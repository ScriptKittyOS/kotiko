// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Language tags (slice 08): one canonical tag per language group, the base tag of the
// languages a learner reads (slice 50 section 2), the script check of a word's `native`,
// and display names. Pure, no DOM or extension APIs. The data is spec/languages.json and
// spec/lang-aliases.json, loaded from extension/spec/spec.js (globalThis.KOTIKO_SPEC).
// server/lib/kotiko/lang.ex implements the same rules; spec/fixtures/lang-tags.json and
// base-tags.json hold both to the same answers.
//
//   KotikoLang.canonical("zh-TW")        -> { ok: true, tag: "zh-Hant", known: true }
//   KotikoLang.canonical("i")            -> { ok: false, code: "invalid_lang" }
//   KotikoLang.baseTagOf("es-PR")        -> "es"
//   KotikoLang.checkScript("sr", "hvala") -> { ok: true, tag: "sr-Latn" }
(() => {
  const MAX_TAG = 35;

  function createLang(spec) {
    const LANGS = spec.languages.languages;
    const ALIASES = spec.aliases;
    const INVALID = new Set(ALIASES.invalid);
    const SIGN = new Set(ALIASES.sign);
    const SCRIPTS = Object.entries(spec.languages.unicode_scripts).map(([name, isos]) => ({
      re: new RegExp(`\\p{Script=${name}}`, "gu"),
      isos,
    }));

    const title = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    const entryOf = (lang) => (Object.hasOwn(LANGS, lang) ? LANGS[lang] : null);

    // Steps 1-10 of slice 08 section 2. Returns the parts of the tag (`named` is the script
    // the input named or implied, before the default script is dropped), or an error code.
    function parse(input) {
      if (typeof input !== "string") return { error: "invalid_lang" };
      const s = input.trim().replaceAll("_", "-");
      if (!s || s.length > MAX_TAG || !/^[A-Za-z0-9-]+$/.test(s) || /^-|-$|--/.test(s)) {
        return { error: "invalid_lang" };
      }
      let lower = s.toLowerCase();

      if (lower.startsWith("x-")) {
        const m = /^x-([a-z]{2,8})$/.exec(lower);
        return m ? { private: m[1] } : { error: "invalid_lang" };
      }
      if (Object.hasOwn(ALIASES.legacy, lower)) lower = ALIASES.legacy[lower].toLowerCase();

      const rest = lower.split("-");
      let lang = rest.shift();
      if (!/^[a-z]{2,3}$/.test(lang)) return { error: "invalid_lang" };
      // An extended language subtag names the language itself: zh-yue is yue.
      if (rest.length && /^[a-z]{3}$/.test(rest[0])) lang = rest.shift();
      while (rest.length && /^[a-z]{3}$/.test(rest[0])) rest.shift();

      let script = null;
      let region = null;
      for (const t of rest) {
        if (t.length === 1) break; // an extension (-u-, -t-) or private use: dropped
        if (!script && !region && /^[a-z]{4}$/.test(t)) script = title(t);
        else if (!region && /^([a-z]{2}|\d{3})$/.test(t)) region = t.toUpperCase();
      }

      if (INVALID.has(lang)) return { error: "invalid_lang" };
      if (Object.hasOwn(ALIASES.language, lang)) {
        const [l, ...more] = ALIASES.language[lang].split("-");
        lang = l;
        for (const t of more) {
          if (/^[A-Za-z]{4}$/.test(t)) script ??= title(t);
          else region ??= t.toUpperCase();
        }
      }
      if (script && Object.hasOwn(ALIASES.script, script)) script = ALIASES.script[script];
      if (region && Object.hasOwn(ALIASES.territory, region)) region = ALIASES.territory[region];

      let entry = entryOf(lang);
      if (SIGN.has(lang) || entry?.sign) return { error: "sign_language_unsupported" };
      if (!entry) return { lang, script, region, named: script, known: false };

      if (region) {
        if (entry.region_scripts?.[region]) {
          script ??= entry.region_scripts[region];
          region = null;
        } else if (entry.region_languages?.[region]) {
          lang = entry.region_languages[region];
          region = null;
          entry = entryOf(lang);
          if (!entry) return { lang, script, region, named: script, known: false };
        } else if (entry.region_aliases?.[region]) {
          region = entry.region_aliases[region];
        }
        if (region && !entry.regions.includes(region)) region = null;
      }

      const named = script;
      if (script) {
        if (entry.script_languages?.[script]) {
          lang = entry.script_languages[script];
          entry = entryOf(lang);
          script = null;
          if (!entry) return { lang, script, region, named: null, known: false };
        } else if (script === entry.script || !entry.scripts.includes(script)) {
          script = null;
        }
      }
      return { lang, script, region, named, known: true };
    }

    const join = (...parts) => parts.filter(Boolean).join("-");

    // { ok: true, tag, known } or { ok: false, code }: invalid_lang, sign_language_unsupported.
    function canonical(input) {
      const p = parse(input);
      if (p.error) return { ok: false, code: p.error };
      if (p.private) return { ok: true, tag: `x-${p.private}`, known: false };
      return { ok: true, tag: join(p.lang, p.script, p.region), known: p.known };
    }

    // Slice 50 section 2 / 08 section 6: the base tag of a browser or page language, or null.
    function baseTagOf(input) {
      const p = parse(input);
      if (p.error || p.private) return null;
      const entry = entryOf(p.lang);
      if (!entry || !p.known) return join(p.lang, p.script);
      const script = p.script ?? (entry.scripts.length > 1 ? entry.script : null);
      const region = p.region && entry.base_regions.includes(p.region) ? p.region : null;
      return join(p.lang, script, region);
    }

    // Same primary language, and the same script when both name one.
    function sameBase(a, b) {
      const pa = parse(a);
      const pb = parse(b);
      if (pa.error || pb.error) return false;
      if (pa.private || pb.private) return pa.private === pb.private;
      if (pa.lang !== pb.lang) return false;
      return !(pa.named && pb.named && pa.named !== pb.named);
    }

    function known(tag) {
      const p = parse(tag);
      return !p.error && !p.private && p.known;
    }

    // Code points of `native` per ISO 15924 script, ignoring Common and Inherited.
    function scriptCounts(native, current) {
      const counts = new Map();
      for (const { re, isos } of SCRIPTS) {
        const n = (native.match(re) ?? []).length;
        if (!n) continue;
        const iso = isos.includes(current) ? current : isos[0];
        counts.set(iso, (counts.get(iso) ?? 0) + n);
      }
      return counts;
    }

    // Slice 08 section 3: { ok: true, tag } (maybe rewritten to the script `native` is
    // written in) or { ok: false, code: "script_mismatch" }. `tag` is a canonical tag.
    function checkScript(tag, native) {
      const p = parse(tag);
      if (p.error) return { ok: false, code: p.error };
      const entry = p.private || !p.known ? null : entryOf(p.lang);
      if (!entry?.script || typeof native !== "string") return { ok: true, tag };
      const current = p.script ?? entry.script;
      const counts = scriptCounts(native, current);
      if (!counts.size) return { ok: true, tag };
      // Loanwords keep their Latin letters (COVID-19 вирус, iPhone 手机).
      if (current !== "Latn" && counts.get(current)) counts.delete("Latn");
      let dominant = null;
      let best = 0;
      for (const [iso, n] of counts) {
        if (n > best || (n === best && iso === current)) [dominant, best] = [iso, n];
      }
      if (dominant === current) return { ok: true, tag };
      if (!entry.scripts.includes(dominant)) return { ok: false, code: "script_mismatch" };
      return { ok: true, tag: join(p.lang, dominant === entry.script ? null : dominant, p.region) };
    }

    // The language's name in itself ("español", "粵語"), for the API's `language` field.
    function endonym(tag) {
      const p = parse(tag);
      if (p.error) return null;
      if (p.private) return title(p.private);
      const entry = entryOf(p.lang);
      return entry?.endonym ?? entry?.names.en ?? p.lang;
    }

    // A name from the data, in `locale` when the file has it: "Portuguese (Brazil)",
    // "serbio (latino)". The fallback when Intl.DisplayNames has no answer.
    function dataName(tag, locale) {
      const p = parse(tag);
      if (p.error) return null;
      if (p.private) return title(p.private);
      const entry = entryOf(p.lang);
      if (!entry) return join(p.lang, p.script, p.region);
      const loc = spec.languages.locales.includes(locale) ? locale : "en";
      const base = entry.names[loc] ?? entry.endonym ?? entry.names.en ?? p.lang;
      const extra = [
        p.script && spec.languages.scriptNames[loc]?.[p.script],
        p.region && spec.languages.regionNames[loc]?.[p.region],
      ].filter(Boolean);
      return extra.length ? `${base} (${extra.join(", ")})` : base;
    }

    // Slice 08 section 4: Intl.DisplayNames in the interface locale, then the data.
    function displayName(tag, uiLocale) {
      const c = canonical(tag);
      if (!c.ok) return null;
      if (c.known) {
        try {
          const name = new Intl.DisplayNames([uiLocale], { type: "language", fallback: "none" }).of(c.tag);
          if (name && name.toLowerCase() !== c.tag.toLowerCase()) return name;
        } catch {
          // RangeError: a tag Intl can't name. The data below can.
        }
      }
      return dataName(c.tag, (uiLocale ?? "en").split("-")[0]);
    }

    return { canonical, baseTagOf, sameBase, known, checkScript, endonym, dataName, displayName, parse };
  }

  const api = globalThis.KOTIKO_SPEC ? createLang(globalThis.KOTIKO_SPEC) : {};
  api.createLang = createLang;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else globalThis.KotikoLang = api;
})();
