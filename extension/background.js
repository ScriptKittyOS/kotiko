// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Kotiko's background. Words live in this browser (slice 11's IndexedDB store, projected
// into storage.local for content scripts) or on a Kotiko server (pulled every minute into
// storage.local, as before). New words are looked up by the learner's own provider, by
// the server, or typed with their meaning, through add jobs that never block a page.
// Secrets (the lookup key, the server token) live only in the store, which content
// scripts can't reach, and only this file reads them. So do the real copies of every
// setting and of the add queue (lib/settings.js): storage.local, which content scripts can
// write, is only a mirror of them, and a change made there by anything but this file is
// put back.
//
// The libraries load through importScripts in Chrome's service worker, and through the
// manifest's background.scripts list (before this file) in Firefox's event page.
if (!globalThis.SyncController && typeof importScripts === "function") {
  importScripts(
    "lib/url.js", "lib/server-auth.js", "lib/errors.js", "lib/validate-words.js", "lib/sync-controller.js", "lib/messages.js", "lib/i18n.js", "lib/badge.js",
    "spec/spec.js", "lib/text.js", "lib/lang.js", "lib/words-v1.js", "lib/wordspec.js", "lib/word-merge.js", "lib/store.js",
    "lib/settings.js", "lib/backup.js", "lib/projection.js", "lib/llm/policy.js", "lib/llm/catalog.js", "lib/llm/client.js", "lib/add-queue.js",
    "lib/refresh-job.js", "lib/local-mode.js", "lib/pkce.js", "lib/celebrations.js", "lib/welcome-model.js",
    "lib/pronounce.js", "lib/wiktionary-pass.js",
  );
}

const ext = globalThis.browser ?? globalThis.chrome;
const { normalizeServerUrl } = globalThis.ServerUrl;
const ServerAuth = globalThis.KotikoServerAuth;
const { fromStatus } = globalThis.KotikoErrors;
const { validateWordsResponse, filterWords } = globalThis.WordValidator;
const { createSyncController } = globalThis.SyncController;
const { createMessageRouter, checks } = globalThis.MessageRouter;
const { badgeFor, OFF_COLOR } = globalThis.KotikoBadge;
const { t } = globalThis.KotikoI18n;
const { createWordHandlers } = globalThis.KotikoWordsV1;
const Local = globalThis.KotikoLocal;
const Settings = globalThis.KotikoSettings;

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

// "Delete everything" leaves a new database holding only this mark (slice 54, A-06): the
// store set up in it later, by this worker or by one started after this one stopped, takes
// nothing from storage.local, which content scripts can write while Kotiko is wiped. Without
// it, a 0.2-style `token` and `serverUrl` planted there were adopted as the trusted server.
const BORN_FROM_WIPE = "bornFromWipe";
const NO_LEGACY = { get: async (defaults) => ({ ...defaults }), remove: async () => {} };
// Whether this worker's start set the store up from what storage.local held (an update from
// 0.2, or a database lost some other way); `onInstalled` keeps it only for the former.
let adoptedLegacy = false;

