import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
await mkdir("dist", { recursive: true });
execFileSync(
  "zip",
  ["-qr", "-FS", resolve("dist/tryon-studio-extension.zip"), "."],
  { cwd: "apps/extension/dist" },
);
console.log("dist/tryon-studio-extension.zip");
