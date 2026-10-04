// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Kotiko's background. Words live in this browser (slice 11's IndexedDB store, projected
// into storage.local for content scripts) or on a Kotiko server (pulled every minute into
// storage.local, as before). New words are looked up by the learner's own provider, by
// the server, or typed with their meaning, through add jobs that never block a page.
// Secrets (the lookup key, the server token) live only in the store, which content
// scripts can't reach, and only this file reads them.
//
// The libraries load through importScripts in Chrome's service worker, and through the
// manifest's background.scripts list (before this file) in Firefox's event page.
if (!globalThis.SyncController && typeof importScripts === "function") {
  importScripts(
    "lib/url.js", "lib/validate-words.js", "lib/sync-controller.js", "lib/messages.js", "lib/i18n.js", "lib/badge.js",
    "spec/spec.js", "lib/text.js", "lib/lang.js", "lib/words-v1.js", "lib/wordspec.js", "lib/word-merge.js", "lib/store.js",
    "lib/projection.js", "lib/llm/policy.js", "lib/llm/catalog.js", "lib/llm/client.js", "lib/add-queue.js",
    "lib/refresh-job.js", "lib/local-mode.js", "lib/pkce.js", "lib/celebrations.js", "lib/welcome-model.js",
    "lib/pronounce.js", "lib/wiktionary-pass.js",
  );
}

const ext = globalThis.browser ?? globalThis.chrome;
const { normalizeServerUrl } = globalThis.ServerUrl;
const { validateWordsResponse, filterWords } = globalThis.WordValidator;
const { createSyncController } = globalThis.SyncController;
const { createMessageRouter, checks } = globalThis.MessageRouter;
const { badgeFor, OFF_COLOR } = globalThis.KotikoBadge;
const { t } = globalThis.KotikoI18n;
const { createWordHandlers } = globalThis.KotikoWordsV1;
const Local = globalThis.KotikoLocal;

const ALARM = "kotiko-sync";
// The sync alarm's name before the rename; cleared on update. Remove in the next release.
const OLD_ALARM = "slovo-sync"; // legacy-name-ok
// Inside Chrome's 30 s limit for a fetch in a service worker.
const ADD_TIMEOUT_MS = 28_000;
const BATCH = 500;
const SECRET_IDS = /^(server|provider:[a-z0-9-]{1,32})$/;
const MAX_SECRET = 4096;

const codedError = (code, message, details = {}) => Object.assign(new Error(message), { code, details });
const now = () => Date.now();
const uiLanguage = () => {
  try {
    return ext.i18n?.getUILanguage?.() ?? "en";
  } catch {
    return "en";
  }
};

// ── the store, the one-time upgrade and secrets ─────────────────────────────

let storeP = null;
function getStore() {
  storeP ??= globalThis.KotikoStore.open({ indexedDB: globalThis.indexedDB, now }).catch((e) => {
    storeP = null;
    throw e;
  });
  return storeP;
}

// Everything that reads settings or secrets waits for the upgrade (slice 11 section 8),
// which runs at every worker start until it has finished once.
let readyP = null;
function ready() {
  readyP ??= (async () => {
    const store = await getStore();
    const r = await Local.migrate({ store, storage: ext.storage.local, uiLanguage: uiLanguage() });
    if (r.migrated && r.home === "local" && r.seeded) projector.schedule();
    if (r.migrated) refresh.nudge().catch(() => {});
  })().catch((e) => {
    readyP = null;
    console.warn("Kotiko couldn't open its word store:", e?.message ?? e);
    throw e;
  });
  return readyP;
}

// Secrets stay in this worker's memory for its life; nothing writes them to any storage area.
const secretCache = new Map();
async function secret(id) {
  if (secretCache.has(id)) return secretCache.get(id);
  const store = await getStore();
  const value = await store.secrets.get(id);
  secretCache.set(id, value);
  return value;
}

async function setSecret(id, value) {
  const store = await getStore();
  if (value) await store.secrets.set(id, value);
  else await store.secrets.remove(id);
  secretCache.set(id, value || null);
  const s = await Local.readSettings(ext.storage.local);
  const keys = { server: s.keys.server, providers: { ...s.keys.providers } };
  if (id === "server") keys.server = !!value;
  else keys.providers[id.slice("provider:".length)] = !!value;
  await ext.storage.local.set({ keys });
}

// "sk-or-…a1b2": the first six and last four characters, never the whole key.
function mask(v) {
  if (typeof v !== "string" || !v) return null;
  return v.length > 14 ? `${v.slice(0, 6)}…${v.slice(-4)}` : `…${v.slice(-2)}`;
}

const settings = async () => {
  await ready().catch(() => {});
  return Local.readSettings(ext.storage.local);
};
const home = async () => (await settings()).wordsHome ?? "local";

// The learner's base languages: slice 50's synced list when it exists, else the local
// copy, else the browser's language.
async function currentBases() {
  try {
    const { ui } = await ext.storage.sync.get({ ui: {} });
    if (Array.isArray(ui?.baseLangs) && ui.baseLangs.length) return ui.baseLangs.slice(0, 4);
  } catch {
    // no storage.sync here
  }
  const { baseLangs } = await ext.storage.local.get({ baseLangs: null });
  if (Array.isArray(baseLangs) && baseLangs.length) return baseLangs.slice(0, 4);
  return Local.detectBases(uiLanguage());
}

// What content scripts need to read pages in the learner's languages (slice 50 section 5):
// each base's word-boundary rules and its common words (for telling languages apart, 16),
// written to storage.local as `baseRules` when the bases change and after an update. The
// common words are the base's own list, else the imported stopwords-iso list, about 200 KB
// that only this worker reads.
let stopwordsP = null;
function importedStopwords() {
  stopwordsP ??= fetch(ext.runtime.getURL("spec/lang/_generic/stopwords.json"))
    .then((r) => r.json())
    .catch(() => {
      stopwordsP = null;
      return {};
    });
  return stopwordsP;
}

