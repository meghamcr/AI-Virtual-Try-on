import { build as vite } from "vite";
import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
import "dotenv/config";
import sharp from "sharp";
const api = new URL(process.env.VITE_API_URL || "http://localhost:4000");
if (
  api.protocol !== "https:" &&
  !["localhost", "127.0.0.1"].includes(api.hostname)
)
  throw Error("Remote API requires HTTPS");
await vite({ configFile: "apps/extension/vite.config.ts" });
await build({
  entryPoints: ["apps/extension/src/content.ts"],
  outfile: "apps/extension/dist/content.js",
  bundle: true,
  minify: true,
  format: "iife",
  target: "chrome116",
});
await build({
  entryPoints: ["apps/extension/src/background.ts"],
  outfile: "apps/extension/dist/background.js",
  bundle: true,
  minify: true,
  format: "esm",
  target: "chrome116",
});
const manifest = {
  manifest_version: 3,
  name: "TryOn Studio",
  version: "1.0.0",
  description:
    "Your personal fitting room, across the web. AI appearance previews with reusable private profiles.",
  minimum_chrome_version: "116",
  permissions: ["activeTab", "scripting", "storage", "sidePanel"],
  host_permissions: [`${api.origin}/*`],
  action: { default_popup: "popup.html", default_title: "TryOn Studio" },
  icons: {
    16: "icon-16.png",
    32: "icon-32.png",
    48: "icon-48.png",
    128: "icon-128.png",
  },
  side_panel: { default_path: "sidepanel.html" },
  options_page: "options.html",
  background: { service_worker: "background.js", type: "module" },
  content_security_policy: {
    extension_pages: `script-src 'self'; object-src 'self'; connect-src ${api.origin}; img-src 'self' blob: data: https: http:;`,
  },
};
const icon = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#506a39"/><path d="M42 28v49q0 18 18 12M28 47h39" fill="none" stroke="#fffefb" stroke-width="10" stroke-linecap="round"/><ellipse cx="83" cy="72" rx="18" ry="24" fill="none" stroke="#fffefb" stroke-width="9"/></svg>',
);
for (const size of [16, 32, 48, 128])
  await sharp(icon)
    .resize(size, size)
    .png()
    .toFile(`apps/extension/dist/icon-${size}.png`);
await writeFile(
  "apps/extension/dist/manifest.json",
  JSON.stringify(manifest, null, 2),
);
console.log("Installable MV3 extension built.");
