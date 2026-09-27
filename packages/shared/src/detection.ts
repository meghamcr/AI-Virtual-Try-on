import { inferCategory, productSchema, type Product } from "./index";
const text = (el: Element | null) =>
  el?.textContent?.trim().replace(/\s+/g, " ") || "";
export function absolute(value: unknown, base: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) return;
  try {
    const u = new URL(value, base);
    if (["https:", "http:"].includes(u.protocol)) {
      u.hash = "";
      return u.href;
    }
  } catch {
    /* Invalid website metadata is ignored. */
  }
}
export function jsonProducts(value: unknown): Record<string, any>[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(jsonProducts);
  const obj = value as Record<string, any>;
  const types = Array.isArray(obj["@type"]) ? obj["@type"] : [obj["@type"]];
  return [
    ...(types.includes("Product") ? [obj] : []),
    ...Object.entries(obj)
      .filter(([k]) => k !== "@context")
      .flatMap(([, v]) => jsonProducts(v)),
  ];
}
export function imageCandidates(
  root: Element | Document,
  base: string,
): Product["images"] {
  const found: Product["images"] = [];
  for (const img of [...root.querySelectorAll("img")].slice(0, 300)) {
    if (img.closest('[hidden],[aria-hidden="true"]')) continue;
    const style = img.getAttribute("style") || "";
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) continue;
    const width = img.naturalWidth || Number(img.getAttribute("width")) || 0,
      height = img.naturalHeight || Number(img.getAttribute("height")) || 0;
    if (
      (width && width < 90) ||
      (height && height < 90) ||
      /logo|icon|banner|tracking/i.test(img.getAttribute("alt") || "")
    )
      continue;
    const sets = [
      img.getAttribute("srcset"),
      img.getAttribute("data-srcset"),
      ...Array.from(
        img.closest("picture")?.querySelectorAll("source") || [],
      ).map((s) => s.getAttribute("srcset")),
    ];
    const urls = [
      ...sets.flatMap((s) =>
        (s || "")
          .split(",")
          .map((c) => c.trim().split(/\s+/)[0])
          .reverse(),
      ),
      img.currentSrc,
      img.getAttribute("data-src"),
      img.getAttribute("data-original"),
      img.getAttribute("data-lazy-src"),
      img.getAttribute("src"),
    ];
    for (const raw of urls) {
      const url = absolute(raw, base);
      if (url && !found.some((i) => i.url === url))
        found.push({
          url,
          width: width || undefined,
          height: height || undefined,
          score:
            Math.min((width * height) / 10000, 100) +
            (img.closest('[class*="gallery"],[class*="product"]') ? 30 : 0) +
            (raw === img.currentSrc ? 10 : 0),
        });
    }
  }
  return found.sort((a, b) => b.score - a.score).slice(0, 40);
}
export function extractProducts(
  doc: Document,
  base: string,
  diagnostics?: string[],
): Product[] {
  const products: Product[] = [];
  let counter = 0;
  const add = (p: Partial<Product>) => {
    const r = productSchema.safeParse({
      ...p,
      id: `p${counter++}`,
      source: base,
      category: inferCategory(p.title || ""),
      variants: p.variants || [],
    });
    if (!r.success)
      diagnostics?.push(
        `${p.method}: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
    if (
      r.success &&
      !products.some((x) => x.url === r.data.url && x.title === r.data.title)
    )
      products.push(r.data);
  };
  const controls = (): Product["variants"] =>
    [
      ...doc.querySelectorAll(
        'select[name*="option"] option,select[name*="color"] option,select[name*="size"] option,[role="radio"][aria-label],input[type="radio"][name*="option"],button[data-option-value]',
      ),
    ]
      .slice(0, 80)
      .map((e) => ({
        label: (
          e.getAttribute("aria-label") ||
          e.getAttribute("data-option-value") ||
          e.getAttribute("value") ||
          text(e)
        ).slice(0, 200),
        selected:
          (e as HTMLOptionElement).selected ||
          e.getAttribute("aria-checked") === "true" ||
          (e as HTMLInputElement).checked ||
          false,
      }))
      .filter((v) => v.label);
  for (const script of [
    ...doc.querySelectorAll('script[type="application/ld+json"]'),
  ].slice(0, 30)) {
    if ((script.textContent?.length || 0) > 1000000) continue;
    try {
      for (const item of jsonProducts(JSON.parse(script.textContent || ""))) {
        const raw = Array.isArray(item.image) ? item.image : [item.image];
        const images = raw
          .map((i: any) =>
            absolute(typeof i === "object" ? i?.url || i?.contentUrl : i, base),
          )
          .filter((v, i, a) => !!v && a.indexOf(v) === i)
          .map((url) => ({ url: url!, score: 100 }));
        const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
        const url = absolute(item.url || offer?.url, base) || base;
        const variants = (Array.isArray(item.hasVariant) ? item.hasVariant : [])
          .slice(0, 80)
          .map((v: any) => ({
            label: String(v.color || v.name || v.sku || "Variant").slice(
              0,
              200,
            ),
            image: absolute(
              Array.isArray(v.image) ? v.image[0] : v.image,
              base,
            ),
          }));
        for (const v of variants)
          if (v.image && !images.some((i) => i.url === v.image))
            images.push({ url: v.image, score: 90 });
        add({
          url,
          title: String(item.name || doc.title).slice(0, 500),
          description:
            typeof item.description === "string"
              ? item.description.slice(0, 3000)
              : undefined,
          brand: typeof item.brand === "string" ? item.brand : item.brand?.name,
          price: offer?.price != null ? String(offer.price) : undefined,
          currency: offer?.priceCurrency,
          images: images.slice(0, 40),
          variants: variants.length ? variants : controls(),
          method: "jsonld",
          confidence: 0.95,
        });
      }
    } catch {
      /* Other scripts may still contain valid metadata. */
    }
  }
  for (const node of [
    ...doc.querySelectorAll('[itemscope][itemtype*="schema.org/Product"]'),
  ].slice(0, 60)) {
    const val = (name: string) => {
      const e = node.querySelector(`[itemprop="${name}"]`);
      return e?.getAttribute("content") || e?.getAttribute("href") || text(e);
    };
    const image = node.querySelector('[itemprop="image"]');
    const url = absolute(
      image?.getAttribute("content") || image?.getAttribute("src"),
      base,
    );
    add({
      url: absolute(val("url"), base) || base,
      title: val("name"),
      price: val("price"),
      currency: val("priceCurrency"),
      brand: val("brand"),
      images: url
        ? [
            { url, score: 90 },
            ...imageCandidates(node, base).filter((i) => i.url !== url),
          ]
        : imageCandidates(node, base),
      method: "microdata",
      confidence: 0.85,
    });
  }
  const cards = [
    ...doc.querySelectorAll(
      '[data-product-id],.product-card,.product-item,li.grid__item,article[class*="product"],[class*="ProductCard"]',
    ),
  ].slice(0, 80);
  {
    for (const anchor of [
      ...doc.querySelectorAll(
        'a[href*="/products/"],a[href*="/product/"],main a[href]',
      ),
    ].slice(0, 350)) {
      if (!anchor.querySelector("img")) continue;
      if (
        anchor.closest("nav,header,footer") ||
        /\/collections\//.test(anchor.getAttribute("href") || "")
      )
        continue;
      const container = anchor.closest("article,li") || anchor;
      if (
        container.querySelectorAll("img").length <= 8 &&
        !cards.some((card) => card.contains(anchor))
      )
        cards.push(container);
      if (cards.length >= 80) break;
    }
  }
  for (const card of cards) {
    const a = card.matches("a[href]")
      ? (card as HTMLAnchorElement)
      : card.querySelector<HTMLAnchorElement>(
          'a[href*="/products/"],a[href*="/product/"],a[href]',
        );
    const images = imageCandidates(card, base);
    const title =
      text(card.querySelector('h2,h3,h4,[class*="title"],[class*="name"]')) ||
      a?.getAttribute("title") ||
      (images.length && card.querySelector("img")?.alt) ||
      text(a);
    if (!a || !title || !images.length) continue;
    add({
      url: absolute(a.getAttribute("href"), base) || base,
      title: String(title).slice(0, 500),
      images,
      price: text(card.querySelector('[class*="price"]')).slice(0, 80),
      method: "card",
      confidence: 0.7,
    });
  }
  const meta = (name: string) =>
    doc
      .querySelector(`meta[property="${name}"],meta[name="${name}"]`)
      ?.getAttribute("content") || "";
  const isDetail =
    /product/i.test(meta("og:type")) ||
    /\/products?\//.test(new URL(base).pathname);
  if (
    !products.length ||
    (isDetail &&
      !products.some((p) => p.url.split("?")[0] === base.split("?")[0]))
  ) {
    const images = imageCandidates(doc.querySelector("main") || doc, base),
      og = absolute(meta("og:image"), base);
    if (og) {
      const existing = images.findIndex((i) => i.url === og);
      if (existing >= 0) images.splice(existing, 1);
      images.unshift({ url: og, score: 110 });
    }
    add({
      url: base,
      title: (
        meta("og:title") ||
        text(doc.querySelector("h1")) ||
        doc.title
      ).slice(0, 500),
      description: meta("og:description").slice(0, 3000),
      images: images.slice(0, 40),
      price: meta("product:price:amount"),
      currency: meta("product:price:currency"),
      variants: controls(),
      method: "metadata",
      confidence: 0.4,
    });
  }
  // Only enrich the main detail product; recommendations retain their own galleries.
  const main = products.find(
    (p) => p.url.split("?")[0] === base.split("?")[0] && p.method === "jsonld",
  );
  if (main && cards.length < 4) {
    for (const i of imageCandidates(
      doc.querySelector('[class*="gallery"],main') || doc,
      base,
    ))
      if (!main.images.some((x) => x.url === i.url) && main.images.length < 40)
        main.images.push(i);
  }
  return products
    .sort(
      (a, b) =>
        Number(b.url.split("?")[0] === base.split("?")[0]) -
        Number(a.url.split("?")[0] === base.split("?")[0]),
    )
    .slice(0, 60);
}