async function mirrorBaseRules({ force = false } = {}) {
  const Text = globalThis.KotikoText;
  const spec = globalThis.KOTIKO_SPEC;
  const bases = await currentBases();
  const stamp = `${ext.runtime.getManifest?.().version ?? ""}|${spec?.version ?? ""}|${bases.join(",")}`;
  const { baseRulesFor } = await ext.storage.local.get({ baseRulesFor: null });
  if (!force && baseRulesFor === stamp) return;
  const imported = await importedStopwords();
  const out = {};
  for (const b of bases) {
    const own = spec?.lang?.[b]?.stopwords ?? spec?.lang?.[Text.primary(b)]?.stopwords;
    const casing = spec?.lang?._generic?.casing;
    out[b] = {
      boundaries: Text.rulesFor(spec?.lang?._generic?.boundaries, b),
      casing: { ...(casing?.default ?? {}), ...(casing?.[b] ?? casing?.[Text.primary(b)] ?? {}) },
      stopwords: own?.length ? own : imported[b] ?? imported[Text.primary(b)] ?? [],
    };
  }
  await ext.storage.local.set({ baseRules: out, baseRulesFor: stamp });
}

// ── the server connection ───────────────────────────────────────────────────

// Resolves the stored address and token into a request base, or throws a coded error.
async function connection() {
  await ready().catch(() => {});
  // A page from before the upgrade may still have written these; they win until moved.
  const legacy = await ext.storage.local.get({ token: "", serverUrl: null });
  const stored = await secret("server").catch(() => null);
  const token = String(legacy.token || stored || "").trim();
  if (!token) throw codedError("server_key_rejected", "Paste your API token to connect.", { reason: "no_token" });
  const n = normalizeServerUrl(legacy.serverUrl ?? (await Local.readSettings(ext.storage.local)).server.url);
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

// For add and remove: the parsed body, or an error. A failed lookup carries slice 25's code
// and its details (`retry_at`, `reason`, `provider`) beside the 0.2 string `error` (slice 10),
// so the popup never reads the message.
async function api(path, init = {}) {
  const res = await request(await connection(), path, { ...init, signal: AbortSignal.timeout(ADD_TIMEOUT_MS) });
  if (res.status === 401) throw codedError("server_key_rejected", "The server rejected that API token.");
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = typeof body.code === "string" && body.code ? body.code : "http_error";
    const details = body.details && typeof body.details === "object" ? body.details : {};
    throw codedError(code, typeof body.error === "string" ? body.error : `The server answered ${res.status}.`, { ...details, status: res.status });
  }
  return body;
}

// The server's lookup status (slice 10 §3): free lookups left today and the provider, kept
// in storage.local.lookupStatus for the popup and the dashboard. An older server without
// the route clears it; other failures keep the last one.
async function refreshLookupStatus() {
  try {
    const s = await apiV1("/api/v1/llm/status");
    const status = {
      provider: typeof s.provider === "string" ? s.provider : null,
      quota: s.quota && typeof s.quota === "object" ? s.quota : null,
      at: Date.now(),
    };
    await ext.storage.local.set({ lookupStatus: status });
    return status;
  } catch (e) {
    if (e?.code === "server_outdated") await ext.storage.local.set({ lookupStatus: null });
    throw e;
  }
}

// The lookup status of whoever looks words up: the server, or this browser's provider.
async function lookupStatus() {
  const s = await settings();
  if (s.lookup.kind === "server") return refreshLookupStatus();
  const st = await client.status();
  const status = { provider: s.lookup.kind === "provider" ? st.provider : null, quota: s.lookup.kind === "provider" ? st.quota : null, ready: s.lookup.kind === "provider" && st.ready, at: Date.now() };
  await ext.storage.local.set({ lookupStatus: status });
  return status;
}

// For the `/api/v1` routes (slice 07 §5), whose errors are {error: {code, message, details}}
// with slice 25's codes: the parsed body, or an error carrying the server's code and the
// HTTP status in its details.
async function apiV1(path, { method = "GET", body, timeoutMs = ADD_TIMEOUT_MS, signal = null } = {}) {
  const init = { method, signal: signal ? AbortSignal.any?.([signal, AbortSignal.timeout(timeoutMs)]) ?? signal : AbortSignal.timeout(timeoutMs) };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await request(await connection(), path, init);
  if (res.status === 401) throw codedError("server_key_rejected", "The server rejected that API token.", { status: 401 });
  const data = await res.json().catch(() => null);
  const e = data?.error;
  if (!res.ok) {
    if (e && typeof e === "object" && typeof e.code === "string" && e.code !== "not_found") {
      throw codedError(e.code, String(e.message ?? e.code), { ...(e.details ?? {}), status: res.status });
    }
    // An older server without /api/v1 (or without this route).
    if (res.status === 404 || res.status === 405) throw codedError("server_outdated", `The server answered ${res.status} for ${path}.`, { status: res.status });
    throw codedError("http_error", typeof e === "string" ? e : `The server answered ${res.status}.`, { status: res.status });
  }
  if (!data || typeof data !== "object") throw codedError("not_kotiko_server", `${path} didn't answer with JSON.`, { status: res.status });
  return data;
}

const sameId = (a, b) => String(a) === String(b);

