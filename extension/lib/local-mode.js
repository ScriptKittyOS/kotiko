// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Local-first mode (slice 11): the settings that say where words live and who looks them
// up, the one-time upgrade of existing installs, the "native = meaning" manual add, and
// the background's word routes over the extension's own store. No DOM, so it runs in the
// background (globalThis.KotikoLocal) and in Node tests (module.exports).
//
// Settings (storage.local is the working copy; slice 39 syncs the non-secret ones):
//   wordsHome   "local" (this browser keeps the words) | "server" (a Kotiko server does)
//   lookup      {kind: "provider" | "server" | "none", provider, baseUrl, model, dataCollection}
//   server      {url}                      the token is a secret, never here
//   keys        {server: bool, providers: {id: bool}}  which secrets exist (no key material)
//
//   await KotikoLocal.readSettings(storage)
//   await KotikoLocal.migrate({ store, storage, uiLanguage })   idempotent; meta.schema = 1
//   KotikoLocal.parseManual("犬 = perro")    -> {native, gloss, romanization, pronunciation}
//   KotikoLocal.createLocalWordHandlers({...}) -> MessageRouter handlers (words.*, job.refresh)
(() => {
  const SCHEMA = 1;
  const DEFAULT_SERVER = "http://localhost:4747";
  const DEFAULT_LOOKUP = { kind: "none", provider: "openrouter", baseUrl: null, model: null, dataCollection: "allow" };
  const DELETED_DAYS = 30;
  const DAY = 86_400_000;

  const Lang = () => globalThis.KotikoLang;
  const WordSpec = () => globalThis.KotikoWordSpec;
  const coded = (code, message, details = {}) => Object.assign(new Error(message), { code, details });

  async function readSettings(storage) {
    const s = await storage.get({ wordsHome: null, lookup: null, server: null, keys: null });
    return {
      wordsHome: s.wordsHome === "server" ? "server" : s.wordsHome === "local" ? "local" : null,
      lookup: { ...DEFAULT_LOOKUP, ...(s.lookup && typeof s.lookup === "object" ? s.lookup : {}) },
      server: { url: typeof s.server?.url === "string" && s.server.url ? s.server.url : DEFAULT_SERVER },
      keys: { server: s.keys?.server === true, providers: { ...(s.keys?.providers ?? {}) } },
    };
  }

  // The learner's bases before slice 50 asks: the browser's language, as a base tag.
  function detectBases(uiLanguage) {
    const tag = Lang()?.baseTagOf?.(uiLanguage ?? "en") ?? "en";
    return [tag || "en"];
  }

  // Slice 11 section 8. Runs on install and update, and on any worker start until
  // meta.schema is set, so an interrupted run resumes. Every step is idempotent; no step
  // deletes a word.
  async function migrate({ store, storage, uiLanguage = "en", log = () => {} }) {
    if ((await store.meta.get("schema")) === SCHEMA) return { migrated: false };
    const legacy = await storage.get({ token: "", serverUrl: null, words: [], wordsHome: null, lookup: null, server: null, baseLangs: null, keys: null });
    const token = String(legacy.token ?? "").trim();
    const patch = {};
    // Step 2: a token means today's setup: words on that server, which also looks them up.
    if (token) {
      await store.secrets.set("server", token);
      patch.server = { url: String(legacy.serverUrl ?? "").trim() || legacy.server?.url || DEFAULT_SERVER };
      patch.wordsHome = "server";
      patch.lookup = { ...DEFAULT_LOOKUP, ...(legacy.lookup ?? {}), kind: "server" };
    } else if (!legacy.wordsHome) {
      patch.wordsHome = "local";
      patch.lookup = { ...DEFAULT_LOOKUP, ...(legacy.lookup ?? {}) };
      if (legacy.serverUrl) patch.server = { url: String(legacy.serverUrl).trim() || DEFAULT_SERVER };
    }
    const home = patch.wordsHome ?? legacy.wordsHome;
    // Step 3: the cached page list seeds the store so pages keep working at once.
    const seeded = await store.seed(Array.isArray(legacy.words) ? legacy.words : []);
    // Step 5: bases for words kept in this browser. A server install keeps today's behaviour
    // (the dashboard reads the bases its words have); seeded words were looked up for English
    // pages, so "en" joins the bases and swaps never silently stop.
    if (home === "local") {
      let bases = Array.isArray(legacy.baseLangs) && legacy.baseLangs.length ? legacy.baseLangs : detectBases(uiLanguage);
      if (seeded && !bases.includes("en")) bases = [...bases, "en"];
      if (JSON.stringify(bases) !== JSON.stringify(legacy.baseLangs)) patch.baseLangs = bases;
    }
    const keys = { server: !!token || legacy.keys?.server === true, providers: { ...(legacy.keys?.providers ?? {}) } };
    patch.keys = keys;
    await storage.set(patch);
    // Step 6: the token and address leave the area content scripts can read.
    await storage.remove(["token", "serverUrl"]);
    await store.meta.set("schema", SCHEMA);
    await store.meta.set("migratedFrom", token ? "server" : legacy.words?.length ? "cache" : "new");
    log(`Kotiko storage ready (${home}; ${seeded} cached word(s) kept)`);
    return { migrated: true, home, seeded };
  }

  // ── "native = meaning" (slice 24 section 7's inline syntax) ─────────────

  const SEPARATOR = /^(.+?)\s*(?:=|\t|\s[—–-]\s)\s*(.+)$/u;
  const RESPELLING = /^[\p{L}\p{M}' ]+(?:-[\p{L}\p{M}' ]+)+$|\p{Lu}{2,}/u;

  function parseManual(text) {
    const m = SEPARATOR.exec(String(text ?? "").trim());
    if (!m) return null;
    let native = m[1].trim();
    const gloss = m[2].trim();
    let romanization = null;
    let pronunciation = null;
    const paren = /^(.+?)\s*\(([^()]+)\)$/u.exec(native);
    if (paren) {
      native = paren[1].trim();
      if (RESPELLING.test(paren[2].trim())) pronunciation = paren[2].trim();
      else romanization = paren[2].trim();
    }
    if (!native || !gloss || [...native].length > 64 || [...gloss].length > 64 || /[=\n]/.test(gloss)) return null;
    return { native, gloss, romanization, pronunciation };
  }

  // A language for a manual word from its letters alone, for scripts one language owns in
  // practice. Latin and the like return null: the hint or a recent language decides.
  const SCRIPT_LANGS = [
    [/[\p{Script=Hiragana}\p{Script=Katakana}]/u, "ja"],
    [/\p{Script=Hangul}/u, "ko"],
    [/\p{Script=Han}/u, "zh"],
    [/\p{Script=Greek}/u, "el"],
    [/\p{Script=Hebrew}/u, "he"],
    [/\p{Script=Thai}/u, "th"],
    [/\p{Script=Georgian}/u, "ka"],
    [/\p{Script=Armenian}/u, "hy"],
    [/\p{Script=Devanagari}/u, "hi"],
    [/\p{Script=Arabic}/u, "ar"],
    [/\p{Script=Cyrillic}/u, "ru"],
  ];

  // The word's language (24 §7): the hint, else the most recent language whose script
  // fits, else the script's usual language. Never the meaning's base.
  function manualLang(native, { hintLang = null, recent = [], base }) {
    const fits = (tag) => {
      const c = Lang().canonical(tag);
      if (!c.ok) return null;
      const s = Lang().checkScript(c.tag, native);
      return s.ok && !Lang().sameBase(s.tag, base) ? s.tag : null;
    };
    if (hintLang) return fits(hintLang);
    for (const r of recent) {
      const t = fits(r);
      if (t && Lang().checkScript(r, native).tag === r && hasOwnScript(r, native)) return t;
    }
    for (const [re, tag] of SCRIPT_LANGS) if (re.test(native)) return fits(tag);
    return null;
  }

  // True when `native` has letters of the tag's own script (Latin text fits any tag whose
  // script check passes, so a recent Latin-script language only claims Latin words).
  function hasOwnScript(tag, native) {
    const latin = /\p{Script=Latin}/u.test(native);
    const nonLatin = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(native);
    const entry = globalThis.KOTIKO_SPEC?.languages?.languages?.[tag.split("-")[0]];
    const script = tag.split("-").find((p) => /^[A-Z][a-z]{3}$/.test(p)) ?? entry?.script ?? null;
    return script === "Latn" ? latin && !nonLatin : nonLatin;
  }

  // A manual word as a checked slice 07 word, or null when it can't be saved without a
  // lookup (no language found, or it would be its own meaning).
  function manualWord(parsed, { lang, base, text }) {
    if (!lang || !base) return null;
    const clean = WordSpec().clean;
    const native = clean(parsed.native);
    const gloss = clean(parsed.gloss);
    if (!native || !gloss) return null;
    const { word } = WordSpec().checkWord({
      lang,
      native,
      base_lang: base,
      sense: "",
      gloss,
      forms: [{ text: gloss, enabled: true, case: "any", ambiguous: false }],
      romanization: parsed.romanization ? clean(parsed.romanization) : null,
      pronunciation: parsed.pronunciation ? clean(parsed.pronunciation) : null,
      pronunciation_careful: null,
      pronunciation_source: parsed.pronunciation ? "user" : null,
      native_vocalized: null,
      note: null,
    });
    return { ...word, origin: "manual", source_text: text, status: "active" };
  }

  // ── the background's word routes over the store (slice 21's protocol) ────

  const isId = (v) => typeof v === "string" && v.length > 0 && v.length <= 64;
  const FIELDS = ["lang", "native", "sense", "romanization", "native_vocalized", "gloss", "forms", "pronunciation", "pronunciation_careful", "pronunciation_source", "note", "status"];
  const MAX = () => globalThis.KOTIKO_SPEC?.rules ?? { max_native_chars: 64, max_gloss_chars: 64, max_romanization_chars: 64, max_note_chars: 200, max_forms: 10 };
  const invalid = (field, reason) => ({ ok: false, code: "invalid_word", message: "That change isn't a valid word.", details: { field, reason } });

  // Checks a patch the way Kotiko.WordSpec.patch/1 and Words.update/3 do. Returns
  // {patch} with cleaned values, or a failure.
  function checkPatch(word, raw) {
    const clean = WordSpec().clean;
    const out = {};
    for (const f of FIELDS) {
      if (!Object.hasOwn(raw, f)) continue;
      const v = raw[f];
      switch (f) {
        case "lang": {
          const c = Lang().canonical(v);
          if (!c.ok) return invalid("lang", c.code);
          out.lang = c.tag;
          break;
        }
        case "native":
        case "gloss": {
          const s = clean(v);
          if (!s) return invalid(f, "missing_field");
          if ([...s].length > (f === "native" ? MAX().max_native_chars : MAX().max_gloss_chars)) return invalid(f, "too_long");
          out[f] = s;
          break;
        }
        case "sense":
          out.sense = clean(v) ?? "";
          break;
        case "romanization": {
          const r = clean(v);
          if (r && !/^[\p{Script=Latin}\p{M}0-9'’ʻʼ .·-]+$/u.test(r)) return invalid(f, "bad_romanization");
          if (r && [...r].length > MAX().max_romanization_chars) return invalid(f, "too_long");
          out.romanization = r;
          break;
        }
        case "forms": {
          if (!Array.isArray(v)) return invalid(f, "bad_value");
          const forms = v.map(globalThis.KotikoWordMerge.form).filter((x) => x.text && x.text.trim());
          if (!forms.length || !forms.some((x) => x.enabled)) return invalid(f, "no_usable_forms");
          out.forms = forms.slice(0, Math.max(MAX().max_forms, word.forms?.length ?? 0));
          break;
        }
        case "pronunciation_source":
          if (![null, "model", "user"].includes(v)) return invalid(f, "bad_value");
          out[f] = v;
          break;
        case "status":
          if (v !== "active" && v !== "paused") return invalid(f, "bad_value");
          out.status = v;
          break;
        case "note":
          out.note = clean(v);
          break;
        default:
          if (v !== null && typeof v !== "string") return invalid(f, "bad_value");
          out[f] = clean(v);
      }
    }
    const after = { ...word, ...out };
    if (Object.hasOwn(out, "lang") || Object.hasOwn(out, "native")) {
      const s = Lang().checkScript(after.lang, after.native);
      if (!s.ok) return invalid("lang", "script_mismatch");
      if (s.tag !== after.lang) {
        out.lang = s.tag;
        after.lang = s.tag;
      }
    }
    if (Lang().sameBase(after.lang, after.base_lang)) return invalid("lang", "target_is_base");
    const pron = ["pronunciation", "pronunciation_careful", "native_vocalized"].filter((k) => Object.hasOwn(out, k));
    if (pron.length) {
      const { dropped_fields: dropped } = WordSpec().checkWord(after);
      const bad = dropped.find((d) => pron.includes(d.field));
      if (bad) return invalid(bad.field, bad.reason);
    }
    return { patch: out };
  }

  // A word a page sends to save (a preview candidate, maybe edited): checked like the
  // server's structured add (Kotiko.WordSpec.validate_word/2), never like a model answer.
  function checkSaved(w, origin) {
    if (!w || typeof w !== "object") return { error: "not_an_object" };
    const clean = WordSpec().clean;
    const c = Lang().canonical(w.lang);
    if (!c.ok) return { error: c.code };
    const base = Lang().baseTagOf(w.base_lang);
    if (!base) return { error: "invalid_lang" };
    const native = clean(w.native);
    const gloss = clean(w.gloss);
    if (!native || !gloss) return { error: "missing_field" };
    if ([...native].length > MAX().max_native_chars || [...gloss].length > MAX().max_gloss_chars) return { error: "too_long" };
    const s = Lang().checkScript(c.tag, native);
    if (!s.ok) return { error: "script_mismatch" };
    if (Lang().sameBase(s.tag, base)) return { error: "target_is_base" };
    const forms = (Array.isArray(w.forms) && w.forms.length ? w.forms : [gloss]).map(globalThis.KotikoWordMerge.form).filter((f) => f.text && f.text.trim());
    const { word, dropped_fields } = WordSpec().checkWord({
      lang: s.tag,
      native,
      base_lang: base,
      sense: clean(w.sense) ?? "",
      gloss,
      forms: forms.length ? forms.slice(0, MAX().max_forms) : [{ text: gloss }],
      romanization: clean(w.romanization),
      native_vocalized: clean(w.native_vocalized),
      pronunciation: clean(w.pronunciation),
      pronunciation_careful: clean(w.pronunciation_careful),
      pronunciation_source: ["model", "user"].includes(w.pronunciation_source) ? w.pronunciation_source : w.pronunciation ? "model" : null,
      note: clean(w.note),
    });
    return { word: { ...word, id: isId(w.id) ? w.id : undefined, status: w.status === "paused" ? "paused" : "active", origin: typeof w.origin === "string" ? w.origin : origin, source_text: clean(w.source_text) }, dropped_fields };
  }

  function createLocalWordHandlers({ store, client, storage, refresh, now = () => Date.now(), from = ["page"], afterWrite = () => {} }) {
    const failure = (e) => ({ ok: false, code: typeof e?.code === "string" ? e.code : "internal", message: String(e?.message ?? e ?? ""), details: e?.details && typeof e.details === "object" ? e.details : {} });
    const version = (clientId) => storage.set({ wordsVersion: { at: now(), by: typeof clientId === "string" ? clientId : null } });

    async function runOp(op, by) {
      try {
        if (op.op === "delete") return await store.remove(op.id, { by });
        if (op.op === "restore") return await store.restore(op.id, { by });
        const word = await store.get(op.id);
        if (!word || word.deleted_at || word.status === "pending") return { ok: false, code: "word_gone", message: "That word was already removed.", details: {} };
        const checked = checkPatch(word, op.patch);
        if (!checked.patch) return checked;
        return await store.update(op.id, checked.patch, { if_updated_at: typeof op.if_updated_at === "string" ? op.if_updated_at : null, by });
      } catch (e) {
        return failure(e);
      }
    }

    return {
      "words.list": {
        from,
        async run() {
          return { words: await store.list(), cursor: null };
        },
      },
      "words.write": {
        from,
        check: (msg) => globalThis.KotikoWordsV1?.checkOps?.(msg) ?? null,
        async run(msg) {
          const by = typeof msg.clientId === "string" ? msg.clientId : null;
          const results = [];
          for (const op of msg.ops) results.push(await runOp(op, by));
          if (results.some((r) => r.ok)) {
            await version(by);
            Promise.resolve().then(afterWrite).catch(() => {});
          }
          return { results };
        },
      },
      // Tombstones of the last 30 days, oldest first, in the shape of the server mode's list.
      "words.deleted": {
        from,
        async run() {
          const t = now();
          const entries = (await store.all())
            .filter((w) => w.deleted_at && t - Date.parse(w.deleted_at) < DELETED_DAYS * DAY && w.native)
            .sort((a, b) => (a.deleted_at < b.deleted_at ? -1 : 1))
            .map((w) => ({ id: w.id, at: Date.parse(w.deleted_at), word: w }));
          return { entries };
        },
      },
      // Look up, save nothing: the page saves the candidates the learner keeps.
      "words.preview": {
        from,
        check: (msg) =>
          typeof msg.text !== "string" || !msg.text.trim() || [...msg.text].length > 200
            ? "text must be 1 to 200 characters"
            : !Array.isArray(msg.base_langs) || !msg.base_langs.length || msg.base_langs.length > 4
              ? "base_langs must list 1 to 4 languages"
              : null,
        async run(msg) {
          const hint = typeof msg.hint_lang === "string" ? msg.hint_lang : null;
          const recent = await store.recentLangs(5);
          // "native = meaning" never asks a model (slice 24 section 7).
          const parsed = parseManual(msg.text);
          const lang = parsed ? manualLang(parsed.native, { hintLang: hint, recent, base: msg.base_langs[0] }) : null;
          const manual = lang ? manualWord(parsed, { lang, base: msg.base_langs[0], text: msg.text }) : null;
          if (manual) return { candidates: [{ ...manual, language: Lang().endonym(manual.lang) }], rejected: [], dropped_forms: [], dropped_fields: [], missing_bases: [] };
          const r = await client.lookup({ text: msg.text, base_langs: msg.base_langs, hint_lang: hint, recent });
          if (!r.ok) throw coded(r.error.code, r.error.code, r.error.details ?? {});
          const res = r.result;
          const candidates = res.words.map((w) => ({ ...w, status: "active", origin: "add", language: Lang().endonym(w.lang) }));
          const out = { candidates, rejected: res.rejected ?? [], dropped_forms: res.dropped_forms ?? [], dropped_fields: res.dropped_fields ?? [], missing_bases: res.missing_bases ?? [] };
          if (res.code) out.code = res.code;
          if (res.reply) out.reply = res.reply;
          return out;
        },
      },
      "words.save": {
        from,
        check: (msg) =>
          !Array.isArray(msg.words) || !msg.words.length || msg.words.length > 500 || msg.words.some((w) => !w || typeof w !== "object")
            ? "words must be 1 to 500 word objects"
            : null,
        async run(msg) {
          const origin = msg.words.length === 1 ? "manual" : "bulk";
          const checked = msg.words.map((w, i) => ({ i, ...checkSaved(w, w.origin ?? origin) }));
          const valid = checked.filter((c) => c.word);
          const rejected = checked.filter((c) => c.error).map((c) => ({ index: c.i, native: msg.words[c.i]?.native ?? null, reason: c.error }));
          const by = typeof msg.clientId === "string" ? msg.clientId : null;
          const crid = typeof msg.client_request_id === "string" ? msg.client_request_id : null;
          const explicit = valid.every((c) => ["add", "manual", "telegram"].includes(c.word.origin));
          const { results } = valid.length ? await store.upsertByNatural(valid.map((c) => c.word), { explicit, jobId: crid, by }) : { results: [] };
          if (valid.some((c) => !c.word.pronunciation)) refresh?.nudge?.().catch?.(() => {});
          await version(by);
          Promise.resolve().then(afterWrite).catch(() => {});
          return { results: results.map((r, k) => ({ ...r, index: valid[k]?.i ?? k })), rejected, dropped_fields: [] };
        },
      },
      "job.refresh": {
        from,
        check: (msg) => (msg.action === undefined || msg.action === "pause" || msg.action === "resume" ? null : "action must be pause or resume"),
        async run(msg) {
          return msg.action ? refresh.control(msg.action) : refresh.status();
        },
      },
    };
  }

  const api = { SCHEMA, DEFAULT_LOOKUP, DEFAULT_SERVER, readSettings, detectBases, migrate, parseManual, manualLang, manualWord, checkPatch, checkSaved, createLocalWordHandlers };
  globalThis.KotikoLocal = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
