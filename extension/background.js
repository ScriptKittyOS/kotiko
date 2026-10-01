// Pulls your active words from the Slovo server and caches them for content scripts.
const ext = globalThis.browser ?? globalThis.chrome;

const DEFAULTS = { serverUrl: "http://localhost:4747", token: "", lang: "ru" };
let inflight = null;

function sync() {
  if (inflight) return inflight;
  inflight = (async () => {
    const s = await ext.storage.local.get(DEFAULTS);
    if (!s.token) {
      await ext.storage.local.set({ syncError: "Paste your API token to connect." });
      return;
    }
    try {
      const base = s.serverUrl.trim().replace(/\/+$/, "");
      const res = await fetch(`${base}/api/words?lang=${encodeURIComponent(s.lang)}`, {
        headers: { Authorization: `Bearer ${s.token.trim()}` },
        cache: "no-store",
      });
      if (res.status === 401) throw new Error("The server rejected that API token.");
      if (!res.ok) throw new Error(`The server answered ${res.status}.`);
      const { words } = await res.json();

      // Only write words when they changed, so open tabs don't redo work every minute.
      const { words: old = [] } = await ext.storage.local.get("words");
      const patch = { lastSync: Date.now(), syncError: null };
      if (JSON.stringify(old) !== JSON.stringify(words)) patch.words = words;
      await ext.storage.local.set(patch);
    } catch (e) {
      const msg = e instanceof TypeError ? `Can't reach ${s.serverUrl}. Is the server running?` : e.message;
      await ext.storage.local.set({ syncError: msg });
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

function ensureAlarm() {
  ext.alarms.create("slovo-sync", { periodInMinutes: 1 });
}

ext.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  sync();
});
ext.runtime.onStartup.addListener(() => {
  ensureAlarm();
  sync();
});
ext.alarms.onAlarm.addListener((a) => {
  if (a.name === "slovo-sync") sync();
});

// Content scripts ask for a sync on every page load; popup asks with force.
ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "sync") return;
  (async () => {
    const { lastSync } = await ext.storage.local.get("lastSync");
    if (msg.force || !lastSync || Date.now() - lastSync > 5000) await sync();
    sendResponse({ ok: true });
  })();
  return true;
});

// Re-sync when connection settings or language change.
ext.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.lang) ext.storage.local.set({ words: [] }).then(sync);
  else if (changes.token || changes.serverUrl) sync();
});
