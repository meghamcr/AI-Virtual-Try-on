// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  extractProducts,
  jsonProducts,
  imageCandidates,
  absolute,
} from "../packages/shared/src/detection";
const fixture = (name: string) =>
  new DOMParser().parseFromString(
    readFileSync(`tests/fixtures/${name}.html`, "utf8"),
    "text/html",
  );
describe("product extraction", () => {
  it("walks arrays and nested graphs", () =>
    expect(
      jsonProducts([
        { "@graph": [{ "@type": ["Thing", "Product"], name: "Dress" }] },
      ]),
    ).toHaveLength(1));
  it("extracts detail metadata and associated variant images", () => {
    const p = extractProducts(
      fixture("detail"),
      "https://shop.example/products/cotton-tee",
    )[0];
    expect(p.title).toBe("Organic cotton T-shirt");
    expect(p.price).toBe("32.00");
    expect(p.brand).toBe("Field");
    expect(p.variants[1]).toMatchObject({
      label: "Green",
      image: "https://shop.example/images/tee-green.jpg",
    });
    expect(p.images.some((i) => i.url.endsWith("tee-green.jpg"))).toBe(true);
  });
  it("extracts multiple generic listing cards without mixing images", () => {
    const p = extractProducts(
      fixture("listing"),
      "https://shop.example/collections/new",
    );
    expect(p).toHaveLength(2);
    expect(p[0].category).toBe("dresses");
    expect(p[0].images[0].url).toBe("https://shop.example/images/dress.jpg");
    expect(p[1].images.every((i) => i.url.includes("top"))).toBe(true);
  });
  it("resolves picture, srcset, relative and lazy image URLs", () => {
    const images = imageCandidates(
      fixture("detail"),
      "https://shop.example/products/cotton-tee",
    );
    expect(images.map((i) => i.url)).toContain(
      "https://shop.example/images/tee-large.webp",
    );
    expect(images.map((i) => i.url)).toContain(
      "https://shop.example/images/tee-large.jpg",
    );
  });
  it("deduplicates DOM candidates", () => {
    document.body.innerHTML = '<img src="/tee.jpg"><img src="/tee.jpg">';
    expect(imageCandidates(document, "https://shop.example")).toHaveLength(1);
  });
  it("rejects non-http URLs and tracking pixels", () => {
    expect(
      absolute("javascript:alert(1)", "https://shop.example"),
    ).toBeUndefined();
    expect(
      imageCandidates(fixture("listing"), "https://shop.example").some(
        (i) => i.url.includes("pixel") || i.url.includes("logo"),
      ),
    ).toBe(false);
  });
  it("isolates malformed JSON-LD and reads microdata", () => {
    document.body.innerHTML =
      '<script type="application/ld+json">broken</script><div itemscope itemtype="https://schema.org/Product"><span itemprop="name">Summer dress</span><img itemprop="image" src="/dress.png"/></div>';
    expect(extractProducts(document, "https://shop.example")[0].method).toBe(
      "microdata",
    );
  });
  it("falls back to Open Graph metadata", () => {
    document.head.innerHTML =
      '<meta property="og:title" content="Blue shirt"><meta property="og:image" content="/blue.jpg">';
    document.body.innerHTML = "";
    expect(extractProducts(document, "https://shop.example")[0]).toMatchObject({
      title: "Blue shirt",
      method: "metadata",
      category: "shirts",
    });
  });
});
it("keeps the main metadata product ahead of recommendations", () => {
  document.head.innerHTML =
    '<meta property="og:title" content="Blue dress"><meta property="og:image" content="/blue.jpg"><meta property="og:type" content="product">';
  document.body.innerHTML =
    '<main><div class="product-card"><a href="/products/other"><img src="/other.jpg" alt="Other top" width="800" height="900"></a></div></main>';
  const p = extractProducts(document, "https://shop.example/products/dress");
  expect(p[0].title).toBe("Blue dress");
  expect(p[0].images[0].url).toBe("https://shop.example/blue.jpg");
});
it("does not let empty quick-add controls suppress semantic listing cards", () => {
  document.head.innerHTML = "";
  document.body.innerHTML =
    '<main><div data-product-id="x"><button>Quick add</button></div><a href="/products/dress"><img src="/dress.jpg" alt="Linen dress" width="700" height="1000"></a></main>';
  expect(
    extractProducts(document, "https://shop.example/collections/new")[0].title,
  ).toBe("Linen dress");
});
