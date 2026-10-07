#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The store uploads wait for the pre-release security review (slice 54; DECISIONS
// 2026-10-02). The review ends with docs/security/review-vX.Y.Z-rc.N.md, in which the lead
// closes the gate with one line of exactly this form, on a line of its own, above the
// "## Appendix" heading under which the reviewers' reports are appended unchanged:
//
//   Gate: closed 2026-11-02 by <lead>, fixes confirmed on v1.0.0-rc.2
//
// The candidate named is one of the reviewed version's (1.0.0 here). Above the appendix the
// report has exactly one line starting "Gate:", so a "Gate: open" line keeps it open. Lines
// below the appendix count for nothing: a reviewer's report may quote the phrase (security
// review C-05).
//
// "One gate line" is judged as a reader sees the text, not byte by byte (security review
// D-05: an open line in a Cyrillic letter, behind a zero-width space or with a fullwidth
// colon sat unseen beside the closed one; E-06: in a list, a table, inline code, HTML, an
// entity or prose). Lines above the appendix are read several ways, and a line counts as a
// gate line if any reading of it, or of it joined with the next line (a paragraph's soft
// break), has the word "gate" followed, within a few non-letters, by a colon-like or
// table-cell separator. A reading: the line as written, and with HTML comments taken out
// (also across lines); then HTML tags removed, entities decoded (`&#97;`, `&colon;`),
// NFKC, invisible characters and combining marks removed. In the word, any non-ASCII
// character stands in for a letter, and any non-ASCII symbol for the colon, so lookalikes
// from every script count without a confusables table. Text inside HTML comments and code
// still counts: a stray `<!-- Gate: open -->` keeps the gate open, which is the safe side.
// A paragraph (or line) that says "open" next to "gate", "review" or "status" keeps it
// open too ("Status: the review is still OPEN"). That is stricter than a reader, and the
// message says which line.
//
// The closed line itself must be the exact ASCII form, visible: not inside an HTML
// comment, a code fence or an HTML block, and in a paragraph without strikethrough, HTML,
// math, code or entity markup (`~ < $ \` &`). The "## Appendix" heading is the first one
// that is visible, in plain ASCII (security review E-06: one inside a comment or code
// fence, or followed by a zero-width character, doesn't count).
//
// This check passes when the tagged tree has a closed report. With --version X.Y.Z (the
// release workflow passes the tag's), a review opened for that version must itself be
// closed; a version without its own review is gated by the earlier ones. The release
// workflow runs it before asking for the `release` environment's approval, so no store
// upload can happen before the first review is done. Later releases that touch
// permissions, messaging, secrets, the server's API or the bot reopen the review by hand: a
// box on the release checklist (docs/stores.md).
//
//   node scripts/check-security-gate.mjs [--dir docs/security] [--version X.Y.Z]

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPORT_RE = /^review-v(\d+\.\d+\.\d+)(?:-rc\.\d+)?\.md$/;
export const CLOSED_RE = /^Gate: closed (\d{4}-\d{2}-\d{2}) by (.+), fixes confirmed on (v\d+\.\d+\.\d+-rc\.\d+)$/;
export const APPENDIX_RE = /^## Appendix(?:[:\s].*)?$/;
const PLAIN = /^[\x20-\x7E]*$/;
// Each letter of `word`, or any non-ASCII character in its place.
const look = (word) => [...word].map((c) => `[${c}\\P{ASCII}]`).join("");
const WORD = (w) => `(?<![\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`;
// The gate word, then a few non-letters, then a colon-like or table-cell separator (D-05,
// E-06): `Gate:`, `**Gate:**`, `| Gate |`, `$Gate$:`, `Gate꞉`, `Gate → open`.
const GATE_RE = new RegExp(`${WORD(look("gate"))}[^\\p{L}\\p{N}:|=]{0,6}?(?:[:|=]|[^\\p{ASCII}\\p{L}\\p{N}\\p{Z}])`, "giu");
const OPEN_RE = new RegExp(WORD(look("open")), "iu");
const STATUS_RE = new RegExp(`${WORD(look("gate"))}|${WORD(look("review"))}|${WORD(look("status"))}`, "iu");
// Markup that could change how the closed line reads, in its paragraph (E-06).
const MARKUP_RE = /[~<$`&]/;

/** A line as a reader sees it: NFKC, without invisible characters or combining marks. */
const visible = (line) =>
  line
    .normalize("NFKC")
    .replace(/[\p{Cf}\p{DI}]/gu, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC");

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", colon: ":", vert: "|", verbar: "|", VerticalLine: "|", num: "#", period: ".", comma: ",", semi: ";", lowbar: "_", ast: "*", grave: "`", tilde: "~", dollar: "$", equals: "=", hyphen: "-", dash: "‐", ndash: "–", mdash: "—", lpar: "(", rpar: ")" };
// An entity the table doesn't know becomes a non-ASCII character, which stands in for a
// letter or the colon, as a lookalike does.
const decode = (text) =>
  text.replace(/&(?:#(\d{1,7})|#[xX]([0-9A-Fa-f]{1,6})|([A-Za-z][A-Za-z0-9]{0,31}));?/g, (_whole, dec, hex, name) => {
    if (name) return ENTITIES[name] ?? "�";
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
  });
// Tags come out until none is left, so one hidden inside another ("<<b>b>") goes too.
const stripTags = (line) => {
  let out = line;
  for (let prev = null; prev !== out; ) {
    prev = out;
    out = out.replace(/<\/?[A-Za-z][^>]*>/g, "");
  }
  return out;
};
const render = (line) => visible(decode(stripTags(line)));

// The text with every HTML comment taken out (also over several lines; an unclosed one
// runs to the end), as lines, each with the number of the line it starts on.
function withoutComments(lines) {
  const out = [{ text: "", n: 1 }];
  let n = 1;
  const text = lines.join("\n");
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("<!--", i);
    const keep = text.slice(i, open < 0 ? text.length : open);
    for (const ch of keep) {
      if (ch === "\n") out.push({ text: "", n: ++n });
      else out[out.length - 1].text += ch;
    }
    if (open < 0) break;
    const close = text.indexOf("-->", open + 4);
    const end = close < 0 ? text.length : close + 3;
    n += (text.slice(open, end).match(/\n/g) ?? []).length;
    i = end;
  }
  return out;
}

