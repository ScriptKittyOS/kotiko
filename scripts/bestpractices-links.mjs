// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Turns the answers in docs/best-practices.md into bestpractices.dev "automation proposal"
// links (https://github.com/ossf/best-practices-badge/blob/main/docs/automation-proposals.md)
// and writes a local page with one button per form section. A maintainer opens a link,
// reviews the highlighted answers and saves; nothing is sent until they press Save.
//
//   node scripts/bestpractices-links.mjs             # the page: only answers that differ from the live entry
//   node scripts/bestpractices-links.mjs --baseline  # also the OpenSSF Baseline levels
//   node scripts/bestpractices-links.mjs --all       # every answer, for a new entry
//   node scripts/bestpractices-links.mjs --out x.html
//   node scripts/bestpractices-links.mjs --check     # validates the answers (CI)
//
// No dependencies, so CI can run it before `npm ci`.
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SITE = "https://www.bestpractices.dev";
// The form's sections, in the order a maintainer fills them.
export const SECTIONS = [
  ["Passing", "passing"],
  ["Silver", "silver"],
  ["Gold", "gold"],
  ["Baseline 1", "baseline-1"],
  ["Baseline 2", "baseline-2"],
  ["Baseline 3", "baseline-3"],
];
export const STATUSES = ["Met", "Unmet", "N/A"];
// Measured 2026-10-06: bestpractices.dev answers 414 somewhere between 8,000 and 12,000
// characters, and a signed-out visit is redirected to the login page with the link encoded
// again in `return_to` (a 5,981-character link became 7,685). 6,000 leaves room for both.
export const MAX_URL = 6000;

const HEADING_RE = new RegExp(`^## (${SECTIONS.map(([n]) => n).join("|")}): (.+)$`);

