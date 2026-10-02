// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 09 section 6: spec/eval/run-eval.mjs. The assertions and scores, replay of the
// committed recordings (no network), and a live run against the fake OpenAI-compatible
// server of test/helpers/fixture-server.mjs: budget refusal, pacing, 429 handling, resume.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startFixtureServer } from "../helpers/fixture-server.mjs";
import {
  checkAssertion,
  loadCases,
  loadSpec,
  main,
  retryDelay,
  scoreCase,
  stressSyllables,
  summarize,
  toneDigits,
} from "../../spec/eval/run-eval.mjs";

const ctx = loadSpec();
const cases = loadCases();
const byId = (id) => cases.find((c) => c.id === id);
const answer = (words, intent = "add") => JSON.stringify({ intent, words, reply: null });
const pozh = (o = {}) => ({ lang: "ru", native: "пожалуйста", romanization: "pozhaluysta", base_lang: "en", gloss: "please", forms: ["please"], pronunciation: "pa-ZHAL-sta", pronunciation_careful: "pa-ZHA-lu-sta", native_vocalized: "пожа́луйста", ...o });

describe("assertions", () => {
  const entry = { lang: "ru", base_lang: "en", native: "пожалуйста", gloss: "please", forms: [{ text: "please" }], romanization: null, pronunciation: "pa-ZHAL-sta", pronunciation_careful: null, native_vocalized: null };
  test("null means must be null; a list may allow null", () => {
    assert.equal(checkAssertion("romanization_any", null, entry, ctx), true);
    assert.equal(checkAssertion("romanization_any", ["pozhaluysta"], entry, ctx), false);
    assert.equal(checkAssertion("romanization_any", ["pozhaluysta", null], entry, ctx), true);
    assert.equal(checkAssertion("careful_any", null, entry, ctx), true);
    assert.equal(checkAssertion("pronunciation_any", null, entry, ctx), false);
  });
  test("capitals compared exactly; stress position and tones", () => {
    assert.equal(checkAssertion("pronunciation_any", ["pa-zhal-sta"], entry, ctx), false);
    assert.deepEqual(stressSyllables({ pronunciation: "pa-ZHAL-sta", pronunciation_careful: "pa-ZHA-lu-sta" }), [2]);
    assert.deepEqual(stressSyllables({ pronunciation: "da svi-DA-nya", pronunciation_careful: null }), [0, 2]);
    assert.equal(toneDigits("shie4-shie"), "4,");
    assert.equal(toneDigits("nee2-how3"), "2,3");
    assert.equal(checkAssertion("no_capitals", true, { ...entry, pronunciation: "a-ree-ga-toh" }, ctx), true);
    assert.equal(checkAssertion("no_capitals", true, entry, ctx), false);
  });
  test("reading_any is skipped until slice 36 adds the field", () => {
    assert.equal(checkAssertion("reading_any", ["すき"], entry, ctx), null);
  });
  test("forms_include and forms_exclude ignore case", () => {
    const e = { ...entry, forms: [{ text: "How" }] };
    assert.equal(checkAssertion("forms_include", ["how"], e, ctx), true);
    assert.equal(checkAssertion("forms_exclude", ["what"], e, ctx), true);
  });
});

describe("scoring", () => {
  test("the reference answer passes; a malformed pronunciation counts as null and fails letters", () => {
    const c = byId("en-ru-pozhaluysta");
    assert.equal(scoreCase(c, answer([pozh()]), ctx).pass, true);
    const bad = scoreCase(c, answer([pozh({ pronunciation: "PA-ZHAL-STA" })]), ctx);
    assert.equal(bad.pass, false);
    assert.equal(bad.words[0].checks.pronunciation_any, false);
  });
  test("unparseable answers fail valid_json", () => {
    assert.equal(scoreCase(byId("en-ru-pozhaluysta"), "no idea", ctx).checks.valid_json, false);
  });
  test("letters, stress and vowel reduction are scored apart", () => {
    const c = byId("en-ru-pozhaluysta");
    const scored = [
      { case: c, score: scoreCase(c, answer([pozh()]), ctx) },
      // Right letters, wrong stress.
      { case: c, score: scoreCase(c, answer([pozh({ pronunciation: "PA-zhal-sta", pronunciation_careful: "PA-zha-lu-sta", native_vocalized: null })]), ctx) },
      // No reduction: "po" where speakers say "pa".
      { case: c, score: scoreCase(c, answer([pozh({ pronunciation: "po-ZHAL-sta" })]), ctx) },
    ];
    const r = summarize(scored).pronunciation["lookup ru en"];
    assert.deepEqual(r.letters, [1, 3]);
    assert.deepEqual(r.stress, [2, 3]);
    assert.deepEqual(r.reduction, [1, 3]);
  });
  test("the golden set covers what slice 09 asks for", () => {
    const tagged = (t) => cases.filter((c) => c.tags.includes(t)).length;
    assert.ok(cases.length >= 120);
    assert.ok(tagged("core") >= 25);
    assert.ok(tagged("base:en") >= 15 && tagged("base:es") >= 15);
    assert.ok(tagged("base:ja") >= 6 && tagged("base:fr") >= 6);
    for (const id of ["en-ru-pozhaluysta", "es-ru-pozhaluysta", "en-zh-xiexie", "es-en-teacher", "respell-en-ru-zamok-homographs", "respell-batch-of-20"]) {
      assert.ok(byId(id), id);
    }
    assert.equal(byId("respell-batch-of-20").items.length, 20);
  });
  test("Retry-After in seconds, else X-RateLimit-Reset in epoch milliseconds", () => {
    assert.equal(retryDelay(new Headers({ "retry-after": "2" })), 2000);
    assert.equal(retryDelay(new Headers({ "x-ratelimit-reset": "1500" }), 1000), 500);
  });
});

