// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Kotiko's JSON backup (slice 12 sections 2 and 5): the document, reading one back (any
// older schema version, every word checked), and what restoring it would do against the
// words already here. Pure, no DOM or extension APIs: the background (globalThis.
// KotikoBackup, for the restore and its undo) and the dashboard (on first use) load the
// same file, and Node tests require it.
//
//   B.exportDoc({ words, settings, stats, version, source, now })  -> the section 2 document
//   B.read(textOrObject, { now })   -> { ok, code } | { ok, words, invalid, dropped, ... }
//   B.plan(fileWords, existing, { restoreDeleted, now })  -> { items, counts, writes }
//   B.settingsOf({ local, sync })   -> the non-secret settings a backup carries
//   B.settingsPatch(settings)       -> { local, sync } to write when restoring them
//
// Merge rules (section 5): the same id, the newer `updated_at` wins as a whole (an older
// backup never undoes a later edit; a newer one brings its edits back); another id with
// the same natural key gets slice 07's additive merge (lib/word-merge.js) and keeps the
// local id; a local tombstone newer than the file's word is skipped unless the learner
// ticks "Also restore words you deleted"; anything else is inserted with the file's id.
(() => {
  const FORMAT = "kotiko.words";
  const SCHEMA_VERSION = 2;
  const MAX_BYTES = 20 * 1024 * 1024;
  const MAX_WORDS = 20_000;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
  const SOURCES = new Set(["model", "user", "wiktionary"]);
  const ORIGINS = new Set(["add", "manual", "telegram", "bulk", "import", "migrated"]);

  // Every slice 07 field, in the order the backup writes them.
  const FIELDS = ["id", "lang", "native", "base_lang", "sense", "gloss", "forms", "romanization", "native_vocalized", "pronunciation", "pronunciation_careful", "pronunciation_source", "note", "status", "origin", "source_text", "created_at", "updated_at", "deleted_at", "merged_into"];
  // What a word says (compared to tell "already identical"); ids, times and provenance aren't.
  const CONTENT = ["lang", "native", "base_lang", "sense", "gloss", "forms", "romanization", "native_vocalized", "pronunciation", "pronunciation_careful", "pronunciation_source", "note", "status"];
  // Fields the store keeps for itself, and `language` (output only, slice 08).
  const INTERNAL = new Set(["native_key", "serverId", "language"]);
  const TEXT = ["romanization", "native_vocalized", "pronunciation", "pronunciation_careful", "note", "source_text"];

  const Lang = () => globalThis.KotikoLang;
  const WordSpec = () => globalThis.KotikoWordSpec;
  const Merge = () => globalThis.KotikoWordMerge;
  const rules = () => globalThis.KOTIKO_SPEC?.rules ?? {};
  const cp = (s) => [...s].length;
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const iso = (ms) => new Date(ms).toISOString();

  // ── the document (section 2) ─────────────────────────────────────────

  // One record as the backup writes it: every 07 field (null when empty), then any field a
  // newer Kotiko added, so it survives a round trip; never the store's own bookkeeping.
  function wordOut(w) {
    const out = {};
    for (const f of FIELDS) out[f] = w[f] === undefined ? (f === "sense" ? "" : null) : w[f];
    out.forms = (Array.isArray(w.forms) ? w.forms : []).map((f) => Merge().form(f));
    out.deleted_at = null;
    for (const [k, v] of Object.entries(w)) if (!(k in out) && !INTERNAL.has(k) && v !== undefined) out[k] = v;
    return out;
  }

  // Every word that isn't deleted, in every status, in id order (stable diffs).
  function exportDoc({ words = [], settings = null, stats = null, version = "", source = "extension", now = Date.now() } = {}) {
    const doc = {
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: iso(now),
      app: { name: "Kotiko", version: String(version ?? ""), source },
      words: words
        .filter((w) => w && !w.deleted_at && w.status !== "pending")
        .map(wordOut)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    };
    if (settings && Object.keys(settings).length) doc.settings = settings;
    if (stats && Object.keys(stats).length) doc.stats = stats;
    return doc;
  }

  // UTF-8, no BOM, two-space indent so backups diff well.
  const stringify = (doc) => `${JSON.stringify(doc, null, 2)}\n`;

  // ── reading a backup (section 5, step 1) ─────────────────────────────

  const clean = (v) => (typeof v === "string" ? WordSpec().clean(v) : null);

  // One word of a file -> { word, dropped } or { error }. Version 1 words (and any word with
  // `english` but no `gloss`) were for English pages: `english` becomes the gloss and the
  // base "en". The pronunciation fields go through slice 09's checks; a bad one is dropped
  // from its word (counted), never the word.
  function checkWord(raw, { version }) {
    if (!isObj(raw)) return { error: "not_an_object" };
    if (raw.deleted_at) return { skip: true };
    if (raw.status === "pending") return { error: "pending" };
    const legacy = version < 2 || (raw.gloss == null && raw.english != null); // base-neutral-ok: version 1 backups
    const R = rules();
    const c = Lang().canonical(raw.lang);
    if (!c.ok) return { error: "bad_lang" };
    const base = legacy && raw.base_lang == null ? "en" : Lang().baseTagOf(raw.base_lang);
    if (!base) return { error: "bad_base_lang" };
    const native = clean(raw.native);
    if (!native || cp(native) > (R.max_native_chars ?? 64)) return { error: "bad_native" };
    const s = Lang().checkScript(c.tag, native);
    if (!s.ok) return { error: "script_mismatch" };
    if (Lang().sameBase(s.tag, base)) return { error: "target_is_base" };
    const gloss = clean(legacy ? raw.gloss ?? raw.english : raw.gloss); // base-neutral-ok: version 1 backups
    if (!gloss || cp(gloss) > (R.max_gloss_chars ?? 64)) return { error: "bad_gloss" };
    const seen = new Set();
    const forms = [];
    for (const f of Array.isArray(raw.forms) ? raw.forms : []) {
      const form = Merge().form(f);
      const text = clean(form.text);
      if (!text || cp(text) > (R.max_form_chars ?? 40) || seen.has(text.toLowerCase())) continue;
      seen.add(text.toLowerCase());
      forms.push({ ...form, text });
    }
    if (!forms.length) forms.push(Merge().form(gloss));
    const sense = typeof raw.sense === "string" ? clean(raw.sense) ?? "" : "";
    if (cp(sense) > (R.max_sense_chars ?? 64)) return { error: "bad_sense" };
    const dropped = [];
    const word = {
      id: typeof raw.id === "string" && UUID.test(raw.id) ? raw.id : null,
      lang: s.tag,
      native,
      base_lang: base,
      sense,
      gloss,
      forms: forms.slice(0, R.max_forms ?? 10),
    };
    for (const f of TEXT) word[f] = typeof raw[f] === "string" && raw[f] !== "" ? raw[f] : null;
    if (legacy) {
      word.pronunciation = null;
      word.pronunciation_careful = null;
    }
    if (word.note !== null && cp(word.note) > (R.max_note_chars ?? 200)) {
      word.note = null;
      dropped.push({ field: "note", reason: "too_long" });
    }
    // Restored as saved; a file from elsewhere that names no source gets "model" (unchecked).
    word.pronunciation_source = word.pronunciation === null || raw.pronunciation_source === null ? null : SOURCES.has(raw.pronunciation_source) ? raw.pronunciation_source : "model";
    // Slice 09's checks decide which pronunciation fields are bad; only those are dropped,
    // so everything that was fine when it was saved comes back exactly as it was.
    const checked = WordSpec().checkWord({ ...word });
    for (const d of checked.dropped_fields) {
      word[d.field] = null;
      if (d.field === "pronunciation") word.pronunciation_careful = null;
      dropped.push(d);
    }
    if (word.pronunciation === null) word.pronunciation_source = null;
    word.status = typeof raw.status === "string" && raw.status && raw.status.length <= 20 ? raw.status : "active";
    word.origin = ORIGINS.has(raw.origin) ? raw.origin : "import";
    word.created_at = typeof raw.created_at === "string" && ISO.test(raw.created_at) ? raw.created_at : null;
    word.updated_at = typeof raw.updated_at === "string" && ISO.test(raw.updated_at) ? raw.updated_at : word.created_at;
    word.deleted_at = null;
    word.merged_into = null;
    // A newer Kotiko's fields, kept as they are (slice 07's forward compatibility).
    for (const [k, v] of Object.entries(raw)) {
      if (!(k in word) && !INTERNAL.has(k) && k !== "english" && v !== undefined) word[k] = v; // base-neutral-ok: version 1 backups
    }
    return { word, dropped, legacy };
  }

  // Reads a backup: its text (or the parsed value). Errors: unreadable, not_backup,
  // backup_newer (refused, nothing changes), too_big, too_many.
  function read(input, { now = Date.now() } = {}) {
    let doc = input;
    if (typeof input === "string") {
      if (input.length > MAX_BYTES) return { ok: false, code: "too_big" };
      try {
        doc = JSON.parse(input.replace(/^\uFEFF/, ""));
      } catch {
        return { ok: false, code: "unreadable" };
      }
    }
    if (!isObj(doc) || (doc.format !== FORMAT && !("schemaVersion" in doc))) return { ok: false, code: "not_backup" };
    if (doc.format !== undefined && doc.format !== FORMAT) return { ok: false, code: "not_backup" };
    const version = doc.schemaVersion;
    if (!Number.isInteger(version) || version < 1) return { ok: false, code: "not_backup" };
    if (version > SCHEMA_VERSION) return { ok: false, code: "backup_newer", details: { version } };
    if (!Array.isArray(doc.words)) return { ok: false, code: "not_backup" };
    if (doc.words.length > MAX_WORDS) return { ok: false, code: "too_many", details: { max: MAX_WORDS, count: doc.words.length } };
    const words = [];
    const invalid = [];
    const dropped = [];
    let legacy = 0;
    const t = iso(now);
    doc.words.forEach((raw, index) => {
      const r = checkWord(raw, { version });
      if (r.skip) return;
      if (r.error) {
        invalid.push({ index, native: typeof raw?.native === "string" ? raw.native.slice(0, 64) : null, reason: r.error });
        return;
      }
      if (r.legacy) legacy++;
      r.word.created_at ??= t;
      r.word.updated_at ??= r.word.created_at;
      for (const d of r.dropped) dropped.push({ index, native: r.word.native, ...d });
      words.push(r.word);
    });
    return {
      ok: true,
      version,
      exportedAt: typeof doc.exportedAt === "string" ? doc.exportedAt : null,
      app: isObj(doc.app) ? { name: String(doc.app.name ?? ""), version: String(doc.app.version ?? ""), source: String(doc.app.source ?? "") } : null,
      total: doc.words.filter((w) => !(isObj(w) && w.deleted_at)).length,
      words,
      invalid,
      dropped,
      legacy,
      bases: [...new Set(words.map((w) => w.base_lang))],
      settings: isObj(doc.settings) ? doc.settings : null,
      stats: isObj(doc.stats) ? doc.stats : null,
    };
  }

  // ── what a restore would do (section 5, steps 2 and 3) ───────────────

  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const formsOf = (w) => (Array.isArray(w.forms) ? w.forms : []).map((f) => Merge().form(f));
  function contentEqual(a, b) {
    return CONTENT.every((f) => (f === "forms" ? same(formsOf(a), formsOf(b)) : f === "sense" ? (a.sense ?? "") === (b.sense ?? "") : same(a[f], b[f])));
  }
  const keyOf = (w) => JSON.stringify(Merge().naturalKey(w));
  const ms = (s) => {
    const n = Date.parse(s ?? "");
    return Number.isFinite(n) ? n : 0;
  };
  // updated_at only moves forward, by at least a millisecond (as the store's writes do).
  const later = (nowMs, prev) => iso(Math.max(nowMs, ms(prev) + 1));

  // The file's version of a word, as a record (its id, times and fields).
  const asRecord = (w, id) => ({ ...w, id, deleted_at: null, merged_into: null });

  // `existing`: every record here, tombstones too. Returns the items (one per file word:
  // create, restore, merge, identical, kept or skipped) and `writes`: the records to put,
  // each with the version it replaces (null for a new record), for the store's single
  // transaction and for Undo.
  function plan(fileWords, existing, { restoreDeleted = null, now = Date.now() } = {}) {
    const byId = new Map();
    const liveByKey = new Map();
    for (const r of existing) {
      byId.set(r.id, r);
      if (!r.deleted_at) liveByKey.set(keyOf(r), r);
    }
    const restoreAll = restoreDeleted ?? liveByKey.size === 0;
    const counts = { new: 0, merge: 0, identical: 0, kept: 0, deletedLater: 0, restoredDeleted: 0 };
    const items = [];
    const writes = new Map(); // id -> {record, previous}
    const put = (record, before) => {
      const prev = writes.has(record.id) ? writes.get(record.id).previous : before ?? null;
      writes.set(record.id, { record, previous: prev });
      byId.set(record.id, record);
      if (before && !before.deleted_at) liveByKey.delete(keyOf(before));
      if (!record.deleted_at) liveByKey.set(keyOf(record), record);
    };
    // 07's additive merge into a live word that has the natural key.
    const mergeInto = (target, w) => {
      const changes = Merge().changes(target, w, { explicit: false });
      if (!Object.keys(changes).length) return null;
      return { ...target, ...changes, updated_at: later(now, target.updated_at) };
    };

    for (const w of fileWords) {
      const local = w.id ? byId.get(w.id) : null;
      const holder = liveByKey.get(keyOf(w));
      if (local && !local.deleted_at) {
        if (contentEqual(local, w)) {
          items.push({ kind: "identical", id: local.id });
          counts.identical++;
        } else if (ms(w.updated_at) > ms(local.updated_at)) {
          // The backup is newer: its version wins, unless its key now belongs to another word.
          const next = holder && holder.id !== local.id ? { ...local, ...pick(w, CONTENT.filter((f) => !["lang", "native", "sense", "base_lang"].includes(f))) } : { ...local, ...pick(w, CONTENT) };
          next.updated_at = later(now, local.updated_at);
          put(next, local);
          items.push({ kind: "merge", id: local.id });
          counts.merge++;
        } else {
          items.push({ kind: "kept", id: local.id });
          counts.kept++;
        }
        continue;
      }
      if (local && local.deleted_at && ms(local.deleted_at) > ms(w.updated_at)) {
        counts.deletedLater++;
        if (!restoreAll) {
          items.push({ kind: "skipped", id: local.id });
          continue;
        }
        counts.restoredDeleted++;
      }
      if (holder) {
        const next = mergeInto(holder, w);
        if (next) {
          put(next, holder);
          items.push({ kind: "merge", id: holder.id });
          counts.merge++;
        } else {
          items.push({ kind: "identical", id: holder.id });
          counts.identical++;
        }
        continue;
      }
      // New here (or back over its own tombstone): the file's id when it is free.
      const id = w.id && (!byId.has(w.id) || byId.get(w.id).deleted_at) ? w.id : null;
      const rec = asRecord(w, id ?? globalThis.KotikoStore?.uuid7?.(now) ?? w.id);
      put(rec, id ? byId.get(id) ?? null : null);
      items.push({ kind: local ? "restore" : "create", id: rec.id });
      counts.new++;
    }
    const out = { items, counts, writes: [...writes.values()], restoreDeleted: restoreAll };
    if (globalThis.__KOTIKO_ASSERT__ === true) checkPlan(fileWords, out);
    return out;
  }

  // Assertion mode (test/helpers/assert-mode.mjs): what a restore plan promises the store's
  // one transaction and its Undo, checked under the tests only.
  function checkPlan(fileWords, { items, counts, writes }) {
    const fail = (what) => {
      throw new Error(`KotikoBackup.plan invariant: ${what}`);
    };
    if (items.length !== fileWords.length) fail(`${items.length} items for ${fileWords.length} words`);
    const kinds = {};
    for (const i of items) kinds[i.kind] = (kinds[i.kind] ?? 0) + 1;
    if ((kinds.create ?? 0) + (kinds.restore ?? 0) !== counts.new) fail("new words miscounted");
    for (const k of ["merge", "identical", "kept"]) if ((kinds[k] ?? 0) !== counts[k]) fail(`${k} miscounted`);
    if (counts.restoredDeleted > counts.deletedLater) fail("restored more deleted words than there were");
    const ids = new Set();
    for (const { record, previous } of writes) {
      if (typeof record.id !== "string" || !record.id) fail("a write has no id");
      if (ids.has(record.id)) fail(`${record.id} is written twice`);
      ids.add(record.id);
      if (previous && previous.id !== record.id) fail("a write replaces another word");
      if (record.deleted_at) fail("a restore writes a deleted word");
    }
  }

  function pick(w, fields) {
    const out = {};
    for (const f of fields) if (w[f] !== undefined) out[f] = w[f];
    return out;
  }

  // ── settings (section 2; slice 39's list, never a secret) ────────────

  const tags = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length <= 35).slice(0, 50) : undefined);
  // An address without user name, password, query or fragment.
  function bareUrl(v) {
    if (typeof v !== "string" || !v) return null;
    try {
      const u = new URL(v);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      u.username = "";
      u.password = "";
      u.search = "";
      u.hash = "";
      return u.toString().replace(/\/$/, "");
    } catch {
      return null;
    }
  }

  // From storage.local and storage.sync's `ui`. An allowlist: nothing else (no token, no
  // key, no word list) can reach a backup through here.
  function settingsOf({ local = {}, sync = {} } = {}) {
    const out = {};
    if (typeof local.enabled === "boolean") out.enabled = local.enabled;
    if (tags(local.pausedHosts)?.length) out.pausedHosts = local.pausedHosts.filter((h) => typeof h === "string" && h.length <= 253).slice(0, 500);
    if (tags(local.hiddenLangs)?.length) out.hiddenLangs = tags(local.hiddenLangs);
    for (const k of ["prefs", "mixing"]) if (isObj(local[k])) out[k] = JSON.parse(JSON.stringify(local[k]));
    if (isObj(local.speech)) out.speech = { allowOnline: local.speech.allowOnline === true, rate: typeof local.speech.rate === "number" ? local.speech.rate : undefined, voices: isObj(local.speech.voices) ? { ...local.speech.voices } : {} };
    if (typeof local.seedSalt === "string" && /^[0-9a-f]{32}$/.test(local.seedSalt)) out.seedSalt = local.seedSalt;
    if (isObj(local.lookup)) {
      const l = local.lookup;
      out.lookup = { provider: typeof l.provider === "string" ? l.provider : null, baseUrl: bareUrl(l.baseUrl), model: typeof l.model === "string" ? l.model.slice(0, 300) : null, dataCollection: l.dataCollection === "deny" ? "deny" : "allow" };
    }
    const server = bareUrl(local.server?.url);
    if (server) out.server = { url: server };
    const ui = isObj(sync.ui) ? sync.ui : {};
    const bases = tags(ui.baseLangs) ?? tags(local.baseLangs);
    if (bases?.length || typeof ui.uiLang === "string") out.ui = { ...(typeof ui.uiLang === "string" ? { uiLang: ui.uiLang } : {}), ...(bases?.length ? { baseLangs: bases.slice(0, 4) } : {}) };
    return out;
  }

  // What restoring a backup's settings writes. The lookup kind and provider, every address,
  // where words live and every secret stay as they are here.
  function settingsPatch(s, { current = {} } = {}) {
    const local = {};
    const sync = {};
    if (!isObj(s)) return { local, sync };
    if (typeof s.enabled === "boolean") local.enabled = s.enabled;
    for (const k of ["pausedHosts", "hiddenLangs"]) if (tags(s[k])) local[k] = tags(s[k]);
    for (const k of ["prefs", "mixing"]) if (isObj(s[k])) local[k] = { ...(isObj(current[k]) ? current[k] : {}), ...s[k] };
    if (isObj(s.speech)) local.speech = { ...(isObj(current.speech) ? current.speech : {}), ...settingsOf({ local: { speech: s.speech } }).speech };
    if (typeof s.seedSalt === "string" && /^[0-9a-f]{32}$/.test(s.seedSalt)) local.seedSalt = s.seedSalt;
    // Where requests go (the provider, its address, the server's address) is never taken
    // from a file: it is set in Kotiko's settings, which bind each key to its address
    // (slice 28). The model comes back only for the provider already chosen here.
    if (isObj(s.lookup) && isObj(current.lookup)) {
      const l = settingsOf({ local: { lookup: s.lookup } }).lookup;
      const model = l.provider && l.provider === current.lookup.provider && l.model ? { model: l.model } : {};
      local.lookup = { ...current.lookup, ...model, dataCollection: l.dataCollection };
    }
    if (isObj(s.ui)) {
      const bases = tags(s.ui.baseLangs)?.map((b) => Lang().baseTagOf(b)).filter(Boolean);
      if (bases?.length) {
        sync.baseLangs = [...new Set(bases)].slice(0, 4);
        local.baseLangs = sync.baseLangs;
      }
      if (typeof s.ui.uiLang === "string" && s.ui.uiLang.length <= 35) sync.uiLang = s.ui.uiLang;
    }
    return { local, sync };
  }

  const api = { FORMAT, SCHEMA_VERSION, MAX_BYTES, MAX_WORDS, FIELDS, CONTENT, exportDoc, stringify, read, checkWord, plan, contentEqual, settingsOf, settingsPatch, wordOut };
  globalThis.KotikoBackup = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
