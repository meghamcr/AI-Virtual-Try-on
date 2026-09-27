import { z } from "zod";
import { categories, type CategoryId } from "../../../packages/shared/src/index";
import { env } from "./config";
import { MAX_BYTES, normalizeImage } from "./images";

export class ProviderError extends Error {
  constructor(public code: string, public retryable = false) {
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
  submitTryOn(person: Buffer, garment: Buffer, category: CategoryId): Promise<string>;
  getJobStatus(id: string): Promise<z.infer<typeof statusSchema>>;
  normalizeOutput(output: string): Promise<Buffer>;
  submitScene(image: Buffer, scene: string): Promise<string>;
}

const HF_SPACE = env.HF_SPACE_URL.replace(/\/$/, "");
const HF_TRYON_CATEGORIES = new Set<CategoryId>(["tops", "shirts"]);

function hfHeaders(json = false): Record<string, string> {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(env.HF_TOKEN ? { Authorization: `Bearer ${env.HF_TOKEN}` } : {}),
  };
}

async function hfFetch(url: string, init: RequestInit, timeoutMs = 30000) {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ProviderError("PROVIDER_UNAVAILABLE", true);
  }
  if (!response.ok) throw normalizeProviderError(response.status);
  return response;
}

type FileData = {
  path: string;
  orig_name: string;
  meta: { _type: "gradio.FileData" };
};

export class HuggingFaceProvider implements Provider {
  getCapabilities() {
    return {
      name: "huggingface",
      model: "yisol/IDM-VTON",
      categories: categories.filter((c) => HF_TRYON_CATEGORIES.has(c.id)).map((c) => c.id),
      cancel: false,
      lifestyle: false,
    };
  }

  validateInput(category: CategoryId) {
    if (!HF_TRYON_CATEGORIES.has(category))
      throw new ProviderError("CATEGORY_UNSUPPORTED");
  }

  private async upload(bytes: Buffer, name: string): Promise<FileData> {
    const form = new FormData();
    form.append("files", new Blob([Uint8Array.from(bytes).buffer], { type: "image/jpeg" }), name);
    let response: Response | undefined;
    for (const path of ["/gradio_api/upload", "/upload"]) {
      try {
        response = await hfFetch(`${HF_SPACE}${path}`, {
          method: "POST",
          headers: hfHeaders(false),
          body: form,
        });
        break;
      } catch (error) {
        if (error instanceof ProviderError && error.code === "PROVIDER_REJECTED") continue;
        throw error;
      }
    }
    if (!response) throw new ProviderError("PROVIDER_UNAVAILABLE", true);
    const paths = z.array(z.string()).parse(await response.json());
    if (!paths[0]) throw new ProviderError("PROVIDER_RESPONSE_INVALID");
    return { path: paths[0], orig_name: name, meta: { _type: "gradio.FileData" } };
  }

  async submitTryOn(person: Buffer, garment: Buffer, category: CategoryId) {
    this.validateInput(category);
    const [human, cloth] = await Promise.all([
      this.upload(person, "person.jpg"),
      this.upload(garment, "garment.jpg"),
    ]);
    const data = [
      { background: human, layers: [], composite: null },
      cloth,
      category === "shirts" ? "shirt" : "T-shirt or upper-body top",
      true,
      false,
      30,
      42,
    ];

    let response: Response | undefined;
    for (const path of ["/gradio_api/call/tryon", "/call/tryon"]) {
      try {
        response = await hfFetch(`${HF_SPACE}${path}`, {
          method: "POST",
          headers: hfHeaders(true),
          body: JSON.stringify({ data }),
        });
        break;
      } catch (error) {
        if (error instanceof ProviderError && error.code === "PROVIDER_REJECTED") continue;
        throw error;
      }
    }
    if (!response) throw new ProviderError("PROVIDER_UNAVAILABLE", true);
    return z.object({ event_id: z.string() }).parse(await response.json()).event_id;
  }

  async getJobStatus(id: string) {
    let response: Response | undefined;
    for (const path of [
      `/gradio_api/call/tryon/${encodeURIComponent(id)}`,
      `/call/tryon/${encodeURIComponent(id)}`,
    ]) {
      try {
        response = await hfFetch(`${HF_SPACE}${path}`, {
          method: "GET",
          headers: hfHeaders(false),
        }, 19 * 60 * 1000);
        break;
      } catch (error) {
        if (error instanceof ProviderError && error.code === "PROVIDER_REJECTED") continue;
        throw error;
      }
    }
    if (!response) throw new ProviderError("PROVIDER_UNAVAILABLE", true);
    const stream = await response.text();
    if (/event:\s*error/i.test(stream)) {
      if (/quota|rate.?limit|too many/i.test(stream))
        throw new ProviderError("PROVIDER_RATE_LIMIT", true);
      return { id, status: "failed" as const, error: stream.slice(-1000) };
    }
    const matches = [...stream.matchAll(/event:\s*complete\s*\ndata:\s*(.+)(?:\n|$)/g)];
    const last = matches.at(-1)?.[1];
    if (!last) return { id, status: "processing" as const };
    let data: unknown;
    try {
      data = JSON.parse(last);
    } catch {
      throw new ProviderError("PROVIDER_RESPONSE_INVALID");
    }
    const parsed = z.array(z.unknown()).parse(data);
    const first = parsed[0];
    const output =
      typeof first === "string"
        ? first
        : z.object({ url: z.string().url().optional(), path: z.string().optional() }).parse(first).url;
    if (!output) throw new ProviderError("PROVIDER_OUTPUT_MISSING");
    return { id, status: "completed" as const, output: [output] };
  }

  async normalizeOutput(output: string) {
    const url = new URL(output, HF_SPACE);
    const expected = new URL(HF_SPACE);
    if (url.protocol !== "https:" || url.hostname !== expected.hostname)
      throw new ProviderError("PROVIDER_OUTPUT_INVALID");
    const response = await hfFetch(url.toString(), { method: "GET", headers: hfHeaders(false) });
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_BYTES * 2) throw new ProviderError("PROVIDER_OUTPUT_TOO_LARGE");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_BYTES * 2) throw new ProviderError("PROVIDER_OUTPUT_TOO_LARGE");
    return (await normalizeImage(bytes)).data;
  }

  async submitScene(): Promise<string> {
    throw new ProviderError("LIFESTYLE_DISABLED");
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
  async submitTryOn() { return "mock-explicit-demo"; }
  async getJobStatus(id: string) {
    return { id, status: "completed" as const, output: ["mock"] };
  }
  async normalizeOutput(): Promise<Buffer> {
    throw Error("Mock output uses the stored original and is labeled; no generated image.");
  }
  async submitScene(): Promise<string> { throw Error("LIFESTYLE_DISABLED"); }
}

export const provider: Provider =
  env.PROVIDER === "mock" ? new MockProvider() : new HuggingFaceProvider();
