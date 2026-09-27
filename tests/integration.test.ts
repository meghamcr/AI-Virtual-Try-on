import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
vi.mock("../apps/api/src/images", async (original) => {
  const mod = await original<typeof import("../apps/api/src/images")>();
  return {
    ...mod,
    fetchImage: vi.fn(async () =>
      sharp({
        create: {
          width: 800,
          height: 1000,
          channels: 3,
          background: "#9baa83",
        },
      })
        .jpeg()
        .toBuffer(),
    ),
  };
});
const enabled = process.env.INTEGRATION === "1";
describe.skipIf(!enabled)(
  "real database / storage API integration (mock provider, synthetic images)",
  () => {
    let app: any, db: any, queue: any, processJob: any, provider: any;
    let token = "",
      other = "",
      userId = "",
      otherId = "",
      profileId = "";
    let originalPhotoKey = "";
    const auth = () => ({ Authorization: `Bearer ${token}` });
    let body: any;
    beforeAll(async () => {
      process.env.PROVIDER = "mock";
      ({ app } = await import("../apps/api/src/app"));
      ({ db } = await import("../apps/api/src/db"));
      ({ queue } = await import("../apps/api/src/queue"));
      ({ processJob } = await import("../apps/worker/src/processor"));
      ({ provider } = await import("../apps/api/src/provider"));
      await (await import("../apps/api/src/storage")).initStorage();
      for (const index of [0, 1]) {
        const r = await request(app)
          .post("/auth/register")
          .send({
            email: `test-${randomUUID()}@example.com`,
            password: "test-password-1234",
          });
        expect(r.status).toBe(201);
        const me = await request(app)
          .get("/auth/me")
          .set("Authorization", `Bearer ${r.body.token}`);
        if (index === 0) {
          token = r.body.token;
          userId = me.body.id;
        } else {
          other = r.body.token;
          otherId = me.body.id;
        }
      }
      const p = await request(app)
        .post("/profiles")
        .set(auth())
        .send({ name: "Test profile" });
      profileId = p.body.id;
      const img = await sharp({
        create: { width: 800, height: 1200, channels: 3, background: "#ddd" },
      })
        .jpeg()
        .toBuffer();
      expect(
        (
          await request(app)
            .post(`/profiles/${profileId}/images/full`)
            .set(auth())
            .attach("image", img, "person.jpg")
        ).status,
      ).toBe(201);
      originalPhotoKey = (
        await db.profileImage.findFirst({ where: { profileId } })
      ).key;
      body = {
        profileId,
        category: "tops",
        scene: "original",
        consent: true,
        idempotencyKey: randomUUID(),
        selectedImage: "https://shop.example/top.jpg",
        product: {
          id: "p1",
          source: "https://shop.example/dress",
          url: "https://shop.example/dress",
          title: "Blue dress",
          category: "tops",
          images: [{ url: "https://shop.example/top.jpg", score: 10 }],
          variants: [],
          method: "jsonld",
          confidence: 0.9,
        },
      };
    });
    afterAll(async () => {
      if (!db) return;
      await request(app).delete("/account").set(auth());
      await request(app)
        .delete("/account")
        .set("Authorization", `Bearer ${other}`);
      await queue.close();
      await db.$disconnect();
    });
    it("enforces authentication and profile ownership", async () => {
      expect((await request(app).get("/profiles")).status).toBe(401);
      expect(
        (
          await request(app)
            .patch(`/profiles/${profileId}`)
            .set("Authorization", `Bearer ${other}`)
            .send({ name: "stolen" })
        ).status,
      ).toBe(404);
      expect(
        (
          await request(app)
            .post("/jobs")
            .set("Authorization", `Bearer ${other}`)
            .send(body)
        ).status,
      ).toBe(404);
    });
    it("validates consent and selected image membership", async () => {
      expect(
        (
          await request(app)
            .post("/jobs")
            .set(auth())
            .send({ ...body, consent: false })
        ).status,
      ).toBe(400);
      expect(
        (
          await request(app)
            .post("/jobs")
            .set(auth())
            .send({ ...body, selectedImage: "https://other.example/image.jpg" })
        ).status,
      ).toBe(400);
    });
    it("deduplicates creation, completes mock output, authorizes media and saves feedback", async () => {
      const a = await request(app).post("/jobs").set(auth()).send(body),
        b = await request(app).post("/jobs").set(auth()).send(body);
      expect(a.status).toBe(202);
      expect(b.body.id).toBe(a.body.id);
      expect(
        (
          await request(app)
            .post("/jobs")
            .set(auth())
            .send({ ...body, scene: "city" })
        ).status,
      ).toBe(400);
      await processJob(a.body.id);
      const done = await request(app).get(`/jobs/${a.body.id}`).set(auth());
      expect(done.body.status).toBe("completed");
      expect(done.body.provider).toBe("mock");
      expect(
        (await request(app).get(`/jobs/${a.body.id}/media/result`).set(auth()))
          .status,
      ).toBe(200);
      expect(
        (
          await request(app)
            .get(`/jobs/${a.body.id}/media/result`)
            .set("Authorization", `Bearer ${other}`)
        ).status,
      ).toBe(404);
      expect(
        (
          await request(app)
            .patch(`/results/${done.body.result.id}`)
            .set(auth())
            .send({ saved: true, feedback: "Wrong color" })
        ).status,
      ).toBe(200);
      expect(
        (
          await request(app)
            .delete(`/results/${done.body.result.id}`)
            .set(auth())
        ).status,
      ).toBe(200);
      expect(
        (await request(app).get(`/jobs/${a.body.id}/media/result`).set(auth()))
          .status,
      ).toBe(404);
    });
    it("does not resurrect a job deleted while preparing a product", async () => {
      const images = await import("../apps/api/src/images");
      let release!: () => void, entered!: () => void;
      const started = new Promise<void>((r) => (entered = r)),
        gate = new Promise<void>((r) => (release = r));
      vi.mocked(images.fetchImage).mockImplementationOnce(async () => {
        entered();
        await gate;
        return sharp({
          create: { width: 800, height: 1000, channels: 3, background: "blue" },
        })
          .jpeg()
          .toBuffer();
      });
      const a = await request(app)
        .post("/jobs")
        .set(auth())
        .send({ ...body, idempotencyKey: randomUUID() });
      const running = processJob(a.body.id);
      await started;
      expect(
        (await request(app).delete(`/jobs/${a.body.id}`).set(auth())).status,
      ).toBe(200);
      release();
      await running;
      expect(
        await db.tryOnJob.findUnique({ where: { id: a.body.id } }),
      ).toBeNull();
      expect(await db.tryOnResult.count({ where: { jobId: a.body.id } })).toBe(
        0,
      );
    });
    it("recovers saved provider IDs without resubmitting", async () => {
      const a = await request(app)
        .post("/jobs")
        .set(auth())
        .send({ ...body, idempotencyKey: randomUUID() });
      await db.tryOnJob.update({
        where: { id: a.body.id },
        data: {
          provider: "huggingface",
          providerId: "persisted-id",
          submissionStarted: true,
          status: "submitted",
        },
      });
      const caps = vi.spyOn(provider, "getCapabilities").mockReturnValue({
          name: "huggingface",
          model: "yisol/IDM-VTON",
          categories: ["tops", "shirts"],
          cancel: false,
          lifestyle: false,
        }),
        submit = vi.spyOn(provider, "submitTryOn"),
        poll = vi.spyOn(provider, "getJobStatus").mockResolvedValue({
          id: "persisted-id",
          status: "completed",
          output: ["test-output"],
        }),
        normalize = vi.spyOn(provider, "normalizeOutput").mockResolvedValue(
          await sharp({
            create: {
              width: 800,
              height: 1200,
              channels: 3,
              background: "green",
            },
          })
            .jpeg()
            .toBuffer(),
        );
      await processJob(a.body.id);
      expect(submit).not.toHaveBeenCalled();
      expect(poll).toHaveBeenCalledWith("persisted-id");
      expect(
        (await db.tryOnJob.findUnique({ where: { id: a.body.id } })).status,
      ).toBe("completed");
      caps.mockRestore();
      submit.mockRestore();
      poll.mockRestore();
      normalize.mockRestore();
    });
    it("fails uncertain submissions rather than creating duplicate paid jobs", async () => {
      const a = await request(app)
        .post("/jobs")
        .set(auth())
        .send({ ...body, idempotencyKey: randomUUID() });
      await db.tryOnJob.update({
        where: { id: a.body.id },
        data: {
          provider: "huggingface",
          submissionStarted: true,
          status: "submitted",
        },
      });
      const caps = vi.spyOn(provider, "getCapabilities").mockReturnValue({
          name: "huggingface",
          model: "yisol/IDM-VTON",
          categories: ["tops", "shirts"],
          cancel: false,
          lifestyle: false,
        }),
        submit = vi.spyOn(provider, "submitTryOn");
      await processJob(a.body.id);
      expect(submit).not.toHaveBeenCalled();
      expect(
        (await db.tryOnJob.findUnique({ where: { id: a.body.id } })).errorCode,
      ).toBe("SUBMISSION_UNCERTAIN");
      caps.mockRestore();
      submit.mockRestore();
    });
    it("cancels an active job on photo replacement and removes all data on profile deletion", async () => {
      const a = await request(app)
        .post("/jobs")
        .set(auth())
        .send({ ...body, idempotencyKey: randomUUID() });
      const img = await sharp({
        create: { width: 800, height: 1200, channels: 3, background: "white" },
      })
        .jpeg()
        .toBuffer();
      await request(app)
        .post(`/profiles/${profileId}/images/full`)
        .set(auth())
        .attach("image", img, "new.jpg");
      expect(
        (await request(app).get(`/jobs/${a.body.id}`).set(auth())).body.status,
      ).toBe("cancelled");
      expect(
        (await request(app).delete(`/profiles/${profileId}`).set(auth()))
          .status,
      ).toBe(200);
      expect(await db.tryOnJob.count({ where: { userId } })).toBe(0);
      expect(await db.garbageObject.count()).toBeGreaterThan(0);
      expect(otherId).toBeTruthy();
    });
    it("physically removes deleted images and revokes account sessions", async () => {
      const { get } = await import("../apps/api/src/storage");
      const { collectGarbage } = await import("../apps/worker/src/processor");
      await db.garbageObject.update({
        where: { key: originalPhotoKey },
        data: { createdAt: new Date(Date.now() - 180000) },
      });
      await collectGarbage();
      await expect(get(originalPhotoKey)).rejects.toThrow();
      expect(
        await db.garbageObject.findUnique({ where: { key: originalPhotoKey } }),
      ).toBeNull();
      expect((await request(app).delete("/account").set(auth())).status).toBe(
        200,
      );
      expect((await request(app).get("/auth/me").set(auth())).status).toBe(401);
    });
  },
);
