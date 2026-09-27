import {
  extractProducts,
  absolute,
} from "../../../packages/shared/src/detection";
import {
  messageSchema,
  inferCategory,
  type Product,
} from "../../../packages/shared/src/index";
const g = globalThis as typeof globalThis & { tryonCleanup?: () => void };
g.tryonCleanup?.();
let timer: ReturnType<typeof setTimeout> | undefined;
let lastUrl = location.href;
let picking = false;
let lastScan = 0;
const send = () => {
  try {
    void chrome.runtime
      .sendMessage({
        type: "PRODUCTS",
        url: location.href,
        products: extractProducts(document, location.href),
      })
      .catch(() => {});
  } catch {
    /* Extension was reloaded. */
  }
};
const schedule = () => {
  clearTimeout(timer);
  timer = setTimeout(
    () => {
      lastScan = Date.now();
      send();
    },
    Math.max(900, 3000 - (Date.now() - lastScan)),
  );
};
const observer = new MutationObserver((records) => {
  if (records.some((r) => r.type === "childList" || r.type === "attributes"))
    schedule();
});
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: [
    "src",
    "srcset",
    "data-src",
    "aria-checked",
    "aria-hidden",
    "hidden",
  ],
});
const onClick = (e: MouseEvent) => {
  if (!picking) return;
  const target = e.target;
  if (!(target instanceof HTMLImageElement)) return;
  e.preventDefault();
  e.stopPropagation();
  const url = absolute(
    target.currentSrc || target.getAttribute("data-src") || target.src,
    location.href,
  );
  if (!url) return;
  const title =
    target.alt || document.querySelector("h1")?.textContent || document.title;
  const product: Product = {
    id: "manual",
    source: location.href,
    url: location.href,
    title: title.slice(0, 500),
    category: inferCategory(title),
    images: [{ url, score: 100 }],
    variants: [],
    method: "manual",
    confidence: 0.5,
  };
  stopPick();
  void chrome.runtime.sendMessage({ type: "PICKED", product });
};
const stopPick = () => {
  picking = false;
  document.documentElement.style.cursor = "";
  document.getElementById("tryon-picker-notice")?.remove();
};
const onKey = (e: KeyboardEvent) => {
  if (e.key === "Escape") stopPick();
};
const listener = (
  raw: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (v: unknown) => void,
) => {
  if (sender.id !== chrome.runtime.id || sender.tab) return;
  const m = messageSchema.safeParse(raw);
  if (!m.success) return;
  if (m.data.type === "SCAN") {
    lastScan = 0;
    send();
    respond({ ok: true });
  }
  if (m.data.type === "PICK") {
    stopPick();
    picking = true;
    document.documentElement.style.cursor = "crosshair";
    const n = document.createElement("div");
    n.id = "tryon-picker-notice";
    n.textContent = "TryOn Studio: click a product image. Esc to cancel.";
    Object.assign(n.style, {
      position: "fixed",
      top: "16px",
      left: "16px",
      padding: "16px",
      background: "#222",
      color: "#fff",
      zIndex: "2147483647",
      borderRadius: "8px",
      font: "14px sans-serif",
      pointerEvents: "none",
    });
    document.body.append(n);
    respond({ ok: true });
  }
};
chrome.runtime.onMessage.addListener(listener);
document.addEventListener("click", onClick, true);
document.addEventListener("keydown", onKey);
const nav = setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    lastScan = 0;
    schedule();
  }
}, 1500);
g.tryonCleanup = () => {
  clearTimeout(timer);
  clearInterval(nav);
  observer.disconnect();
  stopPick();
  document.removeEventListener("click", onClick, true);
  document.removeEventListener("keydown", onKey);
  chrome.runtime.onMessage.removeListener(listener);
};
send();
