// Opens an isolated, disposable manual QA session; no real AI or personal photos.
import { chromium } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
process.env.PROVIDER = "mock";
const directory = await mkdtemp(resolve(tmpdir(), "tryon-native-"));
const extension = resolve("apps/extension/dist");
const context = await chromium.launchPersistentContext(directory, {
  channel: "chromium",
  headless: false,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
  viewport: null,
});
const worker =
  context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
const id = new URL(worker.url()).hostname;
process.env.CORS_ORIGINS = `chrome-extension://${id}`;
const { app } = await import("../apps/api/src/app");
const { db } = await import("../apps/api/src/db");
const { queue } = await import("../apps/api/src/queue");
const server = app.listen(4000, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const response = await fetch("http://localhost:4000/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: `native-${randomUUID()}@example.com`,
    password: randomUUID(),
  }),
});
const { token } = (await response.json()) as { token: string };
if (!token) throw Error("Test account creation failed");
await worker.evaluate(
  async (token) => chrome.storage.local.set({ token }),
  token,
);
await context
  .pages()[0]
  .goto("https://www.tentree.com/products/valley-dress-jasper", {
    waitUntil: "domcontentloaded",
  });
console.log(
  "Native QA browser ready. Disposable mock account; no personal photos.",
);
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  await fetch("http://localhost:4000/account", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
  await context.close();
  server.close();
  await queue.close();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
setTimeout(stop, 15 * 60000);