const sync = createSyncController({
  now: () => Date.now(),
  async readCreds() {
    await ready().catch(() => {});
    const legacy = await ext.storage.local.get({ token: "" });
    return { token: String(legacy.token || (await secret("server").catch(() => null)) || "").trim() };
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
    // Words kept in this browser are the projection's; a late server answer never lands.
    if ((await home()) === "local") return;
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

// Syncs with the server when it owns the words; with words in this browser there is
// nothing to pull (slice 11 section 7: the content script's `sync` is a no-op).
async function requestSync(opts) {
  if ((await home()) === "local") return { ok: true, local: true };
  return sync.request(opts);
}

// ── words in this browser: projection, lookups, add jobs ─────────────────────

const projector = globalThis.KotikoProjection.createProjector({
  list: async () => (await getStore()).list(),
  storage: ext.storage.local,
  bases: currentBases,
  enabled: async () => (await home()) === "local",
  onError: (e) => console.warn("Kotiko couldn't update the page word list:", e?.message ?? e),
});
let lastBases = null;

const client = globalThis.KotikoLLMClient.createClient({
  fetch: (...a) => fetch(...a),
  store: { meta: { get: async (k) => (await getStore()).meta.get(k), set: async (k, v) => (await getStore()).meta.set(k, v) }, cache: { get: async (k) => (await getStore()).cache.get(k), put: async (k, v, m) => (await getStore()).cache.put(k, v, m) } },
  settings: async () => (await settings()).lookup,
  key: (providerId) => secret(`provider:${providerId}`).catch(() => null),
  now,
  onQuota: (quota) => {
    settings().then((s) => s.lookup.kind === "provider" && ext.storage.local.set({ lookupStatus: { provider: s.lookup.provider, quota, ready: true, at: Date.now() } })).catch(() => {});
  },
});

// ── pronunciations from Wiktionary (slice 49 section 4a) ─────────────────────

const Pronounce = globalThis.KotikoPronounce.create(globalThis.KOTIKO_SPEC);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A word's page: its HTML, null when there is none, or a thrown error. Waits once when
// Wikimedia asks for at most `maxWaitMs`.
async function wiktionaryPage(title, { maxWaitMs = 2000 } = {}) {
  const W = globalThis.KOTIKO_SPEC.wiktionary;
  const url = W.endpoint.replace("{title}", encodeURIComponent(title));
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers: { "Api-User-Agent": W.agent }, signal: AbortSignal.timeout(W.timeout_ms) });
    if (res.ok) return res.text();
    if (res.status === 404) return null;
    const after = Number(res.headers.get("retry-after"));
    if (res.status === 429 && attempt === 0 && Number.isFinite(after) && after * 1000 <= maxWaitMs) {
      await wait(after * 1000);
      continue;
    }
    throw new Error(`Wiktionary answered ${res.status}`);
  }
  throw new Error("Wiktionary is busy");
}

const pageCache = {
  get: async (key) => (await getStore()).cache.get(key),
  put: async (key, value) => (await getStore()).cache.put(key, value, "wiktionary"),
};

// The model's words (or "native = meaning" words) with Wiktionary's pronunciation where it
// has one. Never fails an add: a page that can't be read leaves the word as it was, and the
// background pass tries again.
async function pronounceWords(words) {
  const out = [];
  for (const w of words ?? []) {
    try {
      out.push((await Pronounce.enrich(w, { fetchPage: wiktionaryPage, cache: pageCache })).word);
    } catch {
      out.push(w);
    }
  }
  return out;
}

let wiktionaryPass = null;
async function pronunciationPass() {
  wiktionaryPass ??= globalThis.KotikoWiktionaryPass.createPass({
    store: await getStore(),
    pronounce: Pronounce,
    fetchPage: (t) => wiktionaryPage(t, { maxWaitMs: 10_000 }),
    cache: pageCache,
    enabled: async () => (await home()) === "local",
  });
  return wiktionaryPass;
}

// One lookup for an add job (slice 11 section 5): "native = meaning" never asks a model;
// otherwise the configured backend.
async function lookupJob(job, signal) {
  const s = await settings();
  const store = await getStore();
  const parsed = Local.parseManual(job.text);
  const base = job.baseLangs[0] ?? (await currentBases())[0];
  if (parsed) {
    const lang = Local.manualLang(parsed.native, { hintLang: job.hintLang, recent: await store.recentLangs(5), base });
    const word = lang ? Local.manualWord(parsed, { lang, base, text: job.text }) : null;
    if (word) return { ok: true, result: { words: await pronounceWords([word]), rejected: [], missing_bases: [] } };
  }
  if (s.lookup.kind === "provider") {
    const res = await client.lookup({ text: job.text, base_langs: job.baseLangs, hint_lang: job.hintLang, recent: await store.recentLangs(5) }, { signal });
    if (res?.ok && res.result?.words?.length) res.result = { ...res.result, words: await pronounceWords(res.result.words) };
    return res;
  }
  if (s.lookup.kind === "server") {
    // The server looks up and saves nothing (its preview); the words are saved here.
    try {
      const body = { text: job.text, preview: true, base_langs: job.baseLangs };
      if (job.hintLang) body.hint_lang = job.hintLang;
      const res = await apiV1("/api/v1/words", { method: "POST", body, signal });
      return { ok: true, result: { words: res.candidates ?? [], rejected: res.rejected ?? [], missing_bases: res.missing_bases ?? [], code: res.code ?? null, reply: res.reply ?? null } };
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      return { ok: false, error: { code: e?.code ?? "internal", details: e?.details ?? {} } };
    }
  }
  return { ok: false, error: { code: "lookup_not_set_up", details: { reason: "no_provider" } } };
}

// Saves a job's words where they live: one store transaction keyed by the job id, or the
// server's structured batch route with the job id as client_request_id.
async function saveJob(job, words) {
  if ((await home()) === "local") {
    const store = await getStore();
    const manual = words.every((w) => w.origin === "manual");
    const { results } = await store.upsertByNatural(words, { explicit: true, origin: manual ? "manual" : "add", jobId: job.id });
    if (words.some((w) => !w.pronunciation)) refresh.nudge().then(() => refresh.tick()).catch(() => {});
    return results;
  }
  const res = await apiV1("/api/v1/words/batch", { method: "POST", body: { words: words.map((w) => ({ ...w, origin: w.origin ?? "add" })), client_request_id: job.id } });
  sync.request({ reason: "add", force: true });
  return Array.isArray(res.results) ? res.results : [];
}

