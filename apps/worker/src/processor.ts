import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { db, ownedTransaction, garbage } from "../../api/src/db";
import { get, put, remove } from "../../api/src/storage";
import { fetchImage, normalizeImage } from "../../api/src/images";
import { provider, ProviderError } from "../../api/src/provider";
import { terminal, type CategoryId } from "../../../packages/shared/src/index";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function active(id: string) {
  const j = await db.tryOnJob.findUnique({
    where: { id },
    include: { product: true, result: true },
  });
  return j && !terminal.includes(j.status) ? j : null;
}
async function state(id: string, status: string) {
  await db.tryOnJob.updateMany({
    where: { id, status: { notIn: terminal } },
    data: { status },
  });
}
async function saveObject(
  id: string,
  field: "originalKey" | "garmentKey" | "intermediateKey" | "result",
  data: Buffer,
) {
  const key = `jobs/${randomUUID()}.jpg`;
  await db.garbageObject.create({ data: { key } });
  const j = await active(id);
  if (!j) return;
  await ownedTransaction(j.userId, async (tx) => {
    const current = await tx.tryOnJob.findUnique({ where: { id } });
    if (!current || terminal.includes(current.status)) return;
    if (field !== "result" && current[field]) return;
    await put(key, data);
    if (field === "result") {
      await tx.tryOnResult.upsert({
        where: { jobId: id },
        create: { jobId: id, key },
        update: { key },
      });
      await tx.tryOnJob.update({
        where: { id },
        data: { status: "completed", completedAt: new Date() },
      });
    } else await tx.tryOnJob.update({ where: { id }, data: { [field]: key } });
    await tx.garbageObject.delete({ where: { key } });
  });
}
async function submit(id: string, edit: boolean, fn: () => Promise<string>) {
  let j = await active(id);
  if (!j) return;
  const started = edit ? "editStarted" : "submissionStarted",
    field = edit ? "editProviderId" : "providerId";
  if (j[field]) return j[field]!;
  if (j[started]) throw new ProviderError("SUBMISSION_UNCERTAIN");
  const claimed = await db.tryOnJob.updateMany({
    where: { id, status: { notIn: terminal }, [started]: false },
    data: { [started]: true, status: edit ? "generating" : "submitted" },
  });
  if (!claimed.count) return;
  let providerId: string;
  try {
    providerId = await fn();
  } catch (error) {
    // A timeout, broken response or 5xx can happen after paid work was accepted.
    if (
      error instanceof ProviderError &&
      ["PROVIDER_AUTH", "PROVIDER_REJECTED", "PROVIDER_RATE_LIMIT"].includes(
        error.code,
      )
    )
      throw error;
    throw new ProviderError("SUBMISSION_UNCERTAIN");
  }
  await db.tryOnJob.updateMany({
    where: { id, status: { notIn: terminal } },
    data: { [field]: providerId },
  });
  j = await active(id);
  return j?.[field] || undefined;
}
async function poll(id: string, providerId: string) {
  let failures = 0;
  while (true) {
    const j = await active(id);
    if (!j) return;
    if (Date.now() - j.createdAt.getTime() > 20 * 60000)
      throw new ProviderError("GENERATION_TIMEOUT");
    try {
      const result = await provider.getJobStatus(providerId);
      failures = 0;
      if (result.status === "failed")
        throw new ProviderError("GENERATION_REJECTED");
      if (result.status === "completed") {
        if (!result.output?.[0])
          throw new ProviderError("PROVIDER_OUTPUT_MISSING");
        return result.output[0];
      }
      if (result.status === "processing") await state(id, "generating");
    } catch (e) {
      if (e instanceof ProviderError && e.retryable && failures++ < 8) {
        await sleep(Math.min(30000, 1000 * 2 ** failures));
        continue;
      }
      throw e;
    }
    await sleep(2500);
  }
}
export async function processJob(id: string) {
  try {
    let j = await active(id);
    if (!j) return;
    if (j.provider !== provider.getCapabilities().name)
      throw new ProviderError("PROVIDER_CONFIGURATION_CHANGED");
    if (!j.originalKey) {
      await state(id, "validating");
      provider.validateInput(j.category as CategoryId);
      const image = await db.profileImage.findUnique({
        where: { id: j.imageId },
      });
      if (!image) throw new ProviderError("PROFILE_PHOTO_MISSING");
      await saveObject(id, "originalKey", await get(image.key));
    }
    j = await active(id);
    if (!j) return;
    if (!j.garmentKey) {
      await state(id, "preparing");
      if (!j.product) throw new ProviderError("PRODUCT_MISSING");
      const garment = await normalizeImage(
        await fetchImage(j.product.selectedImage),
      );
      await saveObject(id, "garmentKey", garment.data);
    }
    j = await active(id);
    if (!j) return;
    if (j.provider === "mock") {
      await state(id, "saving");
      const image = await sharp(await get(j.originalKey!))
        .resize({ width: 864 })
        .toBuffer();
      const watermark = Buffer.from(
        '<svg width="864" height="100"><rect width="864" height="100" fill="#171717"/><text x="32" y="58" fill="white" font-size="28">DEMO — NO AI GENERATION</text></svg>',
      );
      await saveObject(
        id,
        "result",
        await sharp(image)
          .composite([{ input: watermark, gravity: "south" }])
          .jpeg()
          .toBuffer(),
      );
      return;
    }
    if (!j.intermediateKey) {
      const person = await get(j.originalKey!),
        garment = await get(j.garmentKey!);
      const pid = await submit(id, false, () =>
        provider.submitTryOn(person, garment, j!.category as CategoryId),
      );
      if (!pid) return;
      const output = await poll(id, pid);
      if (!output) return;
      await saveObject(
        id,
        "intermediateKey",
        await provider.normalizeOutput(output),
      );
    }
    j = await active(id);
    if (!j) return;
    let output: Buffer = await get(j.intermediateKey!);
    if (j.scene !== "original") {
      const editId = await submit(id, true, () =>
        provider.submitScene(output, j!.scene),
      );
      if (!editId) return;
      const sceneOutput = await poll(id, editId);
      if (!sceneOutput) return;
      output = await provider.normalizeOutput(sceneOutput);
    }
    await state(id, "saving");
    await saveObject(id, "result", output);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code =
      error instanceof ProviderError
        ? error.code
        : /^(IMAGE_|UNSAFE_IMAGE_URL|TOO_MANY_REDIRECTS)/.test(message)
          ? message
          : "PROCESSING_FAILED";
    await db.tryOnJob.updateMany({
      where: { id, status: { notIn: terminal } },
      data: { status: "failed", errorCode: code },
    });
  }
}
export async function collectGarbage() {
  const cutoff = new Date(Date.now() - 120000);
  for (const o of await db.garbageObject.findMany({
    where: { createdAt: { lt: cutoff } },
    take: 100,
  })) {
    try {
      await remove(o.key);
      await db.garbageObject.deleteMany({ where: { key: o.key } });
    } catch {
      /* Retry next sweep; never log personal keys. */
    }
  }
  for (const j of await db.tryOnJob.findMany({
    where: {
      status: { in: ["cancelled", "failed"] },
      OR: [
        { originalKey: { not: null } },
        { garmentKey: { not: null } },
        { intermediateKey: { not: null } },
      ],
    },
    take: 100,
  })) {
    await ownedTransaction(j.userId, async (tx) => {
      await garbage(tx, [j.originalKey, j.garmentKey, j.intermediateKey]);
      await tx.tryOnJob.updateMany({
        where: { id: j.id, status: { in: ["cancelled", "failed"] } },
        data: { originalKey: null, garmentKey: null, intermediateKey: null },
      });
    }).catch(() => {});
  }
}
