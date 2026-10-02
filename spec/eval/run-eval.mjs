#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The golden evaluation (slice 09 section 6): runs spec/eval/golden.jsonl against any
// OpenAI-compatible model with the prompt of spec/prompt.md, checks each answer with the
// extension's pipeline (extension/lib/wordspec.js) and scores it. Node 22, no
// dependencies. See spec/eval/README.md.
//
//   node spec/eval/run-eval.mjs --replay [--set all] [--check]      re-score recordings, no network
//   node spec/eval/run-eval.mjs --models a:free,b:free [--set core] [--budget 40] [--rpm 15]
//        [--base-url https://openrouter.ai/api/v1] [--key-env OPENROUTER_API_KEY] [--out spec/eval/recorded]
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

// ── the pipeline, from the extension ─────────────────────────────────

function loadExt(rel) {
  const module = { exports: {} };
  const file = path.join(ROOT, "extension", rel);
  vm.runInThisContext(`(function (module, exports) {${fs.readFileSync(file, "utf8")}\n})`, { filename: file })(
    module,
    module.exports,
  );
  return module.exports;
}

export function loadSpec() {
  const spec = loadExt("spec/spec.js");
  const Lang = loadExt("lib/lang.js").createLang(spec);
  const WS = loadExt("lib/wordspec.js").createWordSpec(spec, Lang);
  return { spec, Lang, WS };
}

// ── cases ────────────────────────────────────────────────────────────

export function loadCases(file = path.join(HERE, "golden.jsonl")) {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const c = JSON.parse(l);
      c.tags = [...new Set([...(c.tags ?? []), ...(c.base_langs ?? []).map((b) => `base:${b}`)])];
      return c;
    });
}

// --set core | all | tag:<tag>; core cases first.
export function selectCases(cases, set = "core") {
  const picked =
    set === "all" ? cases : set.startsWith("tag:") ? cases.filter((c) => c.tags.includes(set.slice(4))) : cases.filter((c) => c.tags.includes(set));
  return [...picked].sort((a, b) => Number(!a.tags.includes("core")) - Number(!b.tags.includes("core")));
}

// The request both runtimes build (slice 09 section 2).
export function buildRequest(c, WS) {
  if (c.mode === "respell") {
    return { system: WS.buildRespellSystem(c.items), user: JSON.stringify({ items: c.items }) };
  }
  const input = WS.prepareInput(c.input);
  const system = WS.buildSystem({ base_langs: c.base_langs, mode: c.mode, recent: c.recent ?? [], hint_lang: c.hint_lang ?? null });
  return { system, user: input.ok ? input.text : c.input };
}

export const promptHash = ({ system, user }) =>
  crypto.createHash("sha256").update(`${system}\u0000${user}`).digest("hex").slice(0, 16);

// ── scoring ──────────────────────────────────────────────────────────

const lower = (s) => (typeof s === "string" ? s.toLowerCase() : s);
const inList = (value, list) => list.some((x) => (x === null ? value === null : value === x));

// The capital syllable of each word (1-based, 0 for none) of the careful form, or the
// everyday one when there is none.
export function stressSyllables(word) {
  const form = word.pronunciation_careful ?? word.pronunciation;
  if (form === null || form === undefined) return null;
  return form.split(" ").map((w) => {
    const i = w.split("-").findIndex((s) => {
      const letters = s.replace(/[^\p{L}]/gu, "");
      return letters !== "" && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
    });
    return i + 1;
  });
}

// "4," for shie4-shie: one entry per syllable, empty for a neutral one.
export function toneDigits(p) {
  if (p === null || p === undefined) return null;
  return p
    .split(/[ -]/)
    .map((s) => /([0-9])$/.exec(s)?.[1] ?? "")
    .join(",");
}

