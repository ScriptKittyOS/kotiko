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

const Text = requireExt("lib/text.js");
const { buildIndex, scan: scanText, skipLetter } = requireExt("lib/matcher.js");
const { display } = requireExt("lib/casing.js");
const BOUNDARIES = JSON.parse(fs.readFileSync(path.join(HERE, "../../spec/lang/_generic/boundaries.json"), "utf8"));
const { cardFor } = requireExt("lib/word-card.js");
const { pickVoice } = requireExt("lib/speak.js");

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
    const gloss = i % 7 === 6 ? `${base} ${pseudoWord(next, 3, 8)}` : base;
    words.push({ id: i + 1, lang: langs[i % langs.length], native: `w${i}`, base_lang: "en", gloss, forms: [gloss, `${gloss}s`], status: "active" });
  }
  return words;
}

// Japanese pages (slice 14's budget: 100,000 nodes of about 20 characters, 5,000 forms):
// short sentences of common words and particles, written without spaces. The learner
// knows the first six words of the page's vocabulary, so a node has a word or two to swap.
const JA_COMMON = ["犬", "好き", "食べた", "コーヒー", "水", "本", "猫", "です", "時間", "日本", "学校", "先生", "友達", "今日", "明日", "家", "車", "電車", "会社", "仕事", "映画", "音楽", "天気", "新聞", "大学", "病院", "銀行", "部屋", "料理", "旅行"];
const JA_KNOWN = 6;
const JA_PARTICLES = ["が", "を", "に", "は", "で", "と", "の", "も"];
function generateJapanese(count = 100_000) {
  const next = rng(42);
  const nodes = [];
  for (let i = 0; i < count; i++) {
    let text = "";
    while (text.length < 20) text += JA_COMMON[Math.floor(next() * JA_COMMON.length)] + JA_PARTICLES[Math.floor(next() * JA_PARTICLES.length)];
    nodes.push(`${text}。`);
  }
  return nodes;
}
function generateJapaneseWords(count) {
  const next = rng(count + 1);
  const kana = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわん";
  const words = JA_COMMON.slice(0, JA_KNOWN).map((f, i) => ({ id: i + 1, lang: "ko", native: `w${i}`, base_lang: "ja", gloss: f, forms: [f], status: "active" }));
  for (let i = words.length; i < count; i++) {
    let f = "";
    for (let n = 2 + Math.floor(next() * 3); n > 0; n--) f += kana[Math.floor(next() * kana.length)];
    words.push({ id: i + 1, lang: "ko", native: `w${i}`, base_lang: "ja", gloss: f, forms: [f], status: "active" });
  }
  return words;
}

// The matching half of content.js, without the DOM: scan each node in its base, skip a
// lone capital that is a code, pick the language whose turn it is and case the native word.
function scan(index, nodes) {
  const turns = new Map();
  let swaps = 0;
  for (const text of nodes) {
    for (const m of scanText(text, { base: index.base }, index).matches) {
      if (m.surface.length === 1 && skipLetter(text, m.start)) continue;
      const all = m.entry.candidates;
      const turn = turns.get(m.entry) ?? 0;
      turns.set(m.entry, turn + 1);
      const w = all[turn % all.length].word;
      display({ shape: m.shape, sentenceStart: m.shape === "title" && m.sentenceStart, shouting: false, native: w.native, lang: w.lang });
      swaps++;
    }
  }
  return swaps;
}

const page = generatePage();
const pageKb = Math.round(page.reduce((n, t) => n + t.length, 0) / 1024);
const wordSets = { "1k": generateWords(500), "10k": generateWords(5000) }; // two forms per word
const build = (words, base) => buildIndex(words, { base, rules: Text.rulesFor(BOUNDARIES, base) });

const benchmarks = {};
for (const [label, words] of Object.entries(wordSets)) {
  benchmarks[`matcher.build.${label}`] = () => `${build(words, "en").size}`;
  benchmarks[`matcher.scan.250kb.${label}`] = {
    setup: () => build(words, "en"),
    run: (index) => scan(index, page),
  };
}
const jaPage = generateJapanese();
benchmarks["matcher.build.ja.5k"] = () => `${build(generateJapaneseWords(5000), "ja").size}`;
benchmarks["matcher.scan.ja.100k-nodes.5k"] = {
  setup: () => build(generateJapaneseWords(5000), "ja"),
  run: (index) => scan(index, jaPage),
};