// Everything that reads settings or secrets waits for the upgrade (slice 11 section 8),
// which runs at every worker start until it has finished once.
let readyP = null;
function ready() {
  readyP ??= (async () => {
    const store = await getStore();
    // A brand-new store (an install, or after "delete everything") takes nothing from
    // storage.local: it is marked before the upgrade counts as done.
    const r = await Local.migrate({
      store,
      storage: trustedCopy,
      legacy: (await store.meta.get(BORN_FROM_WIPE)) ? NO_LEGACY : ext.storage.local,
      uiLanguage: uiLanguage(),
      beforeDone: async (from) => from === "new" && (await store.meta.get(TRUSTED)) !== true && store.meta.set(TRUSTED, "fresh"),
    });
    if (r.migrated && (await store.meta.get("migratedFrom")) !== "new") adoptedLegacy = true;
    await adoptOnce(store);
    if (r.migrated && r.home === "local" && r.seeded) projector.schedule();
    if (r.migrated) refresh.nudge().catch(() => {});
    await bindRoutesOnce(store, { fresh: r.migrated && (await store.meta.get("migratedFrom")) === "new" });
    // Whatever was written to storage.local while no worker was listening.
    trustedCopy.heal().catch(() => {});
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
  if (id === "server") forgetProof();
  const s = await Local.readSettings(area);
  const keys = { server: s.keys.server, providers: { ...s.keys.providers } };
  if (id === "server") keys.server = !!value;
  else keys.providers[id.slice("provider:".length)] = !!value;
  await area.set({ keys });
}

// ── settings only Kotiko may change (SCR-448) ────────────────────────────────────

// The trusted copy of everything Kotiko keeps in storage.local, in the store's `meta`,
// mirrored to storage.local for content scripts and pages to read. Every read below is from
// here, never from storage.local, which content scripts can write.
const trustedCopy = Settings.createArea({
  meta: {
    entries: async (prefix) => (await getStore()).meta.entries(prefix),
    write: async (puts, deletes) => (await getStore()).meta.write(puts, deletes),
  },
  mirror: ext.storage.local,
  onChange: (keys) => settingsChanged(keys),
});
// Everything outside the upgrade itself waits for it, so an install from before this
// version never reads its settings before they were taken over (`adoptOnce`).
const area = Object.fromEntries(["get", "set", "update", "remove", "heal", "has"].map((op) => [op, async (...a) => (await ready().catch(() => {}), trustedCopy[op](...a))]));
area.reset = () => trustedCopy.reset();

// What Kotiko keeps in storage.local; an install from before the trusted copy has these to
// take once (`adoptOnce`). The 0.2 `token` and `serverUrl` are the storage upgrade's.
const ADOPT = new Set([
  "words", "wordsVersion", "baseLangs", "baseRules", "baseRulesFor", "sensitiveSites", "enabled", "pausedHosts", "hiddenLangs", "mixing", "prefs", "speech",
  "onboarding", "celebrations", "backupSnooze", "backupSince", "lastBackupAt", "lookupStatus", "syncError", "lastSync", "syncWarnings", "keys", "wordsHome",
  "lookup", "server", "addJobs", "recentlyDeleted", "seedSalt",
]);
const TRUSTED = "settingsTrusted";
const isTag = (tag) => globalThis.KotikoLang.canonical(tag).ok;
const validSalt = (s) => typeof s === "string" && /^[0-9a-f]{32}$/.test(s);
// A value of a key Kotiko's pages may change, if it has the shape they write.
const pageValue = (key, value) => Settings.edit({}, { set: { [key]: value } }, { isTag }).patch?.[key];

// Once per store. An install from before this version kept everything in storage.local,
// where its pages and its background wrote, and where a content script could have too; the
// two can't be told apart, so what is there now is taken as it is (the keys Kotiko writes),
// the same moment slice 28 takes the addresses. A new store takes nothing from
// storage.local, only the languages synced from the learner's other browsers (slice 50),
// as the first run always has.
const UI_FIELDS = ["uiLang", "baseLangs", "baseLangsDetected", "baseLangsConfirmed"];
async function adoptOnce(store) {
  const mark = await store.meta.get(TRUSTED);
  if (mark === true) return;
  const patch = {};
  if (mark !== "fresh") {
    const raw = await ext.storage.local.get(null);
    for (const [k, v] of Object.entries(raw)) if (ADOPT.has(k) && !(await trustedCopy.has(k))) patch[k] = v;
  }
  try {
    const synced = await ext.storage.sync.get({ ui: null, seedSalt: null });
    const ui = synced.ui && typeof synced.ui === "object" && !Array.isArray(synced.ui) ? Object.fromEntries(UI_FIELDS.filter((f) => synced.ui[f] !== undefined).map((f) => [f, synced.ui[f]])) : null;
    if (ui && !(await trustedCopy.has("ui"))) patch.ui = ui;
    if (validSalt(synced.seedSalt) && !(await trustedCopy.has("seedSalt"))) patch.seedSalt = synced.seedSalt;
  } catch {
    // no storage.sync here
  }
  await trustedCopy.set(patch);
  await store.meta.set(TRUSTED, true);
}

// Chrome 140 and later can keep content scripts out of storage.sync (`setAccessLevel`;
// before 140, and in Firefox, they can write it). Then a change there was made by Kotiko,
// here or in the learner's other browsers, and is taken; otherwise it is left alone, and
// this browser keeps its own copy. The level is kept by the browser, so asking again at
// each start is harmless.
const syncLocked = (async () => {
  if (typeof ext.storage.sync?.setAccessLevel !== "function") return false;
  try {
    await ext.storage.sync.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    return true;
  } catch {
    return false;
  }
})();

async function adoptSync(changes) {
  if (!(await syncLocked)) return;
  await ready();
  const patch = {};
  const current = await area.get({ ui: null, seedSalt: null });
  const incoming = changes.ui ? pageValue("ui", changes.ui.newValue) : undefined;
  // The languages detected here stay this browser's own, whatever another one synced.
  const ui = incoming && { ...incoming, ...(current.ui?.baseLangsDetected ? { baseLangsDetected: current.ui.baseLangsDetected } : {}) };
  if (ui && !Settings.same(ui, current.ui)) {
    patch.ui = ui;
    if (ui.baseLangs) patch.baseLangs = ui.baseLangs;
  }
  const salt = changes.seedSalt?.newValue;
  if (validSalt(salt) && salt !== current.seedSalt) patch.seedSalt = salt;
  await area.set(patch);
}

// storage.sync's `ui` (slice 50) follows the trusted copy, for the learner's other browsers,
// once the learner has confirmed their languages, and never with the ones read from this
// browser's settings (`baseLangsDetected`): those stay on the device (slice 54, C-07).
// `with` goes into the trusted copy in the same write (the pages' `baseLangs`), so nothing
// reads the bases half changed.
async function saveUi(ui, { with: also = {} } = {}) {
  await area.set({ ...also, ui });
  if (ui?.baseLangsConfirmed !== true) return;
  const synced = { ...ui };
  delete synced.baseLangsDetected;
  await Promise.resolve().then(() => ext.storage.sync.set({ ui: synced })).catch(() => {});
}

// Reactions to a change of the trusted copy, whoever in this file made it.
function settingsChanged(keys) {
  const k = new Set(keys);
  if (k.has("ui")) {
    projector.schedule();
    mirrorBaseRules().catch(() => {});
  }
  if (k.has("wordsHome")) home().then((h) => h === "local" && projector.schedule()).catch(() => {});
  if (k.has("enabled") || k.has("pausedHosts")) updateAllBadges();
  if (k.has("words")) area.get({ words: [] }).then(({ words }) => Array.isArray(words) && words.length && noteFirstWord()).catch(() => {});
}

// A page's change (`settings.set`), one at a time: checked against the allowlist and the
// shapes in lib/settings.js, applied to the trusted values, then mirrored. Bases changed
// in `ui` are copied to the pages' `baseLangs`, and go to storage.sync.
let settingsChain = Promise.resolve();
function saveSettings(m) {
  const run = settingsChain.then(async () => {
    await ready();
    const names = new Set([...Object.keys(m.set ?? {}), ...Object.keys(m.merge ?? {}), ...[...Object.keys(m.add ?? {}), ...Object.keys(m.remove ?? {})].map((p) => p.split(".")[0])]);
    const r = Settings.edit(await area.get([...names]), m, { isTag });
    if (r.error) throw codedError("invalid_message", r.error);
    const patch = r.patch;
    if (patch.ui?.baseLangs && !patch.baseLangs) patch.baseLangs = patch.ui.baseLangs;
    const { ui } = patch;
    delete patch.ui;
    if (ui) await saveUi(ui, { with: patch });
    else await area.set(patch);
    if (patch.baseLangs) {
      projector.schedule();
      mirrorBaseRules().catch(() => {});
    }
    return { ok: true };
  });
  settingsChain = run.catch(() => {});
  return run;
}

// Where requests may go (slice 28 §7). The settings that say where Kotiko sends words and
// keys lived in storage.local, which content scripts can write as well as read; they now
// live in the trusted copy above, and the routes stay as a second check. Each
// route's trusted address is kept in the store (`meta`, out of their reach): "server", and
// "lookup:<provider>" for each lookup service. Only Kotiko's own pages set it, by naming an
// address (`server.connect`, `backend.set`, the OpenRouter sign-in), plus once at the
// upgrade that introduced it. Every request checks the address it is about to use against
// its route and sends nothing when they differ ("address_changed"); until a page names an
// address, a route trusts the built-in one (a preset's own, the default server's).
// Keys and the token go only where their route's trusted address is.
const routeKey = (route) => `route:${route}`;
const providerOf = (id) => globalThis.KOTIKO_SPEC.providers.providers.find((p) => p.id === id) ?? null;

// The address a request on `route` would use, in the form routes are stored in: plain-http
// localhost as 127.0.0.1 (slice 54, B-01), like every request.
function routeUrl(route, url) {
  if (route === "server") {
    const n = normalizeServerUrl(url ?? "");
    return n.ok ? n.url : null;
  }
  return url ? globalThis.ServerUrl.pinLoopback(String(url).trim().replace(/\/+$/, "")) || null : null;
}

// Read from the store every time (one small read), so a wiped store (slice 12's "delete
// everything") is never outlived by a remembered address. One bound before addresses were
// pinned to 127.0.0.1 compares in today's form.
async function trustedUrl(route) {
  const bound = await (await getStore()).meta.get(routeKey(route));
  if (bound) return bound.startsWith(RAW) ? bound : routeUrl(route, bound) ?? bound;
  // Nothing named yet (a new install, or after "delete everything"): the built-in addresses.
  if (route.startsWith("lookup:")) return routeUrl(route, providerOf(route.slice("lookup:".length))?.baseUrl ?? null);
  return route === "server" ? routeUrl(route, Local.DEFAULT_SERVER) : null;
}

// Every change to where requests go (a route and the `server` or `lookup` settings that
// follow it) runs one at a time, so the repair below never writes back a stale copy over
// a page's change.
let routeChain = Promise.resolve();
function underRoutes(fn) {
  const run = routeChain.then(fn);
  routeChain = run.catch(() => {});
  return run;
}

// The lookup service the learner chose on a Kotiko page (the provider, not only its
// address): a page can't be made to send words to another service the learner has a key
// for. Until a page chooses, the default service.
const CHOSEN = "route:lookupProvider";
async function chosenProvider() {
  return (await (await getStore()).meta.get(CHOSEN)) ?? globalThis.KOTIKO_SPEC.providers.default;
}
async function chooseProvider(id) {
  await (await getStore()).meta.set(CHOSEN, id);
}
async function lookupAllowed(providerId, baseUrl) {
  if ((await chosenProvider()) !== providerId) {
    healRoutes().catch(() => {});
    return false;
  }
  return routeAllows(`lookup:${providerId}`, baseUrl);
}

// Called only for an address a Kotiko page named (or the one-time upgrade). An address
// that isn't one is kept as typed ("raw:…"), so the settings can show the learner's typo
// and its error; no request is ever made to it.
const RAW = "raw:";
async function bindRoute(route, url) {
  const value = routeUrl(route, url) ?? (url ? `${RAW}${String(url).trim()}` : null);
  if (route === "server") forgetProof();
  await (await getStore()).meta.set(routeKey(route), value);
}
const sameAddress = (route, url, trusted) => (routeUrl(route, url) ?? `${RAW}${String(url ?? "").trim()}`) === trusted;

async function routeAllows(route, url, { heal = true } = {}) {
  const want = routeUrl(route, url);
  const ok = !!want && want === (await trustedUrl(route));
  // A refusal also puts the trusted address back in the settings (in case the change
  // arrived while this worker wasn't listening), which wakes the waiting adds.
  if (!ok && heal) healRoutes().catch(() => {});
  return ok;
}

const addressChanged = (route) =>
  codedError("address_changed", "Where Kotiko sends words was changed outside its settings, so it sent nothing. Check the address in Settings and save it again.", { route });

// The secret for a request to `url`: only on its route's trusted address.
async function secretFor(id, url) {
  const route = id === "server" ? "server" : `lookup:${id.slice("provider:".length)}`;
  if (!(await routeAllows(route, url))) return null;
  return secret(id);
}

// The upgrade to routes, once, right after the storage upgrade. A fresh install trusts only
// the built-in addresses (the default server, each preset's own), never what storage.local
// says, since a content script may already have written there. An install from before
// this version trusts the addresses its settings hold at that moment, where its pages and
// content scripts could both write, except where no page could have: Kotiko's pages show
// an address field only for a service on the learner's computer and "custom", so an
// address saved for a hosted service (OpenRouter, OpenAI and the like) that isn't its own
// is dropped (SCR-448).
async function bindRoutesOnce(store, { fresh = false } = {}) {
  if ((await store.meta.get("routesBound")) === true) return;
  if (fresh) {
    await bindRoute("server", Local.DEFAULT_SERVER);
  } else {
    const s = await Local.readSettings(trustedCopy);
    await bindRoute("server", s.server.url);
    const ep = globalThis.KotikoLLMClient.endpoint(s.lookup);
    const typed = ep.preset.local || ep.preset.id === "custom";
    if (s.lookup.baseUrl && typed) await bindRoute(`lookup:${ep.preset.id}`, ep.baseUrl);
    else if (s.lookup.baseUrl) await trustedCopy.set({ lookup: { ...s.lookup, baseUrl: null } });
    await chooseProvider(ep.preset.id);
  }
  await store.meta.set("routesBound", true);
}

// "sk-or-…a1b2": the first six and last four characters, never the whole key.
function mask(v) {
  if (typeof v !== "string" || !v) return null;
  return v.length > 14 ? `${v.slice(0, 6)}…${v.slice(-4)}` : `…${v.slice(-2)}`;
}

const settings = async () => {
  await ready().catch(() => {});
  return Local.readSettings(area);
};
const home = async () => (await settings()).wordsHome ?? "local";

// The learner's base languages: slice 50's list (`ui`, the trusted copy of what
// storage.sync holds) when it exists, else the pages' copy, else the browser's language.
// `get` reads the trusted copy directly, inside one of its updates (the projector's).
async function currentBases(get = null) {
  if (!get) await ready().catch(() => {});
  const { ui, baseLangs } = await (get ?? area.get)({ ui: null, baseLangs: null });
  if (Array.isArray(ui?.baseLangs) && ui.baseLangs.length) return ui.baseLangs.slice(0, 4);
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
  const { baseRulesFor } = await area.get({ baseRulesFor: null });
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
  await area.set({ baseRules: out, baseRulesFor: sites ? stamp : null, ...(sites ? { sensitiveSites: sites } : {}) });
}

// ── the server connection ───────────────────────────────────────────────────

// Resolves the stored address and token into a request base, or throws a coded error.
async function connection() {
  await ready().catch(() => {});
  const stored = await secret("server").catch(() => null);
  if (!stored) throw codedError("server_key_rejected", "Paste your API token to connect.", { reason: "no_token" });
  const n = normalizeServerUrl((await Local.readSettings(area)).server.url);
  if (!n.ok) throw codedError(n.code, n.hint, { hint: n.hint });
  // Only the address a Kotiko page named gets requests signed with the token (slice 28 §7).
  const token = await secretFor("server", n.url);
  if (!token) throw addressChanged("server");
  // And only once the server there has shown it holds the same token (below).
  await proveServer(n.url, token);
  return { base: n.url, token };
}

// Slice 54, B-01 and D-01. The token never leaves this browser: every request to the
// server is signed with it (lib/server-auth.js), and every answer must carry the server's
// signature, made with the same token, before Kotiko reads it. Before the first request to
// an address, and again whenever its proof is older than 30 s before a request that carries
// the learner's words or settings (anything but a GET), the server proves it holds the
// token without either side sending it: Kotiko sends a fresh random nonce to
// `POST /api/v1/proof`, the server answers base64url(HMAC-SHA256(token, "kotiko-proof-v1:"
// + nonce)), and Kotiko checks it with WebCrypto (`subtle.verify`, which compares in
// constant time). So another program listening at the address (on [::1], or on 127.0.0.1
// while Kotiko's server is stopped) gets no token, can't answer for the server, and gets a
// word only if it took the port within 30 s of the last proof and before any other request
// found it out. The proof is forgotten on `server.connect`, when the address or token
// changes, when the server can't be reached, and after any answer the server didn't sign;
// nothing more is sent until a new proof succeeds.
// The proof answer also carries the server's boot id, signed for this nonce (`boot_mac`),
// which every request signs: the server makes a new one at each start and refuses a request
// signed for another (`stale_boot`), so a request another program caught while the server
// was stopped can't be played to it once it is back (security review E-01). When a request
// is refused as `stale_boot` (the server restarted since the last proof), Kotiko proves
// again and sends it once more.
//   - 200 with a proof, or a boot id, that doesn't match: that server has another token
//     (the learner's is wrong, or it isn't theirs): server_key_rejected, reason "wrong_proof".
//   - no route (401, 404 or 405: a server from before this check), or an answer with no
//     proof or no boot id (a server from before E-01): not_kotiko_server, reason "no_proof".
//     An older server has to be updated: anything could answer 404, so a missing route
//     can't be trusted either.
const PROOF_CONTEXT = "kotiko-proof-v1:";
const PROOF_TIMEOUT_MS = 10_000;
// How old a proof may be before a request that carries the learner's data.
const PROOF_FRESH_MS = 30_000;
let proven = null; // {base, token, at, boot} proven in this worker's life
let proving = null; // {base, token, promise} under way
const utf8 = (text) => new TextEncoder().encode(text);
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function forgetProof() {
  proven = null;
  proving = null;
}

// Resolves to the server's boot id once `base` has proved it holds `token`, within
// `maxAge` ms when given.
function proveServer(base, token, maxAge = Infinity) {
  if (proven?.base === base && proven.token === token && now() - proven.at < maxAge) return Promise.resolve(proven.boot);
  if (proving?.base === base && proving.token === token) return proving.promise;
  const promise = askProof(base, token)
    .then((boot) => {
      if (proving?.promise === promise) proven = { base, token, at: now(), boot };
      return boot;
    })
    .finally(() => {
      if (proving?.promise === promise) proving = null;
    });
  proving = { base, token, promise };
  return promise;
}

async function askProof(base, token) {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(32)));
  let res;
  try {
    res = await fetch(`${base}/api/v1/proof`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonce }),
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(PROOF_TIMEOUT_MS),
    });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw codedError("server_unreachable", `Can't reach ${base}. Is the server running?`, { reason: e?.name === "TimeoutError" ? "timeout" : "network" });
  }
  const noProof = (status) => codedError("not_kotiko_server", `${base} didn't prove it holds this token, so nothing was sent.`, { reason: "no_proof", status });
  if (res.status === 401 || res.status === 404 || res.status === 405) throw noProof(res.status);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error;
    const code = e && typeof e === "object" && typeof e.code === "string" ? e.code : fromStatus(res.status);
    // A server error's own words (a 0.2-style string) go in the details, as for a sync.
    const said = typeof e === "string" ? { error: e.slice(0, 200) } : {};
    throw codedError(code, `The server answered ${res.status} to the proof.`, { ...(e?.details && typeof e.details === "object" ? e.details : {}), ...said, status: res.status });
  }
  const proof = typeof body?.proof === "string" && /^[A-Za-z0-9_-]{43}$/.test(body.proof) ? body.proof : null;
  if (!proof) throw noProof(res.status);
  const wrong = () => codedError("server_key_rejected", `The server at ${base} has another token.`, { reason: "wrong_proof", status: res.status });
  const key = await crypto.subtle.importKey("raw", utf8(token), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  if (!(await crypto.subtle.verify("HMAC", key, ServerAuth.fromB64url(proof), utf8(PROOF_CONTEXT + nonce)))) throw wrong();
  // A server from before boot ids (E-01) can't check today's requests: it needs an update.
  if (body.boot === undefined) throw noProof(res.status);
  if (!(await ServerAuth.verifyBoot(token, nonce, body.boot, body.boot_mac))) throw wrong();
  return body.boot;
}

