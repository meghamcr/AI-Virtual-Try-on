import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import bcrypt from "bcryptjs";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import {
  authSchema,
  profileSchema,
  slotSchema,
  jobSchema,
  readiness,
  terminal,
} from "../../../packages/shared/src/index";
import { env } from "./config";
import { db, ownedTransaction, garbage } from "./db";
import { get, put, storageReady } from "./storage";
import { MAX_BYTES, normalizeImage } from "./images";
import { provider } from "./provider";
import { queue, enqueue } from "./queue";
export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", env.TRUST_PROXY);
app.use(helmet());
app.use(
  cors({
    origin(origin, cb) {
      cb(null, !origin || env.CORS_ORIGINS.split(",").includes(origin));
    },
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "PATCH", "DELETE"],
  }),
);
app.use(express.json({ limit: "200kb" }));
app.use(
  rateLimit({
    windowMs: 60000,
    limit: 180,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
const fail = (status: number, message: string) =>
  Object.assign(Error(message), { status });
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const token = req.headers.authorization?.match(
      /^Bearer ([a-f0-9]{64})$/,
    )?.[1];
    if (!token) throw fail(401, "Sign in to continue");
    const s = await db.session.findUnique({ where: { id: hash(token) } });
    if (!s || s.expiresAt < new Date()) throw fail(401, "Session expired");
    res.locals.userId = s.userId;
    res.locals.sessionId = s.id;
    next();
  } catch (e) {
    next(e);
  }
};
app.get("/health", (_req, res) =>
  res.json({ ok: true, service: "TryOn Studio" }),
);
app.get(
  "/ready",
  wrap(async (_req, res) => {
    try {
      await Promise.all([
        db.$queryRaw`SELECT 1`,
        queue.getJobCounts(),
        storageReady(),
      ]);
      const configured = env.PROVIDER === "mock" || !!env.FASHN_API_KEY;
      const heartbeat = await (
        await queue.client
      ).get("tryon:worker:heartbeat");
      const worker = !!heartbeat && Date.now() - Number(heartbeat) < 60000;
      res.status(configured && worker ? 200 : 503).json({
        ok: configured && worker,
        provider: env.PROVIDER,
        configured,
        worker,
      });
    } catch {
      res
        .status(503)
        .json({ ok: false, error: "A required service is unavailable" });
    }
  }),
);
app.get("/capabilities", (_req, res) =>
  res.json({
    ...provider.getCapabilities(),
    configured: env.PROVIDER === "mock" || !!env.FASHN_API_KEY,
    consentVersion: "2026-09-27",
  }),
);
const authLimit = rateLimit({ windowMs: 15 * 60000, limit: 20 });
async function session(userId: string) {
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      id: hash(token),
      userId,
      expiresAt: new Date(Date.now() + 7 * 86400000),
    },
  });
  return token;
}
app.post(
  "/auth/register",
  authLimit,
  wrap(async (req, res) => {
    const v = authSchema.parse(req.body);
    const user = await db.user.create({
      data: { email: v.email, passwordHash: await bcrypt.hash(v.password, 12) },
    });
    res.status(201).json({ token: await session(user.id), email: user.email });
  }),
);
app.post(
  "/auth/login",
  authLimit,
  wrap(async (req, res) => {
    const v = authSchema.parse(req.body),
      u = await db.user.findUnique({ where: { email: v.email } });
    if (!u || !(await bcrypt.compare(v.password, u.passwordHash)))
      throw fail(401, "Email or password is incorrect");
    res.json({ token: await session(u.id), email: u.email });
  }),
);
app.use(authenticate);
app.get(
  "/auth/me",
  wrap(async (_req, res) => {
    res.json(
      await db.user.findUnique({
        where: { id: res.locals.userId },
        select: { id: true, email: true, createdAt: true },
      }),
    );
  }),
);
app.post(
  "/auth/logout",
  wrap(async (_req, res) => {
    await db.session.deleteMany({ where: { id: res.locals.sessionId } });
    res.json({ ok: true });
  }),
);
const profileInclude = {
  images: {
    select: {
      id: true,
      slot: true,
      width: true,
      height: true,
      createdAt: true,
    },
  },
} as const;
app.get(
  "/profiles",
  wrap(async (_req, res) =>
    res.json(
      await db.profile.findMany({
        where: { userId: res.locals.userId },
        include: profileInclude,
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      }),
    ),
  ),
);
app.post(
  "/profiles",
  wrap(async (req, res) => {
    const v = profileSchema.parse(req.body);
    const p = await ownedTransaction(res.locals.userId, async (tx) => {
      if (
        (await tx.profile.count({ where: { userId: res.locals.userId } })) >= 10
      )
        throw fail(400, "Maximum 10 profiles");
      const isDefault =
        v.isDefault ||
        !(await tx.profile.count({ where: { userId: res.locals.userId } }));
      if (isDefault)
        await tx.profile.updateMany({
          where: { userId: res.locals.userId },
          data: { isDefault: false },
        });
      return tx.profile.create({
        data: { ...v, isDefault, userId: res.locals.userId },
        include: profileInclude,
      });
    });
    res.status(201).json(p);
  }),
);
app.patch(
  "/profiles/:id",
  wrap(async (req, res) => {
    const v = profileSchema.partial().parse(req.body);
    const p = await ownedTransaction(res.locals.userId, async (tx) => {
      const p = await tx.profile.findFirst({
        where: { id: String(req.params.id), userId: res.locals.userId },
      });
      if (!p) throw fail(404, "Profile not found");
      if (v.isDefault)
        await tx.profile.updateMany({
          where: { userId: p.userId },
          data: { isDefault: false },
        });
      return tx.profile.update({
        where: { id: p.id },
        data: v,
        include: profileInclude,
      });
    });
    res.json(p);
  }),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 0 },
});
app.post(
  "/profiles/:id/images/:slot",
  rateLimit({ windowMs: 60000, limit: 12 }),
  upload.single("image"),
  wrap(async (req, res) => {
    const slot = slotSchema.parse(req.params.slot);
    if (!req.file) throw fail(400, "Choose an image");
    const normalized = await normalizeImage(req.file.buffer);
    const key = `images/${randomUUID()}.jpg`;
    await db.garbageObject.create({ data: { key } });
    const p = await ownedTransaction(res.locals.userId, async (tx) => {
      const p = await tx.profile.findFirst({
        where: { id: String(req.params.id), userId: res.locals.userId },
      });
      if (!p) throw fail(404, "Profile not found");
      await put(key, normalized.data);
      const old = await tx.profileImage.findUnique({
        where: { profileId_slot: { profileId: p.id, slot } },
      });
      if (old) {
        await garbage(tx, [old.key]);
        await tx.tryOnJob.updateMany({
          where: {
            profileId: p.id,
            imageId: old.id,
            status: { notIn: terminal },
          },
          data: { status: "cancelled", errorCode: "PROFILE_PHOTO_REPLACED" },
        });
      }
      const image = await tx.profileImage.upsert({
        where: { profileId_slot: { profileId: p.id, slot } },
        create: {
          profileId: p.id,
          slot,
          key,
          width: normalized.width,
          height: normalized.height,
        },
        update: {
          key,
          width: normalized.width,
          height: normalized.height,
          createdAt: new Date(),
        },
      });
      await tx.garbageObject.delete({ where: { key } });
      return {
        id: image.id,
        slot: image.slot,
        width: image.width,
        height: image.height,
        warnings: normalized.warnings,
      };
    });
    res.status(201).json(p);
  }),
);
app.get(
  "/images/:id",
  wrap(async (req, res) => {
    const p = await db.profileImage.findFirst({
      where: {
        id: String(req.params.id),
        profile: { userId: res.locals.userId },
      },
    });
    if (!p) throw fail(404, "Image not found");
    res.type("image/jpeg").send(await get(p.key));
  }),
);
app.delete(
  "/profiles/:id/images/:slot",
  wrap(async (req, res) => {
    await ownedTransaction(res.locals.userId, async (tx) => {
      const image = await tx.profileImage.findFirst({
        where: {
          profileId: String(req.params.id),
          slot: slotSchema.parse(req.params.slot),
          profile: { userId: res.locals.userId },
        },
      });
      if (!image) throw fail(404, "Image not found");
      await tx.tryOnJob.updateMany({
        where: { imageId: image.id, status: { notIn: terminal } },
        data: { status: "cancelled" },
      });
      await garbage(tx, [image.key]);
      await tx.profileImage.delete({ where: { id: image.id } });
    });
    res.json({ ok: true });
  }),
);
app.post(
  "/jobs",
  rateLimit({ windowMs: 60000, limit: 10 }),
  wrap(async (req, res) => {
    const v = jobSchema.parse(req.body);
    provider.validateInput(v.category);
    if (v.scene !== "original" && !provider.getCapabilities().lifestyle)
      throw fail(400, "Lifestyle is disabled");
    const requestHash = hash(
      JSON.stringify({ ...v, idempotencyKey: undefined }),
    );
    const job = await ownedTransaction(res.locals.userId, async (tx) => {
      const old = await tx.tryOnJob.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: res.locals.userId,
            idempotencyKey: v.idempotencyKey,
          },
        },
      });
      if (old) {
        if (old.requestHash !== requestHash)
          throw fail(
            409,
            "Idempotency key was already used for different inputs",
          );
        return old;
      }
      const p = await tx.profile.findFirst({
        where: { id: v.profileId, userId: res.locals.userId },
        include: { images: true },
      });
      if (!p) throw fail(404, "Profile not found");
      const ready = readiness(
        v.category,
        p.images.map((i) => i.slot),
      );
      if (!ready.ready) throw fail(400, ready.reason);
      if (
        (await tx.tryOnJob.count({
          where: { userId: res.locals.userId, status: { notIn: terminal } },
        })) >= 3
      )
        throw fail(429, "Wait for an active try-on to finish");
      await tx.consentRecord.create({
        data: {
          userId: res.locals.userId,
          provider: env.PROVIDER,
          version: "2026-09-27",
        },
      });
      return tx.tryOnJob.create({
        data: {
          userId: res.locals.userId,
          profileId: p.id,
          imageId: p.images.find((i) => i.slot === ready.slot)!.id,
          idempotencyKey: v.idempotencyKey,
          requestHash,
          category: v.category,
          scene: v.scene,
          provider: env.PROVIDER,
          model: provider.getCapabilities().model,
          product: {
            create: {
              data: v.product,
              selectedImage: v.selectedImage,
              variant: v.variant,
            },
          },
        },
      });
    });
    await enqueue(job.id).catch(() => {
      /* Durable queued DB row is dispatched by reconciler. */
    });
    res.status(202).json({ id: job.id, status: job.status });
  }),
);
const jobSelect = {
  id: true,
  profileId: true,
  category: true,
  scene: true,
  status: true,
  provider: true,
  model: true,
  errorCode: true,
  createdAt: true,
  completedAt: true,
  product: true,
  result: { select: { id: true, saved: true, feedback: true } },
} as const;
app.get(
  "/jobs",
  wrap(async (_req, res) =>
    res.json(
      await db.tryOnJob.findMany({
        where: { userId: res.locals.userId },
        select: jobSelect,
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ),
  ),
);
app.get(
  "/jobs/:id",
  wrap(async (req, res) => {
    const j = await db.tryOnJob.findFirst({
      where: { id: String(req.params.id), userId: res.locals.userId },
      select: jobSelect,
    });
    if (!j) throw fail(404, "Job not found");
    res.json(j);
  }),
);
app.post(
  "/jobs/:id/cancel",
  wrap(async (req, res) => {
    await ownedTransaction(res.locals.userId, async (tx) => {
      const j = await tx.tryOnJob.findFirst({
        where: { id: String(req.params.id), userId: res.locals.userId },
      });
      if (!j) throw fail(404, "Job not found");
      if (!terminal.includes(j.status))
        await tx.tryOnJob.update({
          where: { id: j.id },
          data: { status: "cancelled" },
        });
    });
    res.json({
      ok: true,
      note: "Local job cancelled. Already submitted provider computation may finish and incur a charge; its output will not be published.",
    });
  }),
);
app.get(
  "/results",
  wrap(async (_req, res) =>
    res.json(
      await db.tryOnJob.findMany({
        where: {
          userId: res.locals.userId,
          status: "completed",
          result: { isNot: null },
        },
        select: jobSelect,
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ),
  ),
);
app.get(
  "/jobs/:id/media/:kind",
  wrap(async (req, res) => {
    const j = await db.tryOnJob.findFirst({
      where: { id: String(req.params.id), userId: res.locals.userId },
      include: { result: true },
    });
    if (!j) throw fail(404, "Image not found");
    const key =
      req.params.kind === "original"
        ? j.originalKey
        : req.params.kind === "product"
          ? j.garmentKey
          : req.params.kind === "result"
            ? j.result?.key
            : undefined;
    if (!key) throw fail(404, "Image not found");
    if (req.query.download === "1") res.attachment(`tryon-${j.id}.jpg`);
    res.type("image/jpeg").send(await get(key));
  }),
);
app.patch(
  "/results/:id",
  wrap(async (req, res) => {
    const v = z
      .object({
        saved: z.boolean().optional(),
        feedback: z
          .enum([
            "Product details changed",
            "Face changed",
            "Incorrect positioning",
            "Wrong color",
            "Unnatural body shape",
          ])
          .optional(),
      })
      .parse(req.body);
    const r = await db.tryOnResult.findFirst({
      where: { id: String(req.params.id), job: { userId: res.locals.userId } },
    });
    if (!r) throw fail(404, "Result not found");
    await db.tryOnResult.update({ where: { id: r.id }, data: v });
    res.json({ ok: true });
  }),
);
app.delete(
  "/jobs/:id",
  wrap(async (req, res) => {
    await ownedTransaction(res.locals.userId, async (tx) => {
      const j = await tx.tryOnJob.findFirst({
        where: { id: String(req.params.id), userId: res.locals.userId },
        include: { result: true },
      });
      if (!j) throw fail(404, "Job not found");
      await garbage(tx, [
        j.originalKey,
        j.garmentKey,
        j.intermediateKey,
        j.result?.key,
      ]);
      await tx.tryOnJob.delete({ where: { id: j.id } });
    });
    res.json({ ok: true });
  }),
);
app.delete(
  "/results/:id",
  wrap(async (req, res) => {
    await ownedTransaction(res.locals.userId, async (tx) => {
      const r = await tx.tryOnResult.findFirst({
        where: {
          id: String(req.params.id),
          job: { userId: res.locals.userId },
        },
        include: { job: true },
      });
      if (!r) throw fail(404, "Result not found");
      await garbage(tx, [
        r.key,
        r.job.originalKey,
        r.job.garmentKey,
        r.job.intermediateKey,
      ]);
      await tx.tryOnJob.delete({ where: { id: r.jobId } });
    });
    res.json({ ok: true });
  }),
);
app.delete(
  "/profiles/:id",
  wrap(async (req, res) => {
    await ownedTransaction(res.locals.userId, async (tx) => {
      const p = await tx.profile.findFirst({
        where: { id: String(req.params.id), userId: res.locals.userId },
        include: { images: true, jobs: { include: { result: true } } },
      });
      if (!p) throw fail(404, "Profile not found");
      await garbage(tx, [
        ...p.images.map((i) => i.key),
        ...p.jobs.flatMap((j) => [
          j.originalKey,
          j.garmentKey,
          j.intermediateKey,
          j.result?.key,
        ]),
      ]);
      await tx.profile.delete({ where: { id: p.id } });
      if (p.isDefault) {
        const first = await tx.profile.findFirst({
          where: { userId: res.locals.userId },
          orderBy: { createdAt: "asc" },
        });
        if (first)
          await tx.profile.update({
            where: { id: first.id },
            data: { isDefault: true },
          });
      }
    });
    res.json({ ok: true });
  }),
);
app.delete(
  "/account",
  wrap(async (_req, res) => {
    await ownedTransaction(res.locals.userId, async (tx) => {
      const profiles = await tx.profile.findMany({
          where: { userId: res.locals.userId },
          include: { images: true },
        }),
        jobs = await tx.tryOnJob.findMany({
          where: { userId: res.locals.userId },
          include: { result: true },
        });
      await garbage(tx, [
        ...profiles.flatMap((p) => p.images.map((i) => i.key)),
        ...jobs.flatMap((j) => [
          j.originalKey,
          j.garmentKey,
          j.intermediateKey,
          j.result?.key,
        ]),
      ]);
      await tx.user.delete({ where: { id: res.locals.userId } });
    });
    res.json({ ok: true });
  }),
);
app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  const known =
    error instanceof ZodError ||
    error.status ||
    error.code === "P2002" ||
    error.code === "LIMIT_FILE_SIZE" ||
    error.message?.startsWith("PROVIDER_");
  const status =
    error instanceof ZodError
      ? 400
      : error.code === "P2002"
        ? 409
        : error.code === "LIMIT_FILE_SIZE"
          ? 413
          : error.message === "PROVIDER_NOT_CONFIGURED"
            ? 503
            : error.status || 400;
  res.status(known ? status : 400).json({
    error:
      error instanceof ZodError
        ? "Invalid request. Check the required fields."
        : error.code === "P2002"
          ? "This account or resource already exists"
          : error.code === "LIMIT_FILE_SIZE"
            ? "Image limit is 12 MB"
            : known
              ? error.message
              : "Request could not be completed. Check the image and service connection.",
  });
});
