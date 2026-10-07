// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The pure modules behind background sync: server address normalisation
// (extension/lib/url.js), word-list validation (lib/validate-words.js) and message
// sender checks (lib/messages.js).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readExt, requireExt } from "../helpers/load-script.mjs";
import { loadLocalLibs } from "../helpers/local-libs.mjs";

const { normalizeServerUrl, pinLoopback } = requireExt("lib/url.js");
const { validateWordsResponse, checkWord, filterWords, LIMITS } = requireExt("lib/validate-words.js");
const { senderKinds, createMessageRouter } = requireExt("lib/messages.js");

describe("normalizeServerUrl", () => {
  // Plain-http `localhost` becomes 127.0.0.1 (slice 54, B-01): browsers try [::1] first for
  // the name, where another account on the computer can listen while Kotiko's server
  // listens on 127.0.0.1 only, and the first request carries the token.
  const good = [
    ["localhost:4747", "http://127.0.0.1:4747"],
    ["192.168.1.5:4747", "http://192.168.1.5:4747"],
    ["kotiko.tail1234.ts.net", "https://kotiko.tail1234.ts.net"],
    ["  http://localhost:4747//  ", "http://127.0.0.1:4747"],
    ["HTTP://LocalHost:4747/", "http://127.0.0.1:4747"],
    ["http://localhost./kotiko/", "http://127.0.0.1/kotiko"],
    ["http://127.0.0.1:4747", "http://127.0.0.1:4747"],
    // TLS names the host in its certificate, and *.localhost names a site behind a proxy.
    ["https://localhost:4747", "https://localhost:4747"],
    ["http://kotiko.localhost:4747", "http://kotiko.localhost:4747"],
    ["http://localhost.example.com", "http://localhost.example.com"],
    ["100.64.0.1", "http://100.64.0.1"],
    ["100.127.255.254:4747", "http://100.127.255.254:4747"],
    ["[::1]:4747", "http://[::1]:4747"],
    ["nas.local:4747", "http://nas.local:4747"],
    ["example.com", "https://example.com"],
    ["example.com:8443/words/", "https://example.com:8443/words"],
    ["https://example.com/base/path", "https://example.com/base/path"],
    ["http://127.0.0.1:80", "http://127.0.0.1"],
  ];
  for (const [input, url] of good) {
    test(`${JSON.stringify(input)} -> ${url}`, () => {
      assert.deepEqual(normalizeServerUrl(input), { ok: true, url });
    });
  }

  const bad = [
    "",
    "   ",
    null,
    "http://user:pw@host",
    "user:pw@host:4747",
    "ftp://localhost",
    "javascript:alert(1)",
    "http:/localhost",
    "http://localhost:4747/?token=x",
    "http://localhost:4747/#x",
    "http://",
    "http://exa mple.com",
  ];
  for (const input of bad) {
    test(`rejects ${JSON.stringify(input)} with a hint`, () => {
      const r = normalizeServerUrl(input);
      assert.equal(r.ok, false);
      assert.equal(r.code, "server_address_invalid");
      assert.equal(typeof r.hint, "string");
      assert.ok(r.hint.length > 10);
    });
  }

  test("pinLoopback: plain-http localhost in any address, the rest as given", () => {
    const cases = [
      ["http://localhost:11434/v1", "http://127.0.0.1:11434/v1"],
      ["HTTP://LOCALHOST:1234/v1/", "http://127.0.0.1:1234/v1/"],
      ["http://localhost", "http://127.0.0.1"],
      ["https://localhost:8443/v1", "https://localhost:8443/v1"],
      ["http://localhost.evil.example/v1", "http://localhost.evil.example/v1"],
      ["http://my.localhost:1234/v1", "http://my.localhost:1234/v1"],
      ["http://127.0.0.1:4747", "http://127.0.0.1:4747"],
      ["not an address", "not an address"],
      ["", ""],
      [null, null],
    ];
    for (const [input, out] of cases) assert.equal(pinLoopback(input), out, String(input));
  });

  test("no default, example or preset address in the extension names localhost", () => {
    const L = loadLocalLibs();
    assert.equal(new URL(L.Local.DEFAULT_SERVER).hostname, "127.0.0.1");
    for (const p of L.spec.providers.providers.filter((x) => x.local)) assert.equal(new URL(p.baseUrl).hostname, "127.0.0.1", p.id);
    const files = ["popup.js", "popup.html", "dashboard.js", "dashboard.html", "welcome.js", "welcome.html", "lib/local-mode.js", "spec/providers.json", "_locales/en/messages.json", "_locales/es/messages.json"];
    for (const f of files) assert.doesNotMatch(readExt(f), /https?:\/\/localhost\b/, f);
  });

  test("the hints show a loopback address, not localhost", () => {
    for (const input of ["", "http://exa mple.com"]) assert.doesNotMatch(normalizeServerUrl(input).hint, /localhost/);
  });

  test("the user-info hint points at the token field", () => {
    assert.match(normalizeServerUrl("http://user:pw@host").hint, /token/);
  });
});

