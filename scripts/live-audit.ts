import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { mkdir, writeFile, mkdtemp, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { fetchImage, normalizeImage } from "../apps/api/src/images";
const bundle = await build({
  entryPoints: ["packages/shared/src/detection.ts"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "TryOnDetection",
  platform: "browser",
});
const directory = await mkdtemp(resolve(tmpdir(), "tryon-live-"));
const extension = resolve("apps/extension/dist");
const context = await chromium.launchPersistentContext(directory, {
  channel: "chromium",
  headless: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
  viewport: { width: 1280, height: 900 },
});
await mkdir("docs/evidence", { recursive: true });
const records: any[] = process.env.LIVE_SITE
  ? JSON.parse(await readFile("docs/evidence/live-audit.json", "utf8")).filter(
      (r: any) => r.site !== process.env.LIVE_SITE,
    )
  : [];
try {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker", { timeout: 15000 }));
  const extensionId = new URL(worker.url()).hostname;
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole("heading", { name: /See it/ }).waitFor();
  await panel.setViewportSize({ width: 390, height: 1000 });
  await panel.screenshot({
    path: "docs/evidence/extension-signin.png",
    fullPage: true,
  });
  const targets = [
    {
      site: "tentree",
      url: "https://www.tentree.com/products/valley-dress-jasper",
      kind: "detail",
    },
    {
      site: "ASKET",
      url: "https://www.asket.com/en-us/mens-t-shirt-white",
      kind: "detail",
    },
    {
      site: "UNIQLO",
      url: "https://www.uniqlo.com/us/en/women/tops/t-shirts?colorDisplayCode=09",
      kind: "listing",
    },
    {
      site: "Everlane",
      url: "https://www.everlane.com/collections/womens-day-to-night-dresses",
      kind: "listing",
    },
  ];
  for (const target of targets.filter(
    (t) => !process.env.LIVE_SITE || t.site === process.env.LIVE_SITE,
  )) {
    const page = await context.newPage();
    const r: any = { ...target, date: new Date().toISOString(), extensionId };
    try {
      const response = await page.goto(target.url, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      r.httpStatus = response?.status();
      await page.waitForTimeout(3500);
      if (target.site === "Everlane") {
        await page.waitForTimeout(2500);
        for (const frame of page.frames()) {
          const dismiss = frame.getByText("No Thanks", { exact: true });
          if (await dismiss.isVisible()) {
            await dismiss.click();
            await page.waitForTimeout(400);
            r.interaction =
              "Dismissed optional newsletter popup using No Thanks";
            break;
          }
        }
      }
      r.finalUrl = page.url();
      r.title = await page.title();
      const body = (await page.locator("body").innerText()).slice(0, 1500);
      if (
        (response?.status() || 0) >= 400 ||
        /access denied|verify you are human|just a moment|captcha/i.test(body)
      ) {
        r.limitation =
          "Site access restriction encountered; no bypass attempted";
      } else {
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        const extracted = await page.evaluate(() => {
          const errors: string[] = [];
          const products = (window as any).TryOnDetection.extractProducts(
            document,
            location.href,
            errors,
          );
          return { products, errors };
        });
        const products = extracted.products;
        r.diagnostics = extracted.errors;
        r.extractionMethod =
          "Production extractor executed in live browser by test harness; toolbar activeTab gesture not automated";
        r.products = products.map((p: any) => ({
          title: p.title,
          category: p.category,
          method: p.method,
          confidence: p.confidence,
          url: p.url,
          images: p.images.length,
          variants: p.variants.length,
        }));
        r.count = products.length;
        if (products[0]?.images[0]) {
          r.selectedImage = products[0].images[0].url;
          try {
            const image = await normalizeImage(
              await fetchImage(r.selectedImage),
            );
            r.retrieval = {
              ok: true,
              width: image.width,
              height: image.height,
            };
          } catch (e) {
            r.retrieval = { ok: false, error: (e as Error).message };
          }
        }
      }
      await page.screenshot({
        path: `docs/evidence/${target.site.toLowerCase()}-live.png`,
      });
    } catch (e) {
      r.error = (e as Error).message;
    }
    records.push(r);
    console.log(JSON.stringify(r));
    await page.close();
  }
} finally {
  await context.close();
  await writeFile(
    "docs/evidence/live-audit.json",
    JSON.stringify(records, null, 2),
  );
}
