#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Generates spec/languages.json and spec/lang-aliases.json (slice 08 section 1) from
// Unicode CLDR (the cldr-core and cldr-localenames-full npm packages, dev dependencies
// only) plus the hand-curated spec/tools/lang-curation.json.
//
//   node spec/tools/gen-lang-data.mjs           rewrite both files
//   node spec/tools/gen-lang-data.mjs --check   exit 1 if the committed files differ
//
// KOTIKO_CLDR_DIR may point at a node_modules folder holding the two packages (for a
// checkout whose node_modules can't be changed); otherwise they resolve normally.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const SPEC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.dirname(SPEC);
const require = createRequire(path.join(process.env.KOTIKO_CLDR_DIR || path.join(ROOT, "node_modules"), "x.js"));

const curation = JSON.parse(fs.readFileSync(path.join(SPEC, "tools/lang-curation.json"), "utf8"));
const cldr = (rel) => require(rel);
const cldrVersion = cldr("cldr-core/package.json").version;
const supplemental = (name) => cldr(`cldr-core/supplemental/${name}.json`).supplemental;
const aliasData = supplemental("aliases").metadata.alias;
const languageData = supplemental("languageData").languageData;
const likely = supplemental("likelySubtags").likelySubtags;
const scriptMeta = cldr("cldr-core/scriptMetadata.json").scriptMetadata;