// An answer the server didn't sign: nothing in it is used. A 401 from a server from before
// signed requests (its challenge is `Bearer` alone) means it needs an update ("no_proof");
// today's server names `Kotiko-HMAC` and why it refused (`stale`: the clocks differ by
// over two minutes; `stale_boot`: the server restarted since the proof, which request()
// handles with one more proof). Neither is authenticated, so they only choose the message
// or that one retry. Anything else (a captive portal, another program) isn't a Kotiko
// server ("unsigned").
function unsignedAnswer(base, res) {
  const c = ServerAuth.challenge(res.headers.get("www-authenticate"));
  if (res.status === 401 && c.signs) return codedError("server_key_rejected", `${base} refused the request's signature.`, { reason: c.reason ?? "signature", status: 401 });
  if (res.status === 401) return codedError("not_kotiko_server", `${base} can't check signed requests.`, { reason: "no_proof", status: 401 });
  if (res.status === 429) return codedError("rate_limited", `${base} answered 429.`, { status: 429 });
  return codedError("not_kotiko_server", `${base} didn't sign its answer, so it wasn't used.`, { reason: "unsigned", status: res.status });
}

// Calls the server, signed, and returns its answer once the server's signature on it is
// checked. Network failures and unsigned answers become coded errors. A request refused as
// signed for the server's previous boot (it restarted since the proof) is sent once more
// after a new proof; the server refused it before doing anything with it.
async function request(conn, path, init = {}, retried = false) {
  const method = String(init.method ?? "GET").toUpperCase();
  // The learner's words and settings go only to a server that proved itself just now.
  const boot = await proveServer(conn.base, conn.token, method === "GET" ? Infinity : PROOF_FRESH_MS);
  const url = `${conn.base}${path}`;
  const body = typeof init.body === "string" ? init.body : "";
  const { header, nonce } = await ServerAuth.sign(conn.token, { method, path: ServerAuth.target(conn.base, url), body, ts: Math.floor(now() / 1000), boot });
  let res;
  try {
    res = await fetch(url, {
      ...init,
      method,
      headers: { ...init.headers, Authorization: header },
      cache: "no-store",
      credentials: "omit",
    });
  } catch (e) {
    // The server may have stopped, and another program may listen there next: prove again.
    if (e?.name !== "AbortError") forgetProof();
    if (e?.name === "TimeoutError") {
      throw codedError("server_unreachable", `${conn.base} took too long to answer.`, { reason: "timeout" });
    }
    if (e?.name === "AbortError") throw e;
    throw codedError("server_unreachable", `Can't reach ${conn.base}. Is the server running?`, {
      reason: "network",
    });
  }
  if (!(await ServerAuth.verifyResponse(conn.token, nonce, res.status, res.headers.get("x-kotiko-server")))) {
    forgetProof();
    res.body?.cancel?.().catch?.(() => {});
    const refused = unsignedAnswer(conn.base, res);
    if (!retried && refused.details?.reason === "stale_boot") return request(conn, path, init, true);
    throw refused;
  }
  return res;
}