describe("validateWordsResponse", () => {
  const W = { id: 1, lang: "ru", native: "дом", english: "house", forms: ["house", "houses"] };
  const ok = (body, contentType = "application/json; charset=utf-8") =>
    validateWordsResponse({ status: 200, contentType, body: JSON.stringify(body) });

  test("a good list", () => {
    assert.deepEqual(ok({ words: [W] }), { ok: true, words: [W], dropped: 0, reasons: {}, droppedForms: 0 });
  });

  const notLists = [
    ["HTML", { status: 200, contentType: "text/html", body: "<!doctype html><p>Sign in" }],
    ["JSON without a content type", { status: 200, contentType: "", body: '{"words":[]}' }],
    ["{}", { status: 200, contentType: "application/json", body: "{}" }],
    ["words as a string", { status: 200, contentType: "application/json", body: '{"words":"дом"}' }],
    ["a top-level array", { status: 200, contentType: "application/json", body: "[]" }],
    ["broken JSON", { status: 200, contentType: "application/json", body: '{"words": [' }],
    ["a 404", { status: 404, contentType: "text/plain", body: "not found" }],
    ["a 403", { status: 403, contentType: "application/json", body: "{}" }],
  ];
  for (const [name, raw] of notLists) {
    test(`${name} is not_kotiko_server`, () => {
      assert.equal(validateWordsResponse(raw).code, "not_kotiko_server");
    });
  }

  // The property test's counterexample (slice 54, C-08; FC_SEED=504574479): a content type
  // that isn't a string, even one whose toString can't be called, is no content type.
  test("a content type that isn't a string is treated as none, never thrown on", () => {
    for (const contentType of [{ toString: false }, Object.create(null), ["application/json"], 42, null]) {
      const r = validateWordsResponse({ status: 200, contentType, body: '{"words":[]}' });
      assert.equal(r.code, "not_kotiko_server", String(typeof contentType));
      assert.equal(r.details.contentType, "");
    }
  });

  test("status codes map to their errors", () => {
    const code = (status, body = "") => validateWordsResponse({ status, contentType: "application/json", body }).code;
    assert.equal(code(401), "server_key_rejected");
    assert.equal(code(421), "server_address_invalid");
    assert.equal(code(500), "internal");
    // A gateway in front of a server that's down (slice 25): unreachable, not broken.
    for (const status of [502, 503, 504]) assert.equal(code(status), "server_unreachable", status);
    assert.equal(code(507), "internal");
    assert.deepEqual(
      validateWordsResponse({ status: 500, contentType: "application/json", body: '{"error":"Database is locked."}' }).details,
      { status: 500, error: "Database is locked." },
    );
  });

  const words = [
    ["integer id", { ...W, id: 7 }, null],
    ["string id", { ...W, id: "abc" }, null],
    ["base_lang present", { ...W, base_lang: "es" }, null],
    ["legacy word without base_lang", W, null],
    ["v1 Form objects", { ...W, forms: [{ text: "house" }, { text: "houses", pos: "noun" }] }, null],
    ["no forms, english fallback", { ...W, forms: [] }, null],
    ["10 forms", { ...W, forms: Array.from({ length: 10 }, (_, i) => `form${i}`) }, null],
    ["64-character native", { ...W, native: "я".repeat(64) }, null],
    ["emoji counted as one character", { ...W, native: "🐶".repeat(64) }, null],
    ["missing id", { ...W, id: undefined }, "bad_id"],
    ["fractional id", { ...W, id: 1.5 }, "bad_id"],
    ["object id", { ...W, id: {} }, "bad_id"],
    ["empty lang", { ...W, lang: "" }, "bad_lang"],
    ["36-character lang", { ...W, lang: "x".repeat(36) }, "bad_lang"],
    ["empty base_lang", { ...W, base_lang: "" }, "bad_base_lang"],
    ["empty native", { ...W, native: "" }, "bad_native"],
    ["65-character native", { ...W, native: "я".repeat(65) }, "bad_native"],
    ["10 KB native", { ...W, native: "x".repeat(10_240) }, "bad_native"],
    ["native with a newline", { ...W, native: "дом\nx" }, "bad_native"],
    // A learner may add one-letter words ("I", "a"); the matcher decides whether to swap them.
    ["one-letter form 'a'", { ...W, forms: ["a"] }, null],
    // Bad individual forms are removed (see below); the word stays while english is valid.
    ["41-character form", { ...W, forms: ["x".repeat(41)] }, null],
    ["form that isn't a string", { ...W, forms: [3] }, null],
    ["Form object without text", { ...W, forms: [{ pos: "noun" }] }, null],
    ["11 forms", { ...W, forms: Array.from({ length: 11 }, (_, i) => `form${i}`) }, null],
    ["forms that aren't a list", { ...W, forms: "house" }, "bad_forms"],
    ["no forms and no english", { ...W, forms: [], english: undefined }, "bad_forms"],
    ["only bad forms and no english", { ...W, forms: [3, "x".repeat(41)], english: undefined }, "bad_forms"],
    ["not an object", "дом", "not_an_object"],
    ["null", null, "not_an_object"],
  ];
  for (const [name, w, reason] of words) {
    test(`word check: ${name}`, () => {
      assert.equal(checkWord(w), reason);
    });
  }

  test("invalid words are dropped and counted; the rest are kept in order", () => {
    const r = ok({
      words: [W, { ...W, id: 2, forms: [3], english: undefined }, { ...W, id: 3 }, { ...W, id: 4, native: "" }],
    });
    assert.deepEqual(r.words.map((w) => w.id), [1, 3]);
    assert.equal(r.dropped, 2);
    assert.deepEqual(r.reasons, { bad_forms: 1, bad_native: 1 });
  });

  test("a word keeps its good forms when some are bad, and is otherwise untouched", () => {
    const messy = { ...W, id: 5, forms: ["house", 3, "x".repeat(41), "houses"] };
    const r = ok({ words: [W, messy] });
    assert.equal(r.dropped, 0);
    assert.equal(r.droppedForms, 2);
    assert.deepEqual(r.words[1], { ...messy, forms: ["house", "houses"] });
    assert.deepEqual(r.words[0], W);
  });

  test("more than 10 forms are cut to the first 10", () => {
    const many = { ...W, forms: Array.from({ length: 11 }, (_, i) => `form${i}`) };
    assert.deepEqual(ok({ words: [many] }).words[0].forms, many.forms.slice(0, 10));
  });

  test(`at most ${LIMITS.maxWords} words are kept`, () => {
    const many = Array.from({ length: LIMITS.maxWords + 5 }, (_, i) => ({ ...W, id: i }));
    const r = filterWords(many);
    assert.equal(r.words.length, LIMITS.maxWords);
    assert.equal(r.words.at(-1).id, LIMITS.maxWords - 1);
    assert.deepEqual(r.reasons, { too_many_words: 5 });
    assert.equal(r.dropped, 5);
  });
});