const queue = globalThis.KotikoAddQueue.createAddQueue({
  storage: ext.storage.local,
  lookup: lookupJob,
  save: saveJob,
  now,
  onSettled: () => {
    lookupStatus().catch(() => {});
    refresh.tick().catch(() => {});
  },
  onError: (e) => console.warn("Kotiko add job:", e?.message ?? e),
});

const refresh = globalThis.KotikoRefreshJob.createRefreshJob({
  store: {
    list: async (o) => (await getStore()).list(o),
    update: async (id, p, o) => (await getStore()).update(id, p, o),
    meta: { get: async (k) => (await getStore()).meta.get(k), set: async (k, v) => (await getStore()).meta.set(k, v) },
  },
  client,
  busy: () => queue.busy(),
  enabled: async () => {
    const s = await settings();
    return s.wordsHome === "local" && s.lookup.kind === "provider";
  },
  now,
});

// Every committed write updates the pages' list once, 100 ms later.
getStore().then((store) => store.onCommit((info) => projector.schedule({ by: info?.by ?? null }))).catch(() => {});

// ── moving words between this browser and a server (slice 11 section 6) ────────────

const PUBLIC_FIELDS = ["id", "lang", "native", "base_lang", "sense", "gloss", "forms", "romanization", "native_vocalized", "pronunciation", "pronunciation_careful", "pronunciation_source", "note", "status", "origin", "source_text"];
const forServer = (w) => Object.fromEntries(PUBLIC_FIELDS.filter((k) => w[k] !== undefined).map((k) => [k, w[k]]));

async function serverWords() {
  const res = await apiV1("/api/v1/words?status=active,paused", { timeoutMs: 60_000 });
  return Array.isArray(res.words) ? res.words : [];
}

async function preview(to) {
  await ready();
  const s = await settings();
  if (to === "server") {
    const words = await (await getStore()).list();
    return { to, count: words.length, server: s.server.url, connected: s.keys.server };
  }
  const words = await serverWords();
  return { to, count: words.length, server: s.server.url };
}

// Local -> server: upload every word through the structured batch route (no model
// calls), 500 at a time. Nothing switches unless every batch succeeded.
async function toServer() {
  const store = await getStore();
  const words = await store.list();
  const counts = { created: 0, updated: 0, unchanged: 0, rejected: 0 };
  for (let i = 0; i < words.length; i += BATCH) {
    const chunk = words.slice(i, i + BATCH).map(forServer);
    const res = await apiV1("/api/v1/words/batch", { method: "POST", body: { words: chunk, client_request_id: globalThis.KotikoStore.uuid7(now()) }, timeoutMs: 60_000 });
    for (const r of res.results ?? []) if (counts[r.result] !== undefined) counts[r.result]++;
    counts.rejected += Array.isArray(res.rejected) ? res.rejected.length : 0;
  }
  const s = await settings();
  await ext.storage.local.set({ wordsHome: "server", lookup: { ...s.lookup, kind: s.lookup.kind === "none" ? "server" : s.lookup.kind } });
  await sync.credentialsChanged();
  return { ok: true, total: words.length, ...counts };
}

// Server -> local: the server's words, ids kept, replace this browser's copy; the
// server's data is untouched.
async function toLocal({ forget = false, serverLookups = false } = {}) {
  const words = await serverWords();
  const store = await getStore();
  const n = await store.replaceAll(words);
  const s = await settings();
  const bases = await currentBases();
  const present = [...new Set(words.map((w) => w.base_lang).filter(Boolean))];
  const nextBases = [...bases, ...present.filter((b) => !bases.includes(b))].slice(0, 4);
  const kind = s.lookup.kind === "server" && !(serverLookups && !forget) ? "none" : s.lookup.kind;
  await ext.storage.local.set({ wordsHome: "local", lookup: { ...s.lookup, kind }, baseLangs: nextBases, syncError: null });
  // Slice 50's synced list, when there is one, is what currentBases() reads first.
  try {
    const { ui } = await ext.storage.sync.get({ ui: null });
    if (Array.isArray(ui?.baseLangs) && JSON.stringify(ui.baseLangs) !== JSON.stringify(nextBases)) await ext.storage.sync.set({ ui: { ...ui, baseLangs: nextBases } });
  } catch {
    // no storage.sync here
  }
  if (forget) {
    await setSecret("server", null);
    await ext.storage.local.set({ server: { url: Local.DEFAULT_SERVER } });
  }
  await projector.flush();
  refresh.nudge().catch(() => {});
  return { ok: true, total: n };
}

// ── triggers ───────────────────────────────────────────────────────────────

// Runs at every worker start, including after the extension is re-enabled, when neither
// onInstalled nor onStartup fires (research 06 F39). Cheap and idempotent.
function ensureAlarm() {
  return Promise.resolve(ext.alarms.get(ALARM))
    .then((a) => a || ext.alarms.create(ALARM, { periodInMinutes: 1 }))
    .catch(() => {});
}
ensureAlarm();
mirrorBaseRules().catch(() => {});

// Slice 08: languages hidden under an old code stay hidden under the canonical one, so a
// hidden "cmn" is a hidden "zh" once the server re-tags its words.
async function migrateHiddenLangs() {
  const { hiddenLangs = [] } = await ext.storage.local.get({ hiddenLangs: [] });
  const canonical = (tag) => globalThis.KotikoLang.canonical(tag);
  const mapped = [...new Set(hiddenLangs.map((tag) => (canonical(tag).ok ? canonical(tag).tag : tag)))];
  if (JSON.stringify(mapped) !== JSON.stringify(hiddenLangs)) await ext.storage.local.set({ hiddenLangs: mapped });
}

// At every worker start: finish the upgrade, pick up jobs a stopped worker left behind.
ready()
  .then(async () => {
    await queue.resume();
    refresh.tick().catch(() => {});
    (await getStore()).cache.prune().catch(() => {});
  })
  .catch(() => {});