// One assertion of an expected word against one entry: true, false, or null (skipped).
export function checkAssertion(name, value, entry, { Lang, WS }) {
  const forms = (entry.forms ?? []).map((f) => lower(f.text));
  switch (name) {
    case "lang":
      return Lang.canonical(value).tag === entry.lang;
    case "base_lang":
      return Lang.baseTagOf(value) === entry.base_lang;
    case "native_any":
      return value.some((n) => WS.fold(n.normalize("NFC")) === WS.fold(entry.native));
    case "gloss_any":
      return value.some((g) => lower(g) === lower(entry.gloss));
    case "forms_include":
      return value.every((f) => forms.includes(lower(f)));
    case "forms_exclude":
      return !value.some((f) => forms.includes(lower(f)));
    case "romanization_re":
      return entry.romanization !== null && new RegExp(value, "u").test(entry.romanization);
    case "romanization_any":
      return value === null ? entry.romanization === null : inList(entry.romanization, value);
    case "pronunciation_any":
      return value === null ? entry.pronunciation === null : inList(entry.pronunciation, value);
    case "careful_any":
      return value === null ? entry.pronunciation_careful === null : inList(entry.pronunciation_careful, value);
    case "native_vocalized_any":
      return value === null ? entry.native_vocalized === null : inList(entry.native_vocalized, value);
    case "stress_syllable":
      return JSON.stringify(stressSyllables(entry)) === JSON.stringify(value);
    case "no_capitals":
      return [entry.pronunciation, entry.pronunciation_careful].every((p) => p === null || p === p.toLowerCase());
    case "tones":
      return toneDigits(entry.pronunciation) === value;
    case "reading_any":
      return entry.reading === undefined ? null : inList(entry.reading, value);
    default:
      return null;
  }
}

function scoreWord(expected, entries, ctx) {
  let best = null;
  for (const entry of entries) {
    const checks = {};
    for (const [name, value] of Object.entries(expected)) checks[name] = checkAssertion(name, value, entry, ctx);
    const passed = Object.values(checks).filter((v) => v === true).length;
    const ok = Object.values(checks).every((v) => v !== false);
    if (!best || ok > best.ok || (ok === best.ok && passed > best.passed)) best = { entry, checks, ok, passed };
  }
  return best ?? { entry: null, checks: Object.fromEntries(Object.keys(expected).map((k) => [k, false])), ok: false, passed: 0 };
}

// Scores one case's raw answer. Returns { pass, checks, words: [{checks, entry}], result }.
export function scoreCase(c, raw, ctx) {
  const { WS, Lang } = ctx;
  const checks = {};
  if (c.mode === "respell") {
    const result = raw === null ? { error: "no answer" } : WS.processRespell(c.items, raw);
    checks.valid_json = !result.error;
    const items = result.items ?? [];
    const words = (c.expect.items ?? []).map((e) => {
      const { lang, native, base_lang, ...rest } = e;
      const candidates = items.filter(
        (i) => i.lang === Lang.canonical(lang).tag && i.base_lang === Lang.baseTagOf(base_lang) && WS.fold(i.native) === WS.fold(native),
      );
      return scoreWord(rest, candidates, ctx);
    });
    const pass = checks.valid_json && words.every((w) => w.ok);
    return { pass, checks, words, result };
  }

  const input = { text: c.input, mode: c.mode, base_langs: c.base_langs };
  const result = raw === null ? { error: "no answer" } : WS.process(input, raw);
  checks.valid_json = !result.error;
  const entries = result.words ?? [];
  const groups = new Set(entries.map((w) => `${w.lang}\u0000${WS.fold(w.native)}`));
  const e = c.expect;
  if (e.intent !== undefined) checks.intent = result.intent === e.intent;
  if (e.count) checks.count = groups.size >= e.count[0] && groups.size <= e.count[1];
  if (e.no_reply) checks.no_reply = (result.reply ?? null) === null;
  if (e.code !== undefined) checks.code = (result.code ?? null) === e.code;
  if (e.bases_complete) {
    checks.bases_complete = [...groups].every((g) => {
      const members = entries.filter((w) => `${w.lang}\u0000${WS.fold(w.native)}` === g);
      return c.base_langs
        .map((b) => Lang.baseTagOf(b))
        .every((b) => Lang.sameBase(members[0].lang, b) || members.some((m) => m.base_lang === b));
    });
  }
  // Order-insensitive: each expected word takes the best remaining entry.
  const remaining = [...entries];
  const words = (e.words ?? []).map((w) => {
    const s = scoreWord(w, remaining, ctx);
    if (s.entry) remaining.splice(remaining.indexOf(s.entry), 1);
    return s;
  });
  const pass = Object.values(checks).every(Boolean) && words.every((w) => w.ok);
  return { pass, checks, words, result };
}