const mainDir = path.dirname(require.resolve("cldr-localenames-full/package.json"));
const localeNames = (locale, kind) => {
  const file = path.join(mainDir, "main", locale, `${kind}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")).main[locale].localeDisplayNames[kind];
};

const LOCALES = curation.locales;
const names = Object.fromEntries(LOCALES.map((l) => [l, localeNames(l, "languages")]));
const invalid = new Set(curation.invalid);

// ── aliases ──────────────────────────────────────────────────────────

const language = {};
const legacy = {};
for (const [key, { _replacement: to }] of Object.entries(aliasData.languageAlias)) {
  if (key.startsWith("und-") || to.startsWith("und")) continue;
  if (key.includes("-")) legacy[key.toLowerCase()] = to;
  else language[key] = to;
}
for (const [from, to] of Object.entries(curation.aliases)) language[from] = to;

const sign = new Set(curation.sign);
for (const [key, { _replacement: to }] of Object.entries(aliasData.languageAlias)) {
  if (key.startsWith("sgn-")) sign.add(to);
}

// ── languages ────────────────────────────────────────────────────────

const primaryCodes = Object.keys(names.en)
  .filter((k) => /^[a-z]{2,3}$/.test(k) && !invalid.has(k) && !language[k])
  .concat(Object.keys(curation.languages))
  .filter((k, i, all) => all.indexOf(k) === i)
  .sort();

const scriptOf = (tag) => {
  const l = likely[tag];
  return l ? l.split("-")[1] : null;
};

const endonymOf = (code) => {
  const own = localeNames(code, "languages");
  return own?.[code] ?? null;
};

const languages = {};
for (const code of primaryCodes) {
  const cur = curation.languages[code] ?? {};
  const over = curation.overrides[code] ?? {};
  const script = over.script ?? cur.script ?? scriptOf(code) ?? languageData[code]?._scripts?.[0] ?? null;
  const fromData = languageData[code]?._scripts ?? [];
  const scripts = over.scripts ?? cur.scripts ?? (script ? [script, ...fromData.filter((s) => s !== script)] : fromData);
  const meta = script ? scriptMeta[script] : null;
  const entry = {
    endonym: cur.endonym ?? endonymOf(code),
    names: Object.fromEntries(
      LOCALES.map((l) => [l, cur.names?.[l] ?? names[l]?.[code] ?? null]).filter(([, n]) => n),
    ),
    script,
    scripts,
    caseful: meta?.hasCase === "YES",
    rtl: meta?.rtl === "YES",
    regions: over.regions ?? [],
    base_regions: over.base_regions ?? [],
    sign: sign.has(code),
  };
  for (const k of ["region_aliases", "region_scripts", "region_languages", "script_languages"]) {
    if (over[k]) entry[k] = over[k];
  }
  languages[code] = entry;
}

// Region and script names, only for the regions and scripts the tags can carry.
const regionCodes = new Set();
const scriptCodes = new Set();
for (const e of Object.values(languages)) {
  for (const r of [...e.regions, ...e.base_regions]) regionCodes.add(r);
  for (const s of e.scripts) scriptCodes.add(s);
}
const pick = (kind, codes) =>
  Object.fromEntries(
    LOCALES.map((l) => {
      const all = localeNames(l, kind);
      return [l, Object.fromEntries([...codes].sort().filter((c) => all[c]).map((c) => [c, all[c]]))];
    }),
  );

// Region and script aliases, only those landing on something a tag can keep.
const keptRegions = new Set(regionCodes);
for (const e of Object.values(languages)) {
  for (const k of ["region_aliases", "region_scripts", "region_languages"]) {
    for (const r of Object.keys(e[k] ?? {})) keptRegions.add(r);
  }
}
const territory = {};
for (const [from, { _replacement: to }] of Object.entries(aliasData.territoryAlias)) {
  const first = to.split(" ")[0];
  // Only keys a region subtag can be (two letters or three digits), landing on a region
  // some rule reads.
  if (/^([A-Z]{2}|\d{3})$/.test(from) && keptRegions.has(first)) territory[from] = first;
}
const script = Object.fromEntries(
  Object.entries(aliasData.scriptAlias).map(([from, { _replacement: to }]) => [from, to]),
);

// ── output ───────────────────────────────────────────────────────────

const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

// One language per line keeps the file reviewable and diffs small.
function languagesJson() {
  const lines = Object.entries(languages).map(([code, e]) => `    ${JSON.stringify(code)}: ${JSON.stringify(e)}`);
  return (
    "{\n" +
    `  "cldr_version": ${JSON.stringify(cldrVersion)},\n` +
    `  "locales": ${JSON.stringify(LOCALES)},\n` +
    `  "regionNames": ${JSON.stringify(pick("territories", regionCodes))},\n` +
    `  "scriptNames": ${JSON.stringify(pick("scripts", scriptCodes))},\n` +
    `  "unicode_scripts": ${JSON.stringify(curation.unicode_scripts)},\n` +
    `  "languages": {\n${lines.join(",\n")}\n  }\n}\n`
  );
}

function aliasesJson() {
  const out = {
    cldr_version: cldrVersion,
    invalid: [...invalid].sort(),
    sign: [...sign].sort(),
    language: sortKeys(language),
    legacy: sortKeys(legacy),
    script: sortKeys(script),
    territory: sortKeys(territory),
  };
  return JSON.stringify(out, null, 2) + "\n";
}

const outputs = { "languages.json": languagesJson(), "lang-aliases.json": aliasesJson() };

if (process.argv.includes("--check")) {
  let stale = false;
  for (const [file, text] of Object.entries(outputs)) {
    const current = fs.existsSync(path.join(SPEC, file)) ? fs.readFileSync(path.join(SPEC, file), "utf8") : "";
    if (current !== text) {
      console.error(`spec/${file} differs from what CLDR ${cldrVersion} and lang-curation.json produce.`);
      stale = true;
    }
  }
  if (stale) {
    console.error("Run: node spec/tools/gen-lang-data.mjs");
    process.exit(1);
  }
  console.log(`spec/languages.json and spec/lang-aliases.json match CLDR ${cldrVersion}.`);
} else {
  for (const [file, text] of Object.entries(outputs)) fs.writeFileSync(path.join(SPEC, file), text);
  console.log(`Wrote spec/languages.json (${primaryCodes.length} languages) and spec/lang-aliases.json from CLDR ${cldrVersion}.`);
}