// Which lines a reader can't see, or can't take as plain text: inside a code fence (its
// fences too), an HTML comment, or an HTML block (a line starting with a tag, to the next
// blank line). Generous on purpose: it decides where the appendix starts and whether the
// closed line is visible, where hiding too much only keeps the gate open.
function hiddenLines(lines) {
  const hidden = [];
  let fence = null;
  let comment = false;
  let html = false;
  for (const line of lines) {
    let hide = false;
    if (fence) {
      hide = true;
      const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
    } else if (comment) {
      hide = true;
      const close = line.indexOf("-->");
      if (close >= 0) comment = line.indexOf("<!--", close) > close;
    } else if (html) {
      hide = line.trim() !== "";
      html = hide;
    } else if (/^ {0,3}(`{3,}|~{3,})/.test(line)) {
      fence = /^ {0,3}(`{3,}|~{3,})/.exec(line)[1];
      hide = true;
    } else if (line.includes("<!--")) {
      hide = true;
      comment = line.lastIndexOf("<!--") > line.lastIndexOf("-->");
    } else if (/^ {0,3}<[A-Za-z/!?]/.test(line)) {
      hide = true;
      html = true;
    }
    hidden.push(hide);
  }
  return hidden;
}

// Every reading of the lines (see above): [{ text, n }], n the line it starts on.
function readings(lines) {
  return [lines.map((text, i) => ({ text, n: i + 1 })), withoutComments(lines)].map((read) => read.map((l) => ({ ...l, text: render(l.text) })));
}

// The numbers of the lines that read as a gate line.
function gateLines(lines) {
  const found = new Set();
  for (const read of readings(lines)) {
    read.forEach((line, i) => {
      const next = read[i + 1]?.text ?? "";
      for (const m of `${line.text} ${next}`.matchAll(GATE_RE)) if (m.index < line.text.length) found.add(line.n);
    });
  }
  return [...found].sort((a, b) => a - b);
}

