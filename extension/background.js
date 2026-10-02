// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Pulls your active words (every language) from the Kotiko server and caches them for
// content scripts. Which languages show is decided locally, so switching is instant.
//
// The libraries load through importScripts in Chrome's service worker, and through the
// manifest's background.scripts list (before this file) in Firefox's event page.
if (!globalThis.SyncController && typeof importScripts === "function") {
  importScripts("lib/url.js", "lib/validate-words.js", "lib/sync-controller.js", "lib/messages.js", "lib/i18n.js", "lib/badge.js");
}

const ext = globalThis.browser ?? globalThis.chrome;
const { normalizeServerUrl } = globalThis.ServerUrl;
const { validateWordsResponse, filterWords } = globalThis.WordValidator;
const { createSyncController } = globalThis.SyncController;
const { createMessageRouter, checks } = globalThis.MessageRouter;
const { badgeFor, OFF_COLOR } = globalThis.KotikoBadge;
const { t } = globalThis.KotikoI18n;

const DEFAULTS = { serverUrl: "http://localhost:4747", token: "" };
const ALARM = "kotiko-sync";
// The sync alarm's name before the rename; cleared on update. Remove in the next release.
const OLD_ALARM = "slovo-sync"; // legacy-name-ok
// Inside Chrome's 30 s limit for a fetch in a service worker.
const ADD_TIMEOUT_MS = 28_000;

const codedError = (code, message, details = {}) => Object.assign(new Error(message), { code, details });

// Resolves the stored address and token into a request base, or throws a coded error.
async function connection() {
  const s = await ext.storage.local.get(DEFAULTS);
  const token = String(s.token ?? "").trim();
  if (!token) throw codedError("server_key_rejected", "Paste your API token to connect.", { reason: "no_token" });
  const n = normalizeServerUrl(s.serverUrl);
  if (!n.ok) throw codedError(n.code, n.hint, { hint: n.hint });
  return { base: n.url, token };
}

// Calls the server and returns the raw response. Network failures become coded errors.
async function request(conn, path, init = {}) {
  try {
    return await fetch(`${conn.base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${conn.token}`, ...init.headers },
      cache: "no-store",
    });
  } catch (e) {
    if (e?.name === "TimeoutError") {
      throw codedError("server_unreachable", `${conn.base} took too long to answer.`, { reason: "timeout" });
    }
    if (e?.name === "AbortError") throw e;
    throw codedError("server_unreachable", `Can't reach ${conn.base}. Is the server running?`, {
      reason: "network",
    });
  }
}

// For add and remove: the parsed body, or an error with the server's own message.
async function api(path, init = {}) {
  const res = await request(await connection(), path, { ...init, signal: AbortSignal.timeout(ADD_TIMEOUT_MS) });
  if (res.status === 401) throw codedError("server_key_rejected", "The server rejected that API token.");
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw codedError("http_error", body.error || `The server answered ${res.status}.`, { status: res.status });
  return body;
}

const sameId = (a, b) => String(a) === String(b);

const sync = createSyncController({
  now: () => Date.now(),
  async readCreds() {
    return ext.storage.local.get(DEFAULTS);
  },
  async fetchWords(_creds, signal) {
    // Read the settings again here, so an address that fails to parse reports
    // server_address_invalid instead of "can't reach".
    const conn = await connection();
    const res = await request(conn, "/api/words", { signal });
    return { status: res.status, contentType: res.headers.get("content-type") ?? "", body: await res.text() };
  },
  validate: validateWordsResponse,
  async writeResult(result) {
    if (!result.ok) {
      const { code, message, details } = result;
      await ext.storage.local.set({ syncError: { code, message, details, at: Date.now() } });
      return;
    }
    // Only write words when they changed, so open tabs don't redo work every minute.
    const { words: old = [] } = await ext.storage.local.get("words");
    const patch = {
      lastSync: Date.now(),
      syncError: null,
      syncWarnings: result.dropped ? { dropped: result.dropped, reasons: result.reasons } : null,
    };
    if (JSON.stringify(old) !== JSON.stringify(result.words)) patch.words = result.words;
    if (result.dropped) console.warn("Skipped words the server sent that can't be shown:", result.reasons);
    await ext.storage.local.set(patch);
  },
});

// Runs at every worker start, including after the extension is re-enabled, when neither
// onInstalled nor onStartup fires (research 06 F39). Cheap and idempotent.
function ensureAlarm() {
  return Promise.resolve(ext.alarms.get(ALARM))
    .then((a) => a || ext.alarms.create(ALARM, { periodInMinutes: 1 }))
    .catch(() => {});
}
ensureAlarm();

