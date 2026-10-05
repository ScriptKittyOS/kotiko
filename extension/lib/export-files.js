// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The spreadsheet (CSV) and Anki (tab-separated text) exports of slice 12 sections 3 and 4,
// and the files' names. Pure: the dashboard loads it on first use and passes in how to name
// languages and the headers in the interface language, so the files read in the learner's
// own language; Node tests require it.
//
//   F.csv(records, { header: (id) => "word", langName: (tag) => "Japanese" })  -> text
//   F.anki(records, { langName, careful: (p) => "Slowly: " + p, notetype })      -> text
//   F.filename("backup" | "csv" | "anki", ms)  -> "kotiko-backup-2026-10-05.json"
(() => {
  // Section 3's columns, in order; their headers are `export_csv_col_<id>` messages.
  const CSV_COLUMNS = ["native", "native_vocalized", "pronunciation", "pronunciation_careful", "romanization", "gloss", "forms", "language", "language_code", "base_language", "base_language_code", "note", "status", "added", "pronunciation_source", "id"];
  const BOM = String.fromCharCode(0xfeff);
  // OWASP's CSV injection guidance: a cell starting with one of these is prefixed with '.
  const FORMULA = /^[=+\-@\t\r]/;

  const pad = (n) => String(n).padStart(2, "0");
  // YYYY-MM-DD in local time.
  function day(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  const NAMES = { backup: ["kotiko-backup", "json"], csv: ["kotiko-words", "csv"], anki: ["kotiko-anki", "txt"] };
  const filename = (kind, ms = Date.now()) => `${NAMES[kind][0]}-${day(ms)}.${NAMES[kind][1]}`;

  const formText = (f) => (typeof f === "string" ? f : f && typeof f === "object" && typeof f.text === "string" ? f.text : null);
  const enabledForms = (w) => (Array.isArray(w.forms) ? w.forms : []).filter((f) => typeof f === "string" || f?.enabled !== false).map(formText).filter(Boolean);

  // ── CSV (RFC 4180, UTF-8 with a BOM, CRLF) ───────────────────────────

  function cell(v) {
    let s = v === null || v === undefined ? "" : String(v);
    if (FORMULA.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  }

  function csvRow(w, langName) {
    const values = {
      native: w.native,
      native_vocalized: w.native_vocalized,
      pronunciation: w.pronunciation,
      pronunciation_careful: w.pronunciation_careful,
      romanization: w.romanization,
      gloss: w.gloss,
      forms: enabledForms(w).join(" | "),
      language: langName(w.lang),
      language_code: w.lang,
      base_language: langName(w.base_lang),
      base_language_code: w.base_lang,
      note: w.note,
      status: w.status,
      added: w.created_at ? day(Date.parse(w.created_at)) : "",
      pronunciation_source: w.pronunciation ? w.pronunciation_source ?? "" : "",
      id: w.id,
    };
    return CSV_COLUMNS.map((c) => cell(values[c])).join(",");
  }

  // One row per word record: a bilingual learner's 犬 is a row per base.
  function csv(records, { header = (id) => id, langName = (tag) => tag } = {}) {
    const lines = [CSV_COLUMNS.map((c) => cell(header(c) || c)).join(",")];
    for (const w of records) lines.push(csvRow(w, langName));
    return `${BOM}${lines.join("\r\n")}\r\n`;
  }

  // ── Anki (text import with file headers, Anki 2.1.54 and later) ──────

  // Tabs and line breaks inside a field become spaces; a field with a double quote is quoted
  // (Anki reads the file as CSV with a tab separator).
  function field(v) {
    const s = String(v ?? "").replace(/[\t\r\n]+/g, " ").trim();
    return s.includes('"') ? `"${s.replaceAll('"', '""')}"` : s;
  }

  // Front: the word (with its stress or vowel marks), its romanization, how to say it and
  // the slow form; never the meaning. Back: the meaning and the note; never a pronunciation,
  // which would read the answer aloud on the reversed card (section 4).
  function front(w, careful) {
    let s = w.native_vocalized || w.native;
    if (w.romanization) s += ` (${w.romanization})`;
    if (w.pronunciation) s += ` · ${w.pronunciation}`;
    if (w.pronunciation && w.pronunciation_careful) s += ` · ${careful(w.pronunciation_careful)}`;
    return s;
  }
  const back = (w) => (w.note ? `${w.gloss} - ${w.note}` : String(w.gloss ?? ""));
  // Deck and tag names: no "::" or spaces of their own.
  const deckPart = (s) => String(s ?? "").replaceAll("::", ":").replace(/[\t\r\n]+/g, " ").trim();
  const tagPart = (s) => String(s ?? "").replace(/\s+/g, "_");

  function anki(records, { langName = (tag) => tag, careful = (p) => p, notetype = null } = {}) {
    const bilingual = new Set(records.map((w) => w.base_lang)).size > 1;
    const head = ["#separator:tab", "#html:false"];
    if (notetype) head.push(`#notetype:${notetype}`);
    head.push("#deck column:4", "#tags column:5", "#guid column:6", "#columns:Front\tBack\tLanguage\tDeck\tTags\tGUID");
    const rows = records.map((w) => {
      const language = langName(w.lang);
      const deck = bilingual ? `Kotiko::${deckPart(langName(w.base_lang))}::${deckPart(language)}` : `Kotiko::${deckPart(language)}`;
      return [front(w, careful), back(w), language, deck, `kotiko lang::${tagPart(w.lang)} base::${tagPart(w.base_lang)}`, `kotiko-${w.id}`].map(field).join("\t");
    });
    return `${[...head, ...rows].join("\n")}\n`;
  }

  const api = { CSV_COLUMNS, csv, anki, filename, day, front, back };
  globalThis.KotikoExportFiles = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
