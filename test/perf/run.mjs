// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Runs named benchmarks and compares each median with test/perf/budgets.json. With CI set,
// budgets are multiplied by their ci_factor to absorb noisy runners. Prints every result,
// exits 1 on a breach or on a benchmark without a budget.
//
//   npm run perf                      all benchmarks
//   npm run perf -- matcher.scan      only names containing "matcher.scan"
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireExt } from "../helpers/load-script.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const budgets = JSON.parse(fs.readFileSync(path.join(HERE, "budgets.json"), "utf8"));
const CI = !!process.env.CI;
const filter = process.argv[2] ?? "";

const { buildMatcher, matchCase, norm, skipLetter } = requireExt("lib/matcher.js");

// Deterministic pseudo-random numbers, so every run measures the same input.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const COMMON = [
  "the", "of", "and", "to", "in", "is", "you", "that", "it", "he", "was", "for", "on", "are",
  "as", "with", "his", "they", "at", "be", "this", "have", "from", "or", "one", "had", "by",
  "word", "but", "not", "what", "all", "were", "we", "when", "your", "can", "said", "there",
  "house", "water", "people", "information", "available", "thanks", "dog", "book", "time",
];

function pseudoWord(next, min = 3, max = 10) {
  const len = min + Math.floor(next() * (max - min + 1));
  let s = "";
  for (let i = 0; i < len; i++) s += LETTERS[Math.floor(next() * 26)];
  return s;
}

// About 250 KB of page text: common words, made-up words and punctuation, in text nodes
// of 40-400 characters, the way a long article or a feed arrives.
function generatePage(bytes = 250 * 1024) {
  const next = rng(250);
  const nodes = [];
  let size = 0;
  while (size < bytes) {
    const target = 40 + Math.floor(next() * 360);
    let text = "";
    while (text.length < target) {
      const w = next() < 0.8 ? COMMON[Math.floor(next() * COMMON.length)] : pseudoWord(next);
      text += (next() < 0.08 ? w[0].toUpperCase() + w.slice(1) : w) + (next() < 0.1 ? ", " : next() < 0.06 ? ". " : " ");
    }
    nodes.push(text);
    size += text.length;
  }
  return nodes;
}

// `count` English forms across a few languages: the common words first (so there are
// matches), then made-up words, with one in seven a two-word phrase.
function generateWords(count) {
  const next = rng(count);
  const langs = ["ru", "ar", "zh", "ja", "es"];
  const words = [];
  for (let i = 0; i < count; i++) {
    const base = i < COMMON.length ? COMMON[i] : pseudoWord(next, 4, 12);
    const english = i % 7 === 6 ? `${base} ${pseudoWord(next, 3, 8)}` : base;
    words.push({
      id: i + 1,
      lang: langs[i % langs.length],
      language: null,
      native: `w${i}`,
      romanization: null,
      english,
      forms: [english, `${english}s`],
      note: null,
    });
  }
  return words;
}

// The matching half of content.js's swapText, without the DOM: find each match, skip a
// lone capital that is a code, pick the language whose turn it is and case the native word.
function scan(matcher, nodes) {
  const { re, map, turns } = matcher;
  let swaps = 0;
  for (const text of nodes) {
    if (text.length < 2) continue;
    re.lastIndex = 0;
    if (!re.test(text)) continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const all = map.get(norm(m[0]));
      if (!all) continue;
      if (m[0].length === 1 && skipLetter(text, m.index)) continue;
      const turn = turns.get(all) ?? 0;
      turns.set(all, turn + 1);
      matchCase(m[0], all[turn % all.length].native);
      swaps++;
    }
  }
  return swaps;
}

const page = generatePage();
const pageKb = Math.round(page.reduce((n, t) => n + t.length, 0) / 1024);
const wordSets = { "1k": generateWords(500), "10k": generateWords(5000) }; // two forms per word

const benchmarks = {};
for (const [label, words] of Object.entries(wordSets)) {
  benchmarks[`matcher.build.${label}`] = () => buildMatcher(words, new Set());
  benchmarks[`matcher.scan.250kb.${label}`] = {
    setup: () => buildMatcher(words, new Set()),
    run: (matcher) => scan(matcher, page),
  };
}

// Median of several runs after warm-up. A benchmark that takes over a second (today's
// matcher with 10k forms) gets three runs and no warm-up, so the job stays short.
function measure(bench) {
  const { setup = () => undefined, run } = typeof bench === "function" ? { run: bench } : bench;
  const once = () => {
    const input = setup();
    const t = performance.now();
    const result = run(input);
    return { ms: performance.now() - t, result };
  };
  const first = once();
  const slow = first.ms > 1000;
  const times = slow ? [first.ms] : [];
  let result = first.result;
  if (!slow) once();
  for (let i = times.length; i < (slow ? 3 : 9); i++) {
    const r = once();
    times.push(r.ms);
    result = r.result;
  }
  times.sort((a, b) => a - b);
  return { median: times[Math.floor(times.length / 2)], min: times[0], max: times.at(-1), result };
}

console.log(`perf: ${pageKb} KB of page text in ${page.length} text nodes${CI ? " (CI budgets)" : ""}\n`);
const rows = [];
let failed = false;
for (const [name, bench] of Object.entries(benchmarks)) {
  if (!name.includes(filter)) continue;
  const { median, min, max, result } = measure(bench);
  const b = budgets[name];
  const limit = b ? b.budget_ms * (CI ? b.ci_factor ?? 1 : 1) : null;
  const ok = limit !== null && median <= limit;
  if (!ok) failed = true;
  rows.push({
    benchmark: name,
    "median ms": median.toFixed(2),
    "min ms": min.toFixed(2),
    "max ms": max.toFixed(2),
    "budget ms": limit === null ? "none" : String(limit),
    "target ms": b?.target_ms ?? "",
    result: typeof result === "number" ? `${result} swaps` : "",
    status: limit === null ? "NO BUDGET" : ok ? "ok" : "OVER BUDGET",
  });
}
console.table(rows);

if (!rows.length) {
  console.error(`No benchmark matches "${filter}".`);
  process.exit(1);
}
if (failed) {
  console.error("\nA benchmark is over budget or has none in test/perf/budgets.json.");
  process.exit(1);
}