// For add and remove: the parsed body, or an error. A failed lookup carries slice 25's code
// and its details (`retry_at`, `reason`, `provider`) beside the 0.2 string `error` (slice 10),
// so the popup never reads the message.
async function api(path, init = {}) {
  const res = await request(await connection(), path, { ...init, signal: AbortSignal.timeout(ADD_TIMEOUT_MS) });
  if (res.status === 401) throw codedError("server_key_rejected", "The server rejected that API token.", { status: 401 });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // A 0.2 route answers a string `error`; the code comes from the status (slice 25).
    const code = typeof body.code === "string" && body.code ? body.code : res.status === 404 && init.method === "DELETE" ? "word_gone" : fromStatus(res.status);
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
    await area.set({ lookupStatus: status });
    return status;
  } catch (e) {
    if (e?.code === "server_outdated") await area.set({ lookupStatus: null });
    throw e;
  }
}

// The lookup status of whoever looks words up: the server, or this browser's provider.
async function lookupStatus() {
  const s = await settings();
  if (s.lookup.kind === "server") return refreshLookupStatus();
  const st = await client.status();
  const status = { provider: s.lookup.kind === "provider" ? st.provider : null, quota: s.lookup.kind === "provider" ? st.quota : null, ready: s.lookup.kind === "provider" && st.ready, at: Date.now() };
  await area.set({ lookupStatus: status });
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
    // An older server without /api/v1 (or without this route), a proxy, or a status alone.
    if (res.status === 404 || res.status === 405) throw codedError("server_outdated", `The server answered ${res.status} for ${path}.`, { status: res.status });
    throw codedError(fromStatus(res.status), typeof e === "string" ? e : `The server answered ${res.status}.`, { status: res.status });
  }
  if (!data || typeof data !== "object") throw codedError("not_kotiko_server", `${path} didn't answer with JSON.`, { status: res.status });
  return data;
}

// The learner's languages on the connected server (slice 41 §9): the base languages its
// Telegram bot looks meanings up in, and the interface language chosen here (null when
// automatic). Sent when an extension page changes them (`profile.sync`), after connecting
// a server, and after each sync when what the server last got differs (a first sync after
// an update, a send that failed). Only these, never words or page text. One at a time;
// failures are kept quiet and tried again on the next sync.
let profileChain = Promise.resolve();
function pushProfile() {
  profileChain = profileChain.then(sendProfile, sendProfile);
  return profileChain;
}

