import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import sharp from "sharp";
export const MAX_BYTES = 12 * 1024 * 1024;
export function publicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export async function resolvePublic(raw: string) {
  const u = new URL(raw);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    (u.port && !["80", "443"].includes(u.port))
  )
    throw Error("UNSAFE_IMAGE_URL");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const records = await lookup(host, { all: true });
  if (!records.length || records.some((r) => !publicAddress(r.address)))
    throw Error("UNSAFE_IMAGE_URL");
  return { url: u, address: records[0] };
}
export async function fetchImage(raw: string, redirects = 0): Promise<Buffer> {
  if (redirects > 4) throw Error("TOO_MANY_REDIRECTS");
  const { url, address } = await resolvePublic(raw);
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).get(
      url,
      {
        headers: { Accept: "image/*", "User-Agent": "TryOnStudio/1.0" },
        lookup: (_host, options, cb) => {
          // Node's family auto-selection requests the all-address callback form.
          // Return only the pinned, validated destination in either form.
          if (options.all) (cb as any)(null, [address]);
          else cb(null, address.address, address.family);
        },
      },
      (res) => {
        if (
          res.statusCode &&
          [301, 302, 303, 307, 308].includes(res.statusCode)
        ) {
          res.resume();
          clearTimeout(timer);
          if (!res.headers.location) return reject(Error("IMAGE_REDIRECT"));
          fetchImage(
            new URL(res.headers.location, url).href,
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          clearTimeout(timer);
          return reject(Error(`IMAGE_HTTP_${res.statusCode}`));
        }
        if (Number(res.headers["content-length"] || 0) > MAX_BYTES) {
          req.destroy(Error("IMAGE_TOO_LARGE"));
          return;
        }
        let total = 0;
        const chunks: Buffer[] = [];
        res.on("data", (part: Buffer) => {
          total += part.length;
          if (total > MAX_BYTES) req.destroy(Error("IMAGE_TOO_LARGE"));
          else chunks.push(part);
        });
        res.on("end", () => {
          clearTimeout(timer);
          resolve(Buffer.concat(chunks));
        });
        res.on("error", reject);
      },
    );
    const timer = setTimeout(() => req.destroy(Error("IMAGE_TIMEOUT")), 15000);
    req.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}
export async function normalizeImage(input: Buffer) {
  if (input.length > MAX_BYTES || !input.length) throw Error("IMAGE_TOO_LARGE");
  const instance = sharp(input, {
    limitInputPixels: 25_000_000,
    animated: false,
    failOn: "warning",
  });
  const meta = await instance.metadata();
  if (
    !["jpeg", "png", "webp"].includes(meta.format || "") ||
    (meta.pages || 1) > 1
  )
    throw Error("Use a non-animated JPEG, PNG or WebP image");
  if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < 256)
    throw Error("Image must be at least 256 pixels in each dimension");
  const { data, info } = await instance
    .rotate()
    .resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 92 })
    .toBuffer({ resolveWithObject: true });
  const warnings: string[] = [];
  if (Math.min(meta.width, meta.height) < 600)
    warnings.push("Low resolution may reduce detail (dimension heuristic).");
  if (meta.width / meta.height > 2 || meta.height / meta.width > 3)
    warnings.push(
      "Unusual framing; check the required body region (aspect-ratio heuristic).",
    );
  return { data, width: info.width, height: info.height, warnings };
}
export const dataUri = (b: Buffer) =>
  `data:image/jpeg;base64,${b.toString("base64")}`;