// ── summaries ────────────────────────────────────────────────────────

const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] : null);
const p95 = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(0.95 * xs.length) - 1)] : null);

// scored: [{ case, score, latency_ms }] for one model.
export function summarize(scored) {
  const rate = (pred, filter = () => true) => {
    const xs = scored.filter(filter);
    return { n: xs.filter(pred).length, of: xs.length, pct: pct(xs.filter(pred).length, xs.length) };
  };
  const hasCheck = (k) => (s) => s.score.checks[k] !== undefined;
  const bases = [...new Set(scored.flatMap((s) => s.case.tags.filter((t) => t.startsWith("base:"))))].sort();
  const lookups = scored.filter((s) => s.case.mode !== "respell");
  const langChecks = lookups.flatMap((s) => s.score.words.map((w) => w.checks.lang).filter((v) => v !== undefined && v !== null));
  const latency = scored.map((s) => s.latency_ms).filter((x) => typeof x === "number");
  return {
    cases: scored.length,
    pass: rate((s) => s.score.pass),
    core: rate((s) => s.score.pass, (s) => s.case.tags.includes("core")),
    per_base: Object.fromEntries(bases.map((b) => [b.slice(5), rate((s) => s.score.pass, (s) => s.case.tags.includes(b))])),
    valid_json: rate((s) => s.score.checks.valid_json),
    intent: rate((s) => s.score.checks.intent, hasCheck("intent")),
    language: { n: langChecks.filter(Boolean).length, of: langChecks.length, pct: pct(langChecks.filter(Boolean).length, langChecks.length) },
    bases_complete: rate((s) => s.score.checks.bases_complete, hasCheck("bases_complete")),
    forms_precision: rate(
      (s) => s.score.words.every((w) => w.checks.forms_exclude !== false),
      (s) => (s.case.expect.words ?? []).some((w) => w.forms_exclude),
    ),
    latency_ms: { median: median(latency), p95: p95(latency) },
    requests: scored.filter((s) => s.requested).length,
    pronunciation: pronunciationTable(scored),
  };
}

// Letters, stress and vowel reduction per target and base, for the lookup and respell prompts.
function pronunciationTable(scored) {
  const rows = {};
  for (const s of scored.filter((x) => x.case.tags.includes("pron"))) {
    const prompt = s.case.mode === "respell" ? "respell" : "lookup";
    const expected = s.case.mode === "respell" ? s.case.expect.items ?? [] : s.case.expect.words ?? [];
    expected.forEach((e, i) => {
      const w = s.score.words[i];
      if (!w) return;
      const key = `${prompt} ${e.lang} ${e.base_lang ?? s.case.base_langs?.[0]}`;
      const r = (rows[key] ??= { letters: [0, 0], stress: [0, 0], reduction: [0, 0], tones: [0, 0], dropped: [0, 0] });
      const add = (k, ok) => {
        if (ok === undefined || ok === null) return;
        r[k][1]++;
        if (ok) r[k][0]++;
      };
      add("letters", w.checks.pronunciation_any === undefined && w.checks.careful_any === undefined ? undefined : w.checks.pronunciation_any !== false && w.checks.careful_any !== false);
      // A missing pronunciation scores no stress, even where "no capitals" would hold.
      const hasPron = (w.entry?.pronunciation ?? null) !== null;
      add("stress", w.checks.stress_syllable === undefined && w.checks.no_capitals === undefined ? undefined : hasPron && w.checks.stress_syllable !== false && w.checks.no_capitals !== false);
      if (s.case.tags.includes("reduction")) add("reduction", w.checks.pronunciation_any);
      add("tones", w.checks.tones);
      const dropped = (s.score.result.dropped_fields ?? []).some((d) => d.field === "pronunciation" && d.base_lang === (w.entry?.base_lang ?? e.base_lang));
      add("dropped", dropped);
    });
  }
  return rows;
}

