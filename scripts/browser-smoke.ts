import { chromium, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
const dir = await mkdtemp(resolve(tmpdir(), "tryon-browser-")),
  extension = resolve("apps/extension/dist");
const context = await chromium.launchPersistentContext(dir, {
  channel: "chromium",
  headless: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
  viewport: { width: 390, height: 1000 },
});
let server: ReturnType<typeof spawn> | undefined;
let processor: ReturnType<typeof spawn> | undefined;
let accountToken = "";
const checks: string[] = [];
await context.addInitScript(() => {
  (window as any).scriptPolicyViolations = [];
  document.addEventListener("securitypolicyviolation", (event) => {
    if (event.violatedDirective.includes("script-src"))
      (window as any).scriptPolicyViolations.push(event.blockedURI);
  });
});
try {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).hostname;
  server = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/fixture-api.ts"],
    {
      env: {
        ...process.env,
        PROVIDER: "mock",
        CORS_ORIGINS: `chrome-extension://${id}`,
      },
      stdio: "pipe",
    },
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("API startup timeout")), 15000);
    server!.stdout!.on("data", (d) => {
      if (String(d).includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server!.once("exit", () => reject(Error("API exited")));
  });
  const panel = await context.newPage();
  const errors: string[] = [];
  panel.on("pageerror", (e) => errors.push(e.message));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel
    .getByRole("button", { name: "New here? Create an account" })
    .click();
  await panel.getByLabel("Email").fill(`browser-${randomUUID()}@example.com`);
  await panel.getByLabel("Password").fill("browser-test-password-123");
  await panel.getByRole("button", { name: "Create your account" }).click();
  await expect(
    panel.getByRole("button", { name: "Create your first profile" }),
  ).toBeVisible();
  checks.push("Installed MV3 panel loads and registration works");
  accountToken = await worker.evaluate(
    async () => (await chrome.storage.local.get("token")).token as string,
  );
  await panel
    .getByRole("button", { name: "Create your first profile" })
    .click();
  await panel
    .getByRole("textbox", { name: "Profile name" })
    .fill("Synthetic browser test");
  await panel.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    panel.getByRole("heading", { name: "Synthetic browser test" }),
  ).toBeVisible();
  const photo = await sharp({
    create: { width: 800, height: 1200, channels: 3, background: "#9caa84" },
  })
    .jpeg()
    .toBuffer();
  await panel.locator("input[type=file]").first().setInputFiles({
    name: "synthetic.jpg",
    mimeType: "image/jpeg",
    buffer: photo,
  });
  await expect(panel.getByText("Photo securely saved.")).toBeVisible();
  checks.push("Profile creation and authenticated image upload");
  await mkdir("docs/evidence", { recursive: true });
  await panel.screenshot({
    path: "docs/evidence/extension-profiles.png",
    fullPage: true,
  });
  await panel.getByRole("button", { name: "Try On", exact: true }).click();
  await expect(panel.getByText("Demo mode — no AI generation")).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Run labeled demo" }),
  ).toBeDisabled();
  checks.push("Mock banner is visible and incomplete job is disabled");
  await panel.screenshot({
    path: "docs/evidence/extension-tryon-empty.png",
    fullPage: true,
  });

  processor = spawn(
    process.execPath,
    ["--import", "tsx", "apps/worker/src/index.ts"],
    { env: { ...process.env, PROVIDER: "mock" }, stdio: "pipe" },
  );
  const shopping = await context.newPage();
  await shopping.goto("http://localhost:4000/fixture-product");
  await panel.getByRole("button", { name: "↻ Detect products" }).click();
  await expect(
    panel.getByRole("button", { name: /Browser test dress/ }),
  ).toBeVisible({ timeout: 15000 });
  await panel.getByRole("button", { name: /Browser test dress/ }).click();
  await panel.getByLabel(/I have permission/).check();
  await panel.getByRole("button", { name: "Run labeled demo" }).click();
  await expect(panel.locator(".status.completed")).toBeVisible({
    timeout: 60000,
  });
  checks.push(
    "Content script detects fixture; API, Redis worker and live public garment retrieval complete a labeled mock job",
  );
  await panel.getByRole("button", { name: "♡ Save look" }).click();
  await expect(panel.getByRole("button", { name: "♥ Saved" })).toBeVisible();
  await panel.getByLabel("How did it turn out?").selectOption("Wrong color");
  await panel.screenshot({
    path: "docs/evidence/extension-mock-result.png",
    fullPage: true,
  });
  const pendingDownload = panel.waitForEvent("download");
  await panel.getByRole("button", { name: "↓ Download" }).click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toContain("DEMO");
  checks.push(
    "Result comparison, save, feedback and authenticated download work",
  );
  await panel.close();
  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${id}/sidepanel.html`);
  await expect(reopened.locator(".status.completed")).toBeVisible();
  checks.push("Panel reopening recovers the persisted job");
  expect(
    await reopened.evaluate(() => (window as any).scriptPolicyViolations),
  ).toEqual([]);
  checks.push("No script CSP violations with validator JIT disabled");
  await reopened.getByRole("button", { name: "Settings", exact: true }).click();
  reopened.once("dialog", (dialog) => dialog.accept());
  await reopened
    .getByRole("button", { name: "Delete account & personal data" })
    .click();
  await expect(reopened.getByRole("heading", { name: /See it/ })).toBeVisible();
  checks.push("Account deletion clears session and returns to sign-in");
  await worker.evaluate(async () =>
    chrome.storage.local.set({ token: "0".repeat(64) }),
  );
  await reopened.reload();
  await expect(reopened.getByRole("heading", { name: /See it/ })).toBeVisible();
  await expect
    .poll(async () =>
      worker.evaluate(
        async () => (await chrome.storage.local.get("token")).token,
      ),
    )
    .toBeUndefined();
  checks.push(
    "Expired or revoked sessions recover to sign-in without trapping the user",
  );
  expect(errors).toEqual([]);
  checks.push("No extension page runtime errors");
  await writeFile(
    "docs/evidence/browser-smoke.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        checks,
        provider: "mock",
        realGeneration: false,
      },
      null,
      2,
    ),
  );
  console.log(checks.join("\n"));
} finally {
  if (accountToken)
    await fetch("http://localhost:4000/account", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accountToken}` },
    }).catch(() => {});
  await context.close();
  server?.kill("SIGTERM");
  processor?.kill("SIGTERM");
}
