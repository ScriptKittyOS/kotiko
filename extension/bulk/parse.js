// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Reading a pasted list or a dropped file into rows (slice 13 §3): decoding, the format
// (Kotiko's backup, a JSON array, an Anki plain-text export, CSV or TSV, or one item per
// line), the columns, and which side of a line is the word being learned, decided from the
// learner's base language and the scripts and language of each side, never by assuming the
// meaning is English. Pure: no DOM, no extension APIs (the caller passes the language data,
// the base's common words and the browser's language detection). Runs in the dashboard
// (globalThis.KotikoBulkParse) and in Node tests.
//
//   const P = KotikoBulkParse;
//   P.decode(bytes)                               -> { text } | { error: "too_big" | "unreadable" }, warning?
//   P.read(text, { filename })                     -> { format, header?, rows: [cells], roles, notes }
//   await P.build(read, { base, target, langs, stopwords, detect, htmlToText })
//     -> { rows: [{ native, gloss, forms, romanization, pronunciation, note, lang, source_text, lookup }],
//          wordSide, decidedBy, question, roles }
(() => {
  const MAX_BYTES = 5 * 1024 * 1024;
  const MAX_ROWS = 5000;

  // ── decoding ──────────────────────────────────────────────────────────

  function decode(input) {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (b.length > MAX_BYTES) return { error: "too_big" };
    let text;
    let warning = null;
    if (b[0] === 0xff && b[1] === 0xfe) text = new TextDecoder("utf-16le").decode(b.subarray(2));
    else if (b[0] === 0xfe && b[1] === 0xff) text = new TextDecoder("utf-16be").decode(b.subarray(2));
    else {
      const body = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? b.subarray(3) : b;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(body);
      } catch {
        text = new TextDecoder("windows-1252").decode(body);
        warning = "not_utf8";
      }
    }
    // A binary file (a spreadsheet, an .apkg) has NULs; text never does.
    if (text.includes(String.fromCharCode(0))) return { error: "unreadable" };
    return { text: clean(text), warning };
  }

  const clean = (text) => String(text ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").normalize("NFC");

  // ── header names (slice 13 §3, 12's export columns) ─────────────────────

  const ROLE_NAMES = {
    native: ["native", "word", "front", "term", "palabra", "término", "anverso"],
    // Slice 12's export columns (stable ids, and the English headers); `headers` adds the
    // interface language's own (export_csv_col_*).
    native_vocalized: ["native_vocalized", "word_with_marks"],
    forms: ["forms"],
    lang_code: ["language_code"],
    base_code: ["base_language_code"],
    pronunciation_source: ["pronunciation_source"],
    // base-neutral-ok: "english" names the meaning in 0.2's exported lists
    gloss: ["gloss", "meaning", "back", "translation", "definition", "english", "significado", "traducción", "definición", "reverso"],
    romanization: ["romanization", "transliteration", "translit", "pinyin", "romaji", "jyutping", "romanización", "transliteración"],
    pronunciation: ["pronunciation", "respelling", "pronunciación"],
    pronunciation_careful: ["pronunciation_careful", "pronunciation_slow", "careful", "pronunciación cuidada"],
    note: ["note", "notes", "nota", "notas"],
    lang: ["lang", "language", "idioma", "lengua"],
    base_lang: ["base_lang", "base_language", "base language", "idioma base"],
    reading: ["reading", "lectura"],
  };
  const ROLE_OF = new Map(Object.entries(ROLE_NAMES).flatMap(([role, names]) => names.map((n) => [n, role])));
  const norm = (s) => String(s ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");

  // A language named by tag, its English or Spanish name, or its own name ("es", "Spanish",
  // "español", "日本語") -> its tag; null otherwise.
  function languageNamed(name, langs) {
    const n = norm(name);
    if (!n || !langs) return null;
    if (/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(n) && langs[n.split("-")[0]]) return n.split("-")[0] === n ? n : name.trim();
    for (const [tag, e] of Object.entries(langs)) {
      if (norm(e.endonym) === n || Object.values(e.names ?? {}).some((x) => norm(x) === n)) return tag;
    }
    return null;
  }

  // ── reading the text into rows of cells ──────────────────────────────

  // RFC 4180: quoted fields, doubled quotes, separators and line breaks inside quotes.
  function csv(text, sep) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"' && cell === "") quoted = true;
      else if (c === sep) row.push(cell), (cell = "");
      else if (c === "\n") row.push(cell), rows.push(row), (row = []), (cell = "");
      else cell += c;
    }
    if (cell !== "" || row.length) row.push(cell), rows.push(row);
    return rows.filter((r) => r.some((x) => x.trim()));
  }

  // A line-list separator (§3 "One line"), which a table's commas must not be mistaken for.
  const LINE_SEP = /\s=\s|=|→|＝|：|\s[—–-]\s|:\s|\t/u;

  // How a table is separated, or null for a line list: more than half the non-empty lines
  // with the same number (one or more) of tabs, or of `；`, or of commas outside quotes on
  // lines that have no line-list separator.
  function tableSeparator(lines) {
    const nonEmpty = lines.filter((l) => l.trim());
    if (!nonEmpty.length) return null;
    const outside = (l, sep) => l.replace(/"[^"]*"/g, "").split(sep).length - 1;
    for (const sep of ["\t", "；", ","]) {
      const counts = new Map();
      for (const l of nonEmpty) {
        if (sep === "," && LINE_SEP.test(l.replace(/\t/g, " "))) continue;
        const n = outside(l, sep);
        if (n >= 1) counts.set(n, (counts.get(n) ?? 0) + 1);
      }
      const best = Math.max(0, ...counts.values());
      if (best > nonEmpty.length / 2) return sep;
    }
    return null;
  }

  // Anki's "Notes in Plain Text" export: its header lines, then a separated table.
  const ANKI_SEP = { tab: "\t", comma: ",", semicolon: ";", pipe: "|", space: " ", colon: ":" };
  function anki(text) {
    const lines = text.split("\n");
    const meta = {};
    while (lines.length && lines[0].startsWith("#")) {
      const m = /^#([a-z ]+):(.*)$/i.exec(lines.shift());
      if (m) meta[m[1].trim().toLowerCase()] = m[2].trim();
    }
    const sep = ANKI_SEP[meta.separator] ?? meta.separator ?? "\t";
    const rows = csv(lines.join("\n"), sep);
    // The deck, notetype and tags columns (1-based) aren't content.
    const skip = new Set(["notetype column", "deck column", "tags column", "guid column"].map((k) => Number(meta[k]) - 1).filter((n) => n >= 0));
    const header = meta.columns ? meta.columns.split(sep).filter((_, i) => !skip.has(i)) : null;
    return { rows: rows.map((r) => r.filter((_, i) => !skip.has(i))), header, html: meta.html === "true", tags: rows.map((r) => (meta["tags column"] ? r[Number(meta["tags column"]) - 1] : "")) };
  }

  // Anki field markup to text: HTML (through the caller's inert parser), [sound:…], cloze.
  function ankiText(s, html, htmlToText) {
    let t = String(s ?? "");
    t = t.replace(/\[sound:[^\]]*\]/g, "").replace(/\{\{c\d+::([^}]*?)(?:::[^}]*)?\}\}/g, "$1");
    if (html) {
      t = t.replace(/<br\s*\/?>/gi, "; ");
      t = htmlToText ? htmlToText(t) : t.replace(/<[^>]*>/g, "");
    }
    return t.replace(/\s+/g, " ").trim();
  }

  // The format, and the rows as cells. `json` rows come with their roles already known.
  function read(text, { filename = "" } = {}) {
    const t = clean(text);
    const ext = (/\.([a-z0-9]+)$/i.exec(filename)?.[1] ?? "").toLowerCase();
    if (ext === "xlsx" || ext === "xls" || ext === "ods" || ext === "numbers") return { error: "spreadsheet" };
    if (ext === "apkg" || ext === "colpkg") return { error: "apkg" };
    if (ext === "json" || /^\s*[[{]/.test(t)) {
      let data;
      try {
        data = JSON.parse(t);
      } catch {
        if (ext === "json") return { error: "unreadable" };
        data = undefined;
      }
      if (data !== undefined) {
        if (data && typeof data === "object" && !Array.isArray(data) && "schemaVersion" in data) return { format: "kotiko-backup", data };
        if (!Array.isArray(data) || !data.length || data.some((x) => !x || typeof x !== "object" || Array.isArray(x))) return { error: "unreadable" };
        const keys = [...new Set(data.flatMap((x) => Object.keys(x)))];
        return { format: "json", header: keys, rows: data.map((x) => keys.map((k) => (x[k] == null ? "" : String(x[k])))) };
      }
    }
    if (/^#(separator|html|columns|notetype|deck|tags|guid)[^:]*:/im.test(t.split("\n")[0] ?? "")) {
      const a = anki(t);
      return { format: "anki", header: a.header, rows: a.rows, html: a.html, kotiko: a.tags.some((x) => /(^|\s)kotiko/.test(x)) };
    }
    const lines = t.split("\n");
    const sep = ext === "tsv" ? "\t" : ext === "csv" ? (tableSeparator(lines) ?? ",") : tableSeparator(lines);
    if (sep) {
      const rows = csv(t, sep);
      return { format: sep === "\t" ? "tsv" : "csv", rows };
    }
    return { format: "lines", rows: lines.map((l) => [l]).filter(([l]) => l.trim()) };
  }

  // ── one line (§3 "One line") ────────────────────────────────────────────

  const NUMBERED = /^\s*(?:\d{1,4}[.)]\s+|[-•*·]\s+|[\u2460-\u2473]\s*|[一二三四五六七八九十百]+[、.]\s*)/u;
  // Earliest separator: = (spaces optional), → ＝ ： (no spaces needed), a dash with spaces,
  // ": " (a colon followed by a space; "10:30" and "C:" aren't separators), a tab.
  const SEP = /\s*(?:=|→|＝|：)\s*|\s[—–-]\s|:\s+|\t+/u;
  const PARENS = /^(.+?)\s*[(（]([^()（）]+)[)）]$/u;
  // Hyphenated syllables with one all-capital one: a respelling ("spa-SEE-ba").
  const RESPELLING = /^(?=.*\p{Lu}{2})[\p{L}\p{M}' ]+(?:-[\p{L}\p{M}' ]+)+$/u;
  const FORM_SEP = /\s*[,;/、，／]\s*/u;
  const unmark = (s) => String(s ?? "").trim().replace(/^[¿¡]+/u, "").replace(/[?!]+$/u, "").trim();

  // A side of a line: its text, and what parentheses after it held.
  function side(raw) {
    const s = { text: unmark(raw), romanization: null, pronunciation: null };
    const p = PARENS.exec(s.text);
    if (p) {
      s.text = unmark(p[1]);
      if (RESPELLING.test(p[2].trim())) s.pronunciation = p[2].trim();
      else s.romanization = p[2].trim();
    }
    return s;
  }

  // One line of a list: an optional language prefix, two sides or one, and a note.
  function line(raw, langs) {
    let t = String(raw ?? "").replace(NUMBERED, "").trim();
    if (!t || !/[\p{L}\p{N}]/u.test(t)) return null;
    let note = null;
    const n = /\s(?:#|\/\/)\s*(.*)$/u.exec(t);
    if (n) {
      note = n[1].trim() || null;
      t = t.slice(0, n.index).trim();
    }
    let lang = null;
    const prefix = /^([\p{L}\p{M} -]{2,24}?)\s*[:：]\s*(.+)$/u.exec(t);
    if (prefix && SEP.exec(prefix[2])) {
      const named = languageNamed(prefix[1], langs);
      if (named) {
        lang = named;
        t = prefix[2];
      }
    }
    const m = SEP.exec(t);
    if (!m) return { sides: [side(t)], note, lang, source: String(raw).trim() };
    return { sides: [side(t.slice(0, m.index)), side(t.slice(m.index + m[0].length))], note, lang, source: String(raw).trim() };
  }

  // ── scripts (§3 rule 2) ────────────────────────────────────────────────

  const SCRIPTS = [
    ["Hira", /\p{Script=Hiragana}/u], ["Kana", /\p{Script=Katakana}/u], ["Hang", /\p{Script=Hangul}/u], ["Hani", /\p{Script=Han}/u],
    ["Latn", /\p{Script=Latin}/u], ["Cyrl", /\p{Script=Cyrillic}/u], ["Grek", /\p{Script=Greek}/u], ["Arab", /\p{Script=Arabic}/u],
    ["Hebr", /\p{Script=Hebrew}/u], ["Thai", /\p{Script=Thai}/u], ["Deva", /\p{Script=Devanagari}/u], ["Geor", /\p{Script=Georgian}/u],
    ["Armn", /\p{Script=Armenian}/u], ["Ethi", /\p{Script=Ethiopic}/u], ["Beng", /\p{Script=Bengali}/u], ["Taml", /\p{Script=Tamil}/u],
  ];
  // The scripts a language's own script stands for (Japanese is Han and kana; Korean,
  // Hangul and Han; Chinese, Han).
  const COVERS = { Jpan: ["Hani", "Hira", "Kana"], Kore: ["Hang", "Hani"], Hans: ["Hani"], Hant: ["Hani"] };
  function scriptOf(text) {
    const counts = new Map();
    for (const c of String(text ?? "")) {
      for (const [iso, re] of SCRIPTS) {
        if (re.test(c)) {
          counts.set(iso, (counts.get(iso) ?? 0) + 1);
          break;
        }
      }
    }
    let best = null;
    for (const [iso, n] of counts) if (!best || n > counts.get(best)) best = iso;
    return best;
  }
  function scriptsOf(tag, langs) {
    const e = langs?.[String(tag ?? "").split("-")[0]];
    const own = String(tag ?? "").split("-").find((p) => /^[A-Z][a-z]{3}$/.test(p));
    const list = own ? [own] : e?.scripts ?? (e?.script ? [e.script] : []);
    return new Set(list.flatMap((s) => COVERS[s] ?? [s]));
  }

  // ── orientation (§3) ─────────────────────────────────────────────────────

  const primary = (tag) => String(tag ?? "").split("-")[0].toLowerCase();

  // Which side (0 or 1) is the word being learned: by script, then by the language each
  // side's text detects as and its share of the base's common words, else side 0 with a
  // question for the learner.
  async function orient(pairs, { base, target = null, langs, stopwords = null, detect = null }) {
    const both = pairs.filter((p) => p[0] && p[1]);
    if (!both.length) return { wordSide: 0, by: "none" };
    const baseScripts = scriptsOf(base, langs);
    const targetScripts = target ? scriptsOf(target, langs) : null;
    const inBase = (s) => baseScripts.has(scriptOf(s));
    const share = (i, fn) => both.filter((p) => fn(p[i])).length / both.length;
    const differ = targetScripts && ![...targetScripts].some((s) => baseScripts.has(s));
    if (differ || !target) {
      const a = share(0, inBase);
      const b = share(1, inBase);
      if (Math.abs(a - b) >= 0.5) return { wordSide: a > b ? 1 : 0, by: "script" };
    }
    const joined = [0, 1].map((i) => both.map((p) => p[i]).join("\n"));
    let detected = [null, null];
    if (detect) detected = await Promise.all(joined.map((t) => Promise.resolve(detect(t)).catch(() => null)));
    const isBase = (d) => !!d?.isReliable && primary(d.languages?.[0]?.language) === primary(base);
    if (isBase(detected[0]) !== isBase(detected[1])) return { wordSide: isBase(detected[0]) ? 1 : 0, by: "language" };
    if (stopwords?.size) {
      const hits = joined.map((t) => t.toLocaleLowerCase().split(/[^\p{L}\p{M}']+/u).filter((w) => stopwords.has(w)).length);
      if (Math.max(...hits) >= 2 && Math.max(...hits) >= 2 * Math.min(...hits) + 1) return { wordSide: hits[0] > hits[1] ? 1 : 0, by: "common_words" };
    }
    return { wordSide: 0, by: "undecided", question: { a: both[0][0], b: both[0][1] } };
  }

  // ── columns of a table (§3 "Columns") ────────────────────────────────────

  // Roles from a header row, or null when the first row isn't one: a known name, or a
  // language (the base's column is the meaning, another language's the word).
  function headerRoles(header, { base, langs, headers = null }) {
    if (!header?.length) return null;
    const extra = new Map(Object.entries(headers ?? {}).flatMap(([role, names]) => [names].flat().filter(Boolean).map((n) => [norm(n), role])));
    let known = 0;
    // A language's name first: "English" over a base-Spanish list is the word's column,
    // though 0.2's lists named the meaning `english`.
    const roles = header.map((h) => {
      const named = languageNamed(h, langs);
      if (named) return known++, primary(named) === primary(base) ? "gloss" : `native:${named}`;
      const r = ROLE_OF.get(norm(h).replace(/^'/, "")) ?? extra.get(norm(h).replace(/^'/, ""));
      if (r) return known++, r;
      return "ignore";
    });
    return known >= Math.min(2, header.length) ? roles : null;
  }

  // Default roles for an unheaded table: the first two columns are the two sides; a third
  // Latin column beside non-Latin words is their romanization (or pronunciation when its
  // values look like respellings); anything else is ignored.
  function defaultRoles(rows) {
    const width = Math.max(...rows.map((r) => r.length));
    const roles = Array.from({ length: width }, (_, i) => (i === 0 ? "side0" : i === 1 ? "side1" : "ignore"));
    if (width >= 3) {
      const col = (i) => rows.map((r) => r[i] ?? "").filter((x) => x.trim());
      const latin = (i) => col(i).filter((x) => scriptOf(x) === "Latn").length > col(i).length / 2;
      if (!latin(0) && latin(1)) {
        const respelled = col(1).filter((x) => RESPELLING.test(x.trim())).length > col(1).length / 2;
        roles[1] = respelled ? "pronunciation" : "romanization";
        roles[2] = "side1";
      }
    }
    return roles;
  }

  // Kotiko's CSV export guards cells against formulas with a leading apostrophe (12).
  const unguard = (s) => s.replace(/^'([=+\-@\t\r])/, "$1");

  // ── the rows (§3) ────────────────────────────────────────────────────────

  // Everything read, as rows ready for the review table. `roles` (optional) is the column
  // mapping the learner chose; `swap` flips the two sides.
  async function build(r, { base, target = null, langs, stopwords = null, detect = null, htmlToText = null, roles: chosen = null, swap = null, headers = null } = {}) {
    if (r.error || r.format === "kotiko-backup") return { rows: [], ...r };
    const notes = [];
    let items;
    let roles = null;
    let header = null;
    if (r.format === "lines") {
      items = r.rows.map(([l]) => line(l, langs)).filter(Boolean);
    } else {
      let rows = r.rows.map((cells) => cells.map((c) => (r.format === "anki" ? ankiText(c, r.html, htmlToText) : c.trim())));
      const fromHeader = headerRoles(r.header ?? rows[0], { base, langs, headers });
      if (fromHeader && !r.header) {
        header = rows[0];
        rows = rows.slice(1);
        if (fromHeader.some((x) => x === "native")) rows = rows.map((cells) => cells.map(unguard));
      } else header = r.header ?? null;
      roles = chosen ?? fromHeader ?? defaultRoles(rows);
      items = rows.map((cells) => {
        const pick = (role) => cells[roles.indexOf(role)] ?? "";
        const nativeCol = roles.findIndex((x) => x === "native" || x.startsWith("native:") || x === "side0");
        const glossCol = roles.findIndex((x) => x === "gloss" || x === "side1");
        const lang = roles[nativeCol]?.startsWith("native:") ? roles[nativeCol].slice(7) : pick("lang_code") ? pick("lang_code").trim() : pick("lang") ? languageNamed(pick("lang"), langs) ?? pick("lang").trim() : null;
        const a = side(cells[nativeCol] ?? "");
        const b = glossCol >= 0 ? side(cells[glossCol] ?? "") : null;
        a.romanization = pick("romanization") || a.romanization;
        a.pronunciation = pick("pronunciation") || a.pronunciation;
        const reading = pick("reading");
        if (reading && scriptOf(reading) === "Latn" && !a.romanization) a.romanization = reading;
        // A Kotiko export's own columns come back as they were (slice 12 §3).
        const kept = {
          native_vocalized: pick("native_vocalized") || null,
          pronunciation_careful: pick("pronunciation_careful") || null,
          pronunciation_source: ["model", "user", "wiktionary"].includes(pick("pronunciation_source")) ? pick("pronunciation_source") : null,
          base_lang: pick("base_code").trim() || null,
          forms: pick("forms") ? pick("forms").split(" | ").map((f) => f.trim()).filter(Boolean) : null,
        };
        return { sides: b?.text ? [a, b] : [a], note: pick("note") || null, lang, kept, source: cells.join(" · "), fixed: roles.some((x) => x === "native" || x === "gloss" || x.startsWith("native:")) };
      });
    }
    if (items.length > MAX_ROWS) {
      notes.push({ key: "too_many", count: items.length });
      items = items.slice(0, MAX_ROWS);
    }
    // Which side is the word: fixed by headers, else oriented once for the whole list.
    const fixed = items.some((x) => x.fixed);
    const o = fixed ? { wordSide: 0, by: "headers" } : await orient(items.map((x) => (x.sides.length === 2 ? [x.sides[0].text, x.sides[1].text] : [x.sides[0].text, ""])), { base, target, langs, stopwords, detect });
    const wordSide = swap === null ? o.wordSide : swap ? 1 - o.wordSide : o.wordSide;
    // A bare list in the base's own script or language: words to find in the target.
    const bare = items.filter((x) => x.sides.length === 1);
    let bareIsBase = false;
    if (bare.length) {
      const text = bare.map((x) => x.sides[0].text).join("\n");
      const baseScripts = scriptsOf(base, langs);
      const targetScripts = target ? scriptsOf(target, langs) : null;
      if (targetScripts && ![...targetScripts].some((s) => baseScripts.has(s))) bareIsBase = baseScripts.has(scriptOf(text));
      else if (detect) {
        const d = await Promise.resolve(detect(text)).catch(() => null);
        bareIsBase = !!d?.isReliable && primary(d.languages?.[0]?.language) === primary(base);
      }
    }
    const rows = items.map((x) => {
      if (x.sides.length === 1) {
        const s = x.sides[0];
        // A base-language word: Kotiko finds its word in the target; it's the meaning.
        if (bareIsBase) return { native: "", gloss: s.text, forms: [s.text], romanization: null, pronunciation: null, note: x.note, lang: x.lang, source_text: x.source, lookup: "find" };
        return { native: s.text, gloss: "", forms: [], romanization: s.romanization, pronunciation: s.pronunciation, note: x.note, lang: x.lang, source_text: x.source, lookup: "explain" };
      }
      const w = x.sides[wordSide];
      const m = x.sides[1 - wordSide];
      const forms = x.kept?.forms?.length && wordSide === 0 ? [m.text, ...x.kept.forms.filter((f) => f !== m.text)] : m.text.split(FORM_SEP).map(unmark).filter(Boolean);
      const kept = x.kept && wordSide === 0 ? { ...x.kept } : {};
      delete kept.forms;
      return { native: w.text, gloss: forms[0] ?? "", forms, romanization: w.romanization ?? m.romanization, pronunciation: w.pronunciation ?? m.pronunciation, note: x.note, lang: x.lang, source_text: x.source, lookup: null, ...kept };
    });
    return { rows, wordSide, decidedBy: swap === null ? o.by : "learner", question: swap === null ? o.question ?? null : null, roles, header, notes, format: r.format };
  }

  const api = { decode, read, build, line, orient, csv, scriptOf, scriptsOf, languageNamed, headerRoles, defaultRoles, ankiText, MAX_ROWS, MAX_BYTES, RESPELLING };
  globalThis.KotikoBulkParse = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
