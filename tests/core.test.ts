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
  HuggingFaceProvider,
  normalizeProviderError,
} from "../apps/api/src/provider";
afterEach(() => vi.restoreAllMocks());
describe("validation and category registry", () => {
  it("requires only the relevant photo", () => {
    expect(readiness("tops", ["upper"]).ready).toBe(true);
    expect(readiness("dresses", ["upper"]).ready).toBe(false);
    expect(readiness("dresses", ["full"]).ready).toBe(false);
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
  it("exposes only the verified IDM-VTON upper-body categories", () => {
    const p = new HuggingFaceProvider();
    expect(p.getCapabilities()).toMatchObject({
      name: "huggingface",
      model: "yisol/IDM-VTON",
      categories: ["tops", "shirts"],
      lifestyle: false,
    });
    expect(() => p.validateInput("tops")).not.toThrow();
    expect(() => p.validateInput("shirts")).not.toThrow();
    expect(() => p.validateInput("dresses")).toThrow("CATEGORY_UNSUPPORTED");
    expect(() => p.validateInput("pants")).toThrow("CATEGORY_UNSUPPORTED");
  });
});