const cell = (r) => (r && r.of ? `${r.pct}% (${r.n}/${r.of})` : "–");
const frac = ([n, d]) => (d ? `${pct(n, d)}% (${n}/${d})` : "–");

export function renderMarkdown(summaries, meta) {
  const lines = [];
  lines.push(`## ${meta.date} · ${meta.mode} · set ${meta.set} · spec ${meta.version}`, "");
  lines.push(`<!-- summary: ${JSON.stringify({ set: meta.set, version: meta.version, models: stable(summaries) })} -->`, "");
  const bases = [...new Set(Object.values(summaries).flatMap((s) => Object.keys(s.per_base)))].sort();
  lines.push(`| Model | Pass | Core | ${bases.map((b) => `Base ${b}`).join(" | ")} | Valid JSON | Intent | Language | Bases complete | Forms precision | Latency median / p95 | Requests |`);
  lines.push(`|---|---|---|${bases.map(() => "---").join("|")}|---|---|---|---|---|---|---|`);
  for (const [model, s] of Object.entries(summaries)) {
    const lat = s.latency_ms.median === null ? "–" : `${s.latency_ms.median} / ${s.latency_ms.p95} ms`;
    lines.push(
      `| ${model} | ${cell(s.pass)} | ${cell(s.core)} | ${bases.map((b) => cell(s.per_base[b])).join(" | ")} | ${cell(s.valid_json)} | ${cell(s.intent)} | ${cell(s.language)} | ${cell(s.bases_complete)} | ${cell(s.forms_precision)} | ${lat} | ${s.requests} |`,
    );
  }
  for (const [model, s] of Object.entries(summaries)) {
    const keys = Object.keys(s.pronunciation).sort();
    if (!keys.length) continue;
    lines.push("", `Pronunciation, ${model}:`, "", "| Prompt | Target | Base | Letters | Stress | Vowel reduction | Tones | Dropped by the checks |", "|---|---|---|---|---|---|---|---|");
    for (const k of keys) {
      const [prompt, target, base] = k.split(" ");
      const r = s.pronunciation[k];
      lines.push(`| ${prompt} | ${target} | ${base} | ${frac(r.letters)} | ${frac(r.stress)} | ${frac(r.reduction)} | ${frac(r.tones)} | ${frac(r.dropped)} |`);
    }
  }
  return lines.join("\n") + "\n";
}

// The summary without what changes from run to run (latency, requests).
function stable(summaries) {
  return Object.fromEntries(
    Object.entries(summaries).map(([m, s]) => {
      const rest = { ...s };
      delete rest.latency_ms;
      delete rest.requests;
      return [m, rest];
    }),
  );
}

// ── recordings ───────────────────────────────────────────────────────

export const recordingFile = (dir, model) => path.join(dir, `${model.replace(/[/:]/g, "__")}.jsonl`);

export function readRecordings(dir) {
  const byModel = {};
  if (!fs.existsSync(dir)) return byModel;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".jsonl")).sort()) {
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      ((byModel[r.model] ??= new Map())).set(`${r.id}\u0000${r.prompt_hash}`, r);
    }
  }
  return byModel;
}

