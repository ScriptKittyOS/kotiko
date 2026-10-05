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
    "lib/backup.js", "lib/projection.js", "lib/llm/policy.js", "lib/llm/catalog.js", "lib/llm/client.js", "lib/add-queue.js",
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
// Slice 12's "delete everything": `deleting` while it deletes the database, `wiped` from
// then until an extension page asks for something again. Meanwhile nothing may recreate the
// store or write a storage area.
let deleting = false;
let wiped = false;
let wipedAt = 0;
function getStore() {
  if (deleting || wiped) return Promise.reject(codedError("storage_full", "Everything Kotiko kept was deleted.", { reason: deleting ? "deleting" : "deleted" }));
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

// Sites left alone by default (slice 16 §4), shipped with the extension.
let sensitiveP = null;
function sensitiveSites() {
  sensitiveP ??= fetch(ext.runtime.getURL("data/sensitive-sites.json"))
    .then((r) => r.json())
    .then((d) => (Array.isArray(d?.sites) ? d.sites : []))
    .catch(() => {
      sensitiveP = null;
      return null;
    });
  return sensitiveP;
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
  // Content scripts read the sensitive-sites list here too; it changes only with a release.
  const sites = await sensitiveSites();
  await ext.storage.local.set({ baseRules: out, baseRulesFor: sites ? stamp : null, ...(sites ? { sensitiveSites: sites } : {}) });
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
  enabled: async () => !wiped && (await home()) === "local",
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
  // The manual form (24 §7): the words were checked when the job was made; no model.
  if (Array.isArray(job.manual?.words) && job.manual.words.length) return { ok: true, result: { words: await pronounceWords(job.manual.words), rejected: [], missing_bases: [] } };
  const s = await settings();
  const store = await getStore();
  const parsed = Local.parseManual(job.text);
  const base = job.baseLangs[0] ?? (await currentBases())[0];
  if (parsed) {
    // The hint, else Focus on one language (18), else the recent languages (24 §7).
    const { mixing } = await ext.storage.local.get({ mixing: null });
    const focus = Array.isArray(mixing?.focus) && mixing.focus.length === 1 ? mixing.focus[0] : null;
    const lang = Local.manualLang(parsed.native, { hintLang: job.hintLang ?? focus, recent: await store.recentLangs(5), base });
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
  const results = Array.isArray(res.results) ? res.results : [];
  // The saved words reach open pages at once (06 F10), checked like any server answer
  // (03 E2); the sync that follows is authoritative.
  const added = filterWords(results.map((r) => r?.word).filter(Boolean).map(cacheWord)).words;
  await sync.update(() => replaceCached(added, added), { reason: "add" });
  return results;
}

// A function word of the word's own language ("en", "mi" for Spanish), from the shared
// common-words lists: such candidates start unticked when an add asks first (24 §2).
let importedStop = null;
function isFunctionWord(w) {
  const Text = globalThis.KotikoText;
  const lang = Text.primary(w?.lang ?? "");
  const own = globalThis.KOTIKO_SPEC?.lang?.[w?.lang]?.stopwords ?? globalThis.KOTIKO_SPEC?.lang?.[lang]?.stopwords;
  const list = own?.length ? own : importedStop?.[w?.lang] ?? importedStop?.[lang] ?? [];
  return list.includes(String(w?.native ?? "").toLocaleLowerCase(lang || undefined));
}
importedStopwords().then((s) => (importedStop = s)).catch(() => {});

// With the browser offline, a failed lookup or save waits for the network (24 §2: the
// `online` event wakes it) instead of reading as a busy model or a server that's down.
const NETWORK = new Set(["server_unreachable", "model_unavailable", "lookup_timeout"]);
const offline = () => globalThis.navigator?.onLine === false;
async function lookupOrOffline(job, signal) {
  const res = await lookupJob(job, signal);
  if (!res?.ok && NETWORK.has(res?.error?.code) && offline()) return { ok: false, error: { code: "offline", details: {} } };
  return res;
}
async function saveOrOffline(job, words) {
  try {
    return await saveJob(job, words);
  } catch (e) {
    if (NETWORK.has(e?.code) && offline()) throw codedError("offline", "You're offline.", {});
    throw e;
  }
}

const queue = globalThis.KotikoAddQueue.createAddQueue({
  storage: ext.storage.local,
  lookup: lookupOrOffline,
  save: saveOrOffline,
  isFunctionWord,
  now,
  onSettled: (job) => {
    lookupStatus().catch(() => {});
    refresh.tick().catch(() => {});
    if (job?.replaces && job.state === "done") retireReplaced(job).catch((e) => console.warn("Kotiko re-add:", e?.message ?? e));
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

// ── backups and "delete everything" (slice 12) ─────────────────────────────

const Backup = globalThis.KotikoBackup;
const RESTORE_OPS = 1000; // words.write's limit per call
// What the dashboard may change on a word when a backup or an undo patches it on a server.
const PATCHABLE = Backup.CONTENT.filter((f) => f !== "base_lang");

// What pages ask for on their own, to show something. Pages left open react to the cleared
// storage at once; for a moment after the delete those requests fail rather than set
// Kotiko up again. After that, or for anything a person asked for, Kotiko starts afresh.
const PASSIVE = new Set(["sync", "sensitiveSites", "llmStatus", "backend.get", "secrets.describe", "words.list", "words.deleted", "jobs.seen", "backup.status", "data.describe", "job.refresh", "celebrations.claim", "data.deleteAll"]);
const SETTLE_MS = 2000;

function checkBackupWords(m) {
  if (!Array.isArray(m.words) || m.words.length > Backup.MAX_WORDS || m.words.some((w) => !w || typeof w !== "object" || Array.isArray(w))) return `words must list up to ${Backup.MAX_WORDS} words`;
  if (m.restoreDeleted !== undefined && m.restoreDeleted !== null && typeof m.restoreDeleted !== "boolean") return "restoreDeleted must be true, false or null";
  return null;
}

// The page checked the file (lib/backup.js); the words are checked again here, so nothing
// a page sends can put a malformed record in the store.
function recheck(words) {
  const out = [];
  for (const w of words) {
    const r = Backup.checkWord(w, { version: Backup.SCHEMA_VERSION });
    if (r.word) out.push({ ...r.word, created_at: r.word.created_at ?? new Date(now()).toISOString(), updated_at: r.word.updated_at ?? r.word.created_at ?? new Date(now()).toISOString() });
  }
  return out;
}

// Every record the restore compares against: the store's, tombstones too; on a server, its
// live words and the deletes this browser remembers (the server lists no tombstones).
async function existingRecords() {
  if ((await home()) === "local") return (await getStore()).all();
  const live = await serverWords();
  const ids = new Set(live.map((w) => w.id));
  const { recentlyDeleted = [] } = await ext.storage.local.get({ recentlyDeleted: [] });
  const gone = (Array.isArray(recentlyDeleted) ? recentlyDeleted : [])
    .filter((e) => e?.word?.id && !ids.has(e.word.id))
    .map((e) => ({ ...e.word, deleted_at: e.word.deleted_at ?? new Date(e.at ?? now()).toISOString() }));
  return [...live, ...gone];
}

async function backupPreview(m) {
  const words = recheck(m.words);
  const p = Backup.plan(words, await existingRecords(), { restoreDeleted: m.restoreDeleted ?? null, now: now() });
  return { ok: true, home: await home(), counts: p.counts, restoreDeleted: p.restoreDeleted, total: words.length };
}

const patchOf = (record, from) => Object.fromEntries(PATCHABLE.filter((f) => JSON.stringify(record[f] ?? null) !== JSON.stringify(from?.[f] ?? null)).map((f) => [f, record[f] ?? null]));

async function serverWriteOps(ops) {
  const results = [];
  for (let i = 0; i < ops.length; i += RESTORE_OPS) results.push(...(await serverHandlers["words.write"].run({ ops: ops.slice(i, i + RESTORE_OPS) })).results);
  return results;
}

// Server mode (section 5 step 3, section 7): new words through slice 07's batch route, 500
// at a time with their ids; restored deletes and merges as edits, each checked against the
// version the plan read. Counts are combined; what changed is kept for Undo.
async function restoreToServer(words, restoreDeleted) {
  const p = Backup.plan(words, await existingRecords(), { restoreDeleted, now: now() });
  const counts = { ...p.counts, created: 0, updated: 0, unchanged: 0, failed: 0 };
  const writes = [];
  const creates = p.writes.filter((x) => !x.previous);
  // A delete this browser remembers: restore it on the server, or, when the server no
  // longer has it, send the word as new.
  const revive = p.writes.filter((x) => x.previous?.deleted_at);
  const revived = [];
  (await serverWriteOps(revive.map((x) => ({ op: "restore", id: x.record.id })))).forEach((r, i) => {
    if (r.ok) revived.push(revive[i]);
    else if (r.code === "word_gone") creates.push(revive[i]);
    else counts.failed++;
  });
  for (let i = 0; i < creates.length; i += BATCH) {
    const chunk = creates.slice(i, i + BATCH).map((x) => forServer(x.record));
    const res = await apiV1("/api/v1/words/batch", { method: "POST", body: { words: chunk, client_request_id: globalThis.KotikoStore.uuid7(now()) }, timeoutMs: 60_000 });
    for (const r of res.results ?? []) {
      if (counts[r.result] !== undefined) counts[r.result]++;
      if (r.result === "created" && r.word?.id) writes.push({ id: r.word.id, updated_at: r.word.updated_at, previous: null });
      if (r.result === "updated" && r.word?.id) writes.push({ id: r.word.id, updated_at: r.word.updated_at, previous: r.previous ?? null });
    }
    counts.failed += Array.isArray(res.rejected) ? res.rejected.length : 0;
  }
  const edits = [...revived, ...p.writes.filter((x) => x.previous && !x.previous.deleted_at)];
  const patches = edits.map((x) => ({ x, op: { op: "patch", id: x.record.id, patch: patchOf(x.record, x.previous), ...(x.previous.deleted_at ? {} : { if_updated_at: x.previous.updated_at }) } }));
  const results = await serverWriteOps(patches.filter((e) => Object.keys(e.op.patch).length).map((e) => e.op));
  let k = 0;
  for (const { x, op } of patches) {
    const r = Object.keys(op.patch).length ? results[k++] : { ok: true, word: null };
    if (r.ok) {
      counts.updated++;
      writes.push({ id: x.record.id, updated_at: r.word?.updated_at ?? null, previous: x.previous });
    } else counts.failed++;
  }
  return { counts, writes, restoreDeleted: p.restoreDeleted };
}

async function backupRestore(m) {
  const words = recheck(m.words);
  const store = await getStore();
  let out;
  if ((await home()) === "local") {
    const r = await store.importWords(words, { restoreDeleted: m.restoreDeleted ?? null, label: typeof m.label === "string" ? m.label.slice(0, 200) : null });
    out = { ok: true, home: "local", counts: r.counts, restoreDeleted: r.restoreDeleted };
    if (m.pronunciations !== false && words.some((w) => !w.pronunciation)) refresh.nudge().catch(() => {});
  } else {
    const r = await restoreToServer(words, m.restoreDeleted ?? null);
    if (r.writes.length) await store.meta.set("lastImport", { at: now(), home: "server", label: typeof m.label === "string" ? m.label.slice(0, 200) : null, counts: r.counts, writes: r.writes });
    sync.request({ reason: "edit", force: true }).catch?.(() => {});
    out = { ok: true, home: "server", counts: r.counts, restoreDeleted: r.restoreDeleted };
  }
  await ext.storage.local.set({ lastBackupAt: now() });
  return out;
}

async function backupUndo() {
  const store = await getStore();
  const last = await store.meta.get("lastImport");
  if (!last || now() - last.at > 86_400_000) return { ok: false, code: "nothing_to_undo", undone: 0, changed: 0 };
  if (last.home !== "server") {
    if ((await home()) !== "local") return { ok: false, code: "nothing_to_undo", undone: 0, changed: 0 };
    return store.undoImport();
  }
  const ops = last.writes.map((w) =>
    !w.previous || w.previous.deleted_at
      ? { op: "delete", id: w.id }
      : { op: "patch", id: w.id, patch: Object.fromEntries(PATCHABLE.map((f) => [f, w.previous[f] ?? null])), ...(w.updated_at ? { if_updated_at: w.updated_at } : {}) },
  );
  const results = await serverWriteOps(ops);
  await store.meta.remove("lastImport");
  const undone = results.filter((r) => r.ok).length;
  return { ok: true, undone, changed: results.length - undone };
}

async function backupStatus() {
  const { lastBackupAt = null } = await ext.storage.local.get({ lastBackupAt: null });
  const last = await (await getStore()).meta.get("lastImport").catch(() => null);
  const fresh = last && now() - last.at <= 86_400_000;
  return { lastBackupAt, lastImport: fresh ? { at: last.at, label: last.label ?? null, counts: last.counts ?? null, home: last.home ?? "local" } : null };
}

// Whether storage.sync really syncs here (not Firefox for Android or Safari, per MDN's
// browser-compat-data), for "Also clear settings synced to your other browsers".
async function syncReal() {
  try {
    if ((await ext.runtime.getPlatformInfo?.())?.os === "android") return false;
  } catch {
    // no platform info: assume a desktop browser
  }
  const ua = String(globalThis.navigator?.userAgent ?? "");
  return !(/Safari\//.test(ua) && !/Chrom(e|ium)\/|Firefox\//.test(ua));
}

// What the "Delete everything" dialog names (section 6).
async function dataDescribe() {
  await ready().catch(() => {});
  const s = await settings();
  const store = await getStore();
  const ids = await store.secrets.ids().catch(() => []);
  const words = s.wordsHome === "local" ? await store.count() : ((await ext.storage.local.get({ words: [] })).words ?? []).length;
  let serverCount = null;
  if (s.keys.server) {
    try {
      serverCount = (await serverWords()).length;
    } catch {
      serverCount = null;
    }
  }
  return {
    wordsHome: s.wordsHome ?? "local",
    words,
    providerKey: ids.some((id) => String(id).startsWith("provider:")),
    server: s.keys.server ? { url: s.server.url, words: serverCount } : null,
    syncReal: await syncReal(),
  };
}

// "Delete everything" (section 6), in the spec's order after the page downloaded the
// backup: the server's words when asked (stop if that fails), every job and alarm, the
// whole database, every storage area this browser holds (storage.sync only when asked), and
// the pages' words, so open tabs put the original text back.
async function deleteEverything(m) {
  let server = null;
  if (m.server === true) {
    server = await apiV1("/api/v1/words", { method: "DELETE", body: { confirm: "delete-all-words" }, timeoutMs: 60_000 });
  }
  wiped = true;
  wipedAt = now();
  deleting = true;
  try {
    await wipeEverything(m);
  } finally {
    deleting = false;
  }
  updateAllBadges();
  return { ok: true, server: server ? { deleted: server.deleted ?? null, reset_epoch: server.reset_epoch ?? null } : null };
}

async function wipeEverything(m) {
  queue.abortRunning();
  for (let i = 0; i < 50 && queue.running(); i++) await new Promise((r) => setTimeout(r, 20));
  await Promise.resolve(ext.alarms.clearAll?.()).catch(() => {});
  await Promise.resolve(ext.contextMenus?.removeAll?.()).catch(() => {});
  const store = await storeP?.catch(() => null);
  store?.close();
  storeP = null;
  readyP = null;
  secretCache.clear();
  client.reset();
  await globalThis.KotikoStore.wipe({ indexedDB: globalThis.indexedDB });
  await ext.storage.local.set({ words: [] });
  await ext.storage.local.clear();
  await Promise.resolve(ext.storage.session?.clear?.()).catch(() => {});
  if (m.sync === true) await Promise.resolve(ext.storage.sync.clear()).catch(() => {});
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

// Slice 18's seed salt: 32 random hex characters, made once and synced, so a page shows the
// same languages on every device; content scripts read the copy in storage.local.
async function ensureSeedSalt() {
  const valid = (s) => typeof s === "string" && /^[0-9a-f]{32}$/.test(s);
  let synced = null;
  try {
    ({ seedSalt: synced } = await ext.storage.sync.get({ seedSalt: null }));
  } catch {
    // no storage.sync here
  }
  const { seedSalt: local } = await ext.storage.local.get({ seedSalt: null });
  const salt = valid(synced) ? synced : valid(local) ? local : [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (salt !== synced) await ext.storage.sync.set({ seedSalt: salt }).catch(() => {});
  if (salt !== local) await ext.storage.local.set({ seedSalt: salt });
}
ensureSeedSalt().catch(() => {});

// Slice 12 §8: the backup reminder counts from the first start of a version that has it,
// so nobody is reminded on day one.
async function ensureBackupClock() {
  if (wiped) return;
  const { backupSince } = await ext.storage.local.get({ backupSince: null });
  if (typeof backupSince !== "number") await ext.storage.local.set({ backupSince: now() });
}
ensureBackupClock().catch(() => {});

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
  if (a.name !== ALARM || wiped) return;
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

// After "delete everything", a request from an extension page (the welcome tab's "Start
// again", say) lets the background work again; content scripts' requests don't.
function wakeAfterWipe(router) {
  const onMessage = (msg, sender, sendResponse) => {
    if (wiped && globalThis.MessageRouter.senderKinds(sender, ext.runtime).has("page") && (!PASSIVE.has(msg?.type) || now() - wipedAt > SETTLE_MS)) wiped = false;
    return router(msg, sender, sendResponse);
  };
  // The router's list of routes, for audits that read it from the listener.
  if (router.routes) onMessage.routes = router.routes;
  return onMessage;
}

// Content scripts ask for a sync on every page load; the popup asks with force. Adds go
// to the add queue (or, with a server that looks words up and keeps them, straight to
// it as before). Only extension pages may add, delete, read secrets' descriptions or
// change settings (research 03 E3, slice 26); content scripts may only sync, and the docs
// site's callback page may send `oauth.code`.
ext.runtime.onMessage.addListener(
  wakeAfterWipe(createMessageRouter({
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
      // A page that opened before the list was copied to storage asks for it (slice 16 §4).
      sensitiveSites: {
        from: ["content"],
        run: async () => ({ sites: (await sensitiveSites()) ?? [] }),
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
          // A v1 record (an add job's result) by its id; a word from the 0.2 list by its number.
          if (isUuid(String(msg.id))) {
            const [r] = (await serverHandlers["words.write"].run({ ops: [{ op: "delete", id: String(msg.id) }] })).results;
            if (!r.ok && r.code !== "word_gone") throw codedError(r.code, r.message, r.details);
          } else {
            await api(`/api/words/${encodeURIComponent(msg.id)}`, { method: "DELETE" });
          }
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
      // The learner's pick when an add found four or more words (24 §2).
      "jobs.choose": {
        from: ["page"],
        check: (m) => (!isUuid(m.id) ? "id must be a job id" : !Array.isArray(m.keys) || m.keys.length > 10 || m.keys.some((k) => typeof k !== "string" || k.length > 200) ? "keys must list up to 10 words" : null),
        run: (m) => queue.choose(m.id, m.keys).then(() => ({ ok: true })),
      },
      // The same text again in another language (24 §6), and the manual form (24 §7).
      "jobs.relang": { from: ["page"], check: (m) => checkJobWord(m) ?? (typeof m.lang === "string" && globalThis.KotikoLang.canonical(m.lang).ok ? null : "lang must be a language tag"), run: relang },
      "jobs.addManual": { from: ["page"], check: checkManual, run: addManual },
      // Undo one word of an add, and "Add it back" (24 §5).
      "jobs.undo": { from: ["page"], check: checkJobWord, run: (m) => undoWord(m.id, m.key) },
      "jobs.redo": { from: ["page"], check: checkJobWord, run: (m) => redoWord(m.id, m.key) },
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

      // Backups, restores and delete everything (slice 12).
      "backup.status": { from: ["page"], run: () => backupStatus() },
      "backup.preview": { from: ["page"], check: checkBackupWords, run: backupPreview },
      "backup.restore": { from: ["page"], check: checkBackupWords, run: backupRestore },
      "backup.undo": { from: ["page"], run: () => backupUndo() },
      // The page saved a backup file (the reminder counts from it, section 8).
      "backup.saved": {
        from: ["page"],
        async run() {
          await ext.storage.local.set({ lastBackupAt: now() });
          return { ok: true };
        },
      },
      "data.describe": { from: ["page"], run: () => dataDescribe() },
      "data.deleteAll": {
        from: ["page"],
        check: (m) => (m.confirm !== "delete-everything" ? "confirm must be delete-everything" : [m.server, m.sync].some((v) => v !== undefined && typeof v !== "boolean") ? "server and sync must be true or false" : null),
        run: deleteEverything,
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
  })),
);

// "Wrong language" (24 §6): the same text as a new job with that language as its hint.
// When it succeeds, the old job's word is removed (retireReplaced); undoing the new one
// brings the old one back.
async function relang(m) {
  const { addJobs = [] } = await ext.storage.local.get({ addJobs: [] });
  const old = addJobs.find((j) => j.id === m.id);
  if (!old) return { error: "That add is gone.", code: "job_gone" };
  const id = globalThis.KotikoStore.uuid7(now());
  await queue.add({ id, text: old.text, hintLang: globalThis.KotikoLang.canonical(m.lang).tag, baseLangs: old.baseLangs, surface: old.surface, replaces: { id: old.id, key: m.key } });
  return { ok: true, newId: id };
}

async function retireReplaced(job) {
  const { id, key } = job.replaces;
  const res = await undoWord(id, key);
  if (res.ok) await queue.patch(id, { replacedBy: job.id });
}

// The manual form (24 §7): one record per filled meaning, checked here as on the page,
// saved as a job that never asks a model. The typed pronunciation goes on the primary
// base's record.
function checkManual(m) {
  const Lang = globalThis.KotikoLang;
  if (!isUuid(m.id)) return "id must be a job id";
  if (typeof m.native !== "string" || !m.native.trim() || [...m.native.trim()].length > 64 || /[\r\n]/.test(m.native)) return "native must be 1 to 64 characters on one line";
  if (typeof m.lang !== "string" || !Lang.canonical(m.lang).ok) return "lang must be a language tag";
  if (!Array.isArray(m.meanings) || !m.meanings.length || m.meanings.length > 4) return "meanings must list 1 to 4 bases";
  for (const x of m.meanings) {
    if (!x || typeof x.base_lang !== "string" || !Lang.canonical(x.base_lang).ok) return "each meaning needs its base";
    if (Lang.sameBase(m.lang, x.base_lang)) return "a word can't be in its meaning's own language";
    if (typeof x.gloss !== "string" || !x.gloss.trim() || [...x.gloss].length > 64) return "each meaning must be 1 to 64 characters";
  }
  for (const k of ["romanization", "pronunciation", "note"]) if (m[k] != null && (typeof m[k] !== "string" || [...m[k]].length > 200)) return `${k} must be text`;
  return null;
}

async function addManual(m) {
  const lang = globalThis.KotikoLang.canonical(m.lang).tag;
  const words = [];
  m.meanings.forEach((x, i) => {
    // "dog, hound" (or 、，for Japanese and Chinese bases): the first is the meaning.
    const forms = x.gloss.split(/\s*[,、，]\s*/u).filter(Boolean);
    const w = Local.manualWord({ native: m.native.trim(), gloss: forms[0], romanization: m.romanization?.trim() || null, pronunciation: i === 0 ? m.pronunciation?.trim() || null : null }, { lang, base: x.base_lang, text: m.native.trim() });
    if (!w) return;
    w.forms = forms.map((text) => ({ text, enabled: true, case: "any", ambiguous: false }));
    if (m.note?.trim()) w.note = m.note.trim();
    words.push(w);
  });
  if (!words.length) return { error: "Nothing to save.", code: "invalid_message", details: {} };
  await queue.add({ id: m.id, text: m.native.trim(), hintLang: lang, baseLangs: m.meanings.map((x) => x.base_lang), surface: typeof m.surface === "string" ? m.surface : "popup", manual: { words } });
  return { ok: true };
}

// A v1 record in the shape the server mode's cache holds (the 0.2 list's), and a change
// to that cache keyed by word (a v1 id and a 0.2 number name the same word).
const sameWord = (a, b) => a.lang === b.lang && a.native === b.native && (a.base_lang ?? "en") === (b.base_lang ?? "en");
function cacheWord(w) {
  const forms = (w.forms ?? []).filter((f) => typeof f === "string" || f?.enabled !== false).map((f) => (typeof f === "string" ? f : f.text));
  // base-neutral-ok: the 0.2 list's field for the gloss, which the server mode's cache keeps
  const out = { id: w.id, lang: w.lang, native: w.native, romanization: w.romanization ?? null, english: w.gloss ?? null, forms, note: w.note ?? null, base_lang: w.base_lang };
  for (const k of ["native_vocalized", "pronunciation", "pronunciation_careful", "pronunciation_source"]) if (w[k]) out[k] = w[k];
  return out;
}
async function replaceCached(gone, added = []) {
  const { words = [] } = await ext.storage.local.get("words");
  const rest = words.filter((w) => !gone.some((g) => sameWord(g, w)));
  if (rest.length !== words.length || added.length) await ext.storage.local.set({ words: [...added, ...rest] });
}

// Undo for one word of a finished add job (slice 24 §5), on every record the job saved
// for it: a created record is removed, an updated one goes back to its previous version
// (refused when it changed since, from another device or the dashboard), an unchanged one
// is left. The outcome is written on the job, so it survives the popup closing.
function checkJobWord(m) {
  return !isUuid(m.id) ? "id must be a job id" : typeof m.key !== "string" || !m.key || m.key.length > 200 ? "key must name a word" : null;
}
const RESTORABLE = ["gloss", "forms", "romanization", "native_vocalized", "pronunciation", "pronunciation_careful", "pronunciation_source", "note", "status", "sense"];
const jobWords = async (id, key) => {
  const { addJobs = [] } = await ext.storage.local.get({ addJobs: [] });
  const job = addJobs.find((j) => j.id === id);
  return (job?.results ?? []).filter((r) => r.word && globalThis.KotikoAddQueue.keyOf(r.word) === key);
};
const writeOps = async (ops) => (await wordRoutes["words.write"].run({ ops })).results;

async function undoWord(id, key) {
  const records = (await jobWords(id, key)).filter((r) => r.result !== "unchanged" && r.undo !== "done");
  if (!records.length) return { ok: true };
  await queue.setUndo(id, key, { undo: "pending", undoError: null });
  const ops = records.map((r) =>
    r.result === "created"
      ? { op: "delete", id: r.wordId }
      : { op: "patch", id: r.wordId, patch: Object.fromEntries(RESTORABLE.filter((k) => r.previous && k in r.previous).map((k) => [k, r.previous[k]])), if_updated_at: r.word.updated_at },
  );
  let results;
  try {
    results = await writeOps(ops);
  } catch (e) {
    results = ops.map(() => ({ ok: false, code: e?.code ?? "internal", details: e?.details ?? {} }));
  }
  // A record already gone counts as undone; the first other failure is the line's.
  const bad = results.find((r) => !r.ok && r.code !== "word_gone");
  // With a server, pages stop showing a removed word at once, as after an add.
  const removed = records.filter((r, i) => r.result === "created" && (results[i].ok || results[i].code === "word_gone")).map((r) => r.word);
  if (removed.length && (await home()) === "server") await sync.update(() => replaceCached(removed), { reason: "remove" });
  await queue.setUndo(id, key, bad ? { undo: "failed", undoError: { code: bad.code, details: bad.details ?? {} } } : { undo: "done", undoError: null });
  // Undoing a re-add in another language brings back the word it replaced (24 §6).
  const { addJobs = [] } = await ext.storage.local.get({ addJobs: [] });
  const job = addJobs.find((j) => j.id === id);
  if (!bad && job?.replaces) {
    await redoWord(job.replaces.id, job.replaces.key);
    await queue.patch(job.replaces.id, { replacedBy: null });
  }
  return bad ? { error: bad.message ?? bad.code, code: bad.code, details: bad.details ?? {} } : { ok: true };
}

// "Add it back" after undoing a created word: restore the tombstone, or, when that word is
// gone for good or its place was taken, save it again without the model.
async function redoWord(id, key) {
  const records = (await jobWords(id, key)).filter((r) => r.result === "created" && r.undo === "done");
  if (!records.length) return { ok: true };
  const results = await writeOps(records.map((r) => ({ op: "restore", id: r.wordId })));
  const again = records.filter((r, i) => !results[i].ok && (results[i].code === "word_gone" || results[i].code === "word_conflict"));
  const failed = results.find((r) => !r.ok && r.code !== "word_gone" && r.code !== "word_conflict");
  if (failed) return { error: failed.message ?? failed.code, code: failed.code, details: failed.details ?? {} };
  if (again.length) {
    const fields = ["lang", "native", "base_lang", "sense", "gloss", "forms", "romanization", "native_vocalized", "pronunciation", "pronunciation_careful", "pronunciation_source", "note"];
    const words = again.map((r) => Object.fromEntries(fields.filter((k) => r.word[k] !== undefined).map((k) => [k, r.word[k]])));
    const res = await wordRoutes["words.save"].run({ words, client_request_id: globalThis.KotikoStore.uuid7(now()) });
    if (res?.error) return res;
  }
  await queue.setUndo(id, key, { undo: null, undoError: null });
  return { ok: true };
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
  if (wiped) return;
  if (area === "sync" && changes.ui) {
    projector.schedule();
    mirrorBaseRules().catch(() => {});
  }
  if (area === "sync" && changes.seedSalt) ensureSeedSalt().catch(() => {});
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
globalThis.__kotiko = { ensureSeedSalt, ready, getStore, queue, refresh, projector, client, settings, currentBases, mirrorBaseRules, injectOpenTabs, toServer, toLocal, openWelcome, claimMilestone, onInstalled };
