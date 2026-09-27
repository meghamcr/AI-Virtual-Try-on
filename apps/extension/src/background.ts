import { messageSchema } from "../../../packages/shared/src/index";
chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  void chrome.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
});
chrome.runtime.onMessage.addListener((raw, sender) => {
  const m = messageSchema.safeParse(raw);
  if (!m.success || sender.id !== chrome.runtime.id || !sender.tab?.id) return;
  if (m.data.type === "PRODUCTS" || m.data.type === "PICKED") {
    void chrome.storage.session.set({
      [`tab:${sender.tab.id}`]: { ...m.data, at: Date.now() },
    });
  }
});
chrome.tabs.onRemoved.addListener((id) => {
  void chrome.storage.session.remove(`tab:${id}`);
});