async function sendProfile() {
  try {
    await ready().catch(() => {});
    if (!(await secret("server").catch(() => null))) return { ok: true, skipped: "no_server" };
    const { ui } = await area.get({ ui: {} });
    const body = { base_langs: await currentBases(), ui_lang: typeof ui?.uiLang === "string" && ui.uiLang !== "auto" ? ui.uiLang : null };
    const stamp = JSON.stringify([(await connection()).base, body]);
    const store = await getStore();
    if ((await store.meta.get("profileSent")) === stamp) return { ok: true, unchanged: true };
    try {
      await apiV1("/api/v1/profile", { method: "PUT", body });
    } catch (e) {
      // A server older than the route: nothing to tell it until it is updated.
      if (e?.code !== "server_outdated") throw e;
    }
    await store.meta.set("profileSent", stamp);
    return { ok: true };
  } catch (e) {
    return { ok: false, code: typeof e?.code === "string" ? e.code : "internal" };
  }
}

const sameId = (a, b) => String(a) === String(b);

const sync = createSyncController({
  now: () => Date.now(),
  async readCreds() {
    await ready().catch(() => {});
    return { token: String((await secret("server").catch(() => null)) || "").trim() };
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
      await area.set({ syncError: { code, message, details, at: Date.now() } });
      return;
    }
    // Only write words when they changed, so open tabs don't redo work every minute.
    const { words: old = [] } = await area.get("words");
    const patch = {
      lastSync: Date.now(),
      syncError: null,
      syncWarnings: result.dropped ? { dropped: result.dropped, reasons: result.reasons } : null,
    };
    if (JSON.stringify(old) !== JSON.stringify(result.words)) patch.words = result.words;
    if (result.dropped) console.warn("Skipped words the server sent that can't be shown:", result.reasons);
    await area.set(patch);
    pushProfile();
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
  storage: area,
  bases: (get) => currentBases(get),
  enabled: async () => !wiped && (await home()) === "local",
  onError: (e) => console.warn("Kotiko couldn't update the page word list:", e?.message ?? e),
});

