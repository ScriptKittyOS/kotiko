// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The shared word spec (slice 09): input checks, the lookup and respell prompts, and the
// pipeline that turns a model's raw answer into checked words (extraction, normalisation,
// validation, whole-answer rules). Pure, no DOM or extension APIs. The data is spec/
// (rules.json, pronunciation.json, prompt.md, lang/), loaded from extension/spec/spec.js.
// server/lib/kotiko/word_spec.ex implements the same steps; the fixtures in spec/fixtures/
// hold both to the same output.
//
//   const ws = KotikoWordSpec;
//   ws.prepareInput("  как ")                 -> { ok: true, text: "как" }
//   ws.buildSystem({ base_langs: ["es"], mode: "add" })  -> the system prompt
//   ws.process({ text, mode: "add", base_langs: ["es"] }, rawModelContent)
//     -> { intent, words, rejected, dropped_forms, dropped_fields, missing_bases, reply, code }
(() => {
  function createWordSpec(spec, Lang) {
    const RULES = spec.rules;
    const PRON = spec.pronunciation;
    const LANGS = spec.languages.languages;
    const FOLDERS = spec.lang;
    const PROMPT = parsePrompt(spec.prompt);

    // ── text ───────────────────────────────────────────────────────────

    const str = (v) => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null);

    // NFC, invisible characters (U+200B, U+FEFF, U+00AD) removed, control characters and
    // whitespace runs as one space, trimmed. Blank is null. U+200C and U+200D stay.
    function clean(v) {
      const s = str(v);
      if (s === null) return null;
      const out = s
        .normalize("NFC")
        .replace(/[\u200B\uFEFF\u00AD]/g, "")
        .replace(/[\p{Cc}\s]+/gu, " ")
        .trim();
      return out === "" ? null : out;
    }

    const cpLen = (s) => [...s].length;
    const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
    const graphemes = (s) => Array.from(segmenter.segment(s), (x) => x.segment);
    const primary = (tag) => String(tag).split("-")[0];

    // Lowercase in the base's locale (Turkish and Azerbaijani dotless i), final sigma as σ.
    function fold(s, base) {
      const p = base ? primary(base) : "";
      const lower = p === "tr" || p === "az" ? s.toLocaleLowerCase("tr") : s.toLowerCase();
      return lower.replaceAll("ς", "σ");
    }

    // At most `max` code points, cut at a word boundary with "…".
    function truncate(s, max) {
      if (s === null || cpLen(s) <= max) return s;
      const cut = [...s].slice(0, max - 1).join("").replace(/\s+\S*$/u, "");
      return cut + "…";
    }

    const ROMANIAN = { "ş": "ș", "Ş": "Ș", "ţ": "ț", "Ţ": "Ț" };
    const romanian = (s) => (s === null ? s : s.replace(/[şŞţŢ]/g, (c) => ROMANIAN[c]));

    // Trailing .,!?;:。、！？ and leading ¿¡ (¿perro? is perro).
    const stripPunct = (s) => (s === null ? s : s.replace(/^[¿¡]+/u, "").replace(/[.,!?;:。、！？]+$/u, "").trim() || null);

    // ── A. input checks ────────────────────────────────────────────────

    function prepareInput(text) {
      if (typeof text !== "string") return { ok: false, code: "empty_input" };
      const t = text
        .normalize("NFC")
        .replace(/[\t\n\r\v\f]/g, " ")
        .replace(/\p{Cc}/gu, "")
        .trim();
      if (!t) return { ok: false, code: "empty_input" };
      if (cpLen(t) > RULES.max_input_chars) return { ok: false, code: "input_too_long" };
      return { ok: true, text: t };
    }

    // ── base-language data (slice 09 section 1) ────────────────────────

    const dataCache = new Map();
    // The folder for the base tag, then its language, then _generic, per file; no
    // fallback for respelling.json.
    function langData(base) {
      const key = String(base);
      if (dataCache.has(key)) return dataCache.get(key);
      const candidates = [key, primary(key)].filter((f, i, all) => all.indexOf(f) === i);
      const find = (kind, generic) => {
        for (const f of generic ? [...candidates, "_generic"] : candidates) {
          if (FOLDERS[f]?.[kind] !== undefined) return f;
        }
        return null;
      };
      const folders = {
        stopwords: find("stopwords", true),
        stem: find("stem", true),
        variants: find("variants", true),
        respelling: find("respelling", false),
      };
      const stem = FOLDERS[folders.stem].stem;
      const variantMap = new Map();
      for (const group of FOLDERS[folders.variants].variants.groups) {
        for (const v of group) variantMap.set(fold(v, key), fold(group[0], key));
      }
      const irregulars = new Map();
      for (const [form, lemmas] of Object.entries(stem.irregulars ?? {})) {
        irregulars.set(fold(form, key), (Array.isArray(lemmas) ? lemmas : [lemmas]).map((l) => fold(l, key)));
      }
      const data = {
        folders,
        stopwords: new Set(FOLDERS[folders.stopwords].stopwords.map((w) => fold(w, key))),
        stem,
        irregulars,
        variantMap,
        respelling: folders.respelling ? FOLDERS[folders.respelling].respelling : null,
      };
      dataCache.set(key, data);
      return data;
    }

    // ── relatedness (the как lesson) ────────────────────────────────────

    const tokens = (s) => s.split(/[^\p{L}\p{M}\p{N}'’]+/u).filter(Boolean);
    const stripAccents = (s) => s.normalize("NFD").replace(/[\u0301\u0308]/g, "").normalize("NFC");

    function candidates(word, data) {
      const out = new Set([word]);
      const addIrregular = (w) => (data.irregulars.get(w) ?? []).forEach((l) => out.add(l));
      addIrregular(word);
      const base = data.stem.strip_accents ? stripAccents(word) : word;
      if (base !== word) {
        out.add(base);
        addIrregular(base);
      }
      const len = graphemes(base).length;
      for (const rule of data.stem.suffixes ?? []) {
        if (!base.endsWith(rule.suffix)) continue;
        if (len - graphemes(rule.suffix).length < (rule.min ?? RULES.min_stem_graphemes)) continue;
        const root = base.slice(0, base.length - rule.suffix.length);
        for (const a of rule.add) out.add(root + a);
        const cps = [...root];
        if (rule.undouble && cps.length >= 2 && cps.at(-1) === cps.at(-2) && !/[aeiou]/.test(cps.at(-1))) {
          out.add(cps.slice(0, -1).join(""));
        }
        break;
      }
      for (const c of [...out]) if (data.variantMap.has(c)) out.add(data.variantMap.get(c));
      return out;
    }

    function related(form, gloss, base, data) {
      const f = fold(form, base);
      const g = fold(gloss, base);
      if (f === g) return true;
      if (data.stem.kind !== "suffix") {
        const gg = graphemes(g);
        const prefix = gg.slice(0, Math.min(RULES.generic_stem_graphemes, gg.length)).join("");
        return f.startsWith(prefix);
      }
      const glossStems = new Set();
      for (const t of tokens(g)) for (const c of candidates(t, data)) glossStems.add(c);
      const formTokens = tokens(f);
      if (!formTokens.length) return false;
      return formTokens.every((t) => [...candidates(t, data)].some((c) => glossStems.has(c)));
    }

    // ── forms ──────────────────────────────────────────────────────────

    const CASES = ["any", "lower", "exact", "proper"];
    function formOf(v) {
      if (typeof v === "string" || typeof v === "number") return { text: str(v), enabled: true, case: "any", ambiguous: false };
      if (v && typeof v === "object" && !Array.isArray(v)) {
        return {
          text: str(v.text),
          enabled: typeof v.enabled === "boolean" ? v.enabled : true,
          case: CASES.includes(v.case) ? v.case : "any",
          ambiguous: typeof v.ambiguous === "boolean" ? v.ambiguous : false,
        };
      }
      return null;
    }

    function rawForms(v) {
      if (typeof v === "string") return v.split(/[,;、，；\n]/u);
      if (Array.isArray(v)) return v;
      if (typeof v === "number") return [v];
      return [];
    }

    function baseScript(base) {
      const p = Lang.parse(base);
      if (p.error || p.private) return null;
      return p.script ?? LANGS[p.lang]?.script ?? null;
    }

    const FORM_CHARS = /^[\p{L}\p{M}\p{N} '’\-.+#·]+$/u;

    // ── D2. pronunciation and target-side fields ────────────────────────

    // The facts for a target: by the full tag, then the language when the tag names no
    // script; otherwise no scheme for Latin script and "unspecified" for any other.
    function targetFacts(tag) {
      const p = Lang.parse(tag);
      const lang = p.lang ?? null;
      const entry = PRON.targets[tag] ?? (p.script ? null : lang && PRON.targets[lang]);
      if (entry) return { stress_marked: false, neutral_tone: false, vowel_letters: "", ...entry };
      const script = p.script ?? (lang && LANGS[lang]?.script);
      return {
        romanization: script === "Latn" ? null : "unspecified",
        stress: "unknown",
        tones: null,
        vocalization_marks: [],
        stress_marked: false,
        neutral_tone: false,
        vowel_letters: "",
      };
    }

    const LATIN = /^[\p{Script=Latin}\p{M}0-9'’ʻʼ .·-]+$/u;

    const escapeClass = (s) => s.replace(/[\\\]^-]/g, "\\$&");
    const pronCharsCache = new Map();
    function pronChars(alphabet, tones) {
      const key = `${alphabet}|${!!tones}`;
      if (!pronCharsCache.has(key)) {
        const letters = escapeClass(alphabet.toLowerCase() + alphabet.toUpperCase());
        pronCharsCache.set(key, new RegExp(`^[${letters}${tones ? "0-9" : ""}' -]+$`, "u"));
      }
      return pronCharsCache.get(key);
    }

    function isCapital(syllable) {
      const letters = syllable.replace(/[^\p{L}]/gu, "");
      return letters !== "" && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
    }

    function validPronunciation(p, facts, key) {
      if (cpLen(p) > RULES.max_pronunciation_chars) return false;
      if (!pronChars(key.alphabet, facts.tones).test(p)) return false;
      if (/^[ -]|[ -]$|--| {2}| -|- /.test(p)) return false;
      for (const word of p.split(" ")) {
        const syllables = word.split("-");
        let capitals = 0;
        let digits = 0;
        for (const s of syllables) {
          const m = /^([^0-9]+)([0-9]?)$/u.exec(s);
          if (!m) return false;
          const letters = m[1];
          if (!/[^']/.test(letters)) return false;
          if (letters !== letters.toUpperCase() && letters !== letters.toLowerCase()) return false;
          if (m[2]) {
            const d = Number(m[2]);
            if (!facts.tones || d < facts.tones[0] || d > facts.tones[1]) return false;
            digits++;
          } else if (facts.tones && !facts.neutral_tone) {
            return false;
          }
          if (isCapital(letters)) capitals++;
        }
        if (facts.stress === "lexical" && capitals !== (syllables.length >= 2 ? 1 : 0)) return false;
        if (facts.stress === "none" && capitals) return false;
        if (facts.tones && facts.neutral_tone && syllables.length > 1 && digits === 0) return false;
      }
      return true;
    }

    const markRegex = (marks) =>
      new RegExp(
        `[${marks
          .map((m) =>
            m
              .split("-")
              .map((u) => `\\u{${u.replace(/^U\+/, "")}}`)
              .join("-"),
          )
          .join("")}]`,
        "gu",
      );

    function vocalizedOk(v, native, facts) {
      const stripped = v.replace(markRegex(facts.vocalization_marks), "");
      if (stripped !== native.normalize("NFC")) return false;
      if (facts.stress_marked) {
        for (const w of v.split(" ")) {
          if ((w.match(/\u0301/g) ?? []).length > 1) return false;
          if (/[ёЁ]\u0301/.test(w)) return false;
        }
      }
      return true;
    }

    // The fields of one entry, checked; returns the dropped list.
    function checkPronunciation(word, facts, key) {
      const dropped = [];
      const drop = (field, reason) => dropped.push({ field, reason });

      if (facts.romanization === null) word.romanization = null;
      else if (word.romanization !== null) {
        if (!LATIN.test(word.romanization)) {
          word.romanization = null;
          drop("romanization", "bad_romanization");
        } else if (cpLen(word.romanization) > RULES.max_romanization_chars) {
          word.romanization = null;
          drop("romanization", "too_long");
        }
      }

      if (!key || word.pronunciation === null) {
        word.pronunciation = null;
        word.pronunciation_careful = null;
      } else if (!validPronunciation(word.pronunciation, facts, key)) {
        word.pronunciation = null;
        word.pronunciation_careful = null;
        drop("pronunciation", "bad_pronunciation");
      } else if (word.pronunciation_careful !== null) {
        if (word.pronunciation_careful === word.pronunciation) word.pronunciation_careful = null;
        else if (!validPronunciation(word.pronunciation_careful, facts, key)) {
          word.pronunciation_careful = null;
          drop("pronunciation_careful", "bad_pronunciation");
        }
      }
      if (word.pronunciation === null) word.pronunciation_source = null;
      else if (word.pronunciation_source !== "user" && word.pronunciation_source !== "wiktionary") word.pronunciation_source = "model";

      if (word.native_vocalized !== null) {
        if (!facts.vocalization_marks.length) word.native_vocalized = null;
        else if (!vocalizedOk(word.native_vocalized, word.native, facts)) {
          word.native_vocalized = null;
          drop("native_vocalized", "bad_vocalized");
        }
      }
      return dropped;
    }

    // ru, uk, be: the capital syllable of the careful (or everyday) form and the vowel
    // carrying U+0301 must be the same, when the form has one syllable per vowel letter.
    function stressAgrees(word, facts) {
      const v = word.native_vocalized;
      const form = word.pronunciation_careful ?? word.pronunciation;
      if (!facts.stress_marked || v === null || form === null) return true;
      const vWords = v.split(" ");
      const fWords = form.split(" ");
      if (vWords.length !== fWords.length) return true;
      const vowels = new Set([...facts.vowel_letters]);
      return vWords.every((w, i) => {
        const syllables = fWords[i].split("-");
        let count = 0;
        let stressed = null;
        for (const c of w) {
          if (c === "\u0301") stressed ??= count - 1;
          else if (vowels.has(c)) count++;
        }
        if (syllables.length !== count) return true;
        const cap = syllables.findIndex(isCapital);
        return (cap === -1 ? null : cap) === stressed;
      });
    }

    // D2 for one word on its own (a structured word, a fixture): the fields, then the
    // stress agreement. Returns { word, dropped_fields }.
    function checkWord(input) {
      const word = {
        romanization: null,
        native_vocalized: null,
        pronunciation: null,
        pronunciation_careful: null,
        pronunciation_source: null,
        ...input,
      };
      const facts = targetFacts(word.lang);
      const dropped = checkPronunciation(word, facts, langData(word.base_lang).respelling);
      if (word.native_vocalized !== null && !stressAgrees(word, facts)) {
        word.native_vocalized = null;
        dropped.push({ field: "native_vocalized", reason: "stress_mismatch" });
      }
      return { word, dropped_fields: dropped };
    }

    // ── B. extraction ──────────────────────────────────────────────────

    // The JSON object in a model's content: the whole of it, or the first balanced {...}
    // that has `key` or `intent`. Null when there is none (unparseable).
    function extract(content, key = "words") {
      if (typeof content !== "string") return null;
      const text = content
        .replace(/<think>[\s\S]*?<\/think>/g, "")
        .replace(/```[A-Za-z]*/g, "")
        .trim();
      const parse = (s) => {
        try {
          const v = JSON.parse(s);
          return v && typeof v === "object" && !Array.isArray(v) ? v : null;
        } catch {
          return null;
        }
      };
      const whole = parse(text);
      if (whole) return whole;
      let start = text.indexOf("{");
      while (start !== -1) {
        let depth = 0;
        let inString = false;
        let end = -1;
        for (let i = start; i < text.length; i++) {
          const c = text[i];
          if (inString) {
            if (c === "\\") i++;
            else if (c === '"') inString = false;
          } else if (c === '"') inString = true;
          else if (c === "{") depth++;
          else if (c === "}" && --depth === 0) {
            end = i;
            break;
          }
        }
        if (end === -1) break;
        const obj = parse(text.slice(start, end + 1));
        if (obj && (Object.hasOwn(obj, key) || Object.hasOwn(obj, "intent"))) return obj;
        start = text.indexOf("{", obj ? end + 1 : start + 1);
      }
      return null;
    }

    function wordList(v) {
      if (Array.isArray(v)) return v.filter((w) => w && typeof w === "object" && !Array.isArray(w));
      if (v && typeof v === "object") {
        if (["native", "lang", "gloss", "english"].some((k) => Object.hasOwn(v, k))) return [v]; // base-neutral-ok: legacy-key repair
        // Values in key order, so both runtimes read them alike.
        return Object.keys(v)
          .sort()
          .map((k) => v[k])
          .filter((w) => w && typeof w === "object" && !Array.isArray(w));
      }
      return [];
    }

    // ── C and D. one entry ──────────────────────────────────────────────

    function resolveBase(raw, requested) {
      const b = Lang.baseTagOf(raw);
      if (!b) return null;
      if (requested.includes(b)) return b;
      return requested.find((r) => Lang.sameBase(r, b)) ?? null;
    }

    function checkEntry(w, ctx) {
      const single = ctx.bases.length === 1;
      const has = (k) => w[k] !== undefined && w[k] !== null;
      const langRaw = clean(w.lang);
      let native = clean(w.native);
      // Legacy-key repair (09): a reply in the old shape names the gloss english.
      let gloss = stripPunct(clean(has("gloss") ? w.gloss : single ? w.english : null)); // base-neutral-ok
      const baseRaw = clean(w.base_lang) ?? (single ? ctx.bases[0] : null);
      const formsRaw = has("forms") ? w.forms : single ? w.english_forms : null; // base-neutral-ok
      const summary = () => ({ native, gloss, base_lang: base ?? baseRaw });
      let base = null;
      const reject = (reason, extra = {}) => ({ rejected: { ...summary(), reason }, ...extra });

      if (!langRaw || !native || !baseRaw || !gloss) return reject("missing_field");
      const c = Lang.canonical(langRaw);
      if (!c.ok) return reject(c.code);
      let lang = c.tag;
      if (primary(lang) === "ro") native = romanian(native);
      const sc = Lang.checkScript(lang, native);
      if (!sc.ok) return reject(sc.code);
      lang = sc.tag;
      const group = `${lang}\u0000${fold(native)}`;
      base = resolveBase(baseRaw, ctx.bases);
      if (!base) return reject("unrequested_base");
      if (Lang.sameBase(lang, base)) return reject("target_is_base", { group });
      if (cpLen(native) > RULES.max_native_chars || cpLen(gloss) > RULES.max_gloss_chars) return reject("too_long");

      const ro = primary(base) === "ro";
      if (ro) gloss = romanian(gloss);
      let note = clean(w.note);
      if (ro) note = romanian(note);

      // Forms: cleaned, punctuation stripped, deduplicated in the base's locale, gloss first.
      const forms = [];
      const seen = new Set();
      for (const raw of rawForms(formsRaw)) {
        const f = formOf(raw);
        if (!f) continue;
        f.text = stripPunct(clean(f.text));
        if (f.text && ro) f.text = romanian(f.text);
        if (!f.text || seen.has(fold(f.text, base))) continue;
        seen.add(fold(f.text, base));
        forms.push(f);
      }
      if (!seen.has(fold(gloss, base))) forms.unshift({ text: gloss, enabled: true, case: "any", ambiguous: false });

      const nk = fold(native, base);
      if (nk === fold(gloss, base) || forms.some((f) => fold(f.text, base) === nk)) return reject("same_as_gloss");

      const data = langData(base);
      const dropped_forms = [];
      const dropForm = (f, reason) => dropped_forms.push({ native, base_lang: base, form: f.text, reason });
      const minLen = RULES.unspaced_scripts.includes(baseScript(base))
        ? RULES.min_form_graphemes_unspaced
        : RULES.min_form_graphemes;
      const inputTokens = new Set(tokens(fold(ctx.text ?? "", base)));
      // The learner named this very word: they typed its base-language word (checked per
      // form below) or the target word itself ("это", "der", "犬"). Its gloss may then be a
      // function word ("it", "el"); extra function words the model adds still go.
      const typed = fold(ctx.text ?? "", lang);
      const nativeTyped = RULES.unspaced_scripts.includes(baseScript(lang))
        ? typed.includes(fold(native, lang))
        : new Set(tokens(typed)).has(fold(native, lang));
      const kept = [];
      for (const f of forms) {
        const n = graphemes(f.text).length;
        if (n < minLen || n > RULES.max_form_chars || !FORM_CHARS.test(f.text)) dropForm(f, "bad_form");
        else if (!related(f.text, gloss, base, data)) dropForm(f, "unrelated_form");
        else if (
          data.stopwords.has(fold(f.text, base)) &&
          !((inputTokens.has(fold(f.text, base)) || nativeTyped) && fold(gloss, base) === fold(f.text, base))
        ) {
          dropForm(f, "stopword");
        } else kept.push(f);
      }
      for (const f of kept.splice(RULES.max_forms)) dropForm(f, "too_many_forms");
      if (!kept.some((f) => f.enabled)) return reject("no_usable_forms", { dropped_forms });

      const word = {
        lang,
        native,
        base_lang: base,
        sense: "",
        gloss,
        forms: kept,
        romanization: clean(w.romanization),
        native_vocalized: clean(w.native_vocalized),
        pronunciation: clean(w.pronunciation),
        pronunciation_careful: clean(w.pronunciation_careful),
        pronunciation_source: null,
        note: truncate(note, RULES.max_note_chars),
      };
      if (primary(lang) === "ro") word.native_vocalized = romanian(word.native_vocalized);
      const facts = targetFacts(lang);
      const fields = checkPronunciation(word, facts, data.respelling).map((d) => ({
        native,
        base_lang: base,
        ...d,
      }));
      return { word, group, dropped_forms, dropped_fields: fields };
    }

    // ── E. merge of duplicate entries (slice 07 section 4's rules) ──────

    function mergeInto(a, b) {
      for (const f of ["romanization", "native_vocalized", "note"]) if (a[f] === null && b[f] !== null) a[f] = b[f];
      if (a.pronunciation === null && b.pronunciation !== null) {
        a.pronunciation = b.pronunciation;
        a.pronunciation_careful = b.pronunciation_careful;
        a.pronunciation_source = b.pronunciation_source;
      }
      const seen = new Set(a.forms.map((f) => fold(f.text, a.base_lang)));
      const incoming = [...b.forms];
      if (!seen.has(fold(b.gloss, a.base_lang))) incoming.push({ text: b.gloss, enabled: true, case: "any", ambiguous: false });
      for (const f of incoming) {
        const k = fold(f.text, a.base_lang);
        if (seen.has(k) || a.forms.length >= RULES.max_forms) continue;
        seen.add(k);
        a.forms.push(f);
      }
    }

    // ── the whole answer ────────────────────────────────────────────────

    function process(input, raw) {
      const obj = extract(raw, "words");
      if (!obj) return { error: "unparseable" };
      const bases = (input.base_langs ?? []).map((b) => Lang.baseTagOf(b)).filter(Boolean);
      const ctx = { bases, text: input.text ?? "" };
      const entries = wordList(obj.words).slice(0, RULES.max_words * Math.max(bases.length, 1));

      const rejected = [];
      let dropped_forms = [];
      let dropped_fields = [];
      const valid = [];
      for (const w of entries) {
        const r = checkEntry(w, ctx);
        dropped_forms = dropped_forms.concat(r.dropped_forms ?? []);
        if (r.rejected) rejected.push({ ...r.rejected, group: r.group ?? null });
        else {
          valid.push(r);
          dropped_fields = dropped_fields.concat(r.dropped_fields);
        }
      }

      // At most max_words distinct words; their entries for several bases count once.
      const groups = [];
      const words = [];
      for (const r of valid) {
        if (!groups.includes(r.group)) {
          if (groups.length >= RULES.max_words) {
            const { native, gloss, base_lang } = r.word;
            rejected.push({ native, gloss, base_lang, reason: "too_many_words", group: r.group });
            continue;
          }
          groups.push(r.group);
        }
        const twin = words.find((x) => x.group === r.group && x.word.base_lang === r.word.base_lang);
        if (twin) mergeInto(twin.word, r.word);
        else words.push({ group: r.group, word: r.word });
      }

      // Target-side fields shared within a word: the primary base's entry, or the first
      // non-null one in base order. Then the stress agreement check.
      for (const g of groups) {
        const members = words.filter((x) => x.group === g);
        const ordered = [...members].sort((x, y) => bases.indexOf(x.word.base_lang) - bases.indexOf(y.word.base_lang));
        const rom = ordered.find((x) => x.word.romanization !== null)?.word.romanization ?? null;
        const voc = ordered.find((x) => x.word.native_vocalized !== null)?.word.native_vocalized ?? null;
        for (const x of members) Object.assign(x.word, { romanization: rom, native_vocalized: voc });
        if (voc !== null) {
          const facts = targetFacts(members[0].word.lang);
          const bad = members.filter((x) => !stressAgrees(x.word, facts));
          if (bad.length) {
            for (const x of members) x.word.native_vocalized = null;
            for (const x of bad) {
              dropped_fields.push({
                native: x.word.native,
                base_lang: x.word.base_lang,
                field: "native_vocalized",
                reason: "stress_mismatch",
              });
            }
          }
        }
      }

      const missing_bases = [];
      for (const g of groups) {
        const members = words.filter((x) => x.group === g);
        const { lang, native } = members[0].word;
        for (const b of bases) {
          if (Lang.sameBase(lang, b) || members.some((x) => x.word.base_lang === b)) continue;
          missing_bases.push({ native, base_lang: b });
        }
      }

      // target_is_base is not shown for a word that has an entry for another base.
      const shown = rejected
        .filter((r) => !(r.reason === "target_is_base" && groups.includes(r.group)))
        .map(({ native, gloss, base_lang, reason }) => ({ native, gloss, base_lang, reason }));

      let intent = ["add", "lookup", "chat"].includes(obj.intent) ? obj.intent : "lookup";
      if (input.mode === "add") intent = "add";
      else if (intent === "chat" && words.length) intent = "lookup";
      else if (intent === "chat" && isBareWord(input.text ?? "")) intent = "lookup";
      const reply = intent === "chat" ? truncate(clean(obj.reply), RULES.max_reply_chars) : null;

      let code = null;
      if (!words.length && intent !== "chat") {
        if (!shown.length) code = "no_word_found";
        else if (shown.every((r) => r.reason === "same_as_gloss" || r.reason === "target_is_base")) {
          code = "rejected_same_as_gloss";
        } else code = "bad_lookup_result";
      }

      return {
        intent,
        words: words.map((x) => x.word),
        rejected: shown,
        dropped_forms,
        dropped_fields,
        missing_bases,
        reply,
        code,
      };
    }

    // A bare word or short phrase: a model that chats about it failed (the как lesson).
    const isBareWord = (text) => text.trim().split(/\s+/u).filter(Boolean).length <= RULES.chat_max_words && !/[?¿？]/u.test(text);

    // ── respell (slice 07 section 8) ────────────────────────────────────

    function processRespell(items, raw) {
      const obj = extract(raw, "items");
      if (!obj) return { error: "unparseable" };
      const requested = [];
      for (const it of items) {
        const c = Lang.canonical(it.lang);
        const native = clean(it.native);
        if (!c.ok || !native) continue;
        for (const b of it.base_langs ?? []) {
          const base = Lang.baseTagOf(b);
          if (base) requested.push({ lang: c.tag, native, base_lang: base, key: `${c.tag}\u0000${fold(native)}\u0000${base}` });
        }
      }
      // Answers by (lang, native, base), in order: homographs asked twice (замок, castle
      // and lock) get their answers in the order asked.
      const answers = new Map();
      for (const a of wordList(obj.items).slice(0, RULES.max_respell_items * RULES.max_base_langs)) {
        const c = Lang.canonical(clean(a.lang));
        const native = clean(a.native);
        const base = Lang.baseTagOf(clean(a.base_lang));
        if (!c.ok || !native || !base) continue;
        const key = `${c.tag}\u0000${fold(native)}\u0000${base}`;
        answers.set(key, [...(answers.get(key) ?? []), a]);
      }
      const out = [];
      let dropped_fields = [];
      for (const r of requested) {
        const a = answers.get(r.key)?.shift();
        if (!a) continue;
        const word = {
          lang: r.lang,
          native: r.native,
          base_lang: r.base_lang,
          romanization: null,
          pronunciation: clean(a.pronunciation),
          pronunciation_careful: clean(a.pronunciation_careful),
          native_vocalized: clean(a.native_vocalized),
          pronunciation_source: null,
        };
        const facts = targetFacts(r.lang);
        const fields = checkPronunciation(word, facts, langData(r.base_lang).respelling);
        if (word.native_vocalized !== null && !stressAgrees(word, facts)) {
          word.native_vocalized = null;
          fields.push({ field: "native_vocalized", reason: "stress_mismatch" });
        }
        dropped_fields = dropped_fields.concat(fields.map((d) => ({ native: r.native, base_lang: r.base_lang, ...d })));
        delete word.romanization;
        out.push(word);
      }
      return { items: out, dropped_fields };
    }

    // ── the prompt (slice 09 section 2) ─────────────────────────────────

    function render(template, vars) {
      const lines = [];
      for (const line of template.split("\n")) {
        const names = [...line.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
        const values = names.map((n) => (vars[n] === undefined || vars[n] === null ? "" : String(vars[n])));
        if (names.length && values.every((v) => v === "")) continue;
        lines.push(line.replace(/\{\{(\w+)\}\}/g, (_, n) => (vars[n] === undefined || vars[n] === null ? "" : String(vars[n]))));
      }
      return lines.join("\n");
    }

    const named = (tag) => `${tag} (${Lang.endonym(tag)})`;

    function romanizationSchemes() {
      const parts = [];
      for (const [tag, t] of Object.entries(PRON.targets)) {
        if (tag.includes("-") || !t.romanization || t.romanization === "unspecified") continue;
        parts.push(`${tag}: ${PRON.schemes[t.romanization]}`);
      }
      parts.push("any other language: its most standard transliteration");
      return parts.join("; ");
    }

    function keyText(base, key) {
      const examples = key.examples
        .map((e) => `${e.native} ${e.pronunciation}${e.pronunciation_careful ? ` (careful: ${e.pronunciation_careful})` : ""}`)
        .join(", ");
      return `${base}: ${key.prompt_summary} Examples: ${examples}.`;
    }

    function pronunciationVars(bases) {
      const withKey = bases.filter((b) => langData(b).respelling);
      return {
        variants: "Where varieties differ, pick one and keep to it.",
        respelling_keys: withKey.map((b) => keyText(b, langData(b).respelling)).join("\n"),
        bases_without_key: bases.filter((b) => !langData(b).respelling).join(", "),
      };
    }

    // request: { base_langs, mode: "add" | "auto", recent: [tag], hint_lang: tag | null }
    function buildSystem(request) {
      const bases = (request.base_langs ?? []).map((b) => Lang.baseTagOf(b)).filter(Boolean);
      const recent = (request.recent ?? []).filter((t) => Lang.canonical(t).ok);
      const hint = request.hint_lang && Lang.canonical(request.hint_lang).ok ? Lang.canonical(request.hint_lang).tag : null;
      const vars = {
        base_list: bases.map(named).join(", "),
        base_tags: bases.join(", "),
        max_words: RULES.max_words,
        romanization_schemes: romanizationSchemes(),
        recent_list: recent.map(named).join(", "),
        lang_name: hint ? Lang.endonym(hint) : "",
        primary_base: bases[0] ?? "",
        primary_base_name: bases[0] ? Lang.endonym(bases[0]) : "",
        ...pronunciationVars(bases),
      };
      const parts = [PROMPT.system, PROMPT.bases, PROMPT.pronunciation];
      if (request.mode === "add") parts.push(PROMPT.add_mode);
      if (recent.length) parts.push(PROMPT.recent_hint);
      if (hint) parts.push(PROMPT.hint_lang);
      const b0 = bases[0] ?? "";
      parts.push(PROMPT[`examples.${b0}`] ?? PROMPT[`examples.${primary(b0)}`] ?? PROMPT["examples._generic"]);
      if (bases.length > 1) parts.push(PROMPT.multi_base);
      return parts.map((p) => render(p, vars)).join("\n\n");
    }

    // items: [{ lang, native, sense, base_langs }]
    function buildRespellSystem(items) {
      const bases = [];
      for (const it of items) {
        for (const b of it.base_langs ?? []) {
          const t = Lang.baseTagOf(b);
          if (t && !bases.includes(t)) bases.push(t);
        }
      }
      return [PROMPT.respell, PROMPT.pronunciation].map((p) => render(p, pronunciationVars(bases))).join("\n\n");
    }

    return {
      prepareInput,
      process,
      processRespell,
      buildSystem,
      buildRespellSystem,
      extract,
      langData,
      candidates,
      related,
      validPronunciation,
      targetFacts,
      checkWord,
      clean,
      fold,
      sections: PROMPT,
    };
  }

  // The fenced blocks of spec/prompt.md whose info string is `prompt <name>`.
  function parsePrompt(text) {
    const sections = {};
    for (const m of String(text).matchAll(/^```prompt ([^\s`]+)\n([\s\S]*?)\n```$/gm)) sections[m[1]] = m[2];
    return sections;
  }

  const api = {};
  if (globalThis.KOTIKO_SPEC && globalThis.KotikoLang?.canonical) {
    Object.assign(api, createWordSpec(globalThis.KOTIKO_SPEC, globalThis.KotikoLang));
  }
  api.createWordSpec = createWordSpec;
  api.parsePrompt = parsePrompt;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.KotikoWordSpec = api;
})();
