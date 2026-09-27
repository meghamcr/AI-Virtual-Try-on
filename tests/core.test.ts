import { it, expect, describe, vi, afterEach } from "vitest";
import sharp from "sharp";
import {
  readiness,
  jobSchema,
  canTransition,
  authSchema,
  messageSchema,
} from "../packages/shared/src/index";
import {
  publicAddress,
  resolvePublic,
  normalizeImage,
} from "../apps/api/src/images";
import {
  FashnProvider,
  normalizeProviderError,
} from "../apps/api/src/provider";
import { env } from "../apps/api/src/config";
afterEach(() => vi.restoreAllMocks());
describe("validation and category registry", () => {
  it("requires only the relevant photo", () => {
    expect(readiness("tops", ["upper"]).ready).toBe(true);
    expect(readiness("dresses", ["upper"]).ready).toBe(false);
    expect(readiness("dresses", ["full"]).ready).toBe(true);
    expect(readiness("shoes", ["feet"]).ready).toBe(false);
  });
  it("rejects invalid jobs and weak account passwords", () => {
    expect(jobSchema.safeParse({ consent: false }).success).toBe(false);
    expect(
      authSchema.safeParse({ email: "a@b.com", password: "short" }).success,
    ).toBe(false);
  });
  it("rejects arbitrary extension messages", () =>
    expect(
      messageSchema.safeParse({ type: "EXECUTE", code: "alert(1)" }).success,
    ).toBe(false));
  it("keeps terminal states terminal", () => {
    expect(canTransition("cancelled", "completed")).toBe(false);
    expect(canTransition("completed", "saving")).toBe(false);
    expect(canTransition("generating", "queued")).toBe(false);
    expect(canTransition("generating", "failed")).toBe(true);
  });
});
describe("image safety", () => {
  it.each([
    "127.0.0.1",
    "10.2.3.4",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "0.0.0.0",
    "100.64.0.1",
  ])("rejects nonpublic address %s", (ip) =>
    expect(publicAddress(ip)).toBe(false),
  );
  it("allows public unicast", () =>
    expect(publicAddress("93.184.216.34")).toBe(true));
  it("rejects dangerous URL schemes and credential URLs before resolving", async () => {
    await expect(resolvePublic("file:///etc/passwd")).rejects.toThrow();
    await expect(resolvePublic("https://u:p@example.com/a")).rejects.toThrow();
  });
  it("verifies decoded bytes, orientation and strips EXIF", async () => {
    const image = await sharp({
      create: { width: 800, height: 600, channels: 3, background: "blue" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const n = await normalizeImage(image);
    expect(n.width).toBe(600);
    expect(n.height).toBe(800);
    expect((await sharp(n.data).metadata()).exif).toBeUndefined();
    await expect(normalizeImage(Buffer.from("<svg/>"))).rejects.toThrow();
  });
  it("rejects tiny and oversized input", async () => {
    await expect(
      normalizeImage(
        await sharp({
          create: { width: 32, height: 32, channels: 3, background: "red" },
        })
          .png()
          .toBuffer(),
      ),
    ).rejects.toThrow();
    await expect(
      normalizeImage(Buffer.alloc(13 * 1024 * 1024)),
    ).rejects.toThrow();
  });
});
describe("provider contract", () => {
  it("normalizes errors without leaking responses", () => {
    expect(normalizeProviderError(429)).toMatchObject({
      code: "PROVIDER_RATE_LIMIT",
      retryable: true,
    });
    expect(normalizeProviderError(401)).toMatchObject({
      code: "PROVIDER_AUTH",
      retryable: false,
    });
  });
  it("uses documented model and person-plus-garment input", async () => {
    env.FASHN_API_KEY = "test-key";
    const mock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "prediction" }), { status: 200 }),
      );
    const p = new FashnProvider();
    expect(
      await p.submitTryOn(
        Buffer.from("person"),
        Buffer.from("dress"),
        "dresses",
      ),
    ).toBe("prediction");
    const body = JSON.parse(mock.mock.calls[0][1]!.body as string);
    expect(body.model_name).toBe("tryon-v1.6");
    expect(body.inputs.category).toBe("one-pieces");
    expect(body.inputs.model_image).toContain("data:image/jpeg");
    expect(body.inputs.garment_image).toContain("data:image/jpeg");
    expect(body.inputs.return_base64).toBe(true);
  });
  it("never retries an ambiguous paid submission", async () => {
    env.FASHN_API_KEY = "test-key";
    const mock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(Error("Timeout"));
    await expect(
      new FashnProvider().submitTryOn(
        Buffer.from("p"),
        Buffer.from("g"),
        "tops",
      ),
    ).rejects.toMatchObject({ code: "SUBMISSION_UNCERTAIN", retryable: false });
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