// ── first run (slice 22) and milestones (slice 32) ─────────────────────────

const WELCOME = "welcome.html";
const Celebrations = globalThis.KotikoCelebrations;

// Opens the welcome tab, or brings an open one to the front.
async function openWelcome() {
  const url = ext.runtime.getURL(WELCOME);
  try {
    const contexts = (await ext.runtime.getContexts?.({ contextTypes: ["TAB"] })) ?? [];
    const open = contexts.find((c) => typeof c.documentUrl === "string" && c.documentUrl.startsWith(url) && c.tabId >= 0);
    if (open) {
      await ext.tabs.update(open.tabId, { active: true });
      if (open.windowId >= 0) await Promise.resolve(ext.windows?.update?.(open.windowId, { focused: true })).catch(() => {});
      return { ok: true, focused: true };
    }
  } catch {
    // no getContexts (Firefox): open a new one
  }
  await Promise.resolve(ext.tabs?.create?.({ url, active: true })).catch(() => {});
  return { ok: true, focused: false };
}

// Slice 50 section 2: the languages the learner reads, from the browser's settings (read
// here, nothing sent). Confirmed on the welcome tab.
async function detectBrowserBases() {
  let accept;
  try {
    accept = (await ext.i18n?.getAcceptLanguages?.()) ?? [];
  } catch {
    accept = [];
  }
  if (!accept.length) accept = Array.isArray(globalThis.navigator?.languages) ? [...globalThis.navigator.languages] : [];
  return globalThis.KotikoWelcomeModel.detectBases({ uiLanguage: uiLanguage(), acceptLanguages: accept, Lang: globalThis.KotikoLang });
}

// A new install: detect the base languages, mark the first run as not done, and open the
// welcome tab. Never on update: existing learners keep what they have.
async function firstInstall() {
  await ready().catch(() => {});
  const bases = await detectBrowserBases();
  let ui;
  try {
    ({ ui = {} } = await ext.storage.sync.get({ ui: {} }));
  } catch {
    ui = null;
  }
  // storage.sync can outlive an uninstall; a learner who confirmed before keeps their list.
  const keep = ui?.baseLangsConfirmed === true && Array.isArray(ui.baseLangs) && ui.baseLangs.length;
  const next = keep ? ui.baseLangs.slice(0, 4) : bases;
  if (ui) {
    await ext.storage.sync.set({ ui: { uiLang: "auto", ...ui, baseLangs: next, baseLangsDetected: bases, baseLangsConfirmed: !!keep } }).catch(() => {});
  }
  const { onboarding } = await ext.storage.local.get({ onboarding: null });
  const patch = { baseLangs: next };
  if (!onboarding) patch.onboarding = { completedAt: null, skipped: false, version: 2 };
  await ext.storage.local.set(patch);
  projector.schedule();
  await openWelcome();
}

// Slice 50 §2's upgrade rule: an update from a version with no base-language setting
// detects the browser's languages, then adds every base the saved words already have
// (all of a pre-v2 list is "en"), so an existing learner's swaps never silently stop.
// A learner who has a setting keeps it untouched.
async function upgradeBases() {
  await ready().catch(() => {});
  let ui;
  try {
    ({ ui = {} } = await ext.storage.sync.get({ ui: {} }));
  } catch {
    ui = null;
  }
  if (Array.isArray(ui?.baseLangs) && ui.baseLangs.length) return;
  const detected = await detectBrowserBases();
  const records = await getStore().then((s) => s.list()).catch(() => []);
  const { words = [] } = await ext.storage.local.get({ words: [] });
  const present = [];
  for (const w of [...records, ...(Array.isArray(words) ? words : [])]) {
    const b = w?.base_lang ?? (w?.english ? "en" : null);
    if (b && !present.includes(b)) present.push(b);
  }
  const Lang = globalThis.KotikoLang;
  const next = detected.slice();
  for (const b of present) if (!next.some((d) => Lang.sameBase(d, b))) next.push(b);
  // Over four: drop detected languages no word uses, from the end.
  for (let i = next.length - 1; next.length > 4 && i >= 0; i--) if (!present.includes(next[i])) next.splice(i, 1);
  const bases = next.slice(0, 4);
  if (ui) await ext.storage.sync.set({ ui: { uiLang: "auto", ...ui, baseLangs: bases, baseLangsDetected: detected, baseLangsConfirmed: false } }).catch(() => {});
  await ext.storage.local.set({ baseLangs: bases });
  projector.schedule();
}

// An update from a version before the welcome tab: the learner is past the first run, and
// a learner who already has words never gets a first-word or first-swap celebration.
async function upgradeOnboarding() {
  await ready().catch(() => {});
  const { onboarding, celebrations, words } = await ext.storage.local.get({ onboarding: null, celebrations: null, words: [] });
  const patch = {};
  if (!onboarding) patch.onboarding = { completedAt: now(), skipped: false, version: 2, upgraded: true };
  const stored = await getStore().then((s) => s.count()).catch(() => 0);
  if ((Array.isArray(words) && words.length) || stored > 0) {
    const next = Celebrations.markDone(celebrations, ["vocab:first", "page:first-swap"], now());
    if (JSON.stringify(next) !== JSON.stringify(celebrations)) patch.celebrations = next;
  }
  if (Object.keys(patch).length) await ext.storage.local.set(patch);
}

// The first word saved anywhere (the popup too) finishes the first run.
let finishing = Promise.resolve();
function noteFirstWord() {
  finishing = finishing.then(async () => {
    const { onboarding } = await ext.storage.local.get({ onboarding: null });
    if (onboarding && !onboarding.completedAt) await ext.storage.local.set({ onboarding: { ...onboarding, completedAt: now() } });
  }).catch(() => {});
  return finishing;
}

