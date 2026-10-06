// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The extension's own word store (slice 11 section 2): one IndexedDB database, `kotiko`,
// opened only by the background. Content scripts can't reach it (they get the page's
// origin for IndexedDB), so the lookup key and the server token live here too.
//
//   const store = await KotikoStore.open({ indexedDB, now });
//   store.upsertByNatural(words, {explicit, origin, jobId})  -> {results, applied}
//   store.list() / get(id) / update(id, patch, {if_updated_at}) / remove(id) / restore(id)
//   store.changesSince(iso) / recentLangs(5) / replaceAll(words) / seed(words)
//   store.importWords(backupWords, {restoreDeleted}) / undoImport()   (slice 12)
//   store.secrets.get(id) / set(id, value) / remove(id) / ids()
//   store.meta.get(key) / set(key, value) / remove(key) / entries(prefix) / write(puts, deletes)
//   store.cache.get(key) / put(key, value) / prune()
//   store.onCommit(fn)                fn({reason, by}) after any committed word write
//   KotikoStore.wipe({ indexedDB })    deletes the whole database (slice 12's delete everything)
//
// Object stores (database version 1): words (key id; indexes natural, group, updated_at,
// lang, base_lang), outbox, secrets, meta, jobs (add jobs already applied, by job id: a
// second application of the same job returns the first one's results) and lookupCache.
//
// IndexedDB unique indexes can't be partial, so the natural key (lang, native_key, sense,
// base_lang) is kept unique among live words in code: every word write runs in one
// readwrite transaction that reads the `natural` index and skips tombstones. Merging
// follows slice 07 (lib/word-merge.js). Pure JavaScript over the IndexedDB API, so Node
// tests run it on fake-indexeddb.
(() => {
  const DB_NAME = "kotiko";
  const DB_VERSION = 1;
  const MAX_VOCABULARY = globalThis.KOTIKO_SPEC?.rules?.max_vocabulary ?? 20_000;
  const RESTORE_DAYS = 30;
  const DAY = 86_400_000;
  const CACHE = globalThis.KOTIKO_SPEC?.models?.policy?.cache ?? { ttl_days: 30, max_entries: 5000 };
  // lib/word-merge.js, loaded before this file.
  const Merge = {
    nativeKey: (s) => globalThis.KotikoWordMerge.nativeKey(s),
    form: (f) => globalThis.KotikoWordMerge.form(f),
    changes: (a, b, o) => globalThis.KotikoWordMerge.changes(a, b, o),
  };

  const LIVE_STATUSES = ["active", "paused"];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  const codedError = (code, message, details = {}) => Object.assign(new Error(message), { code, details });

  function request(r) {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  function upgrade(db) {
    const words = db.createObjectStore("words", { keyPath: "id" });
    words.createIndex("natural", ["lang", "native_key", "sense", "base_lang"], { unique: false });
    words.createIndex("group", ["lang", "native_key"], { unique: false });
    words.createIndex("updated_at", "updated_at", { unique: false });
    words.createIndex("lang", "lang", { unique: false });
    words.createIndex("base_lang", "base_lang", { unique: false });
    db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
    db.createObjectStore("secrets", { keyPath: "id" });
    db.createObjectStore("meta", { keyPath: "key" });
    db.createObjectStore("jobs", { keyPath: "id" });
    const cache = db.createObjectStore("lookupCache", { keyPath: "key" });
    cache.createIndex("used_at", "used_at", { unique: false });
  }

  function openDb(idb, name = DB_NAME) {
    if (!idb?.open) return Promise.reject(codedError("storage_full", "IndexedDB isn't available here.", { reason: "no_indexeddb" }));
    return new Promise((resolve, reject) => {
      const r = idb.open(name, DB_VERSION);
      r.onupgradeneeded = (e) => {
        if (e.oldVersion < 1) upgrade(r.result);
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(codedError("storage_full", String(r.error?.message ?? r.error), { reason: r.error?.name ?? "open_failed" }));
      r.onblocked = () => reject(codedError("storage_full", "The word store is open in an older version.", { reason: "blocked" }));
    });
  }

  // A UUIDv7 (slice 07): 48 bits of milliseconds, version 7, variant 10, random bits.
  function uuid7(ms) {
    const b = new Uint8Array(16);
    globalThis.crypto.getRandomValues(b);
    let t = Math.max(0, Math.floor(ms));
    for (let i = 5; i >= 0; i--) {
      b[i] = t % 256;
      t = Math.floor(t / 256);
    }
    b[6] = (b[6] & 0x0f) | 0x70;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  const iso = (ms) => new Date(ms).toISOString();
  // updated_at only moves forward, by at least a millisecond, so if_updated_at sees every change.
  const later = (nowMs, prev) => {
    const p = Date.parse(prev ?? "");
    return iso(Number.isFinite(p) && p >= nowMs ? p + 1 : nowMs);
  };

  // The record as the rest of the extension sees it: native_key is for indexing only.
  function pub(w) {
    if (!w) return w;
    const rest = { ...w };
    delete rest.native_key;
    return rest;
  }

  const TEXT_FIELDS = ["romanization", "native_vocalized", "pronunciation", "pronunciation_careful", "pronunciation_source", "note", "source_text"];

  // A slice 07 record from a checked word (lib/wordspec.js output or a client's word).
  function record(w, { id, nowMs, origin, status }) {
    const out = {
      id,
      lang: w.lang,
      native: w.native,
      native_key: Merge.nativeKey(w.native),
      base_lang: w.base_lang,
      sense: typeof w.sense === "string" ? w.sense : "",
      gloss: w.gloss,
      forms: (Array.isArray(w.forms) && w.forms.length ? w.forms : [w.gloss]).map(Merge.form).filter((f) => f.text),
      status: w.status === "paused" ? "paused" : status ?? "active",
      origin: w.origin ?? origin ?? "add",
      created_at: iso(nowMs),
      updated_at: iso(nowMs),
      deleted_at: null,
      merged_into: null,
    };
    for (const f of TEXT_FIELDS) out[f] = w[f] ?? null;
    if (w.serverId !== undefined && w.serverId !== null) out.serverId = w.serverId;
    return out;
  }

  async function open({ indexedDB = globalThis.indexedDB, now = () => Date.now(), name = DB_NAME } = {}) {
    const db = await openDb(indexedDB, name);
    const listeners = new Set();
    const committed = (info) => {
      for (const fn of listeners) {
        try {
          fn(info);
        } catch {
          // a listener's problem isn't the store's
        }
      }
    };

    // Runs fn(stores) in one transaction; resolves with fn's result once it commits.
    function tx(names, mode, fn) {
      return new Promise((resolve, reject) => {
        let t;
        try {
          t = db.transaction(names, mode);
        } catch (e) {
          reject(codedError("storage_full", String(e?.message ?? e), { reason: e?.name ?? "transaction" }));
          return;
        }
        const stores = Object.fromEntries([names].flat().map((n) => [n, t.objectStore(n)]));
        let result;
        let failed = null;
        t.oncomplete = () => (failed ? reject(failed) : resolve(result));
        t.onerror = () => reject(failed ?? codedError("storage_full", String(t.error?.message ?? t.error), { reason: t.error?.name ?? "error" }));
        t.onabort = () => reject(failed ?? codedError("storage_full", String(t.error?.message ?? "aborted"), { reason: t.error?.name ?? "abort" }));
        Promise.resolve()
          .then(() => fn(stores, t))
          .then((r) => (result = r))
          .catch((e) => {
            failed = e;
            try {
              t.abort();
            } catch {
              // already finished
            }
          });
      });
    }

    async function liveByNatural(words, key) {
      const rows = await request(words.index("natural").getAll(key));
      return rows.find((w) => !w.deleted_at) ?? null;
    }

    async function liveCount(words) {
      const total = await request(words.count());
      if (total < MAX_VOCABULARY) return total;
      const records = await request(words.getAll());
      return records.filter((w) => !w.deleted_at && w.status !== "pending").length;
    }

    // Saves checked words: inserts each, or merges it into the live word holding its
    // natural key (slice 07). With `jobId`, the whole application is recorded so a second
    // one returns the first one's results without writing (slice 24's idempotency).
    async function upsertByNatural(input, { explicit = true, origin = "add", jobId = null, by = null } = {}) {
      const items = Array.isArray(input) ? input : [input];
      const out = await tx(["words", "jobs"], "readwrite", async ({ words, jobs }) => {
        if (jobId) {
          const done = await request(jobs.get(jobId));
          if (done) return { results: done.results, applied: true };
        }
        const t = now();
        let live = null;
        const results = [];
        for (const w of items) {
          const existing = await liveByNatural(words, [w.lang, Merge.nativeKey(w.native), w.sense ?? "", w.base_lang]);
          if (existing) {
            const changes = Merge.changes(existing, { status: "active", ...w }, { explicit });
            if (!Object.keys(changes).length) {
              results.push({ result: "unchanged", word: pub(existing), previous: null });
              continue;
            }
            const next = { ...existing, ...changes, updated_at: later(t, existing.updated_at) };
            await request(words.put(next));
            results.push({ result: "updated", word: pub(next), previous: pub(existing) });
            continue;
          }
          live ??= await liveCount(words);
          if (live >= MAX_VOCABULARY) throw codedError("vocabulary_full", `At most ${MAX_VOCABULARY} words.`, { max: MAX_VOCABULARY });
          let id = typeof w.id === "string" && UUID.test(w.id) ? w.id : null;
          if (id && (await request(words.get(id)))) id = null;
          const rec = record(w, { id: id ?? uuid7(t), nowMs: t, origin });
          await request(words.add(rec));
          live++;
          results.push({ result: "created", word: pub(rec), previous: null });
        }
        if (jobId) await request(jobs.put({ id: jobId, results, at: iso(t) }));
        return { results, applied: false };
      });
      if (!out.applied && out.results.some((r) => r.result !== "unchanged")) committed({ reason: "upsert", by });
      return out;
    }

    async function get(id) {
      return pub(await tx("words", "readonly", ({ words }) => request(words.get(id))));
    }

    // Live words (active and paused by default), newest first, as slice 07 records.
    async function list({ statuses = LIVE_STATUSES } = {}) {
      const records = await tx("words", "readonly", ({ words }) => request(words.getAll()));
      const want = new Set(statuses);
      return records
        .filter((w) => !w.deleted_at && want.has(w.status))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1))
        .map(pub);
    }

    // Every record, tombstones too (exports and tests).
    async function all() {
      return (await tx("words", "readonly", ({ words }) => request(words.getAll()))).map(pub);
    }

    async function count() {
      return tx("words", "readonly", ({ words }) => liveCount(words));
    }

    // Records changed after `since` (an ISO time), oldest first (slice 39's delta sync).
    async function changesSince(since) {
      const range = since ? globalThis.IDBKeyRange.lowerBound(since, true) : undefined;
      return (await tx("words", "readonly", ({ words }) => request(words.index("updated_at").getAll(range)))).map(pub);
    }

    // The languages of the most recently touched live words, newest first (the prompt's
    // recent-languages hint, today llm.ex and words.ex on the server).
    async function recentLangs(n = 5) {
      return tx("words", "readonly", ({ words }) => new Promise((resolve, reject) => {
        const langs = [];
        const r = words.index("updated_at").openCursor(null, "prev");
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const c = r.result;
          if (!c || langs.length >= n) return resolve(langs);
          const w = c.value;
          if (!w.deleted_at && !langs.includes(w.lang)) langs.push(w.lang);
          c.continue();
        };
      }));
    }

    // An explicit edit (slice 07 section 4): every field in `patch` is set. Returns
    // {ok, word} or {ok: false, code, message, details} with the server's codes.
    async function update(id, patch, { if_updated_at = null, by = null } = {}) {
      const res = await tx("words", "readwrite", async ({ words }) => {
        const w = await request(words.get(id));
        if (!w || w.status === "pending" || w.deleted_at) return { ok: false, code: "word_gone", message: "That word was already removed.", details: {} };
        if (if_updated_at && Date.parse(if_updated_at) !== Date.parse(w.updated_at)) {
          return { ok: false, code: "word_conflict", message: "This word changed since.", details: { reason: "stale", word: pub(w) } };
        }
        const next = { ...w };
        for (const [k, v] of Object.entries(patch)) {
          if (k === "id" || k === "native_key" || k === "created_at" || k === "updated_at" || k === "base_lang") continue;
          next[k] = k === "forms" ? v.map(Merge.form) : v;
        }
        if (Object.hasOwn(patch, "pronunciation") && patch.pronunciation === null) {
          next.pronunciation_careful = null;
          next.pronunciation_source = null;
        } else if ((Object.hasOwn(patch, "pronunciation") || Object.hasOwn(patch, "pronunciation_careful")) && !Object.hasOwn(patch, "pronunciation_source")) {
          next.pronunciation_source = "user";
        }
        next.native_key = Merge.nativeKey(next.native);
        const changed = Object.keys(next).some((k) => JSON.stringify(next[k]) !== JSON.stringify(w[k]));
        if (!changed) return { ok: true, word: pub(w), unchanged: true };
        if (next.lang !== w.lang || next.native_key !== w.native_key || next.sense !== w.sense) {
          const other = await liveByNatural(words, [next.lang, next.native_key, next.sense ?? "", next.base_lang]);
          if (other && other.id !== w.id) return { ok: false, code: "word_conflict", message: "Another word already has that key.", details: { reason: "duplicate", other_id: other.id } };
        }
        next.updated_at = later(now(), w.updated_at);
        await request(words.put(next));
        return { ok: true, word: pub(next) };
      });
      if (res.ok && !res.unchanged) committed({ reason: "update", by });
      delete res.unchanged;
      return res;
    }

    // Tombstones a word; deleting a tombstone changes nothing.
    async function remove(id, { by = null } = {}) {
      const res = await tx("words", "readwrite", async ({ words }) => {
        const w = await request(words.get(id));
        if (!w || w.status === "pending") return { ok: false, code: "word_gone", message: "That word was already removed.", details: {} };
        if (w.deleted_at) return { ok: true, word: pub(w), unchanged: true };
        const at = later(now(), w.updated_at);
        const next = { ...w, deleted_at: at, updated_at: at };
        await request(words.put(next));
        return { ok: true, word: pub(next) };
      });
      if (res.ok && !res.unchanged) committed({ reason: "remove", by });
      delete res.unchanged;
      return res;
    }

    async function restore(id, { by = null } = {}) {
      const res = await tx("words", "readwrite", async ({ words }) => {
        const w = await request(words.get(id));
        if (!w) return { ok: false, code: "word_gone", message: "That word was already removed.", details: {} };
        if (!w.deleted_at) return { ok: true, word: pub(w), unchanged: true };
        if (now() - Date.parse(w.deleted_at) > RESTORE_DAYS * DAY) {
          return { ok: false, code: "word_gone", message: "That word was removed too long ago to restore.", details: { reason: "scrubbed" } };
        }
        const other = await liveByNatural(words, [w.lang, w.native_key, w.sense ?? "", w.base_lang]);
        if (other) return { ok: false, code: "word_conflict", message: "Another word already has that key.", details: { reason: "duplicate", other_id: other.id } };
        const next = { ...w, deleted_at: null, merged_into: null, updated_at: later(now(), w.updated_at) };
        await request(words.put(next));
        return { ok: true, word: pub(next) };
      });
      if (res.ok && !res.unchanged) committed({ reason: "restore", by });
      delete res.unchanged;
      return res;
    }

    // Replaces every live word with `records` (slice 07 records with their ids), in one
    // transaction: the server's view when words move from a server into this browser.
    // Tombstones are kept. Returns the number written.
    async function replaceAll(records) {
      const n = await tx("words", "readwrite", async ({ words }) => {
        const existing = await request(words.getAll());
        for (const w of existing) if (!w.deleted_at) await request(words.delete(w.id));
        const t = now();
        let written = 0;
        const seen = new Set();
        for (const r of records) {
          if (!r || typeof r.id !== "string" || seen.has(r.id)) continue;
          seen.add(r.id);
          const rec = { ...record(r, { id: r.id, nowMs: t, origin: r.origin ?? "import", status: r.status }), created_at: r.created_at ?? iso(t), updated_at: r.updated_at ?? iso(t) };
          await request(words.put(rec));
          written++;
        }
        return written;
      });
      committed({ reason: "replace" });
      return n;
    }

    // Migration step 3: the cached page list (0.2 shape) as records, so pages keep working
    // at once. Each gets a new UUIDv7, `serverId` = the old id, the cached `english` as
    // `gloss` and base "en". Words already seeded (by serverId or natural key) are skipped.
    async function seed(cached) {
      const n = await tx("words", "readwrite", async ({ words }) => {
        const existing = await request(words.getAll());
        const ids = new Set(existing.filter((w) => w.serverId !== undefined).map((w) => String(w.serverId)));
        const t = now();
        let written = 0;
        for (const [i, c] of (Array.isArray(cached) ? cached : []).entries()) {
          if (!c || typeof c.native !== "string" || typeof c.lang !== "string") continue;
          if (c.id !== undefined && ids.has(String(c.id))) continue;
          const base = typeof c.base_lang === "string" && c.base_lang ? c.base_lang : "en";
          const gloss = c.gloss ?? c.english ?? (Array.isArray(c.forms) ? (typeof c.forms[0] === "string" ? c.forms[0] : c.forms[0]?.text) : null);
          if (typeof gloss !== "string" || !gloss.trim()) continue;
          if (await liveByNatural(words, [c.lang, Merge.nativeKey(c.native), c.sense ?? "", base])) continue;
          // The cache is newest first; keep that order (the matcher prefers newer words).
          const rec = record({ ...c, base_lang: base, gloss, id: undefined, serverId: c.id, status: null }, { id: uuid7(t), nowMs: t - i, origin: "migrated" });
          await request(words.put(rec));
          written++;
        }
        return written;
      });
      if (n) committed({ reason: "seed" });
      return n;
    }

    // Restores a backup's checked words (slice 12 section 5, lib/backup.js) in one
    // transaction, so pages update once: the plan is made against the records as they are
    // inside it. Keeps what each write replaced in meta `lastImport` for Undo (24 hours).
    // Returns {counts, items, restoreDeleted, written}.
    async function importWords(fileWords, { restoreDeleted = null, by = null, label = null } = {}) {
      const Backup = globalThis.KotikoBackup;
      const out = await tx(["words", "meta"], "readwrite", async ({ words, meta: m }) => {
        const existing = (await request(words.getAll())).map(pub);
        const t = now();
        const p = Backup.plan(fileWords, existing, { restoreDeleted, now: t });
        const live = existing.filter((w) => !w.deleted_at && w.status !== "pending").length;
        const added = p.writes.filter((x) => !x.previous || x.previous.deleted_at).length;
        if (added && live + added > MAX_VOCABULARY) throw codedError("vocabulary_full", `At most ${MAX_VOCABULARY} words.`, { max: MAX_VOCABULARY });
        for (const { record: r } of p.writes) await request(words.put({ ...r, native_key: Merge.nativeKey(r.native) }));
        if (p.writes.length) {
          const writes = p.writes.map(({ record: r, previous }) => ({ id: r.id, updated_at: r.updated_at, previous: previous ? { ...previous, native_key: Merge.nativeKey(previous.native) } : null }));
          await request(m.put({ key: "lastImport", value: { at: t, label, counts: p.counts, writes } }));
        }
        return { counts: p.counts, items: p.items, restoreDeleted: p.restoreDeleted, written: p.writes.length };
      });
      if (out.written) committed({ reason: "import", by });
      return out;
    }

    // Undoes the last import within 24 hours: records it created are removed, records it
    // changed get their previous version back. A record changed again since is left alone
    // and counted in `changed`.
    async function undoImport({ by = null, maxAgeMs = DAY } = {}) {
      const out = await tx(["words", "meta"], "readwrite", async ({ words, meta: m }) => {
        const last = (await request(m.get("lastImport")))?.value;
        if (!last || now() - last.at > maxAgeMs) return { ok: false, code: "nothing_to_undo", undone: 0, changed: 0 };
        let undone = 0;
        let changed = 0;
        for (const wr of last.writes) {
          const cur = await request(words.get(wr.id));
          if (!cur || cur.updated_at !== wr.updated_at) {
            changed++;
            continue;
          }
          if (wr.previous) await request(words.put(wr.previous));
          else await request(words.delete(wr.id));
          undone++;
        }
        await request(m.delete("lastImport"));
        return { ok: true, undone, changed };
      });
      if (out.undone) committed({ reason: "undo-import", by });
      return out;
    }

    const secrets = {
      get: async (id) => (await tx("secrets", "readonly", ({ secrets: s }) => request(s.get(id))))?.value ?? null,
      set: (id, value) => tx("secrets", "readwrite", ({ secrets: s }) => request(s.put({ id, value }))),
      remove: (id) => tx("secrets", "readwrite", ({ secrets: s }) => request(s.delete(id))),
      ids: () => tx("secrets", "readonly", ({ secrets: s }) => request(s.getAllKeys())),
    };

    const meta = {
      get: async (key) => (await tx("meta", "readonly", ({ meta: m }) => request(m.get(key))))?.value ?? null,
      set: (key, value) => tx("meta", "readwrite", ({ meta: m }) => request(m.put({ key, value }))),
      remove: (key) => tx("meta", "readwrite", ({ meta: m }) => request(m.delete(key))),
      // Every row whose key starts with `prefix` (lib/settings.js keeps one per setting).
      entries: (prefix) => tx("meta", "readonly", ({ meta: m }) => request(m.getAll(globalThis.IDBKeyRange.bound(prefix, `${prefix}￿`)))),
      // Rows put and removed in one transaction.
      write: (puts, deletes) =>
        tx("meta", "readwrite", async ({ meta: m }) => {
          for (const row of puts) await request(m.put(row));
          for (const key of deletes) await request(m.delete(key));
        }),
    };

    // The lookup cache (slice 10 section 5): checked results only, 30 days, the 5,000 used
    // most recently.
    const cache = {
      async get(key) {
        return tx("lookupCache", "readwrite", async ({ lookupCache: c }) => {
          const row = await request(c.get(key));
          if (!row) return null;
          if (now() - row.created_at > CACHE.ttl_days * DAY) {
            await request(c.delete(key));
            return null;
          }
          await request(c.put({ ...row, used_at: now() }));
          return row.value;
        });
      },
      put: (key, value, model = null) => tx("lookupCache", "readwrite", ({ lookupCache: c }) => request(c.put({ key, value, model, created_at: now(), used_at: now() }))),
      async prune() {
        return tx("lookupCache", "readwrite", async ({ lookupCache: c }) => {
          const rows = await request(c.index("used_at").getAll());
          const t = now();
          let removed = 0;
          const keep = rows.length - CACHE.max_entries;
          for (const [i, row] of rows.entries()) {
            if (i < keep || t - row.created_at > CACHE.ttl_days * DAY) {
              await request(c.delete(row.key));
              removed++;
            }
          }
          return removed;
        });
      },
    };

    // The add jobs already applied (slice 24's idempotency ledger), pruned after 7 days.
    async function pruneJobs(maxAgeMs = 7 * DAY) {
      return tx("jobs", "readwrite", async ({ jobs }) => {
        const rows = await request(jobs.getAll());
        for (const r of rows) if (now() - Date.parse(r.at) > maxAgeMs) await request(jobs.delete(r.id));
      });
    }

    return {
      db,
      tx,
      upsertByNatural,
      get,
      list,
      all,
      count,
      changesSince,
      recentLangs,
      update,
      remove,
      restore,
      replaceAll,
      seed,
      importWords,
      undoImport,
      pruneJobs,
      secrets,
      meta,
      cache,
      onCommit(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      close: () => db.close(),
    };
  }

  // Deletes the database and everything in it (words, tombstones, secrets, jobs, cache).
  // Every connection must be closed first; one still open (an older page) blocks it, and
  // after `timeoutMs` that is an error rather than a wait forever.
  function wipe({ indexedDB = globalThis.indexedDB, name = DB_NAME, timeoutMs = 10_000 } = {}) {
    return new Promise((resolve, reject) => {
      if (!indexedDB?.deleteDatabase) return reject(codedError("storage_full", "IndexedDB isn't available here.", { reason: "no_indexeddb" }));
      const timer = setTimeout(() => reject(codedError("storage_full", "The word store is still open somewhere.", { reason: "blocked" })), timeoutMs);
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = () => {
        clearTimeout(timer);
        resolve(true);
      };
      r.onerror = () => {
        clearTimeout(timer);
        reject(codedError("storage_full", String(r.error?.message ?? r.error), { reason: r.error?.name ?? "delete_failed" }));
      };
    });
  }

  const api = { open, openDb, wipe, uuid7, pub, DB_NAME, DB_VERSION, MAX_VOCABULARY };
  globalThis.KotikoStore = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