// ── the live run ─────────────────────────────────────────────────────

async function quota(baseUrl, key, fetchImpl) {
  try {
    const res = await fetchImpl(`${baseUrl}/key`, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
    if (!res.ok) return null;
    const data = (await res.json())?.data ?? {};
    return data.free_model_daily_requests?.remaining ?? null;
  } catch {
    return null;
  }
}

// Waits for Retry-After (seconds) or X-RateLimit-Reset (epoch milliseconds).
export function retryDelay(headers, now = Date.now()) {
  const after = Number(headers.get("retry-after"));
  if (Number.isFinite(after) && after >= 0 && headers.get("retry-after") !== null) return after * 1000;
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) return Math.max(0, reset - now);
  return 10_000;
}

async function ask({ baseUrl, key, model, request, fetchImpl, sleep, log }) {
  const body = {
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ],
  };
  if (baseUrl.includes("openrouter.ai")) body.reasoning = { enabled: false };
  for (let attempt = 0; attempt <= 3; attempt++) {
    const started = Date.now();
    const res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-title": "Kotiko eval", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 3) {
      const wait = retryDelay(res.headers);
      log(`  429 from ${model}; waiting ${Math.round(wait / 100) / 10} s`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) return { raw: null, status: res.status, latency_ms: Date.now() - started };
    const json = await res.json().catch(() => null);
    return { raw: json?.choices?.[0]?.message?.content ?? null, status: res.status, latency_ms: Date.now() - started };
  }
  return { raw: null, status: 429, latency_ms: null };
}

// ── main ─────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const opts = {
    models: null,
    set: "core",
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    rpm: 15,
    budget: 40,
    replay: false,
    check: false,
    write: true,
    out: path.join(HERE, "recorded"),
    results: path.join(HERE, "RESULTS.md"),
    cases: path.join(HERE, "golden.jsonl"),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--models") opts.models = next().split(",").map((m) => m.trim()).filter(Boolean);
    else if (a === "--set") opts.set = next();
    else if (a === "--base-url") opts.baseUrl = next().replace(/\/+$/, "");
    else if (a === "--key-env") opts.keyEnv = next();
    else if (a === "--rpm") opts.rpm = Number(next());
    else if (a === "--budget") opts.budget = Number(next());
    else if (a === "--replay") opts.replay = true;
    else if (a === "--check") opts.check = true;
    else if (a === "--no-write") opts.write = false;
    else if (a === "--out") opts.out = path.resolve(next());
    else if (a === "--results") opts.results = path.resolve(next());
    else if (a === "--cases") opts.cases = path.resolve(next());
    else throw new Error(`Unknown option ${a}`);
  }
  return opts;
}