// Splits a markdown table row on unescaped pipes.
export function cells(line) {
  const out = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && line[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (c === "|") {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out.slice(1, -1);
}

// Reads every "## <Section>: <Group>" table with the columns
// Criterion | Level | Status | Answer | Evidence | Needs.
export function parse(text) {
  const project = text.match(/bestpractices\.dev\/(?:[a-z]{2}\/)?projects\/(\d+)/)?.[1] ?? null;
  const groups = [];
  let group = null;
  let header = null;
  for (const line of text.split("\n")) {
    const h = line.match(HEADING_RE);
    if (h) {
      group = { section: SECTIONS.find(([n]) => n === h[1])[1], name: h[2].trim(), rows: [] };
      groups.push(group);
      header = null;
      continue;
    }
    if (line.startsWith("## ")) {
      group = null;
      continue;
    }
    if (!group || !line.startsWith("|")) continue;
    const row = cells(line);
    if (!header) {
      // Planning tables without an Answer column aren't form answers.
      if (row[0] === "Criterion" && row.includes("Answer") && row.includes("Status")) header = row;
      continue;
    }
    if (row.every((c) => /^-+$/.test(c))) continue;
    const cell = {};
    for (let i = 0; i < header.length; i++) cell[header[i]] = row[i] ?? "";
    group.rows.push({
      criterion: cell.Criterion.replace(/`/g, ""),
      level: cell.Level ?? "",
      status: cell.Status,
      answer: cell.Answer,
    });
  }
  return { project, groups: groups.filter((g) => g.rows.length) };
}

// Returns a list of problems; empty means every answer can go on the form as written.
export function validate({ project, groups }) {
  const problems = [];
  if (!project) problems.push("No bestpractices.dev project number found in the document.");
  const seen = new Map();
  for (const g of groups) {
    for (const r of g.rows) {
      const where = `${g.section} / ${g.name} / ${r.criterion}`;
      // Field names are matched exactly, case included (gold has `require_2FA`).
      if (!/^[A-Za-z0-9_]+$/.test(r.criterion)) problems.push(`${where}: not a field name`);
      const key = `${g.section}:${r.criterion}`;
      if (seen.has(key)) problems.push(`${where}: answered twice`);
      seen.set(key, true);
      if (!STATUSES.includes(r.status)) {
        problems.push(`${where}: status "${r.status}" isn't one of ${STATUSES.join(", ")}`);
      }
      if (!r.answer) problems.push(`${where}: no answer`);
      if (/`/.test(r.answer)) problems.push(`${where}: the answer has markdown backticks`);
      if (r.status === "Met" && /\[URL\]/.test(r.level) && !/https:\/\/\S+/.test(r.answer)) {
        problems.push(`${where}: a Met answer here needs a URL`);
      }
    }
  }
  // A criterion repeated at a higher metal level is the same field on the entry: saving one
  // form overwrites the other, so every copy must say the same thing.
  const metal = new Map();
  for (const g of groups) {
    if (g.section.startsWith("baseline")) continue;
    for (const r of g.rows) {
      const first = metal.get(r.criterion);
      if (!first) metal.set(r.criterion, { ...r, section: g.section });
      else if (first.status !== r.status || first.answer !== r.answer) {
        problems.push(`${g.section} / ${r.criterion}: differs from its ${first.section} copy (one field on the entry)`);
      }
    }
  }
  for (const link of links({ project: project ?? "0", groups })) {
    if (link.url.length > MAX_URL) problems.push(`${link.title}: one answer alone is too long for a link`);
  }
  return problems;
}

function urlFor(project, section, rows, force) {
  const params = new URLSearchParams();
  for (const r of rows) {
    params.append(`${r.criterion}_status`, r.status);
    params.append(`${r.criterion}_justification`, r.answer);
  }
  if (force) params.append("overrides", rows.map((r) => `${r.criterion}_status`).join(","));
  return `${SITE}/en/projects/${project}/${section}/edit?${params}`;
}

// One link per group, split into parts when a group's answers don't fit in one URL.
export function links({ project, groups }) {
  const out = [];
  for (const g of groups) {
    const parts = [];
    let part = [];
    for (const r of g.rows) {
      if (part.length && urlFor(project, g.section, [...part, r], true).length > MAX_URL) {
        parts.push(part);
        part = [];
      }
      part.push(r);
    }
    if (part.length) parts.push(part);
    parts.forEach((rows, i) => {
      const suffix = parts.length > 1 ? ` (part ${i + 1} of ${parts.length})` : "";
      out.push({
        section: g.section,
        title: `${g.name}${suffix}`,
        rows,
        url: urlFor(project, g.section, rows, false),
        forceUrl: urlFor(project, g.section, rows, true),
      });
    });
  }
  return out;
}

// The entry's own JSON names a Baseline field by its OSPS id (OSPS-AC-01.01_status); the form
// and the proposal links use the field name (osps_ac_01_01_status).
export const entryKey = (criterion) =>
  criterion.replace(/^osps_([a-z]{2})_(\d{2})_(\d{2})$/, (_, c, a, b) => `OSPS-${c.toUpperCase()}-${a}.${b}`);

const same = (a, b) => String(a ?? "").replace(/\s+/g, " ").trim() === String(b ?? "").replace(/\s+/g, " ").trim();

// The answers that differ from what is saved on the entry (status or justification), per
// form, each with the saved status as `was`. With no entry, every answer.
export function changes({ groups }, entry = null) {
  const bySection = new Map();
  for (const g of groups) {
    for (const r of g.rows) {
      const key = entryKey(r.criterion);
      const was = entry ? entry[`${key}_status`] ?? "?" : null;
      if (entry && was === r.status && same(entry[`${key}_justification`], r.answer)) continue;
      if (!bySection.has(g.section)) bySection.set(g.section, []);
      bySection.get(g.section).push({ ...r, was });
    }
  }
  return bySection;
}

// As few links as fit for one form, each replacing what is saved (overrides).
export function formLinks(project, section, rows) {
  const parts = [];
  let part = [];
  for (const r of rows) {
    if (part.length && urlFor(project, section, [...part, r], true).length > MAX_URL) {
      parts.push(part);
      part = [];
    }
    part.push(r);
  }
  if (part.length) parts.push(part);
  return parts.map((partRows) => ({ rows: partRows, url: urlFor(project, section, partRows, true) }));
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// The page: one card per form with the answers to update and one button per link. The metal
// series (passing, silver, gold) is the badge the README shows; Baseline only when asked for.
export function page(parsed, { entry = null, baseline = false, checked = "" } = {}) {
  const { project } = parsed;
  const pending = changes(parsed, entry);
  const forms = SECTIONS.filter(([, slug]) => baseline || !slug.startsWith("baseline"));
  const total = forms.reduce((n, [, slug]) => n + (pending.get(slug)?.length ?? 0), 0);
  const cards = forms
    .map(([name, slug]) => {
      const rows = pending.get(slug) ?? [];
      if (!rows.length) {
        return `<section class="card done-card"><h2>${esc(name)}</h2><p class="ok">Up to date: nothing to save.</p></section>`;
      }
      const parts = formLinks(project, slug, rows);
      const buttons = parts
        .map((l, i) => {
          const id = `${slug}-${i}`;
          const label = parts.length > 1 ? `Open ${name} form, part ${i + 1} of ${parts.length}` : `Open ${name} form`;
          const items = l.rows
            .map((r) => {
              const from = r.was === null ? "" : r.was === r.status ? "new wording" : `${r.was === "?" ? "blank" : r.was} → ${r.status}`;
              return `<li><code>${esc(r.criterion)}</code> <span class="pill ${r.status === "N/A" ? "na" : r.status.toLowerCase()}">${esc(r.status)}</span> <span class="from">${esc(from)}</span></li>`;
            })
            .join("");
          return `<div class="part">
  <a class="cta" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(label)}</a>
  <label class="tick"><input type="checkbox" data-id="${esc(id)}"> Saved</label>
  <ul class="items">${items}</ul>
</div>`;
        })
        .join("\n");
      return `<section class="card"><h2>${esc(name)} <span class="count">${rows.length} to update</span></h2>${buttons}</section>`;
    })
    .join("\n");
  const intro = entry
    ? `<p class="lede">${total ? `${total} answers on <a href="${SITE}/en/projects/${esc(project)}">your entry</a> differ from <code>docs/best-practices.md</code>.` : "Every answer on your entry already matches <code>docs/best-practices.md</code>."} Compared with the live entry${checked ? ` on ${esc(checked)}` : ""}; run the script again after saving to see what's left.</p>`
    : `<p class="lede">All answers in <code>docs/best-practices.md</code>, for a new entry.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kotiko badge answers</title>
<style>
:root { --bg: #f7f7fa; --card: #fff; --text: #1d1b22; --muted: #5d5868; --line: #e4e0ea; --accent: #6b3fd6;
  --accent-text: #fff; --met: #1f7a43; --unmet: #a3401c; --na: #5d5868; --ok-bg: #e9f6ee; }
@media (prefers-color-scheme: dark) { :root { --bg: #141218; --card: #1e1b24; --text: #ece8f2; --muted: #a9a2b5;
  --line: #34303c; --accent: #a98bff; --accent-text: #141218; --met: #6fd39a; --unmet: #ff9b73; --na: #a9a2b5; --ok-bg: #15301f; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 24px 16px 64px; display: grid; gap: 16px; }
h1 { font-size: 24px; margin: 0; }
h2 { font-size: 18px; margin: 0; display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.lede, ol.steps { color: var(--muted); margin: 0; }
ol.steps { padding-left: 20px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; display: grid; gap: 12px; }
.done-card { background: var(--ok-bg); }
.ok { margin: 0; color: var(--met); font-weight: 600; }
.count { font-size: 13px; color: var(--muted); font-weight: 400; }
.part { display: grid; gap: 8px; border-top: 1px solid var(--line); padding-top: 12px; }
.part:first-of-type { border-top: 0; padding-top: 0; }
a.cta { justify-self: start; background: var(--accent); color: var(--accent-text); text-decoration: none; padding: 10px 16px;
  border-radius: 8px; font-weight: 600; }
.tick { display: flex; gap: 6px; align-items: center; color: var(--muted); font-size: 14px; }
ul.items { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 14px; }
.from { color: var(--muted); font-size: 13px; }
.pill { font-size: 12px; padding: 0 8px; border-radius: 999px; border: 1px solid currentColor; }
.pill.met { color: var(--met); } .pill.unmet { color: var(--unmet); } .pill.na { color: var(--na); }
a.cta:focus-visible, input:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
code { font-size: 13px; overflow-wrap: anywhere; }
</style>
</head>
<body>
<main>
<h1>Kotiko badge answers</h1>
${intro}
<ol class="steps">
<li>Sign in to <a href="${SITE}/en/login">bestpractices.dev</a>.</li>
<li>Press a button. The form opens with our answers already put in, replacing what was saved.</li>
<li>Scroll to the bottom of the form and press <b>Save</b>. Then tick <b>Saved</b> here.</li>
</ol>
${cards}
</main>
<script>
for (const box of document.querySelectorAll("input[data-id]")) {
  const key = "kotiko-bp-saved-" + box.dataset.id;
  try { box.checked = localStorage.getItem(key) === "1"; } catch {}
  box.addEventListener("change", () => { try { localStorage.setItem(key, box.checked ? "1" : "0"); } catch {} });
}
</script>
</body>
</html>
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const doc = readFileSync(new URL("../docs/best-practices.md", import.meta.url), "utf8");
  const parsed = parse(doc);
  const problems = validate(parsed);
  if (problems.length) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
  const rows = parsed.groups.flatMap((g) => g.rows).length;
  if (args.includes("--check")) {
    console.log(`docs/best-practices.md: ${rows} answers in ${parsed.groups.length} groups, all valid.`);
  } else {
    let entry = null;
    if (!args.includes("--all")) {
      const res = await fetch(`${SITE}/projects/${parsed.project}.json`, { cache: "no-store" });
      if (!res.ok) {
        console.error(`Couldn't read the entry (${res.status}). Use --all to list every answer instead.`);
        process.exit(1);
      }
      entry = await res.json();
    }
    const i = args.indexOf("--out");
    const out = resolve(i >= 0 ? args[i + 1] : join(tmpdir(), "kotiko-bestpractices.html"));
    const html = page(parsed, { entry, baseline: args.includes("--baseline"), checked: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC" });
    writeFileSync(out, html);
    console.log(`${(html.match(/class="cta"/g) ?? []).length} buttons. Open:\n${pathToFileURL(out).href}`);
  }
}