const client = globalThis.KotikoLLMClient.createClient({
  fetch: (...a) => fetch(...a),
  store: { meta: { get: async (k) => (await getStore()).meta.get(k), set: async (k, v) => (await getStore()).meta.set(k, v) }, cache: { get: async (k) => (await getStore()).cache.get(k), put: async (k, v, m) => (await getStore()).cache.put(k, v, m) } },
  settings: async () => (await settings()).lookup,
  // Every request the client makes (lookups, model lists, the quota, Test) asks first.
  allow: (providerId, baseUrl) => lookupAllowed(providerId, baseUrl).catch(() => false),
  key: (providerId, baseUrl) => secretFor(`provider:${providerId}`, baseUrl).catch(() => null),
  now,
  onQuota: (quota) => {
    settings().then((s) => s.lookup.kind === "provider" && area.set({ lookupStatus: { provider: s.lookup.provider, quota, ready: true, at: Date.now() } })).catch(() => {});
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
    fetchPage: (title) => wiktionaryPage(title, { maxWaitMs: 10_000 }),
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
    const { mixing } = await area.get({ mixing: null });
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
  storage: area,
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
  await underRoutes(async () => {
    const s = await settings();
    await area.set({ wordsHome: "server", lookup: { ...s.lookup, kind: s.lookup.kind === "none" ? "server" : s.lookup.kind } });
  });
  await sync.credentialsChanged();
  return { ok: true, total: words.length, ...counts };
}

// Server -> local: the server's words, ids kept, replace this browser's copy; the
// server's data is untouched.
async function toLocal({ forget = false, serverLookups = false } = {}) {
  const words = await serverWords();
  const store = await getStore();
  const n = await store.replaceAll(words);
  const bases = await currentBases();
  const present = [...new Set(words.map((w) => w.base_lang).filter(Boolean))];
  const nextBases = [...bases, ...present.filter((b) => !bases.includes(b))].slice(0, 4);
  await underRoutes(async () => {
    const { lookup } = await settings();
    const kind = lookup.kind === "server" && !(serverLookups && !forget) ? "none" : lookup.kind;
    await area.set({ wordsHome: "local", lookup: { ...lookup, kind }, baseLangs: nextBases, syncError: null });
  });
  // Slice 50's list, when there is one, is what currentBases() reads first.
  const { ui } = await area.get({ ui: null });
  if (Array.isArray(ui?.baseLangs) && JSON.stringify(ui.baseLangs) !== JSON.stringify(nextBases)) await saveUi({ ...ui, baseLangs: nextBases });
  if (forget) {
    await setSecret("server", null);
    await underRoutes(async () => {
      await bindRoute("server", Local.DEFAULT_SERVER);
      await area.set({ server: { url: Local.DEFAULT_SERVER } });
    });
  }
  await projector.flush();
  refresh.nudge().catch(() => {});
  return { ok: true, total: n };
}

// ── backups and "delete everything" (slice 12) ─────────────────────────────

// A backup file's settings: what lib/backup.js `settingsPatch` takes from it (never where
// requests go, nor the lookup service), each checked as a page's change would be.
async function restoreSettings(s) {
  await ready();
  return underRoutes(async () => {
    const current = await area.get(null);
    const { local, sync: ui } = Backup.settingsPatch(s, { current });
    const patch = {};
    for (const [k, v] of Object.entries(local)) {
      const value = k === "lookup" || k === "seedSalt" ? v : pageValue(k, v);
      if (value !== undefined) patch[k] = value;
    }
    if (Object.keys(ui).length) {
      const next = pageValue("ui", { uiLang: "auto", ...current.ui, ...ui, ...(ui.baseLangs ? { baseLangsConfirmed: true } : {}) });
      if (next) await saveUi(next);
    }
    await area.set(patch);
    if (patch.lookup) lookupChanged();
    if (patch.baseLangs) {
      projector.schedule();
      mirrorBaseRules().catch(() => {});
    }
    return { ok: true };
  });
}

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
  const { recentlyDeleted = [] } = await area.get({ recentlyDeleted: [] });
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
  await area.set({ lastBackupAt: now() });
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
  const { lastBackupAt = null } = await area.get({ lastBackupAt: null });
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
  const words = s.wordsHome === "local" ? await store.count() : ((await area.get({ words: [] })).words ?? []).length;
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
  area.reset();
  secretCache.clear();
  client.reset();
  await globalThis.KotikoStore.wipe({ indexedDB: globalThis.indexedDB });
  // An empty database with one mark, so the next store is set up afresh (A-06, above).
  const born = await globalThis.KotikoStore.open({ indexedDB: globalThis.indexedDB, now });
  await born.meta.set(BORN_FROM_WIPE, wipedAt);
  born.close();
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
// same languages on every device; content scripts read the copy in storage.local. The
// synced one wins where storage.sync takes only Kotiko's writes (`syncLocked`); elsewhere
// this browser keeps its own, and fills storage.sync only when it has none.
async function ensureSeedSalt() {
  await ready();
  let synced = null;
  try {
    ({ seedSalt: synced } = await ext.storage.sync.get({ seedSalt: null }));
  } catch {
    // no storage.sync here
  }
  const { seedSalt: local } = await area.get({ seedSalt: null });
  const takeSynced = validSalt(synced) && (!validSalt(local) || (await syncLocked));
  const salt = takeSynced ? synced : validSalt(local) ? local : [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (!validSalt(synced)) await Promise.resolve().then(() => ext.storage.sync.set({ seedSalt: salt })).catch(() => {});
  if (salt !== local) await area.set({ seedSalt: salt });
}
ensureSeedSalt().catch(() => {});

// Slice 12 §8: the backup reminder counts from the first start of a version that has it,
// so nobody is reminded on day one.
async function ensureBackupClock() {
  if (wiped) return;
  const { backupSince } = await area.get({ backupSince: null });
  if (typeof backupSince !== "number") await area.set({ backupSince: now() });
}
ensureBackupClock().catch(() => {});

// Slice 08: languages hidden under an old code stay hidden under the canonical one, so a
// hidden "cmn" is a hidden "zh" once the server re-tags its words.
async function migrateHiddenLangs() {
  const { hiddenLangs = [] } = await area.get({ hiddenLangs: [] });
  const canonical = (tag) => globalThis.KotikoLang.canonical(tag);
  const mapped = [...new Set(hiddenLangs.map((tag) => (canonical(tag).ok ? canonical(tag).tag : tag)))];
  if (JSON.stringify(mapped) !== JSON.stringify(hiddenLangs)) await area.set({ hiddenLangs: mapped });
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
// A new install has nothing from an older version, so a 0.2 token, address or word list
// the one-time upgrade found was written by a web page's content script in the moments
// before the upgrade ran (slice 28 §7): drop all of it, with every address and setting
// taken along with it (SCR-448). Only the synced languages stay.
async function discardPlanted() {
  const store = await getStore();
  const from = await store.meta.get("migratedFrom");
  if (!from || from === "new") return;
  await setSecret("server", null);
  await store.replaceAll([]);
  await underRoutes(async () => {
    await bindRoute("server", Local.DEFAULT_SERVER);
    await store.meta.remove(CHOSEN);
    for (const p of globalThis.KOTIKO_SPEC.providers.providers) await store.meta.remove(routeKey(`lookup:${p.id}`));
    await area.remove(Object.keys(await area.get(null)).filter((k) => k !== "ui"));
    await area.set({ wordsHome: "local", server: { url: Local.DEFAULT_SERVER }, lookup: { ...Local.DEFAULT_LOOKUP }, keys: { server: false, providers: {} }, words: [] });
  });
  await store.meta.set("migratedFrom", "new");
  sync.credentialsChanged();
  ensureSeedSalt().catch(() => {});
}

// Slice 54, A-06: a 0.2 `token` and `serverUrl` (and whatever else storage.local held) count
// only on an update from 0.1 or 0.2, the versions that kept them there. A store set up from
// storage.local at any other start (an update from a later version whose database was lost,
// a browser update) keeps none of it. `ready()` first, so this start's set-up has run.
const fromBeforeStore = (version) => /^0\.[0-2]\./.test(String(version ?? ""));
async function keepLegacyOnlyFrom(details) {
  await ready();
  if (!adoptedLegacy) return;
  // Decided once, by the first event after the set-up: a browser update that follows an
  // update from 0.2 in the same worker must not drop the words that update kept.
  adoptedLegacy = false;
  if (details?.reason === "update" && fromBeforeStore(details.previousVersion)) return;
  await discardPlanted();
}

async function firstInstall() {
  await ready().catch(() => {});
  await discardPlanted().catch((e) => console.warn("Kotiko install:", e?.message ?? e));
  const bases = await detectBrowserBases();
  // storage.sync can outlive an uninstall (the new store took its `ui`, adoptOnce); a
  // learner who confirmed before keeps their list.
  const { ui } = await area.get({ ui: {} });
  const keep = ui?.baseLangsConfirmed === true && Array.isArray(ui.baseLangs) && ui.baseLangs.length;
  const next = keep ? ui.baseLangs.slice(0, 4) : bases;
  const { onboarding } = await area.get({ onboarding: null });
  const patch = { baseLangs: next };
  if (!onboarding) patch.onboarding = { completedAt: null, skipped: false, version: 2 };
  await saveUi({ uiLang: "auto", ...ui, baseLangs: next, baseLangsDetected: bases, baseLangsConfirmed: !!keep }, { with: patch });
  projector.schedule();
  await openWelcome();
}

// Slice 50 §2's upgrade rule: an update from a version with no base-language setting
// detects the browser's languages, then adds every base the saved words already have
// (all of a pre-v2 list is "en"), so an existing learner's swaps never silently stop.
// A learner who has a setting keeps it untouched.
async function upgradeBases() {
  await ready().catch(() => {});
  const { ui } = await area.get({ ui: null });
  if (Array.isArray(ui?.baseLangs) && ui.baseLangs.length) return;
  const detected = await detectBrowserBases();
  const records = await getStore().then((s) => s.list()).catch(() => []);
  const { words = [] } = await area.get({ words: [] });
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
  await saveUi({ uiLang: "auto", ...ui, baseLangs: bases, baseLangsDetected: detected, baseLangsConfirmed: false }, { with: { baseLangs: bases } });
  projector.schedule();
}

// An update from a version before the welcome tab: the learner is past the first run, and
// a learner who already has words never gets a first-word or first-swap celebration.
async function upgradeOnboarding() {
  await ready().catch(() => {});
  const { onboarding, celebrations, words } = await area.get({ onboarding: null, celebrations: null, words: [] });
  const patch = {};
  if (!onboarding) patch.onboarding = { completedAt: now(), skipped: false, version: 2, upgraded: true };
  const stored = await getStore().then((s) => s.count()).catch(() => 0);
  if ((Array.isArray(words) && words.length) || stored > 0) {
    const next = Celebrations.markDone(celebrations, ["vocab:first", "page:first-swap"], now());
    if (JSON.stringify(next) !== JSON.stringify(celebrations)) patch.celebrations = next;
  }
  if (Object.keys(patch).length) await area.set(patch);
}

// The first word saved anywhere (the popup too) finishes the first run.
let finishing = Promise.resolve();
function noteFirstWord() {
  finishing = finishing.then(async () => {
    const { onboarding } = await area.get({ onboarding: null });
    if (onboarding && !onboarding.completedAt) await area.set({ onboarding: { ...onboarding, completedAt: now() } });
  }).catch(() => {});
  return finishing;
}

// One claim at a time, so two pages can't both fire a milestone (32 section 4).
let claiming = Promise.resolve();
function claimMilestone(key) {
  const run = claiming.then(async () => {
    const { celebrations, prefs } = await area.get({ celebrations: null, prefs: {} });
    const r = Celebrations.claim(celebrations, key, { now: now() });
    if (r.claimed) await area.set({ celebrations: r.next });
    return { claimed: r.claimed, reason: r.reason ?? null, celebrate: r.claimed && Celebrations.enabled(prefs) };
  });
  claiming = run.catch(() => {});
  return run;
}

// Tabs open before an install or update get Kotiko without a reload (slice 15): the same
// scripts the manifest injects, top frame only, as it does. On an update the new copy finds
// the old one and makes it stand down (content.js), with nothing a page can see; the swap
// style comes with the first swap (ui/swap-style.js). A tab that can't take scripts (a store
// page, a browser page) is skipped.
async function injectOpenTabs() {
  const cs = ext.runtime.getManifest?.()?.content_scripts?.[0];
  if (!ext.scripting?.executeScript || !cs) return 0;
  const tabs = await Promise.resolve(ext.tabs.query({ url: ["http://*/*", "https://*/*"] })).catch(() => []);
  let n = 0;
  for (const tab of tabs) {
    try {
      await ext.scripting.executeScript({ target: { tabId: tab.id }, files: cs.js });
      n++;
    } catch {
      // not a page Kotiko may run on
    }
  }
  return n;
}

// Slice 54, B-01: an address saved as plain-http localhost by an earlier version, and the
// route it is bound to, become 127.0.0.1, so the settings show where requests really go.
// Requests already went there (routes compare pinned addresses); this only rewrites them.
async function pinLoopbackAddresses() {
  await ready();
  await underRoutes(async () => {
    const store = await getStore();
    const s = await Local.readSettings(area);
    const patch = {};
    const pinned = routeUrl("server", s.server.url);
    if (pinned && pinned !== s.server.url && /^http:\/\/localhost\b/i.test(s.server.url.trim())) patch.server = { ...s.server, url: pinned };
    const lookupUrl = s.lookup.baseUrl ? globalThis.ServerUrl.pinLoopback(s.lookup.baseUrl.trim()) : null;
    if (lookupUrl && lookupUrl !== s.lookup.baseUrl.trim()) patch.lookup = { ...s.lookup, baseUrl: lookupUrl };
    for (const { key, value } of await store.meta.entries("route:")) {
      if (typeof value !== "string" || value.startsWith(RAW) || key === CHOSEN) continue;
      const route = key.slice("route:".length);
      const bound = routeUrl(route, value);
      if (bound && bound !== value) await store.meta.set(key, bound);
    }
    if (Object.keys(patch).length) await area.set(patch);
  });
}

function onInstalled(details) {
  if (details?.reason === "install") firstInstall().catch((e) => console.warn("Kotiko couldn't open the welcome tab:", e?.message ?? e));
  else {
    // What storage.local held is dropped first, so no upgrade step writes something the
    // drop then erases (it once raced the first-run state, and lost it).
    const kept = keepLegacyOnlyFrom(details).catch((e) => console.warn("Kotiko update:", e?.message ?? e));
    if (details?.reason === "update") {
      Promise.resolve(ext.alarms.clear(OLD_ALARM)).catch(() => {});
      kept.then(migrateHiddenLangs).catch(() => {});
      kept.then(pinLoopbackAddresses).catch(() => {});
      // The bases after the first-run state: writing them projects the words again, and
      // the first-run check reads the old list first.
      kept.then(upgradeOnboarding).catch(() => {}).then(upgradeBases).catch(() => {});
    }
  }
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
  storage: area,
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
  storage: area,
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
      // Only Kotiko's own pages skip the 5 s wait (`force`): a content script's sync waits
      // like a page load's, whatever it asks (slice 54, A-08).
      sync: {
        from: ["page", "content"],
        async run(msg, sender) {
          const fromPage = globalThis.MessageRouter.senderKinds(sender, ext.runtime).has("page");
          await requestSync(msg.force === true && fromPage ? { reason: "manual", force: true } : { reason: "page" });
          return { ok: true };
        },
      },
      // A page that opened before the list was copied to storage asks for it (slice 16 §4).
      sensitiveSites: {
        from: ["content"],
        run: async () => ({ sites: (await sensitiveSites()) ?? [] }),
      },
      // "Don't swap this word" from the word card on a page (slice 16 §5): the one setting
      // a content script may change, one word at a time.
      neverSwap: {
        from: ["content"],
        check: (m) => (typeof m.key === "string" && m.key.length >= 1 && m.key.length <= 200 && typeof m.on === "boolean" ? null : "key must name a word, and on be true or false"),
        run: (m) => saveSettings({ [m.on ? "add" : "remove"]: { "prefs.neverSwap": [m.key] } }),
      },
      // Settings Kotiko's pages change (SCR-448): checked, kept in the trusted copy, mirrored.
      "settings.set": {
        from: ["page"],
        check: (m) => (["set", "merge", "add", "remove"].some((o) => m[o] !== undefined) ? null : "nothing to change"),
        run: saveSettings,
      },
      // A backup's settings (slice 12 §7), as lib/backup.js picks them.
      "settings.restore": {
        from: ["page"],
        check: (m) => (m.settings && typeof m.settings === "object" && !Array.isArray(m.settings) ? null : "settings must be an object"),
        run: (m) => restoreSettings(m.settings),
      },
      // The free lookups left today, for the popup and the dashboard (slice 10).
      llmStatus: {
        from: ["page"],
        run: () => lookupStatus(),
      },
      add: {
        from: ["page"],
        check: (msg) => checks.addText(msg.text),
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
            // Already gone is what Undo wanted.
            await api(`/api/words/${encodeURIComponent(msg.id)}`, { method: "DELETE" }).catch((e) => {
              if (e?.code !== "word_gone") throw e;
            });
          }
          if (typeof msg.jobId === "string") await queue.markUndo(msg.jobId, msg.id, "done");
          await sync.update(
            async () => {
              const { words = [] } = await area.get("words");
              const rest = words.filter((w) => !sameId(w.id, msg.id));
              if (rest.length !== words.length) await area.set({ words: rest });
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

      // The languages you read in or Kotiko's language changed (slice 41 §9): the
      // connected server's bot follows them.
      "profile.sync": { from: ["page"], run: () => pushProfile() },

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
        run: (m) => underRoutes(async () => {
          const s = await settings();
          const next = { ...s.lookup };
          for (const k of ["kind", "provider", "baseUrl", "model", "dataCollection"]) if (m.lookup[k] !== undefined) next[k] = typeof m.lookup[k] === "string" ? m.lookup[k].trim() || null : m.lookup[k];
          // Choosing a service without naming an address means its own address.
          if (m.lookup.provider !== undefined && m.lookup.baseUrl === undefined) next.baseUrl = null;
          if (next.kind === "server" && !s.keys.server) throw codedError("server_key_rejected", "Connect a server first.", { reason: "no_token" });
          // The page named the address (or the service, whose own address it is): trust it.
          if (m.lookup.provider !== undefined || m.lookup.baseUrl !== undefined) {
            const ep = globalThis.KotikoLLMClient.endpoint(next);
            await bindRoute(`lookup:${ep.preset.id}`, ep.baseUrl);
            await chooseProvider(ep.preset.id);
          }
          await area.set({ lookup: next });
          lookupChanged();
          return { ok: true, lookup: next };
        }),
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
          // Whatever was proved before, this connection proves itself again.
          forgetProof();
          if (typeof m.url === "string") {
            // Saved as it will be used (localhost as 127.0.0.1, slice 54 B-01); an address
            // that isn't one is kept as typed, so the settings can show it with its error.
            const typed = m.url.trim() || Local.DEFAULT_SERVER;
            const n = normalizeServerUrl(typed);
            await underRoutes(async () => {
              await bindRoute("server", typed);
              await area.set({ server: { url: n.ok ? n.url : typed } });
            });
          }
          if (typeof m.token === "string") await setSecret("server", m.token.trim() || null);
          const s = await settings();
          if (s.wordsHome === "local") {
            const count = await (await getStore()).count();
            if (count > 0) return { ok: true, wordsHome: "local", needsSwitch: true, count };
            if (s.keys.server) {
              await underRoutes(async () => {
                const { lookup } = await settings();
                await area.set({ wordsHome: "server", lookup: { ...lookup, kind: lookup.kind === "provider" ? "provider" : "server" } });
              });
            }
          }
          const result = await sync.credentialsChanged();
          pushProfile();
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
          await area.set({ lastBackupAt: now() });
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
          const { verifier, challenge, state } = await globalThis.KotikoPKCE.pair();
          await (await getStore()).secrets.set("pkce:pending", JSON.stringify({ verifier, state, expires: now() + globalThis.KotikoPKCE.PENDING_MS }));
          const url = globalThis.KotikoPKCE.authUrl({ challenge, state });
          await Promise.resolve(ext.tabs?.create?.({ url })).catch(() => {});
          return { ok: true, url };
        },
      },
      // A code counts only with the state of the sign-in waiting here: any page can open
      // the callback with a code of its own, and that must neither reach OpenRouter nor use
      // up the learner's sign-in. The verifier is kept until a code works or it expires
      // (slice 54, A-05).
      "oauth.code": {
        from: ["docs"],
        check: (m) => (typeof m.code !== "string" || m.code.length === 0 || m.code.length > 512 ? "code must be a string" : m.state !== undefined && (typeof m.state !== "string" || m.state.length > 128) ? "state must be a string" : null),
        async run(m, sender) {
          if (!globalThis.KotikoPKCE.isCallback(sender?.url)) throw codedError("forbidden", "Not the callback page.");
          const store = await getStore();
          const raw = await store.secrets.get("pkce:pending");
          const pending = raw ? JSON.parse(raw) : null;
          if (!pending || pending.expires < now()) {
            if (raw) await store.secrets.remove("pkce:pending");
            throw codedError("key_rejected", "That sign-in has expired.", { reason: "expired", provider: "openrouter" });
          }
          if (!globalThis.KotikoPKCE.sameState(m.state, pending.state)) throw codedError("key_rejected", "That code isn't from the sign-in Kotiko started.", { reason: "not_this_sign_in", provider: "openrouter" });
          const key = await globalThis.KotikoPKCE.exchange({ fetch: (...a) => fetch(...a), code: m.code, verifier: pending.verifier });
          await store.secrets.remove("pkce:pending");
          await setSecret("provider:openrouter", key);
          await underRoutes(async () => {
            await bindRoute("lookup:openrouter", globalThis.KotikoLLMClient.endpoint({ provider: "openrouter" }).baseUrl);
            await chooseProvider("openrouter");
            const s = await settings();
            await area.set({ lookup: { ...s.lookup, kind: "provider", provider: "openrouter", baseUrl: null } });
          });
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
  const { addJobs = [] } = await area.get({ addJobs: [] });
  const old = addJobs.find((j) => j.id === m.id);
  if (!old) return { error: "That add is gone.", code: "job_gone" };
  const id = globalThis.KotikoStore.uuid7(now());
  await queue.add({ id, text: old.text, hintLang: globalThis.KotikoLang.canonical(m.lang).tag, baseLangs: old.baseLangs, surface: old.surface, replaces: { id: old.id, key: m.key } });
  return { ok: true, newId: id };
}

async function retireReplaced(job) {
  const { id, key } = job.replaces;
  // The new add can land on the very word the old one made ("Already in your list", when the
  // model answers the same word in the same language): that word stays.
  const keep = new Set((job.results ?? []).map((r) => r.wordId).filter(Boolean));
  const res = await undoWord(id, key, { keep });
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
  const { words = [] } = await area.get("words");
  const rest = words.filter((w) => !gone.some((g) => sameWord(g, w)));
  if (rest.length !== words.length || added.length) await area.set({ words: [...added, ...rest] });
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
  const { addJobs = [] } = await area.get({ addJobs: [] });
  const job = addJobs.find((j) => j.id === id);
  return (job?.results ?? []).filter((r) => r.word && globalThis.KotikoAddQueue.keyOf(r.word) === key);
};
const writeOps = async (ops) => (await wordRoutes["words.write"].run({ ops })).results;

async function undoWord(id, key, { keep = new Set() } = {}) {
  const records = (await jobWords(id, key)).filter((r) => r.result !== "unchanged" && r.undo !== "done" && !keep.has(r.wordId));
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
  const { addJobs = [] } = await area.get({ addJobs: [] });
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
  const again = records.filter((_r, i) => !results[i].ok && (results[i].code === "word_gone" || results[i].code === "word_conflict"));
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
  else Promise.resolve(ext.tabs.query({ active: true, currentWindow: true })).then(([active]) => active?.id && send(active.id), () => {});
});

// Kotiko's own code writes `server` and `lookup` only after setting their routes, so
// settings that disagree with the routes come from a path that forgot to (a bug): put the
// trusted address back, so the settings show what Kotiko really uses, and wake waiting adds.
let healing = null;
function healRoutes() {
  healing ??= underRoutes(healOnce).finally(() => {
    healing = null;
  });
  return healing;
}
async function healOnce() {
  await ready().catch(() => {});
  const s = await Local.readSettings(area);
  const patch = {};
  const server = await trustedUrl("server");
  if (server && !sameAddress("server", s.server.url, server)) patch.server = { url: server.startsWith(RAW) ? server.slice(RAW.length) : server };
  const chosen = await chosenProvider();
  const ep = globalThis.KotikoLLMClient.endpoint(s.lookup);
  if (ep.preset.id !== chosen || (ep.baseUrl && !(await routeAllows(`lookup:${ep.preset.id}`, ep.baseUrl, { heal: false })))) {
    const trusted = await trustedUrl(`lookup:${chosen}`);
    const own = routeUrl("lookup", providerOf(chosen)?.baseUrl ?? null);
    patch.lookup = { ...s.lookup, provider: chosen, baseUrl: trusted && trusted !== own ? trusted : null };
  }
  if (!Object.keys(patch).length) return;
  await area.set(patch);
  client.reset();
  queue.wake();
  if (patch.server) sync.credentialsChanged();
}

// storage.local is the trusted copy's mirror: a change the background didn't make is put
// back, and a key it doesn't keep (a 0.2 `token` or `serverUrl` written after the upgrade,
// say) is removed unused. storage.sync's changes are taken only where content scripts
// can't write there (`adoptSync`).
ext.storage.onChanged.addListener((changes, areaName) => {
  if (wiped) return;
  if (areaName === "sync") adoptSync(changes).catch(() => {});
  if (areaName !== "local") return;
  ready()
    .then(() => area.heal(changes))
    .then((r) => {
      if (r.restored.length || r.removed.length) console.warn("Kotiko put back settings changed outside its pages:", [...r.restored, ...r.removed].join(", "));
    })
    .catch(() => {});
});

// The toolbar badge and tooltip per tab (slice 20 §5): "off" when Kotiko is off everywhere
// or paused on the tab's site. Set per tab, never globally, and recomputed when the tab
// changes or the settings do.
async function updateBadge(tab) {
  const action = ext.action;
  if (!action?.setBadgeText || !tab?.id) return;
  try {
    const s = await area.get({ enabled: true, pausedHosts: [] });
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
updateAllBadges();

// test-only: start (scripts/build-extension.mjs leaves this block out of the store zips)
// For tests: the parts a test drives directly.
// `seed` writes the trusted copy, as Kotiko's own code does (tests can't write storage.local
// and have it stay, any more than a content script can).
globalThis.__kotiko = { ensureSeedSalt, adoptSync, ready, getStore, queue, refresh, projector, client, settings, currentBases, mirrorBaseRules, injectOpenTabs, toServer, toLocal, openWelcome, claimMilestone, onInstalled, area, seed: async (items) => (await ready(), area.set(items)) };
// test-only: end