// The word card (slice 19 §11: opening costs at most ~4 ms) and the voice choice behind its
// speak button (34): 1,000 cards and 1,000 voice choices, so one open is a thousandth.
const { POPOVER_WORDS } = await import("../helpers/popover-words.mjs");
const voices = JSON.parse(fs.readFileSync(path.join(HERE, "../fixtures/speech/voices.json"), "utf8"));
const allVoices = Object.values(voices).filter(Array.isArray).flat();
benchmarks["wordcard.cardFor.x1000"] = () => {
  let n = 0;
  for (let i = 0; i < 1000; i++) {
    const w = POPOVER_WORDS[i % POPOVER_WORDS.length];
    n += cardFor(w, { all: POPOVER_WORDS, others: [] }).also.length;
  }
  return `${n}`; // not a swap count
};
benchmarks["speak.pickVoice.x1000"] = () => {
  const langs = ["ru", "zh", "zh-Hant", "yue", "ja", "ar", "en", "es", "sr-Latn", "th"];
  let n = 0;
  for (let i = 0; i < 1000; i++) n += pickVoice(allVoices, langs[i % langs.length], { allowOnline: i % 2 === 0 }) ? 1 : 0;
  return `${n}`; // not a swap count
};

// The dashboard (slice 21 §4, §14) with 5,000 and 20,000 words: grouping and indexing on
// load, sorting, one search keystroke, and scrolling the virtualized list in jsdom (100
// steps of three rows; each step is one animation frame's work).
const M = requireExt("lib/dashboard-model.js");
const Search = requireExt("lib/word-search.js");
const { manyWords } = await import("../helpers/dashboard-words.mjs");
for (const [label, count] of [["5k", 5000], ["20k", 20000]]) {
  const records = manyWords(count);
  const prepared = () => {
    const groups = M.groupRecords(records, { bases: ["en"] });
    const index = Search.createIndex();
    for (const g of groups) index.set(g.id, Search.entryFor(g));
    return { groups, index, ids: M.sortGroups(groups, "newest").map((g) => g.id) };
  };
  benchmarks[`dashboard.groupAndIndex.${label}`] = () => `${prepared().index.size}`;
  benchmarks[`dashboard.sort.native.${label}`] = { setup: () => M.groupRecords(records), run: (groups) => `${M.sortGroups(groups, "native").length}` };
  benchmarks[`dashboard.search.keystroke.${label}`] = { setup: prepared, run: ({ index, ids }) => `${index.search("kot12", ids).length}` };
}

// Slice 11: the words content scripts read, projected from the store after each write
// (§2: building the projection for 5,000 words under 30 ms, writing it under 50 ms). The
// write is measured into the fake storage area, which copies values the way Chrome's does.
const Projection = requireExt("lib/projection.js");
const { createFakeChrome: fakeChrome } = await import("../helpers/fake-chrome.mjs");
const localRecords = manyWords(5000).map((w) => ({ ...w, status: "active", deleted_at: null, forms: (w.forms ?? [w.gloss]).map((f) => (typeof f === "string" ? { text: f, enabled: true } : f)) }));
benchmarks["local.projection.build.5k"] = () => `${Projection.project(localRecords, ["en", "es"]).length}`;
benchmarks["local.projection.write.5k"] = {
  setup: () => fakeChrome().chrome.storage.local,
  run: async (storage) => {
    const words = Projection.project(localRecords, ["en", "es"]);
    await storage.set({ words, baseLangs: ["en", "es"], wordsVersion: { n: 1, at: 0, by: null } });
    return `${words.length}`;
  },
};