describe("message router", () => {
  const runtime = { id: "me", getURL: (p) => `chrome-extension://me/${p}` };
  const popup = { id: "me", url: "chrome-extension://me/popup.html" };
  const tabPage = { id: "me", url: "chrome-extension://me/popup.html", tab: { id: 4 } };
  const content = { id: "me", url: "https://news.example/a", tab: { id: 1 } };
  const docs = { id: "me", url: "https://docs.example/connect?code=1", tab: { id: 2 } };
  const other = { id: "other", url: "chrome-extension://other/x.html" };

  test("sender kinds", () => {
    const kinds = (s) => [...senderKinds(s, runtime, "https://docs.example")].sort();
    assert.deepEqual(kinds(popup), ["page"]);
    assert.deepEqual(kinds(tabPage), ["page"]);
    assert.deepEqual(kinds(content), ["content"]);
    assert.deepEqual(kinds(docs), ["content", "docs"]);
    assert.deepEqual(kinds(other), []);
    assert.deepEqual(kinds({ id: "me", url: "file:///x.html", tab: { id: 3 } }), []);
    assert.deepEqual(kinds({ id: "me", url: "https://news.example/" }), [], "a web URL without a tab");
    assert.deepEqual(kinds({ id: "me", url: "chrome-extension://other/popup.html" }), [], "another extension's URL");
    assert.deepEqual(kinds(null), []);
  });

  // Calls the router like the browser would and returns what it answered (or undefined).
  async function call(router, msg, sender) {
    let answer;
    let answered = false;
    const ret = router(msg, sender, (r) => {
      answered = true;
      answer = r;
    });
    if (ret === true) {
      for (let i = 0; i < 10 && !answered; i++) await new Promise((r) => setTimeout(r, 0));
    }
    return { ret, answered, answer };
  }

  const handlers = {
    open: { from: ["page", "content"], run: async () => ({ ok: true }) },
    write: { from: ["page"], check: (m) => (m.n > 0 ? null : "n must be positive"), run: async (m) => ({ n: m.n }) },
    oauth: { from: ["docs"], run: async () => ({ ok: true }) },
    boom: { from: ["page"], run: async () => Promise.reject(Object.assign(new Error("nope"), { code: "http_error" })) },
    bang: { from: ["page"], run: async () => Promise.reject(Object.assign(new Error("gone"), { code: "http_error", details: { status: 502 } })) },
  };
  const router = createMessageRouter({ runtime, handlers, docsOrigin: "https://docs.example" });

  test("allowed senders get the handler's answer", async () => {
    assert.deepEqual((await call(router, { type: "open" }, content)).answer, { ok: true });
    assert.deepEqual((await call(router, { type: "write", n: 2 }, popup)).answer, { n: 2 });
    assert.deepEqual((await call(router, { type: "oauth" }, docs)).answer, { ok: true });
  });

  test("disallowed senders get forbidden", async () => {
    for (const [msg, sender] of [
      [{ type: "write", n: 2 }, content],
      [{ type: "oauth" }, content],
      [{ type: "oauth" }, popup],
      [{ type: "open" }, other],
    ]) {
      const r = await call(router, msg, sender);
      assert.deepEqual(r.answer, { error: { code: "forbidden" } }, `${msg.type} from ${sender.url}`);
    }
  });

  test("unknown types get no answer at all", async () => {
    for (const msg of [{ type: "nope" }, { type: "toString" }, { type: "__proto__" }, null, "sync", {}]) {
      const r = await call(router, msg, popup);
      assert.equal(r.answered, false);
      assert.equal(r.ret, undefined);
    }
  });

  test("bad payloads are refused before the handler runs", async () => {
    const r = await call(router, { type: "write", n: 0 }, popup);
    assert.deepEqual(r.answer, { error: { code: "invalid_message", message: "n must be positive" } });
  });

  test("handler errors answer with the message and code", async () => {
    assert.deepEqual((await call(router, { type: "boom" }, popup)).answer, { error: "nope", code: "http_error" });
  });

  test("handler errors carry their details, so the popup can choose its words", async () => {
    assert.deepEqual((await call(router, { type: "bang" }, popup)).answer, { error: "gone", code: "http_error", details: { status: 502 } });
  });
});
