// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The fixture corpus and the fixture server that serves it, checked without a browser.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startFixtureServer } from "../helpers/fixture-server.mjs";
import { ROOT } from "../helpers/load-script.mjs";

const PAGES_DIR = path.join(ROOT, "test/fixtures/pages");
const E2E_DIR = path.join(ROOT, "test/e2e");

// The corpus table in slices/02-test-harness-and-ci/SPEC.md, section 4.
const CORPUS = [
  "basic.html",
  "boundaries.html",
  "react-list.html",
  "turbo-swap.html",
  "self-healing.html",
  "shadow.html",
  "iframes.html",
  "rtl.html",
  "non-english.html",
  "editors.html",
  "controls.html",
  "big.html",
  "captions.html",
];

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

describe("fixture corpus", () => {
  const pages = fs.readdirSync(PAGES_DIR).filter((f) => f.endsWith(".html"));
  const specs = fs
    .readdirSync(E2E_DIR)
    .filter((f) => f.endsWith(".spec.mjs"))
    .map((f) => fs.readFileSync(path.join(E2E_DIR, f), "utf8"))
    .join("\n");

  test("every page in the spec's table exists and has an e2e spec", () => {
    for (const page of CORPUS) {
      assert.ok(pages.includes(page), `${page} exists`);
      assert.ok(specs.includes(page), `${page} is used by a spec in test/e2e`);
    }
  });

  for (const page of pages) {
    test(`${page} is self-contained`, () => {
      const html = fs.readFileSync(path.join(PAGES_DIR, page), "utf8");
      for (const [, url] of html.matchAll(/\b(?:https?|wss?|ftp):\/\/([^\s"'<>)]+)/gi)) {
        const host = url.split(/[/:?#]/)[0];
        assert.ok(LOCAL_HOSTS.has(host), `${page} refers to an external URL: ${url}`);
      }
      assert.doesNotMatch(html, /\b(?:src|href|action|poster|data)\s*=\s*["']?\/\//i, `${page} has a protocol-relative URL`);
      assert.doesNotMatch(html, /url\(\s*["']?\/\//i, `${page} has a protocol-relative CSS url()`);
      assert.doesNotMatch(html, /@import\s+["']?(?:https?:)?\/\//i, `${page} imports external CSS`);
    });
  }
});

describe("fixture server", () => {
  let srv;
  before(async () => {
    srv = await startFixtureServer();
  });
  after(() => srv.close());

  const chat = (text, signal) =>
    fetch(`${srv.llmUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "m", messages: [{ role: "system", content: "s" }, { role: "user", content: text }] }),
      signal,
    });
  const control = (body) =>
    fetch(`${srv.url}/__control`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.json());

  test("serves pages, and nothing outside the fixture directories", async () => {
    const ok = await fetch(srv.pageUrl("basic.html"));
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("content-type"), /text\/html/);
    assert.match(await ok.text(), /A house by the sea/);
    for (const p of ["/pages/../helpers/fixture-server.mjs", "/pages/%2e%2e/api/words.json", "/pages/nope.html"]) {
      assert.equal((await fetch(srv.url + p)).status, 404, p);
    }
  });

  test("fake Kotiko: health is open, the API needs the token", async () => {
    await control({ reset: true });
    assert.equal(await (await fetch(`${srv.kotikoUrl}/health`)).text(), "ok");
    assert.equal((await fetch(`${srv.kotikoUrl}/api/words`)).status, 401);
    const res = await fetch(`${srv.kotikoUrl}/api/words`, { headers: { authorization: `Bearer ${srv.token}` } });
    assert.equal((await res.json()).words.length, 5);
  });

  test("fake Kotiko: html and slow behaviours", async () => {
    await control({ reset: true, kotiko: "html" });
    const html = await fetch(`${srv.kotikoUrl}/api/words`, { headers: { authorization: `Bearer ${srv.token}` } });
    assert.equal(html.status, 200);
    assert.match(html.headers.get("content-type"), /text\/html/);

    await control({ reset: true, kotiko: "slow", delayMs: 120 });
    const t = performance.now();
    await fetch(`${srv.kotikoUrl}/health`);
    assert.ok(performance.now() - t >= 100);
    await control({ reset: true });
  });

  test("fake LLM: answers from the canned answers by input text", async () => {
    await control({ reset: true });
    const body = await (await chat("  Shukran ")).json();
    const answer = JSON.parse(body.choices[0].message.content);
    assert.equal(answer.words[0].native, "شكرا");
    const none = JSON.parse((await (await chat("zzz")).json()).choices[0].message.content);
    assert.deepEqual(none, { intent: "add", words: [] });
  });

  test("fake LLM: models, key, prose, 429 and stall", async () => {
    assert.ok((await (await fetch(`${srv.llmUrl}/models`)).json()).data.length > 0);
    assert.ok((await (await fetch(`${srv.llmUrl}/key`)).json()).data);

    await control({ llm: "prose" });
    const prose = (await (await chat("shukran")).json()).choices[0].message.content;
    assert.match(prose, /^Sure!/);

    await control({ llm: "429" });
    const plain = await chat("shukran");
    assert.equal(plain.status, 429);
    assert.equal(plain.headers.get("retry-after"), null);

    await control({ llm: "429-headers" });
    const limited = await chat("shukran");
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "2");

    await control({ llm: "stall" });
    await assert.rejects(chat("shukran", AbortSignal.timeout(150)), { name: "TimeoutError" });
    await control({ reset: true });
  });

  test("logs API and model requests for assertions", async () => {
    await control({ reset: true });
    await fetch(`${srv.kotikoUrl}/health`);
    const state = await (await fetch(`${srv.url}/__control`)).json();
    assert.deepEqual(state.log, [{ method: "GET", path: "/kotiko/health", auth: null, host: new URL(srv.url).host }]);
  });
});
