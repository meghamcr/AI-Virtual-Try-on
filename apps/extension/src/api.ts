export const API = (
  import.meta.env.VITE_API_URL || "http://localhost:4000"
).replace(/\/$/, "");
export const isExtension = typeof chrome !== "undefined" && !!chrome.storage;
export async function readStore(key: string) {
  if (isExtension) return (await chrome.storage.local.get(key))[key];
  return JSON.parse(localStorage.getItem(key) || "null");
}
export async function writeStore(key: string, value: unknown) {
  if (isExtension) await chrome.storage.local.set({ [key]: value });
  else localStorage.setItem(key, JSON.stringify(value));
}
export async function clearStore() {
  if (isExtension) {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
  } else localStorage.clear();
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await readStore("token");
  let response: Response;
  try {
    response = await fetch(API + path, {
      ...options,
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      signal: options.signal || AbortSignal.timeout(30000),
    });
  } catch {
    throw Error(
      "Cannot reach TryOn Studio. Check that the API is running and its origin is allowed.",
    );
  }
  if (!response.ok) {
    const b = await response.json().catch(() => ({}));
    throw Object.assign(
      new Error(b.error || `Request failed (${response.status})`),
      { status: response.status },
    );
  }
  return response.json();
}
export async function media(path: string) {
  const token = await readStore("token");
  const r = await fetch(API + path, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw Error("Image is no longer available");
  return r.blob();
}
