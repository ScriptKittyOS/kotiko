// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Turns the answers in docs/best-practices.md into bestpractices.dev "automation proposal"
// links (https://github.com/ossf/best-practices-badge/blob/main/docs/automation-proposals.md)
// and writes a local page with one button per form section. A maintainer opens a link,
// reviews the highlighted answers and saves; nothing is sent until they press Save.
//
//   node scripts/bestpractices-links.mjs             # writes the page, prints its path
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
    const at = (name) => row[header.indexOf(name)] ?? "";
    group.rows.push({
      criterion: at("Criterion").replace(/`/g, ""),
      level: at("Level"),
      status: at("Status"),
      answer: at("Answer"),
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

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function page({ project, groups }) {
  const all = links({ project, groups });
  const sections = SECTIONS.map(([name, slug]) => ({ name, slug, links: all.filter((l) => l.section === slug) }))
    .filter((s) => s.links.length);
  const count = (rows, s) => rows.filter((r) => r.status === s).length;
  const tally = (rows) =>
    STATUSES.map((s) => `<span class="pill ${s === "N/A" ? "na" : s.toLowerCase()}">${count(rows, s)} ${s}</span>`).join("");
  const body = sections
    .map((s) => {
      const rows = s.links.flatMap((l) => l.rows);
      const items = s.links
        .map((l, i) => {
          const id = `${s.slug}-${i}`;
          const list = l.rows
            .map((r) => `<li><code>${esc(r.criterion)}</code> <b>${esc(r.status)}</b> ${esc(r.answer)}</li>`)
            .join("");
          return `<li class="link">
  <label class="done"><input type="checkbox" data-id="${esc(id)}"> <span>${esc(l.title)}</span></label>
  <span class="tally">${tally(l.rows)}</span>
  <a class="cta" href="${esc(l.url)}" data-plain="${esc(l.url)}" data-force="${esc(l.forceUrl)}" target="_blank" rel="noopener">Open and review</a>
  <details><summary>${l.rows.length} answers</summary><ol>${list}</ol></details>
</li>`;
        })
        .join("\n");
      return `<section>
<h2>${esc(s.name)} <span class="tally">${tally(rows)}</span></h2>
<ul>${items}</ul>
</section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kotiko badge answers</title>
<style>
:root { --bg: #faf9fc; --card: #fff; --text: #1d1b22; --muted: #5d5868; --line: #e4e0ea; --accent: #6b3fd6;
  --accent-text: #fff; --met: #1f7a43; --unmet: #a3401c; --na: #5d5868; }
@media (prefers-color-scheme: dark) { :root { --bg: #141218; --card: #1e1b24; --text: #ece8f2; --muted: #a9a2b5;
  --line: #34303c; --accent: #a98bff; --accent-text: #141218; --met: #6fd39a; --unmet: #ff9b73; --na: #a9a2b5; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 24px; margin: 0 0 4px; }
h2 { font-size: 18px; margin: 32px 0 8px; display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
p, li { color: var(--muted); }
ol.steps li { margin: 4px 0; }
ul { list-style: none; padding: 0; margin: 0; }
li.link { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin: 8px 0;
  display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; align-items: center; color: var(--text); }
li.link details { grid-column: 1 / -1; }
li.link details li { margin: 6px 0; font-size: 13px; }
.done { display: flex; gap: 8px; align-items: center; font-weight: 600; }
.done input:checked + span { text-decoration: line-through; color: var(--muted); }
.tally { display: inline-flex; gap: 6px; flex-wrap: wrap; font-weight: 400; }
.pill { font-size: 12px; padding: 1px 8px; border-radius: 999px; border: 1px solid currentColor; }
.pill.met { color: var(--met); } .pill.unmet { color: var(--unmet); } .pill.na { color: var(--na); }
a.cta { grid-row: 1 / 3; grid-column: 2; background: var(--accent); color: var(--accent-text); text-decoration: none;
  padding: 8px 14px; border-radius: 8px; font-weight: 600; white-space: nowrap; }
a.cta:focus-visible, input:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.force { margin: 16px 0; display: flex; gap: 8px; align-items: center; color: var(--text); }
code { font-size: 12px; }
</style>
</head>
<body>
<main>
<h1>Kotiko badge answers</h1>
<p>Project <a href="${SITE}/en/projects/${esc(project)}">${esc(project)}</a> on bestpractices.dev, prefilled from
<code>docs/best-practices.md</code>.</p>
<ol class="steps">
<li>Sign in to bestpractices.dev first (the links work after sign-in too, but this saves a redirect).</li>
<li>Press <b>Open and review</b>. The form opens with the proposed answers highlighted in yellow (🤖).</li>
<li>Read them, change anything you disagree with, then press <b>Save</b> at the bottom of the form.</li>
<li>Tick the box here so you know it's done. Nothing reaches bestpractices.dev until you save.</li>
</ol>
<label class="force"><input type="checkbox" id="force"> Replace answers already on the form (only when updating answers saved before)</label>
${body}
</main>
<script>
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
for (const box of document.querySelectorAll("input[data-id]")) {
  const key = "kotiko-bp-done-" + box.dataset.id;
  box.checked = store.get(key) === "1";
  box.addEventListener("change", () => store.set(key, box.checked ? "1" : "0"));
}
document.getElementById("force").addEventListener("change", (e) => {
  for (const a of document.querySelectorAll("a.cta")) a.href = e.target.checked ? a.dataset.force : a.dataset.plain;
});
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
    const i = args.indexOf("--out");
    const out = resolve(i >= 0 ? args[i + 1] : join(tmpdir(), "kotiko-bestpractices.html"));
    writeFileSync(out, page(parsed));
    console.log(`${links(parsed).length} links for ${rows} answers. Open:\n${pathToFileURL(out).href}`);
  }
}
