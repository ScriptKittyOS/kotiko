// Pulls your active words (every language) from the Slovo server and caches them for
// content scripts. Which languages show is decided locally, so switching is instant.
const ext = globalThis.browser ?? globalThis.chrome;

const DEFAULTS = { serverUrl: "http://localhost:4747", token: "" };
let inflight = null;

async function api(path, init = {}) {
  const s = await ext.storage.local.get(DEFAULTS);
  if (!s.token) throw new Error("Paste your API token to connect.");
  const base = s.serverUrl.trim().replace(/\/+$/, "");
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${s.token.trim()}`, ...init.headers },
      cache: "no-store",
    });
  } catch {
    throw new Error(`Can't reach ${s.serverUrl}. Is the server running?`);
  }
  if (res.status === 401) throw new Error("The server rejected that API token.");
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `The server answered ${res.status}.`);
  return body;
}

function sync() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { words } = await api("/api/words");

      // Only write words when they changed, so open tabs don't redo work every minute.
      const { words: old = [] } = await ext.storage.local.get("words");
      const patch = { lastSync: Date.now(), syncError: null };
      if (JSON.stringify(old) !== JSON.stringify(words)) patch.words = words;
      await ext.storage.local.set(patch);
    } catch (e) {
      await ext.storage.local.set({ syncError: e.message });
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
// The popup's "Add a word" box and its Undo go through here too, so they finish
// even if the popup closes while the model is thinking.
ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handlers = {
    async sync() {
      const { lastSync } = await ext.storage.local.get("lastSync");
      if (msg.force || !lastSync || Date.now() - lastSync > 5000) await sync();
      return { ok: true };
    },
    async add() {
      const res = await api("/api/words", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: msg.text }),
      });
      await sync();
      return res;
    },
    async remove() {
      await api(`/api/words/${encodeURIComponent(msg.id)}`, { method: "DELETE" });
      await sync();
      return { ok: true };
    },
  };
  const handler = handlers[msg?.type];
  if (!handler) return;
  handler().then(sendResponse, (e) => sendResponse({ error: e.message }));
  return true;
});

// Re-sync when connection settings change.
ext.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.token || changes.serverUrl) sync();
});