// One claim at a time, so two pages can't both fire a milestone (32 section 4).
let claiming = Promise.resolve();
function claimMilestone(key) {
  const run = claiming.then(async () => {
    const { celebrations, prefs } = await ext.storage.local.get({ celebrations: null, prefs: {} });
    const r = Celebrations.claim(celebrations, key, { now: now() });
    if (r.claimed) await ext.storage.local.set({ celebrations: r.next });
    return { claimed: r.claimed, reason: r.reason ?? null, celebrate: r.claimed && Celebrations.enabled(prefs) };
  });
  claiming = run.catch(() => {});
  return run;
}

// Tabs open before an install or update get Kotiko without a reload (slice 15): the same
// files the manifest injects, top frame only, as it does. On an update the new copy tells
// the old one to stand down (the handoff in content.js). A tab that can't take scripts (a
// store page, a browser page) is skipped.
async function injectOpenTabs() {
  const cs = ext.runtime.getManifest?.()?.content_scripts?.[0];
  if (!ext.scripting?.executeScript || !cs) return 0;
  const tabs = await Promise.resolve(ext.tabs.query({ url: ["http://*/*", "https://*/*"] })).catch(() => []);
  let n = 0;
  for (const tab of tabs) {
    try {
      if (cs.css?.length) await ext.scripting.insertCSS({ target: { tabId: tab.id }, files: cs.css });
      await ext.scripting.executeScript({ target: { tabId: tab.id }, files: cs.js });
      n++;
    } catch {
      // not a page Kotiko may run on
    }
  }
  return n;
}

function onInstalled(details) {
  if (details?.reason === "update") {
    Promise.resolve(ext.alarms.clear(OLD_ALARM)).catch(() => {});
    migrateHiddenLangs().catch(() => {});
    // The bases after the first-run state: writing them projects the words again, and the
    // first-run check reads the old list first.
    upgradeOnboarding().catch(() => {}).then(upgradeBases).catch(() => {});
  }
  if (details?.reason === "install") firstInstall().catch((e) => console.warn("Kotiko couldn't open the welcome tab:", e?.message ?? e));
  if (details?.reason === "install" || details?.reason === "update") injectOpenTabs().catch(() => {});
  ensureAlarm();
  mirrorBaseRules({ force: true }).catch(() => {});
  ready().catch(() => {}).finally(() => requestSync({ reason: "installed" }));
}
ext.runtime.onInstalled.addListener(onInstalled);
ext.runtime.onStartup.addListener(() => {
  ensureAlarm();
  requestSync({ reason: "startup" });
});
ext.alarms.onAlarm.addListener((a) => {
  if (a.name !== ALARM) return;
  requestSync({ reason: "alarm" });
  queue.kick();
  refresh.tick().catch(() => {});
  pronunciationPass().then((p) => p.tick()).catch(() => {});
});
globalThis.addEventListener?.("online", () => queue.wake());

const isUuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const LOOKUP_KINDS = new Set(["provider", "server", "none"]);

function checkLookup(l) {
  if (!l || typeof l !== "object") return "lookup must be an object";
  if (l.kind !== undefined && !LOOKUP_KINDS.has(l.kind)) return "kind must be provider, server or none";
  if (l.provider !== undefined && !globalThis.KOTIKO_SPEC.providers.providers.some((p) => p.id === l.provider)) return "unknown provider";
  for (const k of ["baseUrl", "model"]) if (l[k] !== undefined && l[k] !== null && (typeof l[k] !== "string" || l[k].length > 300)) return `${k} must be a string`;
  if (l.baseUrl && !/^https?:\/\/[^\s]+$/i.test(l.baseUrl.trim())) return "baseUrl must be an http(s) address";
  if (l.dataCollection !== undefined && l.dataCollection !== "allow" && l.dataCollection !== "deny") return "dataCollection must be allow or deny";
  return null;
}

// New lookup settings: running attempts stop and run again with them; waiting jobs try now.
function lookupChanged() {
  client.reset();
  queue.abortRunning();
  queue.wake();
  refresh.tick().catch(() => {});
  lookupStatus().catch(() => {});
}

// The provider presets for the settings page (no keys, ever).
const PRESETS = () => globalThis.KOTIKO_SPEC.providers.providers.map(({ id, label, baseUrl, keyRequired, keyUrl, modelSource, local, beta, free }) => ({ id, label, baseUrl, keyRequired, keyUrl, modelSource, local: !!local, beta: !!beta, free: !!free }));

const serverHandlers = createWordHandlers({
  call: apiV1,
  storage: ext.storage.local,
  afterWrite: () => sync.request({ reason: "edit", force: true }),
});
const localHandlers = Local.createLocalWordHandlers({
  store: {
    list: async (o) => (await getStore()).list(o),
    all: async () => (await getStore()).all(),
    get: async (id) => (await getStore()).get(id),
    update: async (...a) => (await getStore()).update(...a),
    remove: async (...a) => (await getStore()).remove(...a),
    restore: async (...a) => (await getStore()).restore(...a),
    upsertByNatural: async (...a) => (await getStore()).upsertByNatural(...a),
    recentLangs: async (n) => (await getStore()).recentLangs(n),
  },
  client,
  storage: ext.storage.local,
  refresh,
  now,
});

// The dashboard's word routes reach whichever home the words have (slice 21's protocol).
const wordRoutes = Object.fromEntries(
  Object.keys(serverHandlers).map((type) => [type, {
    from: ["page"],
    check: serverHandlers[type].check,
    async run(msg, sender) {
      return ((await home()) === "local" ? localHandlers : serverHandlers)[type].run(msg, sender);
    },
  }]),
);