export async function main(argv, env = {}) {
  const fetchImpl = env.fetch ?? globalThis.fetch;
  const sleep = env.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = env.log ?? ((s) => console.log(s));
  const opts = parseArgs(argv);
  const ctx = loadSpec();
  const cases = selectCases(loadCases(opts.cases), opts.set);
  const recordings = readRecordings(opts.out);
  const models = opts.models ?? Object.keys(recordings).sort();
  if (!models.length) {
    log("No models: pass --models, or record some first.");
    return 2;
  }
  const requests = new Map(cases.map((c) => [c.id, buildRequest(c, ctx.WS)]));
  const scored = Object.fromEntries(models.map((m) => [m, []]));

  if (!opts.replay) {
    const key = env.key ?? process.env[opts.keyEnv] ?? null;
    const local = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(opts.baseUrl);
    if (!key && !local) {
      log(`Set ${opts.keyEnv} to your API key (or pass --key-env NAME). Nothing was sent.`);
      return 2;
    }
    const pending = [];
    for (const c of cases) {
      for (const m of models) {
        const h = promptHash(requests.get(c.id));
        if (!recordings[m]?.has(`${c.id}\u0000${h}`)) pending.push({ c, m, h });
      }
    }
    const plan = pending.slice(0, Math.max(0, opts.budget));
    const remaining = await quota(opts.baseUrl, key, fetchImpl);
    log(
      `Plan: ${models.length} model(s) × ${cases.length} case(s); ${pending.length} not recorded yet; ` +
        `this run sends ${plan.length} request(s) (--budget ${opts.budget}), core first. ` +
        (remaining === null ? "The provider reports no daily quota." : `${remaining} free request(s) remaining today.`),
    );
    if (remaining !== null && plan.length > remaining) {
      log(`That is more than the ${remaining} remaining today. Nothing was sent; lower --budget or try tomorrow.`);
      return 3;
    }
    fs.mkdirSync(opts.out, { recursive: true });
    const gap = 60_000 / Math.max(1, opts.rpm);
    let last = -Infinity;
    for (const [i, p] of plan.entries()) {
      const wait = last + gap - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const answer = await ask({ baseUrl: opts.baseUrl, key, model: p.m, request: requests.get(p.c.id), fetchImpl, sleep, log });
      const rec = { id: p.c.id, model: p.m, prompt_hash: p.h, status: answer.status, latency_ms: answer.latency_ms, raw: answer.raw, at: new Date().toISOString(), requested: true };
      fs.appendFileSync(recordingFile(opts.out, p.m), JSON.stringify(rec) + "\n");
      ((recordings[p.m] ??= new Map())).set(`${p.c.id}\u0000${p.h}`, rec);
      log(`  [${i + 1}/${plan.length}] ${p.m} ${p.c.id}: ${answer.status}`);
    }
    if (remaining !== null) {
      const after = await quota(opts.baseUrl, key, fetchImpl);
      log(`Free requests remaining now: ${after ?? "unknown"} (was ${remaining}; this run sent ${plan.length}).`);
    }
  }

  let missing = 0;
  for (const m of models) {
    for (const c of cases) {
      const rec = recordings[m]?.get(`${c.id}\u0000${promptHash(requests.get(c.id))}`);
      if (!rec) {
        missing++;
        continue;
      }
      scored[m].push({ case: c, score: scoreCase(c, rec.raw ?? null, ctx), latency_ms: rec.latency_ms, requested: !opts.replay && rec.requested });
    }
  }
  const summaries = Object.fromEntries(models.map((m) => [m, summarize(scored[m])]));
  const meta = { date: new Date().toISOString().slice(0, 10), mode: opts.replay ? "replay" : "live", set: opts.set, version: ctx.spec.version };
  const md = renderMarkdown(summaries, meta);
  log(md);
  if (missing) log(`${missing} case(s) had no recording for the current prompt and were not scored.`);

  if (opts.check) {
    const committed = fs.existsSync(opts.results) ? fs.readFileSync(opts.results, "utf8") : "";
    const want = JSON.stringify({ set: opts.set, version: ctx.spec.version, models: stable(summaries) });
    const found = [...committed.matchAll(/<!-- summary: (.*) -->/g)].map((m) => m[1]);
    if (!found.includes(want)) {
      log(`spec/eval/RESULTS.md has no section with these numbers. Run: node spec/eval/run-eval.mjs --replay --set ${opts.set}`);
      return 1;
    }
    log("RESULTS.md matches the recordings.");
    return 0;
  }
  if (opts.write) {
    const old = fs.existsSync(opts.results) ? fs.readFileSync(opts.results, "utf8") : "";
    const header = "# Evaluation results\n\nNewest run on top. Written by `spec/eval/run-eval.mjs`; see `spec/eval/README.md`.\n\n";
    const body = old.startsWith(header) ? old.slice(header.length) : old;
    fs.writeFileSync(opts.results, header + md + "\n" + body);
  }
  return 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e?.message ?? e);
      process.exit(1);
    },
  );
}