describe("replay", () => {
  test("re-scores the committed recordings with no network and matches RESULTS.md", async () => {
    const noNetwork = () => Promise.reject(new Error("replay must not call the network"));
    const code = await main(["--replay", "--set", "all", "--check"], { fetch: noNetwork, log: () => {} });
    assert.equal(code, 0);
  });
  test("--check fails when RESULTS.md doesn't hold the numbers", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kotiko-eval-"));
    fs.writeFileSync(path.join(tmp, "RESULTS.md"), "# Evaluation results\n");
    const code = await main(["--replay", "--set", "core", "--check", "--results", path.join(tmp, "RESULTS.md")], { log: () => {} });
    assert.equal(code, 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("a live run against the fake server", () => {
  let srv;
  let tmp;
  let casesFile;
  const control = (body) => fetch(`${srv.url}/__control`, { method: "POST", body: JSON.stringify(body) });
  const chats = async () => (await (await fetch(`${srv.url}/__control`)).json()).log.filter((r) => r.path.endsWith("/chat/completions")).length;

  before(async () => {
    srv = await startFixtureServer();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kotiko-eval-"));
    casesFile = path.join(tmp, "golden.jsonl");
    const three = ["en-ru-kak-bare", "es-ru-kak-bare", "en-ru-pozhaluysta"].map((id) => {
      const c = { ...byId(id) };
      c.tags = c.tags.filter((t) => !t.startsWith("base:"));
      return JSON.stringify(c);
    });
    fs.writeFileSync(casesFile, three.join("\n") + "\n");
  });
  after(async () => {
    await srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const run = (extra, env = {}) =>
    main(["--models", "fake/model-a:free", "--set", "all", "--cases", casesFile, "--base-url", srv.llmUrl, "--out", path.join(tmp, "rec"), "--results", path.join(tmp, "RESULTS.md"), ...extra], {
      key: "fake-llm-key",
      log: () => {},
      ...env,
    });

  test("refuses to start when the plan exceeds the free requests left", async () => {
    await control({ reset: true, llmRemaining: 2 });
    assert.equal(await run(["--budget", "10"]), 3);
    assert.equal(await chats(), 0);
  });

  test("paces requests, waits out a 429 and records every answer", async () => {
    await control({ reset: true, llmRemaining: 40, llm: "429-once" });
    const waits = [];
    const sleep = (ms) => {
      waits.push(ms);
      return new Promise((r) => setTimeout(r, Math.min(ms, 20)));
    };
    assert.equal(await run(["--rpm", "600", "--budget", "10"], { sleep }), 0);
    // Three cases, one of them asked twice after the 429.
    assert.equal(await chats(), 4);
    assert.ok(waits.some((ms) => ms > 0 && ms <= 150), `a wait for the reset: ${waits}`);
    assert.ok(waits.some((ms) => ms > 50 && ms <= 100), `pacing at 600 a minute: ${waits}`);
    const lines = fs.readFileSync(path.join(tmp, "rec", "fake__model-a__free.jsonl"), "utf8").trim().split("\n");
    assert.equal(lines.length, 3);
    assert.ok(lines.every((l) => JSON.parse(l).status === 200));
  });

  test("a rerun resumes: recorded cases are not asked again", async () => {
    await control({ reset: true, llmRemaining: 40 });
    assert.equal(await run(["--budget", "10"]), 0);
    assert.equal(await chats(), 0);
  });
});
