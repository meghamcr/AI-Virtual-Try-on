import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  categories,
  slots,
  readiness,
  terminal,
  messageSchema,
  type Product,
  type CategoryId,
} from "../../../packages/shared/src/index";
import {
  api,
  API,
  media,
  readStore,
  writeStore,
  clearStore,
  isExtension,
} from "./api";
import "./style.css";
type Profile = {
  id: string;
  name: string;
  isDefault: boolean;
  images: {
    id: string;
    slot: string;
    width: number;
    height: number;
    createdAt: string;
  }[];
};
type Job = {
  id: string;
  profileId: string;
  status: string;
  category: CategoryId;
  scene: string;
  provider: string;
  model: string;
  errorCode?: string;
  createdAt: string;
  completedAt?: string;
  product: { data: Product; selectedImage: string; variant?: string };
  result?: { id: string; saved: boolean; feedback?: string };
};
type Capabilities = {
  name: string;
  model: string;
  configured: boolean;
  lifestyle: boolean;
};
const photoLabels: Record<string, string> = {
  full: "Front / full body",
  upper: "Upper body",
  lower: "Lower body",
  feet: "Feet / shoes",
  face: "Face",
  extra: "Extra reference",
};
function PrivateImage({
  path,
  alt,
  className = "",
}: {
  path: string;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true,
      url = "";
    setSrc("");
    setError(false);
    media(path)
      .then((b) => {
        url = URL.createObjectURL(b);
        if (alive) setSrc(url);
        else URL.revokeObjectURL(url);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  return src ? (
    <img className={className} src={src} alt={alt} />
  ) : (
    <div className="image-placeholder">
      {error ? "Image unavailable" : "Loading image…"}
    </div>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        t<span>o</span>
      </span>
      <div>
        TryOn <strong>Studio</strong>
        <small>YOUR PERSONAL FITTING ROOM</small>
      </div>
    </div>
  );
}
function Popup() {
  const [status, setStatus] = useState("Checking connection…");
  useEffect(() => {
    api("/ready")
      .then(() => setStatus("Connected to your studio"))
      .catch(() => setStatus("Setup or connection needs attention"));
  }, []);
  return (
    <div className="popup">
      <Brand />
      <p className="muted">
        A little less guessing.
        <br />A lot more you.
      </p>
      <p className="connection">● {status}</p>
      <button
        className="primary"
        onClick={() => {
          chrome.windows.getCurrent((w) => {
            if (w.id) void chrome.sidePanel.open({ windowId: w.id });
          });
        }}
      >
        Open TryOn Studio ↗
      </button>
      <button
        className="text-button"
        onClick={() => chrome.runtime.openOptionsPage()}
      >
        Account & profile settings
      </button>
    </div>
  );
}
function Auth({ done }: { done: () => void }) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="auth">
      <span className="eyebrow">MADE FOR YOUR EVERYDAY</span>
      <h1>
        See it.
        <br />
        Try it.
        <br />
        <em>Make it yours.</em>
      </h1>
      <p className="muted">
        Bring your own style to the things you discover. One private photo
        profile, wherever you shop.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            const r = await api(`/auth/${register ? "register" : "login"}`, {
              method: "POST",
              body: JSON.stringify({
                email: f.get("email"),
                password: f.get("password"),
              }),
            });
            await writeStore("token", r.token);
            done();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            minLength={12}
            maxLength={72}
            required
            placeholder="At least 12 characters"
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy
            ? "Connecting…"
            : register
              ? "Create your account"
              : "Sign in to your studio"}{" "}
          <span>→</span>
        </button>
      </form>
      <button className="text-button" onClick={() => setRegister(!register)}>
        {register
          ? "Already have an account? Sign in"
          : "New here? Create an account"}
      </button>
      <p className="fine">
        An AI appearance preview, not a prediction of size or physical fit.
      </p>
    </section>
  );
}
function App() {
  const options = location.pathname.includes("options");
  const [ready, setReady] = useState(false),
    [signed, setSigned] = useState(false),
    [tab, setTab] = useState(options ? "Profiles" : "Try On"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]),
    [profileId, setProfileId] = useState(""),
    [caps, setCaps] = useState<Capabilities | null>(null),
    [products, setProducts] = useState<Product[]>([]),
    [product, setProduct] = useState<Product | null>(null),
    [image, setImage] = useState(""),
    [category, setCategory] = useState<CategoryId>("tops"),
    [variant, setVariant] = useState(""),
    [variantConfirmed, setVariantConfirmed] = useState(false),
    [scene, setScene] = useState("original"),
    [consent, setConsent] = useState(false),
    [page, setPage] = useState(""),
    [job, setJob] = useState<Job | null>(null),
    [history, setHistory] = useState<Job[]>([]),
    [compare, setCompare] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const hydrated = useRef(false),
    activeTab = useRef<number | undefined>(undefined),
    pageRef = useRef(""),
    requestKey = useRef<string | undefined>(undefined),
    draftKey = useRef("");
  async function load() {
    const [ps, me, js] = await Promise.all([
      api<Profile[]>("/profiles"),
      api("/auth/me"),
      api<Job[]>("/jobs"),
    ]);
    setProfiles(ps);
    setEmail(me.email);
    setProfileId((id) =>
      ps.some((p) => p.id === id)
        ? id
        : ps.find((p) => p.isDefault)?.id || ps[0]?.id || "",
    );
    setHistory(js);
    const id = await readStore("activeJob");
    const pending =
      js.find((j) => j.id === id) ||
      js.find((j) => !terminal.includes(j.status));
    setJob(pending || null);
  }
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      if ((e as { status?: number }).status === 401) {
        await clearStore();
        setSigned(false);
        setJob(null);
      }
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void (async () => {
      try {
        const token = await readStore("token");
        setSigned(!!token);
        const draft = await readStore("draft");
        if (draft) {
          const r = messageSchema.safeParse({
            type: "PICKED",
            product: draft.product,
          });
          if (r.success && r.data.type === "PICKED") {
            setProduct(r.data.product);
            setImage(
              r.data.product.images.some((i) => i.url === draft.image)
                ? draft.image
                : r.data.product.images[0].url,
            );
            setCategory(
              categories.some((c) => c.id === draft.category)
                ? draft.category
                : r.data.product.category,
            );
            setVariant(draft.variant || "");
            setProfileId(draft.profileId || "");
            setScene(draft.scene || "original");
            setVariantConfirmed(!!draft.variantConfirmed);
          }
        }
        if (token) await load();
      } catch (e) {
        setError((e as Error).message);
        if ((e as { status?: number }).status === 401) {
          await clearStore();
          setSigned(false);
        }
      } finally {
        setReady(true);
        hydrated.current = true;
      }
      try {
        setCaps(await api("/capabilities"));
      } catch {
        /* Connection failure already has a recovery action. */
      }
    })();
  }, []);
  useEffect(() => {
    if (hydrated.current)
      void writeStore("draft", {
        product,
        image,
        category,
        variant,
        profileId,
        scene,
        variantConfirmed,
      });
    const k = JSON.stringify({
      product,
      image,
      category,
      variant,
      profileId,
      scene,
    });
    if (k !== draftKey.current) {
      requestKey.current = undefined;
      draftKey.current = k;
    }
  }, [product, image, category, variant, profileId, scene, variantConfirmed]);
  useEffect(() => {
    if (!signed || !isExtension) return;
    const changed = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== "session" || !activeTab.current) return;
      const value = changes[`tab:${activeTab.current}`]?.newValue;
      const result = messageSchema.safeParse(value);
      if (!result.success) return;
      const m = result.data;
      if (m.type === "PRODUCTS") {
        setPage(m.url);
        pageRef.current = m.url;
        setProducts(m.products);
      }
      if (m.type === "PICKED") {
        choose(m.product);
        setNotice(
          "Image selected from the page. Confirm the product and category.",
        );
      }
    };
    const sync = () => {
      void chrome.tabs
        .query({ active: true, currentWindow: true })
        .then(([t]) => {
          activeTab.current = t?.id;
          setPage(t?.url || "");
          setProducts([]);
          if (t?.id)
            void chrome.storage.session.get(`tab:${t.id}`).then((x) => {
              const r = messageSchema.safeParse(x[`tab:${t.id}`]);
              if (
                r.success &&
                r.data.type === "PRODUCTS" &&
                r.data.url === t.url
              )
                setProducts(r.data.products);
            });
        });
    };
    chrome.storage.onChanged.addListener(changed);
    chrome.tabs.onActivated.addListener(sync);
    chrome.tabs.onUpdated.addListener(sync);
    sync();
    return () => {
      chrome.storage.onChanged.removeListener(changed);
      chrome.tabs.onActivated.removeListener(sync);
      chrome.tabs.onUpdated.removeListener(sync);
    };
  }, [signed]);
  useEffect(() => {
    if (!job || terminal.includes(job.status)) return;
    let stop = false,
      timer: ReturnType<typeof setTimeout>;
    let delay = 2000;
    const tick = async () => {
      try {
        const updated = await api<Job>(`/jobs/${job.id}`);
        if (stop) return;
        setJob(updated);
        if (terminal.includes(updated.status)) {
          setHistory(await api("/jobs"));
          return;
        }
        delay = Math.min(8000, delay * 1.2);
      } catch (e) {
        if ((e as { status?: number }).status === 404) {
          setJob(null);
          await writeStore("activeJob", null);
          return;
        }
        if ((e as { status?: number }).status === 401) {
          await clearStore();
          setSigned(false);
          setJob(null);
          return;
        }
        if (!stop) setError((e as Error).message);
        delay = Math.min(30000, delay * 2);
      }
      if (!stop) timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [job?.id, job?.status]);
  function choose(p: Product) {
    setProduct(p);
    setImage(p.images[0].url);
    setCategory(p.category);
    setVariant(
      p.variants
        .filter((v) => v.selected)
        .map((v) => v.label)
        .join(" / "),
    );
    setVariantConfirmed(false);
    setConsent(false);
  }
  async function scan(pick = false) {
    if (!isExtension)
      throw Error(
        "Load the compiled extension in Chrome to detect products on a shopping tab.",
      );
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!t?.id || !t.url?.match(/^https?:/))
      throw Error(
        "Open a shopping webpage, then click the extension toolbar icon to grant access.",
      );
    activeTab.current = t.id;
    setPage(t.url);
    try {
      await chrome.scripting.executeScript({
        target: { tabId: t.id },
        files: ["content.js"],
      });
      await chrome.tabs.sendMessage(t.id, { type: pick ? "PICK" : "SCAN" });
    } catch {
      throw Error(
        "Page access is needed. Click the TryOn Studio toolbar icon on this tab, then try Detect again.",
      );
    }
    if (pick)
      setNotice("Click a product image on the webpage. Press Esc to cancel.");
  }
  async function generate() {
    if (!product) return;
    requestKey.current ||= crypto.randomUUID();
    const r = await api("/jobs", {
      method: "POST",
      body: JSON.stringify({
        profileId,
        product,
        selectedImage: image,
        variant: variant || undefined,
        category,
        scene,
        consent,
        idempotencyKey: requestKey.current,
      }),
    });
    await writeStore("activeJob", r.id);
    setJob(await api(`/jobs/${r.id}`));
  }
  const profile = profiles.find((p) => p.id === profileId),
    readinessInfo = readiness(
      category,
      profile?.images.map((i) => i.slot) || [],
    );
  const active = job && !terminal.includes(job.status);
  const logout = async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      await clearStore();
      location.reload();
    }
  };
  if (!ready)
    return (
      <main>
        <Brand />
        <p>Opening your studio…</p>
      </main>
    );
  return (
    <div className={options ? "shell options" : "shell"}>
      <header>
        <Brand />
        <span className="private-badge">◈ PRIVATE</span>
      </header>
      {!signed ? (
        <>
          <Auth
            done={() => {
              setSigned(true);
              void run(load);
            }}
          />
          <div className="setup-note">
            Backend: {API}
            <br />
            Start the local services if you cannot connect.
          </div>
        </>
      ) : (
        <>
          <nav aria-label="Main navigation">
            {["Try On", "Profiles", "History", "Settings"].map((t) => (
              <button
                aria-current={tab === t ? "page" : undefined}
                className={tab === t ? "selected" : ""}
                key={t}
                onClick={() => {
                  setTab(t);
                  setError("");
                  if (t === "History")
                    void run(async () => setHistory(await api("/jobs")));
                }}
              >
                {t}
              </button>
            ))}
          </nav>
          <main>
            {caps?.name === "mock" && (
              <div className="demo">Demo mode — no AI generation</div>
            )}
            {error && (
              <div role="alert" className="error">
                {error}
                <button className="text-button" onClick={() => setError("")}>
                  Dismiss
                </button>
              </div>
            )}
            {notice && (
              <div role="status" className="notice">
                {notice}
              </div>
            )}
            {tab === "Try On" && (
              <>
                <div className="intro">
                  <span className="eyebrow">THE FITTING ROOM, REIMAGINED</span>
                  <h1>
                    Your next look,
                    <br />
                    <em>on you.</em>
                  </h1>
                  <p className="muted">
                    Discover something you love. See it in your style.
                  </p>
                </div>
                <section>
                  <div className="section-title">
                    <h2>
                      <span>01</span> Your profile
                    </h2>
                    <button
                      className="text-button"
                      onClick={() => setTab("Profiles")}
                    >
                      Manage ↗
                    </button>
                  </div>
                  {profiles.length ? (
                    <label className="sr-label">
                      Active profile
                      <select
                        value={profileId}
                        onChange={(e) => setProfileId(e.target.value)}
                      >
                        {profiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {p.isDefault ? " · default" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <div className="empty">
                      <p>A familiar face makes it personal.</p>
                      <button onClick={() => setTab("Profiles")}>
                        Create your first profile →
                      </button>
                    </div>
                  )}
                </section>
                <section>
                  <div className="section-title">
                    <h2>
                      <span>02</span> Your find
                    </h2>
                    <span className="count">{products.length} found</span>
                  </div>
                  <div className="page-address" title={page}>
                    {page
                      ? (() => {
                          try {
                            return new URL(page).hostname;
                          } catch {
                            return "Shopping page";
                          }
                        })()
                      : "Open a shopping website"}
                  </div>
                  <div className="row">
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void run(() => scan())}
                    >
                      ↻ Detect products
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void run(() => scan(true))}
                    >
                      Select on page
                    </button>
                  </div>
                  {!products.length && !product && (
                    <div className="empty">
                      <div className="empty-symbol">⌕</div>
                      <h3>Found something you like?</h3>
                      <p>
                        Open a product or collection page and detect its images.
                        You choose the exact item.
                      </p>
                    </div>
                  )}
                  <div className="product-grid">
                    {products.map((p) => (
                      <button
                        className={`product-card ${product?.id === p.id && product?.url === p.url ? "chosen" : ""}`}
                        key={p.id + p.url}
                        onClick={() => choose(p)}
                      >
                        <img
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          src={p.images[0].url}
                          alt={p.title}
                        />
                        <span>{p.title}</span>
                        <small>
                          {p.currency} {p.price || "View product"}
                        </small>
                      </button>
                    ))}
                  </div>
                  {product && (
                    <div className="selection">
                      <img
                        className="hero-product"
                        referrerPolicy="no-referrer"
                        src={image}
                        alt={product.title}
                      />
                      <div className="selection-info">
                        <span className="eyebrow">SELECTED PRODUCT</span>
                        <h3>{product.title}</h3>
                        <p className="fine">
                          {product.brand} · {product.method} · confidence{" "}
                          {Math.round(product.confidence * 100)}%
                        </p>
                        <a href={product.url} target="_blank" rel="noreferrer">
                          View source product ↗
                        </a>
                      </div>
                      <div
                        className="thumbnails"
                        aria-label="Product image options"
                      >
                        {product.images.map((i, n) => (
                          <button
                            aria-label={`Select product image ${n + 1}`}
                            aria-pressed={image === i.url}
                            key={i.url}
                            className={image === i.url ? "chosen" : ""}
                            onClick={() => {
                              setImage(i.url);
                              setVariantConfirmed(false);
                            }}
                          >
                            <img
                              src={i.url}
                              referrerPolicy="no-referrer"
                              alt={`Product view ${n + 1}`}
                            />
                          </button>
                        ))}
                      </div>
                      <label>
                        Variant{" "}
                        {product.variants.length > 0 ? (
                          <select
                            value={variant}
                            onChange={(e) => {
                              setVariant(e.target.value);
                              setVariantConfirmed(false);
                              const v = product.variants.find(
                                (v) => v.label === e.target.value,
                              );
                              if (v?.image) setImage(v.image);
                            }}
                          >
                            <option value="">Choose / no variant</option>
                            {product.variants.map((v, n) => (
                              <option key={n} value={v.label}>
                                {v.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={variant}
                            placeholder="Optional: e.g. blue / medium"
                            onChange={(e) => {
                              setVariant(e.target.value);
                              setVariantConfirmed(false);
                            }}
                          />
                        )}
                      </label>
                      {variant && (
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={variantConfirmed}
                            onChange={(e) =>
                              setVariantConfirmed(e.target.checked)
                            }
                          />
                          I checked that this image matches my chosen variant.
                          Size labels do not predict fit.
                        </label>
                      )}
                      <label>
                        Product category
                        <select
                          value={category}
                          onChange={(e) =>
                            setCategory(e.target.value as CategoryId)
                          }
                        >
                          {categories.map((c) => (
                            <option value={c.id} key={c.id}>
                              {c.label}
                              {!c.modelCategory ? " · unavailable" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p
                        className={
                          readinessInfo.ready ? "ready-note" : "warning"
                        }
                      >
                        {readinessInfo.ready
                          ? "✓ Profile ready"
                          : readinessInfo.reason}
                      </p>
                    </div>
                  )}
                </section>
                <section>
                  <h2>
                    <span>03</span> Make it yours
                  </h2>
                  <label>
                    Setting
                    <select
                      value={scene}
                      onChange={(e) => setScene(e.target.value)}
                    >
                      <option value="original">
                        Original setting · recommended
                      </option>
                      {["studio", "outdoors", "beach", "city"].map((s) => (
                        <option key={s} disabled={!caps?.lifestyle} value={s}>
                          {s[0].toUpperCase() + s.slice(1)}
                          {!caps?.lifestyle ? " · not enabled" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  {scene !== "original" ? (
                    <p className="warning">
                      Lifestyle adds a paid editing stage and may change your
                      face or product details. No strict region mask is applied.
                    </p>
                  ) : (
                    <p className="fine">
                      Keeps your original setting where the model allows it.
                    </p>
                  )}
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    I have permission to use this photo and agree to send it and
                    the product image to{" "}
                    {caps?.name === "mock"
                      ? "the local demo processor"
                      : "Hugging Face IDM-VTON"}{" "}
                    for this preview.
                  </label>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      !!active ||
                      !product ||
                      !readinessInfo.ready ||
                      !consent ||
                      (!!variant && !variantConfirmed) ||
                      !caps?.configured
                    }
                    onClick={() => void run(generate)}
                  >
                    {busy
                      ? "Working…"
                      : active
                        ? "Your preview is processing…"
                        : caps?.name === "mock"
                          ? "Run labeled demo"
                          : "Try on this look"}{" "}
                    <span>✧</span>
                  </button>
                  {!caps?.configured && (
                    <p className="warning">
                      Real generation needs backend Hugging Face access. Add
                      HF_TOKEN to the backend .env, then restart API and worker.
                    </p>
                  )}
                  <p className="fine center">
                    Appearance only. Details and identity can vary.
                  </p>
                </section>
                {job && (
                  <JobCard
                    job={job}
                    run={run}
                    refresh={async () => {
                      setJob(await api(`/jobs/${job.id}`));
                      setHistory(await api("/jobs"));
                    }}
                    onDelete={() => setJob(null)}
                    retry={() => {
                      requestKey.current = undefined;
                      choose(job.product.data);
                      setImage(job.product.selectedImage);
                      setCategory(job.category);
                      setProfileId(job.profileId);
                      setScene(job.scene);
                      setVariant(job.product.variant || "");
                      setNotice(
                        "Review the restored selection and consent before creating a new generation.",
                      );
                    }}
                  />
                )}
              </>
            )}
            {tab === "Profiles" && (
              <>
                <span className="eyebrow">A LITTLE MORE YOU</span>
                <h1>
                  Your digital
                  <br />
                  <em>wardrobe starts here.</em>
                </h1>
                <p className="muted">
                  Upload once. Reuse across stores. Only the photo needed for
                  your category is required.
                </p>
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget,
                      name = String(new FormData(form).get("name"));
                    void run(async () => {
                      const p = await api("/profiles", {
                        method: "POST",
                        body: JSON.stringify({ name }),
                      });
                      setProfileId(p.id);
                      await load();
                      form.reset();
                    });
                  }}
                >
                  <input
                    name="name"
                    aria-label="Profile name"
                    placeholder="Name your profile"
                    maxLength={80}
                    required
                  />
                  <button disabled={busy}>Create</button>
                </form>
                <div className="guidance">
                  <h3>A good photo makes a difference.</h3>
                  <p>
                    Use even lighting, one person, a steady camera and an
                    unobstructed body region. Keep the camera level and use a
                    suitable standing pose. This is a photo reference, not a 3D
                    body scan.
                  </p>
                  <small>
                    JPEG, PNG or WebP · up to 12 MB · at least 256 × 256 px.
                    Metadata is removed on upload. Quality warnings are
                    heuristics, not body or pose analysis.
                  </small>
                </div>
                {profiles.map((p) => (
                  <section key={p.id} className="profile-card">
                    <div className="section-title">
                      <h2>{p.name}</h2>
                      {p.isDefault ? (
                        <span className="tag">DEFAULT</span>
                      ) : (
                        <button
                          className="text-button"
                          onClick={() =>
                            void run(async () => {
                              await api(`/profiles/${p.id}`, {
                                method: "PATCH",
                                body: JSON.stringify({ isDefault: true }),
                              });
                              await load();
                            })
                          }
                        >
                          Make default
                        </button>
                      )}
                    </div>
                    <div className="row">
                      <button
                        className="text-button"
                        onClick={() => {
                          const name = prompt("Profile name", p.name);
                          if (name)
                            void run(async () => {
                              await api(`/profiles/${p.id}`, {
                                method: "PATCH",
                                body: JSON.stringify({ name }),
                              });
                              await load();
                            });
                        }}
                      >
                        Rename
                      </button>
                      <button
                        className="text-button danger"
                        onClick={() => {
                          if (
                            confirm(
                              "Delete this profile, its photos and all associated results?",
                            )
                          )
                            void run(async () => {
                              await api(`/profiles/${p.id}`, {
                                method: "DELETE",
                              });
                              setJob(null);
                              await load();
                            });
                        }}
                      >
                        Delete profile
                      </button>
                    </div>
                    <div className="photo-grid">
                      {slots.map((slot) => {
                        const photo = p.images.find((i) => i.slot === slot);
                        return (
                          <div className="photo-slot" key={slot}>
                            {photo ? (
                              <PrivateImage
                                key={`${photo.id}-${photo.createdAt}`}
                                path={`/images/${photo.id}?v=${photo.createdAt}`}
                                alt={photoLabels[slot]}
                              />
                            ) : (
                              <div className="photo-empty">＋</div>
                            )}
                            <strong>{photoLabels[slot]}</strong>
                            <label className="upload-button">
                              {photo ? "Replace photo" : "Add photo"}
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                disabled={busy}
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (!f) return;
                                  void run(async () => {
                                    if (f.size > 12 * 1024 * 1024)
                                      throw Error("Image limit is 12 MB");
                                    const fd = new FormData();
                                    fd.append("image", f);
                                    const r = await api(
                                      `/profiles/${p.id}/images/${slot}`,
                                      { method: "POST", body: fd },
                                    );
                                    await load();
                                    setNotice(
                                      r.warnings.length
                                        ? r.warnings.join(" ")
                                        : "Photo securely saved.",
                                    );
                                  });
                                  e.target.value = "";
                                }}
                              />
                            </label>
                            {photo && (
                              <button
                                className="text-button danger"
                                onClick={() =>
                                  void run(async () => {
                                    await api(
                                      `/profiles/${p.id}/images/${slot}`,
                                      { method: "DELETE" },
                                    );
                                    await load();
                                  })
                                }
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="readiness-list">
                      {categories
                        .filter((c) => c.modelCategory)
                        .map((c) => (
                          <span
                            key={c.id}
                            className={
                              readiness(
                                c.id,
                                p.images.map((i) => i.slot),
                              ).ready
                                ? "ready-note"
                                : "muted"
                            }
                          >
                            {c.label}:{" "}
                            {readiness(
                              c.id,
                              p.images.map((i) => i.slot),
                            ).ready
                              ? "ready"
                              : readiness(
                                  c.id,
                                  p.images.map((i) => i.slot),
                                ).reason}
                          </span>
                        ))}
                    </div>
                  </section>
                ))}
              </>
            )}
            {tab === "History" && (
              <>
                <span className="eyebrow">YOUR STYLE NOTEBOOK</span>
                <h1>
                  Looks worth
                  <br />
                  <em>another look.</em>
                </h1>
                <p className="muted">
                  All previews stay here until you delete them. Save your
                  favorites or select two to compare.
                </p>
                {!history.length && (
                  <div className="empty">
                    <h3>Your first look is waiting.</h3>
                    <p>
                      Try something from a shopping page to start your history.
                    </p>
                    <button onClick={() => setTab("Try On")}>
                      Find a look →
                    </button>
                  </div>
                )}
                {compare.length === 2 && (
                  <div className="comparison-pair">
                    {compare.map((id) => (
                      <div key={id}>
                        <PrivateImage
                          path={`/jobs/${id}/media/result`}
                          alt="Selected comparison result"
                        />
                        <p>
                          {history.find((j) => j.id === id)?.product.data.title}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                {history.map((j) => (
                  <React.Fragment key={j.id}>
                    {j.result && (
                      <label className="check compare-toggle">
                        <input
                          type="checkbox"
                          checked={compare.includes(j.id)}
                          disabled={
                            compare.length === 2 && !compare.includes(j.id)
                          }
                          onChange={(e) =>
                            setCompare(
                              e.target.checked
                                ? [...compare, j.id]
                                : compare.filter((id) => id !== j.id),
                            )
                          }
                        />
                        Compare this look
                      </label>
                    )}
                    <JobCard
                      job={j}
                      run={run}
                      refresh={async () => setHistory(await api("/jobs"))}
                      onDelete={() => {
                        setHistory((h) => h.filter((x) => x.id !== j.id));
                        setCompare((c) => c.filter((id) => id !== j.id));
                        if (job?.id === j.id) setJob(null);
                      }}
                      retry={() => {
                        choose(j.product.data);
                        setImage(j.product.selectedImage);
                        setCategory(j.category);
                        setProfileId(j.profileId);
                        setScene(j.scene);
                        setVariant(j.product.variant || "");
                        requestKey.current = undefined;
                        setTab("Try On");
                      }}
                    />
                  </React.Fragment>
                ))}
              </>
            )}
            {tab === "Settings" && (
              <>
                <span className="eyebrow">YOUR STUDIO, YOUR CONTROL</span>
                <h1>
                  Private by
                  <br />
                  <em>design.</em>
                </h1>
                <section>
                  <h2>Account</h2>
                  <p>{email}</p>
                  <button onClick={() => void run(logout)}>Sign out</button>
                </section>
                <section>
                  <h2>Connection</h2>
                  <p className="fine break">{API}</p>
                  <p>
                    Provider: {caps?.name || "Unavailable"}
                    <br />
                    Model: {caps?.model || "Unknown"}
                  </p>
                  <button
                    onClick={() =>
                      void run(async () => {
                        setCaps(await api("/capabilities"));
                        const r = await api("/ready");
                        setNotice(
                          r.ok
                            ? "API, worker, database, queue and storage are ready."
                            : "Setup needs attention.",
                        );
                      })
                    }
                  >
                    Check connection
                  </button>
                  <p className="fine">
                    For another backend, set VITE_API_URL and rebuild. This
                    keeps permissions limited to your chosen API.
                  </p>
                  {isExtension && !options && (
                    <button
                      className="text-button"
                      onClick={() => chrome.runtime.openOptionsPage()}
                    >
                      Open full settings page ↗
                    </button>
                  )}
                </section>
                <section>
                  <h2>Your images & privacy</h2>
                  <p>
                    Photos and results are stored in your operator’s private
                    object storage. Only authenticated account requests can
                    retrieve them.
                  </p>
                  <p>
                    Hugging Face's IDM-VTON Space receives the selected person
                    and garment images only after you consent. Automatic masking
                    is enabled for upper-body try-on. TryOn Studio does not use
                    your photos to train its own models.
                  </p>
                  <p className="fine">
                    The public Space is a third-party service with queue and
                    ZeroGPU quota limits. Its temporary processing and retention
                    are controlled by Hugging Face and the Space owner. Deleting
                    a local result removes TryOn Studio's stored copy, not data
                    already processed by the external Space.
                  </p>
                  <a
                    href="https://huggingface.co/privacy"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Provider privacy details ↗
                  </a>
                  <p>
                    Deleting a profile also deletes its history. Deleting your
                    account revokes sessions immediately; stored objects are
                    removed by the cleanup worker, normally within a few
                    minutes.
                  </p>
                  <button
                    className="danger"
                    onClick={() => {
                      if (
                        confirm(
                          "Permanently delete your account, profiles and every result?",
                        )
                      )
                        void run(async () => {
                          await api("/account", { method: "DELETE" });
                          await clearStore();
                          location.reload();
                        });
                    }}
                  >
                    Delete account & personal data
                  </button>
                </section>
              </>
            )}
          </main>
          <footer>
            <span>TRYON STUDIO</span>
            <span>Made for your point of view.</span>
          </footer>
        </>
      )}
    </div>
  );
}
function JobCard({
  job,
  run,
  refresh,
  onDelete,
  retry,
}: {
  job: Job;
  run: (fn: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
  onDelete: () => void;
  retry: () => void;
}) {
  const [split, setSplit] = useState(50);
  const [working, setWorking] = useState(false);
  const action = (fn: () => Promise<void>) => {
    if (working) return;
    setWorking(true);
    void run(fn).finally(() => setWorking(false));
  };
  return (
    <section className="result-card">
      <div className="section-title">
        <h2>{job.result ? "Your look" : "Try-on status"}</h2>
        <span className={`status ${job.status}`}>{job.status}</span>
      </div>
      <h3>{job.product.data.title}</h3>
      <p className="fine">
        {categories.find((c) => c.id === job.category)?.label} ·{" "}
        {job.product.variant || "No variant specified"} · {job.scene}
      </p>
      {job.provider === "mock" && (
        <div className="demo">Demo mode — no AI generation</div>
      )}
      {!terminal.includes(job.status) && (
        <div role="status" className="processing">
          <span className="spinner" />
          <p>
            {job.status === "queued"
              ? "Waiting for the worker."
              : job.status === "preparing"
                ? "Retrieving and checking the selected product image."
                : job.status === "saving"
                  ? "Saving your private preview."
                  : "Your request is processing."}
            <small>You can close this panel. Your job continues.</small>
          </p>
        </div>
      )}
      {job.errorCode && (
        <div className="error">
          {job.errorCode}
          <p className="fine">
            {job.errorCode === "SUBMISSION_UNCERTAIN"
              ? "The provider may have accepted a paid request. Check provider history before starting another."
              : job.errorCode.startsWith("IMAGE_")
                ? "The website image could not be retrieved. Choose another accessible image; no site cookies are sent."
                : "Check the required photograph, provider configuration and worker connection."}
          </p>
        </div>
      )}
      {job.result && (
        <>
          <div className="compare-view">
            <PrivateImage
              path={`/jobs/${job.id}/media/result`}
              alt="Try-on result"
            />
            <div
              className="original-overlay"
              style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
            >
              <PrivateImage
                path={`/jobs/${job.id}/media/original`}
                alt="Original profile reference"
              />
            </div>
            <span className="compare-label left">Original</span>
            <span className="compare-label right">
              {job.provider === "mock" ? "Demo" : "AI preview"}
            </span>
            <div className="compare-line" style={{ left: `${split}%` }} />
          </div>
          <label className="range-label">
            Original / preview comparison
            <input
              type="range"
              min="0"
              max="100"
              value={split}
              onChange={(e) => setSplit(Number(e.target.value))}
            />
          </label>
          <div className="product-reference">
            <PrivateImage
              path={`/jobs/${job.id}/media/product`}
              alt="Selected garment reference"
            />
            <div>
              <strong>Product reference</strong>
              <p>{job.product.variant || "Your selected image"}</p>
              <small>
                {job.model}
                {job.completedAt
                  ? ` · ${Math.round((Date.parse(job.completedAt) - Date.parse(job.createdAt)) / 1000)}s total`
                  : ""}
              </small>
            </div>
          </div>
          <div className="row">
            <button
              disabled={working}
              onClick={() =>
                action(async () => {
                  const b = await media(
                      `/jobs/${job.id}/media/result?download=1`,
                    ),
                    u = URL.createObjectURL(b),
                    a = document.createElement("a");
                  a.href = u;
                  a.download = `tryon-${job.provider === "mock" ? "DEMO-" : ""}${job.id}.jpg`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(u), 30000);
                })
              }
            >
              ↓ Download
            </button>
            <button
              disabled={working}
              onClick={() =>
                action(async () => {
                  await api(`/results/${job.result!.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ saved: !job.result!.saved }),
                  });
                  await refresh();
                })
              }
            >
              {job.result.saved ? "♥ Saved" : "♡ Save look"}
            </button>
          </div>
          <label>
            How did it turn out?
            <select
              value={job.result.feedback || ""}
              onChange={(e) => {
                const feedback = e.target.value;
                if (feedback)
                  action(async () => {
                    await api(`/results/${job.result!.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ feedback }),
                    });
                    await refresh();
                  });
              }}
            >
              <option value="">Flag a poor result</option>
              {[
                "Product details changed",
                "Face changed",
                "Incorrect positioning",
                "Wrong color",
                "Unnatural body shape",
              ].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        </>
      )}
      <div className="row actions">
        {terminal.includes(job.status) && (
          <button className="text-button" onClick={retry}>
            Try again with this product ↗
          </button>
        )}
        {!terminal.includes(job.status) && (
          <button
            disabled={working}
            onClick={() =>
              action(async () => {
                await api(`/jobs/${job.id}/cancel`, { method: "POST" });
                await refresh();
              })
            }
          >
            Cancel job
          </button>
        )}
        <button
          className="text-button danger"
          disabled={working}
          onClick={() => {
            if (confirm("Delete this job and its stored images?"))
              action(async () => {
                await api(`/jobs/${job.id}`, { method: "DELETE" });
                onDelete();
              });
          }}
        >
          Delete
        </button>
      </div>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(
  location.pathname.includes("popup") ? <Popup /> : <App />,
);