ext.runtime.onInstalled.addListener((details) => {
  if (details?.reason === "update") Promise.resolve(ext.alarms.clear(OLD_ALARM)).catch(() => {});
  ensureAlarm();
  sync.request({ reason: "installed" });
});
ext.runtime.onStartup.addListener(() => {
  ensureAlarm();
  sync.request({ reason: "startup" });
});
ext.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) sync.request({ reason: "alarm" });
});

// Content scripts ask for a sync on every page load; the popup asks with force.
// The popup's "Add a word" box and its Undo go through here too, so they finish
// even if the popup closes while the model is thinking. Only extension pages may add
// or remove words (research 03 E3).
ext.runtime.onMessage.addListener(
  createMessageRouter({
    runtime: ext.runtime,
    handlers: {
      sync: {
        from: ["page", "content"],
        async run(msg) {
          await sync.request(msg.force ? { reason: "manual", force: true } : { reason: "page" });
          return { ok: true };
        },
      },
      add: {
        from: ["page"],
        check: (msg) => checks.text(msg.text),
        async run(msg) {
          const res = await api("/api/words", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: msg.text }),
          });
          // Show the new words right away; the follow-up sync is authoritative.
          const added = Array.isArray(res.words) ? filterWords(res.words).words : [];
          await sync.update(
            async () => {
              if (!added.length) return;
              const { words = [] } = await ext.storage.local.get("words");
              const rest = words.filter((w) => !added.some((a) => sameId(a.id, w.id)));
              await ext.storage.local.set({ words: [...added, ...rest] });
            },
            { reason: "add" },
          );
          return res;
        },
      },
      remove: {
        from: ["page"],
        check: (msg) => checks.id(msg.id),
        async run(msg) {
          await api(`/api/words/${encodeURIComponent(msg.id)}`, { method: "DELETE" });
          await sync.update(
            async () => {
              const { words = [] } = await ext.storage.local.get("words");
              const rest = words.filter((w) => !sameId(w.id, msg.id));
              if (rest.length !== words.length) await ext.storage.local.set({ words: rest });
            },
            { reason: "remove" },
          );
          return { ok: true };
        },
      },
    },
  }),
);

// "Show details for the selected word" (Alt+Shift+R; slice 33's reveal-word, the keyboard
// path to slice 19's word card). The content script finds the word in the selection or
// focus, or shows "Select a swapped word first." The rest of 33 (other commands, the
// shortcuts settings, the fallback for tabs without a content script) comes with 33.
ext.commands?.onCommand?.addListener((command, tab) => {
  if (command !== "reveal-word") return;
  const send = (id) => Promise.resolve(ext.tabs.sendMessage(id, { type: "reveal-word" })).catch(() => {});
  if (tab?.id) send(tab.id);
  else Promise.resolve(ext.tabs.query({ active: true, currentWindow: true })).then(([t]) => t?.id && send(t.id), () => {});
});

// New connection settings cancel the request made with the old ones and start over, so a
// slow answer for the old token can't overwrite the new result (research 06 F11).
ext.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.token || changes.serverUrl) sync.credentialsChanged();
});

// The toolbar badge and tooltip per tab (slice 20 §5): "off" when Kotiko is off everywhere
// or paused on the tab's site. Set per tab, never globally, and recomputed when the tab
// changes or the settings do.
async function updateBadge(tab) {
  const action = ext.action;
  if (!action?.setBadgeText || !tab?.id) return;
  try {
    const s = await ext.storage.local.get({ enabled: true, pausedHosts: [] });
    const b = badgeFor({ enabled: s.enabled, pausedHosts: s.pausedHosts, url: tab.url ?? "" });
    await action.setBadgeText({ tabId: tab.id, text: b.text ? t("badge_off") : "" });
    if (b.text) {
      await action.setBadgeBackgroundColor?.({ tabId: tab.id, color: OFF_COLOR });
      await action.setBadgeTextColor?.({ tabId: tab.id, color: "#FFFFFF" });
    }
    await action.setTitle?.({ tabId: tab.id, title: t(b.titleKey, { host: b.host ?? "" }) });
  } catch {
    // The tab closed meanwhile.
  }
}

async function updateAllBadges() {
  try {
    for (const tab of await ext.tabs.query({})) updateBadge(tab);
  } catch {
    // no tabs API here (tests)
  }
}

ext.tabs?.onActivated?.addListener(({ tabId }) => {
  Promise.resolve(ext.tabs.get(tabId)).then(updateBadge, () => {});
});
ext.tabs?.onUpdated?.addListener((_id, change, tab) => {
  if (change.url || change.status === "loading") updateBadge(tab);
});
ext.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.enabled || changes.pausedHosts)) updateAllBadges();
});
updateAllBadges();
