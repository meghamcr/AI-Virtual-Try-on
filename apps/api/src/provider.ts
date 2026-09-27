import { z } from "zod";
import {
  categories,
  type CategoryId,
} from "../../../packages/shared/src/index";
import { env } from "./config";
import { dataUri, fetchImage, MAX_BYTES, normalizeImage } from "./images";
export class ProviderError extends Error {
  constructor(
    public code: string,
    public retryable = false,
  ) {
    super(code);
  }
}
export function normalizeProviderError(status: number) {
  return new ProviderError(
    status === 401 || status === 403
      ? "PROVIDER_AUTH"
      : status === 429
        ? "PROVIDER_RATE_LIMIT"
        : status >= 500
          ? "PROVIDER_UNAVAILABLE"
          : "PROVIDER_REJECTED",
    status === 429 || status >= 500,
  );
}
const statusSchema = z.object({
  id: z.string(),
  status: z.enum(["starting", "in_queue", "processing", "completed", "failed"]),
  output: z.array(z.string()).optional(),
  error: z.unknown().optional(),
});
export interface Provider {
  getCapabilities(): {
    name: string;
    model: string;
    categories: string[];
    cancel: boolean;
    lifestyle: boolean;
  };
  validateInput(category: CategoryId): void;
  submitTryOn(
    person: Buffer,
    garment: Buffer,
    category: CategoryId,
  ): Promise<string>;
  getJobStatus(id: string): Promise<z.infer<typeof statusSchema>>;
  normalizeOutput(output: string): Promise<Buffer>;
  submitScene(image: Buffer, scene: string): Promise<string>;
}
export class FashnProvider implements Provider {
  getCapabilities() {
    return {
      name: "fashn",
      model: "tryon-v1.6",
      categories: categories.filter((c) => c.modelCategory).map((c) => c.id),
      cancel: false,
      lifestyle: env.ENABLE_LIFESTYLE === "true",
    };
  }
  validateInput(category: CategoryId) {
    if (!categories.find((c) => c.id === category)?.modelCategory)
      throw new ProviderError("CATEGORY_UNSUPPORTED");
    if (!env.FASHN_API_KEY) throw new ProviderError("PROVIDER_NOT_CONFIGURED");
  }
  private async request(path: string, body?: unknown) {
    let response: Response;
    try {
      response = await fetch(`https://api.fashn.ai/v1/${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${env.FASHN_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new ProviderError(
        body ? "SUBMISSION_UNCERTAIN" : "PROVIDER_UNAVAILABLE",
        !body,
      );
    }
    if (!response.ok) throw normalizeProviderError(response.status);
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderError("PROVIDER_RESPONSE_INVALID");
    const parts: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES * 2) {
        await reader.cancel();
        throw new ProviderError("PROVIDER_OUTPUT_TOO_LARGE");
      }
      parts.push(value);
    }
    const raw = Buffer.concat(parts).toString("utf8");
    try {
      return JSON.parse(raw);
    } catch {
      throw new ProviderError("PROVIDER_RESPONSE_INVALID");
    }
  }
  async submitTryOn(person: Buffer, garment: Buffer, category: CategoryId) {
    this.validateInput(category);
    const c = categories.find((c) => c.id === category)!;
    return z.object({ id: z.string() }).parse(
      await this.request("run", {
        model_name: "tryon-v1.6",
        inputs: {
          model_image: dataUri(person),
          garment_image: dataUri(garment),
          category: c.modelCategory,
          garment_photo_type: "auto",
          mode: "balanced",
          moderation_level: "conservative",
          num_samples: 1,
          output_format: "jpeg",
          return_base64: true,
        },
      }),
    ).id;
  }
  async getJobStatus(id: string) {
    return statusSchema.parse(
      await this.request(`status/${encodeURIComponent(id)}`),
    );
  }
  async submitScene(image: Buffer, scene: string) {
    if (!this.getCapabilities().lifestyle)
      throw new ProviderError("LIFESTYLE_DISABLED");
    const scenes: Record<string, string> = {
      studio: "a neutral photography studio",
      outdoors: "a softly lit garden",
      beach: "a quiet beach",
      city: "a city sidewalk",
    };
    if (!scenes[scene]) throw new ProviderError("SCENE_INVALID");
    return z.object({ id: z.string() }).parse(
      await this.request("run", {
        model_name: "edit",
        inputs: {
          image: dataUri(image),
          prompt: `Change only the background to ${scenes[scene]}. Preserve the person, face, pose, body, clothing color, pattern, logos and silhouette. Do not alter the garment or add accessories.`,
          resolution: "1k",
          generation_mode: "fast",
          num_images: 1,
          output_format: "jpeg",
          return_base64: true,
        },
      }),
    ).id;
  }
  async normalizeOutput(output: string) {
    let bytes: Buffer;
    if (/^data:image\/(jpeg|png);base64,/.test(output)) {
      if (output.length > MAX_BYTES * 1.4)
        throw new ProviderError("PROVIDER_OUTPUT_TOO_LARGE");
      bytes = Buffer.from(output.split(",")[1], "base64");
    } else {
      const u = new URL(output);
      if (
        u.protocol !== "https:" ||
        !["cdn.fashn.ai", "media.fashn.ai"].includes(u.hostname)
      )
        throw new ProviderError("PROVIDER_OUTPUT_INVALID");
      bytes = await fetchImage(output);
    }
    return (await normalizeImage(bytes)).data;
  }
}
export class MockProvider implements Provider {
  getCapabilities() {
    return {
      name: "mock",
      model: "no-ai-demo",
      categories: categories.filter((c) => c.modelCategory).map((c) => c.id),
      cancel: false,
      lifestyle: false,
    };
  }
  validateInput(c: CategoryId) {
    if (!categories.find((x) => x.id === c)?.modelCategory)
      throw new ProviderError("CATEGORY_UNSUPPORTED");
  }
  async submitTryOn() {
    return "mock-explicit-demo";
  }
  async getJobStatus(id: string) {
    return { id, status: "completed" as const, output: ["mock"] };
  }
  async normalizeOutput(): Promise<Buffer> {
    throw Error(
      "Mock output uses the stored original and is labeled; no generated image.",
    );
  }
  async submitScene(): Promise<string> {
    throw Error("LIFESTYLE_DISABLED");
  }
}
export const provider: Provider =
  env.PROVIDER === "mock" ? new MockProvider() : new FashnProvider();