const { JSDOM } = await import("jsdom");
const { createFakeChrome } = await import("../helpers/fake-chrome.mjs");
const { createI18n } = await import("../helpers/fake-i18n.mjs");
const { readExt } = await import("../helpers/load-script.mjs");
const vm = await import("node:vm");
async function dashboardWith(words) {
  const fake = createFakeChrome({
    local: { serverUrl: "http://127.0.0.1:1", token: "t" },
    onSendMessage: (msg) => (msg.type === "words.list" ? { words } : msg.type === "words.deleted" ? { entries: [] } : msg.type === "job.refresh" ? { state: "done" } : { ok: true }),
  });
  fake.chrome.i18n = createI18n("en");
  const dom = new JSDOM(readExt("dashboard.html"), { url: "chrome-extension://perf/dashboard.html", runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.chrome = fake.chrome;
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  for (const rel of ["lib/i18n.js", "ui/icons.js", "lib/speak.js", "lib/word-card.js", "lib/word-search.js", "lib/dashboard-model.js", "lib/word-source.js", "lib/lookup-status.js", "lib/errors.js", "dashboard.js"]) {
    vm.runInContext(readExt(rel), dom.getInternalVMContext());
  }
  await dom.window.KotikoDashboard.ready;
  // The grid is the list's scroll container (slice 27).
  const body = dom.window.document.getElementById("grid");
  let top = 0;
  Object.defineProperty(body, "scrollTop", {
    get: () => top,
    set(v) {
      top = v;
    },
  });
  return { dom, body, setTop: (v) => void (top = v) };
}
const big = await dashboardWith(manyWords(20000));
benchmarks["dashboard.scroll.20k.x100"] = {
  setup: () => big.setTop(0),
  run: () => {
    for (let i = 1; i <= 100; i++) {
      big.setTop(i * 3 * 52);
      big.dom.window.KotikoDashboard._renderWindow();
    }
    return `${big.dom.window.document.querySelectorAll(".wrow").length}`;
  },
};
benchmarks["dashboard.open.20k"] = {
  run: async () => {
    const d = await dashboardWith(manyWords(20000));
    const n = d.dom.window.document.querySelectorAll(".wrow").length;
    d.dom.window.close();
    return `${n}`;
  },
};

// Slice 18: 100,000 language picks from a 20,000-word vocabulary (5,000 concepts in two to
// five languages), over 100 page sessions so the per-page memo doesn't hide the work. A real
// page makes one pick per distinct concept, typically a few hundred.
benchmarks["precedence.pick.100k"] = {
  setup: () => {
    const P = requireExt("lib/precedence.js");
    const T = requireExt("lib/text.js");
    const langs = ["es", "ru", "zh", "ja", "ar"];
    const entries = [];
    const words = [];
    for (let i = 0; i < 5000; i++) {
      const ws = langs.slice(0, 2 + (i % 4)).map((lang, j) => ({ id: `${i}-${j}`, lang, native: `w${i}${lang}`, gloss: `word${i}`, base_lang: "en", status: "active", created_at: "2026-01-01T00:00:00Z" }));
      words.push(...ws);
      entries.push({ key: `word${i}`, candidates: ws.map((word) => ({ word, form: `word${i}`, case: "any" })) });
    }
    return { P, keyOf: (x, b) => T.keyOf(x, b), words, entries, E: P.eligible({ words }) };
  },
  run: ({ P, keyOf, words, entries, E }) => {
    const counts = {};
    for (let n = 0; n < 100; n++) {
      const s = P.createSession({ salt: "bench", pageKey: `https://example.com/${n}`, dayKey: "2026-10-04", eligible: E, words, keyOf, now: Date.parse("2026-10-04T00:00:00Z") });
      for (let i = 0; i < 1000; i++) {
        const entry = entries[(n * 1000 + i) % entries.length];
        const c = s.choose({ base: "en", entry, surface: entry.key });
        counts[c.lang] = (counts[c.lang] ?? 0) + 1;
      }
    }
    return `${Object.values(counts).reduce((a, b) => a + b, 0)} picks`;
  },
};

// Slice 13: a 5,000-row list read and oriented, the work before the review table shows
// (spec: under 1 s with its first rows rendered).
benchmarks["bulk.parse.5k"] = {
  setup: () => {
    const P = requireExt("bulk/parse.js");
    const langs = JSON.parse(fs.readFileSync(new URL("../../extension/spec/languages.json", import.meta.url), "utf8")).languages;
    const text = Array.from({ length: 5000 }, (_, i) => `палабра${i} (palabra${i}) = word${i}, meaning${i} # note ${i}`).join("\n");
    return { P, langs, text };
  },
  run: async ({ P, langs, text }) => {
    const r = await P.build(P.read(text), { base: "en", target: "ru", langs });
    return `${r.rows.length} rows`;
  },
};

// Median of several runs after warm-up. A benchmark that takes over a second (today's
// matcher with 10k forms) gets three runs and no warm-up, so the job stays short.
async function measure(bench) {
  const { setup = () => undefined, run } = typeof bench === "function" ? { run: bench } : bench;
  const once = async () => {
    const input = setup();
    const t = performance.now();
    const result = await run(input);
    return { ms: performance.now() - t, result };
  };
  const first = await once();
  const slow = first.ms > 1000;
  const times = slow ? [first.ms] : [];
  let result = first.result;
  if (!slow) await once();
  for (let i = times.length; i < (slow ? 3 : 9); i++) {
    const r = await once();
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
  const { median, min, max, result } = await measure(bench);
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
// jsdom windows keep timers alive.
process.exit(0);