// The line that says "open" in a paragraph that also says "gate", "review" or "status", or 0.
// Each list item, table row and heading is a paragraph of its own.
function openLine(lines) {
  for (const read of readings(lines)) {
    let para = [];
    const check = () => {
      const text = para.map((l) => l.text).join(" ");
      return OPEN_RE.test(text) && STATUS_RE.test(text) ? (para.find((l) => OPEN_RE.test(l.text)) ?? para[0]).n : 0;
    };
    for (const line of [...read, { text: "", n: 0 }]) {
      const own = /^\s*(?:[-*+>|#]|\d+[.)])/.test(line.text);
      if ((line.text.trim() === "" || own) && para.length) {
        const n = check();
        if (n) return n;
        para = [];
      }
      if (line.text.trim() !== "") para.push(line);
      if (own && para.length) {
        const n = check();
        if (n) return n;
        para = [];
      }
    }
  }
  return 0;
}

// The lines of the paragraph line n (1-based) is in.
function paragraphOf(lines, n) {
  let a = n - 1;
  let b = n - 1;
  while (a > 0 && lines[a - 1].trim() !== "") a--;
  while (b < lines.length - 1 && lines[b + 1].trim() !== "") b++;
  return lines.slice(a, b + 1);
}

const realDate = (d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);

/** `{ gate }` (date, lead, candidate) when the report's gate is closed, else `{ problem }`. */
function readGate(text) {
  const lines = text.split(/\r?\n/);
  const hidden = hiddenLines(lines);
  const end = lines.findIndex((l, i) => !hidden[i] && PLAIN.test(l) && APPENDIX_RE.test(l));
  if (end < 0) return { problem: 'no visible "## Appendix" heading in plain ASCII' };
  const above = lines.slice(0, end);
  const gates = gateLines(above);
  if (gates.length === 0) return { problem: 'no "Gate:" line above the appendix' };
  if (gates.length > 1) {
    return { problem: `${gates.length} lines above the appendix read as a gate line (lines ${gates.join(", ")}); keep only the one` };
  }
  const [n] = gates;
  const line = lines[n - 1];
  if (!PLAIN.test(line)) {
    return { problem: `line ${n} reads as a gate line but has characters outside plain ASCII (a lookalike letter, an invisible or fullwidth character); write it in plain ASCII` };
  }
  const m = line.match(CLOSED_RE);
  if (!m) return { problem: `line ${n} is not the exact closed line` };
  if (hidden[n - 1]) return { problem: `line ${n}, the closed line, is inside an HTML comment, a code block or an HTML block, where a reader doesn't see it as it is` };
  if (paragraphOf(lines, n).some((l) => MARKUP_RE.test(l))) {
    return { problem: `line ${n}, the closed line, shares its paragraph with markup that could change how it reads (~ < $ \` &); put it on its own, with a blank line before and after` };
  }
  const said = openLine(above);
  if (said) return { problem: `line ${said} says "open" beside "gate", "review" or "status" above the appendix; once the gate is closed, only the closed line says how it stands` };
  if (!realDate(m[1])) return { problem: `line ${n}: ${m[1]} is not a date` };
  return { gate: { date: m[1], by: m[2], candidate: m[3] } };
}

/** The lead's closing line in a report's text, or null while the gate is open. */
export function gateLine(text) {
  return readGate(text).gate ?? null;
}

/** Why a report's gate is open (one sentence), or null when its closing line is in order. */
export function gateProblem(text) {
  return readGate(text).problem ?? null;
}

const core = (tag) => tag.replace(/^v/, "").replace(/-rc\.\d+$/, "");

/** Report files in dir whose gate is closed; with version, as that version's release sees them. */
export function closedReviews(dir, { version } = {}) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  return reviews(dir, names, version)
    .filter((r) => !r.problem)
    .map((r) => r.name);
}

/** Every report the release would read, each with why its gate is open (or no problem). */
function reviews(dir, names, version) {
  let reports = names.filter((n) => REPORT_RE.test(n)).sort();
  if (version && reports.some((n) => n.match(REPORT_RE)[1] === version)) {
    reports = reports.filter((n) => n.match(REPORT_RE)[1] === version);
  }
  return reports.map((name) => {
    const { gate, problem } = readGate(readFileSync(join(dir, name), "utf8"));
    const reviewed = name.match(REPORT_RE)[1];
    if (problem) return { name, problem };
    if (core(gate.candidate) !== reviewed) return { name, problem: `${gate.candidate} is not a candidate of ${reviewed}` };
    return { name, problem: null };
  });
}

/** Why each report's gate is open, as "file: reason" lines. */
export function openReasons(dir, { version } = {}) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  return reviews(dir, names, version)
    .filter((r) => r.problem)
    .map((r) => `${r.name}: ${r.problem}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const dir = arg("--dir") ? resolve(arg("--dir")) : join(ROOT, "docs/security");
  const version = arg("--version");
  if (version !== undefined && !/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(version)) {
    console.error(`check-security-gate: --version takes X.Y.Z, not ${version}`);
    process.exit(2);
  }
  const closed = closedReviews(dir, { version: version && core(version) });
  if (closed.length) {
    console.log(`Security review closed: ${closed.join(", ")}`);
  } else {
    console.error(
      "check-security-gate: no closed security review. Store uploads wait for slice 54's review: " +
        "docs/security/review-vX.Y.Z-rc.N.md with, above its \"## Appendix\" heading, the one line " +
        "\"Gate: closed YYYY-MM-DD by <lead>, fixes confirmed on vX.Y.Z-rc.N\"" +
        (version ? `, and if ${core(version)} has its own review, that one closed.` : "."),
    );
    for (const reason of openReasons(dir, { version: version && core(version) })) console.error(`  ${reason}`);
    process.exitCode = 1;
  }
}