// Content scripts ask for a sync on every page load; the popup asks with force. Adds go
// to the add queue (or, with a server that looks words up and keeps them, straight to
// it as before). Only extension pages may add, delete, read secrets' descriptions or
// change settings (research 03 E3, slice 26); content scripts may only sync, and the docs
// site's callback page may send `oauth.code`.
ext.runtime.onMessage.addListener(
  createMessageRouter({
    runtime: ext.runtime,
    docsOrigin: globalThis.KotikoPKCE.DOCS_ORIGIN,
    handlers: {
      ...wordRoutes,
      sync: {
        from: ["page", "content"],
        async run(msg) {
          await requestSync(msg.force ? { reason: "manual", force: true } : { reason: "page" });
          return { ok: true };
        },
      },
      // The free lookups left today, for the popup and the dashboard (slice 10).
      llmStatus: {
        from: ["page"],
        run: () => lookupStatus(),
      },
      add: {
        from: ["page"],
        check: (msg) => checks.text(msg.text),
        async run(msg) {
          await ready().catch(() => {});
          const s = await settings();
          if (s.wordsHome === "server" && s.lookup.kind === "server") return legacyAdd(msg);
          const job = await queue.add({
            id: isUuid(msg.id) ? msg.id : globalThis.KotikoStore.uuid7(now()),
            text: msg.text.trim(),
            hintLang: typeof msg.hintLang === "string" && msg.hintLang ? msg.hintLang : null,
            baseLangs: Array.isArray(msg.baseLangs) && msg.baseLangs.length ? msg.baseLangs.slice(0, 4) : await currentBases(),
            surface: typeof msg.surface === "string" ? msg.surface : "popup",
          });
          return { ok: true, job: { id: job.id, state: job.state } };
        },
      },
      remove: {
        from: ["page"],
        check: (msg) => checks.id(msg.id),
        async run(msg) {
          if ((await home()) === "local") {
            const r = await (await getStore()).remove(String(msg.id));
            if (!r.ok && r.code !== "word_gone") throw codedError(r.code, r.message, r.details);
            if (typeof msg.jobId === "string") await queue.markUndo(msg.jobId, String(msg.id), "done");
            return { ok: true };
          }
          await api(`/api/words/${encodeURIComponent(msg.id)}`, { method: "DELETE" });
          if (typeof msg.jobId === "string") await queue.markUndo(msg.jobId, msg.id, "done");
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
      // The welcome tab (slice 22): opened from the popup's first-run card and the
      // dashboard's About; one tab, brought to the front when already open.
      "welcome.open": { from: ["page"], run: () => openWelcome() },
      // Milestones (slice 32): claimed once, by one page.
      "celebrations.claim": {
        from: ["page"],
        check: (m) => (Celebrations.isKey(m.key) ? null : "key must be a milestone key"),
        run: (m) => claimMilestone(m.key),
      },
      "jobs.retry": { from: ["page"], check: (m) => (isUuid(m.id) ? null : "id must be a job id"), run: (m) => queue.retry(m.id).then(() => ({ ok: true })) },
      "jobs.cancel": { from: ["page"], check: (m) => (isUuid(m.id) ? null : "id must be a job id"), run: (m) => queue.cancel(m.id).then(() => ({ ok: true })) },
      "jobs.dismiss": { from: ["page"], check: (m) => (isUuid(m.id) ? null : "id must be a job id"), run: (m) => queue.dismiss(m.id).then(() => ({ ok: true })) },
      "jobs.seen": { from: ["page"], check: (m) => (Array.isArray(m.ids) && m.ids.length <= 50 ? null : "ids must list job ids"), run: (m) => queue.markSeen(m.ids).then(() => ({ ok: true })) },

      // Secrets (slice 11 section 3): set from extension pages, never read back.
      "secrets.set": {
        from: ["page"],
        check: (m) => (typeof m.id !== "string" || !SECRET_IDS.test(m.id) ? "id must be server or provider:<id>" : typeof m.value !== "string" || !m.value.trim() || m.value.length > MAX_SECRET || /\s/.test(m.value.trim()) ? "value must be a key without spaces" : null),
        async run(m) {
          await ready();
          await setSecret(m.id, m.value.trim());
          if (m.id === "server") sync.credentialsChanged();
          else lookupChanged();
          return { ok: true, masked: mask(m.value.trim()) };
        },
      },
      "secrets.remove": {
        from: ["page"],
        check: (m) => (typeof m.id === "string" && SECRET_IDS.test(m.id) ? null : "id must be server or provider:<id>"),
        async run(m) {
          await ready();
          await setSecret(m.id, null);
          if (m.id !== "server") lookupChanged();
          return { ok: true };
        },
      },
      "secrets.describe": {
        from: ["page"],
        async run() {
          await ready();
          const ids = await (await getStore()).secrets.ids();
          const out = {};
          for (const id of ids) if (SECRET_IDS.test(id)) out[id] = mask(await secret(id));
          return { secrets: out };
        },
      },

      // Where words live and who looks them up (slice 11 section 1).
      "backend.get": {
        from: ["page"],
        async run() {
          const s = await settings();
          return { wordsHome: s.wordsHome ?? "local", lookup: s.lookup, server: s.server, keys: s.keys, providers: PRESETS(), bases: await currentBases() };
        },
      },
      "backend.set": {
        from: ["page"],
        check: (m) => checkLookup(m.lookup),
        async run(m) {
          const s = await settings();
          const next = { ...s.lookup };
          for (const k of ["kind", "provider", "baseUrl", "model", "dataCollection"]) if (m.lookup[k] !== undefined) next[k] = typeof m.lookup[k] === "string" ? m.lookup[k].trim() || null : m.lookup[k];
          if (next.kind === "server" && !s.keys.server) throw codedError("server_key_rejected", "Connect a server first.", { reason: "no_token" });
          await ext.storage.local.set({ lookup: next });
          lookupChanged();
          return { ok: true, lookup: next };
        },
      },
      "backend.test": {
        from: ["page"],
        async run() {
          const s = await settings();
          if (s.lookup.kind === "server") {
            const st = await refreshLookupStatus();
            return { ok: true, provider: st.provider, quota: st.quota };
          }
          const r = await client.test({ base_langs: await currentBases() });
          lookupStatus().catch(() => {});
          return r;
        },
      },
      // Connects a server (address, token). With words kept in this browser it doesn't
      // switch: the learner moves them with migrate.* after seeing the count.
      "server.connect": {
        from: ["page"],
        check: (m) => (m.url !== undefined && (typeof m.url !== "string" || m.url.length > 500) ? "url must be a string" : m.token !== undefined && (typeof m.token !== "string" || m.token.length > MAX_SECRET) ? "token must be a string" : null),
        async run(m) {
          await ready();
          if (typeof m.url === "string") await ext.storage.local.set({ server: { url: m.url.trim() || Local.DEFAULT_SERVER } });
          if (typeof m.token === "string") await setSecret("server", m.token.trim() || null);
          const s = await settings();
          if (s.wordsHome === "local") {
            const count = await (await getStore()).count();
            if (count > 0) return { ok: true, wordsHome: "local", needsSwitch: true, count };
            if (s.keys.server) {
              await ext.storage.local.set({ wordsHome: "server", lookup: { ...s.lookup, kind: s.lookup.kind === "provider" ? "provider" : "server" } });
            }
          }
          const result = await sync.credentialsChanged();
          return { ok: true, wordsHome: (await settings()).wordsHome, sync: result?.ok === false ? { code: result.code } : { ok: true } };
        },
      },
      "migrate.preview": {
        from: ["page"],
        check: (m) => (m.to === "server" || m.to === "local" ? null : "to must be server or local"),
        run: (m) => preview(m.to),
      },
      "migrate.run": {
        from: ["page"],
        check: (m) => (m.to === "server" || m.to === "local" ? null : "to must be server or local"),
        async run(m) {
          await ready();
          return m.to === "server" ? toServer() : toLocal({ forget: m.forget === true, serverLookups: m.serverLookups === true });
        },
      },

      // Connect OpenRouter (slice 11 section 4). The button waits for the docs site's
      // callback page (slice 44); these routes are its hooks.
      "oauth.start": {
        from: ["page"],
        async run() {
          await ready();
          const { verifier, challenge } = await globalThis.KotikoPKCE.pair();
          await (await getStore()).secrets.set("pkce:pending", JSON.stringify({ verifier, expires: now() + globalThis.KotikoPKCE.PENDING_MS }));
          const url = globalThis.KotikoPKCE.authUrl({ challenge });
          await Promise.resolve(ext.tabs?.create?.({ url })).catch(() => {});
          return { ok: true, url };
        },
      },
      "oauth.code": {
        from: ["docs"],
        check: (m) => (typeof m.code === "string" && m.code.length > 0 && m.code.length <= 512 ? null : "code must be a string"),
        async run(m, sender) {
          if (!globalThis.KotikoPKCE.isCallback(sender?.url)) throw codedError("forbidden", "Not the callback page.");
          const store = await getStore();
          const raw = await store.secrets.get("pkce:pending");
          await store.secrets.remove("pkce:pending");
          const pending = raw ? JSON.parse(raw) : null;
          if (!pending || pending.expires < now()) throw codedError("key_rejected", "That sign-in has expired.", { reason: "expired", provider: "openrouter" });
          const key = await globalThis.KotikoPKCE.exchange({ fetch: (...a) => fetch(...a), code: m.code, verifier: pending.verifier });
          await setSecret("provider:openrouter", key);
          const s = await settings();
          await ext.storage.local.set({ lookup: { ...s.lookup, kind: "provider", provider: "openrouter", baseUrl: null } });
          lookupChanged();
          return { ok: true };
        },
      },
    },
  }),
);

// Today's server add (lookup and save on the server, then sync): kept as it was for a
// server that looks words up and keeps them.
async function legacyAdd(msg) {
  // Every add (or failed one) changes what's left: read it again afterwards.
  const res = await api("/api/words", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: msg.text }),
  }).finally(() => {
    refreshLookupStatus().catch(() => {});
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
}

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

// A token or address written to storage.local (a page from before the upgrade, still
// open) moves into the store and the settings at once; then the sync starts over with
// it, cancelling the request made with the old one (research 06 F11).
async function adoptLegacy() {
  await ready().catch(() => {});
  const legacy = await ext.storage.local.get({ token: null, serverUrl: null });
  if (legacy.token === null && legacy.serverUrl === null) return;
  const s = await settings();
  const patch = {};
  if (legacy.serverUrl !== null) patch.server = { url: String(legacy.serverUrl).trim() || Local.DEFAULT_SERVER };
  const token = String(legacy.token ?? "").trim();
  if (legacy.token !== null) {
    await setSecret("server", token || null);
    if (token && s.wordsHome !== "server") {
      patch.wordsHome = "server";
      patch.lookup = { ...s.lookup, kind: s.lookup.kind === "provider" ? "provider" : "server" };
    }
  }
  await ext.storage.local.set(patch);
  await ext.storage.local.remove(["token", "serverUrl"]);
}

ext.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.ui) {
    projector.schedule();
    mirrorBaseRules().catch(() => {});
  }
  if (area !== "local") return;
  if (changes.token?.newValue !== undefined || changes.serverUrl?.newValue !== undefined) {
    sync.credentialsChanged();
    adoptLegacy().catch(() => {});
  }
  // Bases changed by a page (not the projection's own mirror): project again.
  if (changes.baseLangs && JSON.stringify(changes.baseLangs.newValue) !== lastBases) {
    lastBases = JSON.stringify(changes.baseLangs.newValue);
    projector.schedule();
    mirrorBaseRules().catch(() => {});
  }
  if (changes.wordsHome && changes.wordsHome.newValue === "local") projector.schedule();
  if (Array.isArray(changes.words?.newValue) && changes.words.newValue.length) noteFirstWord();
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

// For tests: the parts a test drives directly.
globalThis.__kotiko = { ready, getStore, queue, refresh, projector, client, settings, currentBases, mirrorBaseRules, injectOpenTabs, toServer, toLocal, openWelcome, claimMilestone, onInstalled };
