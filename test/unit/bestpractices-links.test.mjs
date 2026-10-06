// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// scripts/bestpractices-links.mjs: docs/best-practices.md to bestpractices.dev proposal links.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_URL, cells, links, page, parse, validate } from "../../scripts/bestpractices-links.mjs";

const doc = (rows, heading = "## Passing: Basics") => `# Answers

- **Entry:** https://www.bestpractices.dev/en/projects/42

${heading}

| Criterion | Level | Status | Answer | Evidence | Needs |
|---|---|---|---|---|---|
${rows.join("\n")}

## Silver: where things stand

| Criterion | Status | Evidence or what is needed |
|---|---|---|
| \`governance\` | Met | ignored: not a form table |
`;

test("a row splits on pipes but keeps escaped ones", () => {
  assert.deepEqual(cells("| `a` | MUST | Met | x \\| y | e | – |"), ["`a`", "MUST", "Met", "x | y", "e", "–"]);
});

test("reads the project number and only the form tables", () => {
  const parsed = parse(doc(["| `floss_license` | MUST | Met | Apache-2.0. | `LICENSE` | – |"]));
  assert.equal(parsed.project, "42");
  assert.deepEqual(parsed.groups, [
    { section: "passing", name: "Basics", rows: [{ criterion: "floss_license", level: "MUST", status: "Met", answer: "Apache-2.0." }] },
  ]);
  assert.deepEqual(validate(parsed), []);
});

test("field names keep their case, as the form matches them exactly", () => {
  const parsed = parse(doc(["| `require_2FA` | MUST [J] | Met | The org requires 2FA. | – | – |"], "## Gold: Security"));
  assert.deepEqual(validate(parsed), []);
  const [link] = links(parsed);
  assert.equal(new URL(link.url).searchParams.get("require_2FA_status"), "Met");
  assert.match(link.url, /\/projects\/42\/gold\/edit\?/);
});

test("the page shows the metal series unless Baseline is asked for", () => {
  const text = doc(["| `floss_license` | MUST | Met | Apache-2.0. | – | – |"]) +
    "\n## Baseline 1: General\n\n| Criterion | Level | Status | Answer | Evidence | Needs |\n|---|---|---|---|---|---|\n" +
    "| `osps_ac_01_01` | MUST | Met | Org requires 2FA. | – | – |\n";
  const parsed = parse(text);
  assert.equal(page(parsed).match(/class="cta"/g).length, 1);
  assert.doesNotMatch(page(parsed), /baseline-1\/edit/);
  assert.equal(page(parsed, { baseline: true }).match(/class="cta"/g).length, 2);
});

test("baseline headings map to the baseline sections", () => {
  const parsed = parse(doc(["| `osps_ac_01_01` | MUST [N/A J] | Met | Org requires 2FA. | gh api | – |"], "## Baseline 1: Access Control"));
  assert.equal(parsed.groups[0].section, "baseline-1");
});

test("links carry each status and justification, and the force link adds overrides", () => {
  const parsed = parse(doc([
    "| `floss_license` | MUST | Met | Apache-2.0 & more. | – | – |",
    "| `dco` | SHOULD | Unmet | Inbound = outbound. | – | – |",
  ]));
  const [link] = links(parsed);
  const url = new URL(link.url);
  assert.equal(url.origin + url.pathname, "https://www.bestpractices.dev/en/projects/42/passing/edit");
  assert.equal(url.searchParams.get("floss_license_status"), "Met");
  assert.equal(url.searchParams.get("floss_license_justification"), "Apache-2.0 & more.");
  assert.equal(url.searchParams.get("dco_status"), "Unmet");
  assert.equal(url.searchParams.get("overrides"), null);
  assert.equal(new URL(link.forceUrl).searchParams.get("overrides"), "floss_license_status,dco_status");
});

test("a group too long for one URL is split into parts that each fit", () => {
  const long = "x".repeat(900);
  const rows = Array.from({ length: 20 }, (_, i) => `| \`c_${i}\` | MUST | Met | ${long} | – | – |`);
  const out = links(parse(doc(rows)));
  assert.ok(out.length > 1);
  assert.match(out[0].title, /part 1 of \d+/);
  for (const l of out) assert.ok(l.forceUrl.length <= MAX_URL, `${l.title} is ${l.forceUrl.length}`);
  assert.equal(out.flatMap((l) => l.rows).length, 20);
});

test("validation names every problem", () => {
  const problems = validate(parse(doc([
    "| `contribution` | MUST [URL] | Met | See CONTRIBUTING. | – | – |",
    "| `contribution` | MUST | Met† | Old status. | – | – |",
    "| `english` | SHOULD | Met | Uses `code`. | – | – |",
    "| `maintained` | MUST | Unmet |  | – | – |",
  ])));
  assert.ok(problems.some((p) => /contribution: a Met answer here needs a URL/.test(p)));
  assert.ok(problems.some((p) => /contribution: answered twice/.test(p)));
  assert.ok(problems.some((p) => /status "Met†"/.test(p)));
  assert.ok(problems.some((p) => /english: the answer has markdown backticks/.test(p)));
  assert.ok(problems.some((p) => /maintained: no answer/.test(p)));
});

test("the page escapes answers and links every group", () => {
  const parsed = parse(doc(["| `english` | SHOULD | Met | Reports in <b>English</b> welcome. | – | – |"]));
  const html = page(parsed);
  assert.match(html, /Reports in &lt;b&gt;English&lt;\/b&gt; welcome\./);
  assert.equal(html.match(/class="cta"/g).length, 1);
  assert.match(html, /<title>Kotiko badge answers<\/title>/);
});

test("docs/best-practices.md is valid as written", () => {
  const parsed = parse(readFileSync(new URL("../../docs/best-practices.md", import.meta.url), "utf8"));
  assert.deepEqual(validate(parsed), []);
  assert.ok(parsed.groups.some((g) => g.section === "passing"));
});
