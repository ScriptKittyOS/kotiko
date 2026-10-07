// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 11's lookup client (extension/lib/llm/client.js) against a stubbed fetch: every
// preset of spec/providers.json builds the right request, and every failure becomes slice
// 25's code under slice 10's policy. No network: the stub answers everything.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { ROOT } from "../helpers/load-script.mjs";
import { loadLocalLibs } from "../helpers/local-libs.mjs";

globalThis.IDBKeyRange = IDBKeyRange;
const L = loadLocalLibs();
const ANSWERS = JSON.parse(fs.readFileSync(path.join(ROOT, "test/fixtures/llm/answers.json"), "utf8"));
const OR_MODELS = JSON.parse(fs.readFileSync(path.join(ROOT, "test/fixtures/openrouter/models-2026-10-01.json"), "utf8"));
const KEY = "sk-test-0123456789abcdef";

const json = (status, body, headers = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const answer = (text, model = "m") => json(200, { id: "x", model, choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(ANSWERS[text] ?? { intent: "add", words: [] }) } }] });

// A fetch stub: `chat(req, n)` answers the nth chat request; /models and /key have defaults.
function stub({ chat = (req) => answer(req.user), models = null, key = { data: { label: "k" } } } = {}) {
  const log = [];
  let n = 0;
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    const req = { url: String(url), path: u.pathname, method: init.method ?? "GET", headers: { ...init.headers }, body, user: body?.messages?.at(-1)?.content };
    log.push(req);
    if (init.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    if (u.pathname.endsWith("/models")) return models ? models(req) : json(200, { data: [{ id: "fake/model-a:free", context_length: 32768, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["response_format", "max_tokens"] }] });
    if (u.pathname.endsWith("/key")) return json(200, key);
    return chat(req, n++);
  };
  return { fetch, log, chats: () => log.filter((r) => r.path.endsWith("/chat/completions")) };
}

function client({ provider = "openrouter", baseUrl = null, model = null, key = KEY, dataCollection = "allow", fetch, store = null, timeScale = 1, now } = {}) {
  return L.Client.createClient({
    fetch,
    store,
    settings: async () => ({ kind: "provider", provider, baseUrl, model, dataCollection }),
    key: async () => key,
    timeScale,
    sleep: async () => {},
    ...(now ? { now } : {}),
  });
}

const REQ = { text: "shukran", base_langs: ["en"], hint_lang: null, recent: [] };

describe("presets (spec/providers.json): URL, headers and JSON mode", () => {
  const cases = [
    ["openrouter", null, "https://openrouter.ai/api/v1", { "HTTP-Referer": "https://github.com/ScriptKittyOS/kotiko", "X-Title": "Kotiko" }, true],
    ["openai", null, "https://api.openai.com/v1", {}, true],
    ["anthropic", null, "https://api.anthropic.com/v1", { "anthropic-dangerous-direct-browser-access": "true" }, false],
    ["gemini", null, "https://generativelanguage.googleapis.com/v1beta/openai", {}, true],
    ["groq", null, "https://api.groq.com/openai/v1", {}, true],
    ["ollama", null, "http://localhost:11434/v1", {}, true],
    ["lmstudio", null, "http://localhost:1234/v1", {}, false],
    ["custom", "https://llm.example.net/v1/", "https://llm.example.net/v1", {}, true],
  ];
  test("there are eight presets, OpenRouter first and the default", () => {
    assert.deepEqual(L.spec.providers.providers.map((p) => p.id), cases.map((c) => c[0]));
    assert.equal(L.spec.providers.default, "openrouter");
  });
  for (const [id, baseUrl, base, headers, jsonMode] of cases) {
    test(`${id}: one add, the right request`, async () => {
      const keyless = id === "ollama" || id === "lmstudio";
      const s = stub({ models: (req) => json200Models(id, req) });
      const c = client({ provider: id, baseUrl, key: keyless ? null : KEY, fetch: s.fetch });
      const r = await c.lookup(REQ);
      assert.equal(r.ok, true, JSON.stringify(r.error));
      assert.equal(r.result.words[0].native, "شكرا");
      const [chat] = s.chats();
      assert.equal(chat.url, `${base}/chat/completions`);
      assert.equal(chat.method, "POST");
      for (const [k, v] of Object.entries(headers)) assert.equal(chat.headers[k], v, k);
      assert.equal(chat.headers.Authorization, keyless ? undefined : `Bearer ${KEY}`);
      assert.equal("response_format" in chat.body, jsonMode, "response_format");
      assert.equal(chat.body.messages[0].role, "system");
      assert.match(chat.body.messages[0].content, /English/, "the prompt names the base");
      assert.equal(chat.body.messages[1].content, "shukran");
      if (id === "openrouter") assert.equal(chat.body.model, "fake/model-a:free");
    });
  }

  // Slice 54, A-07: a model stuck repeating itself could write until the model's own limit
  // on every lookup, billed to the learner's key. Every request now carries the spec's cap
  // (spec/models.json policy.max_tokens), in the field the preset's API reads.
  for (const [id, baseUrl] of cases.map((c) => [c[0], c[1]])) {
    test(`${id}: every lookup and respelling carries the spec's output cap`, async () => {
      const keyless = id === "ollama" || id === "lmstudio";
      const field = id === "openai" ? "max_completion_tokens" : "max_tokens";
      const other = field === "max_tokens" ? "max_completion_tokens" : "max_tokens";
      // OpenRouter's model doesn't list max_tokens among its parameters: the cap goes anyway
      // (OpenRouter ignores a parameter a model doesn't take).
      const s = stub({ models: (req) => json200Models(id, req) });
      const c = client({ provider: id, baseUrl, key: keyless ? null : KEY, fetch: s.fetch });
      assert.equal((await c.lookup(REQ)).ok, true);
      await c.respell([{ lang: "ar", native: "شكرا", sense: null, base_langs: ["en"] }]);
      const [lookup, respell] = s.chats();
      assert.equal(lookup.body[field], L.spec.models.policy.max_tokens.lookup, "lookup");
      assert.equal(respell.body[field], L.spec.models.policy.max_tokens.respell, "respell");
      assert.equal(other in lookup.body, false, `no ${other} beside it`);
    });
  }

  function json200Models(id) {
    const ids = { openai: ["whisper-1", "gpt-4o-mini", "gpt-4.1-mini"], gemini: ["models/gemini-2.5-flash"], groq: ["llama-3.3-70b-versatile"], ollama: ["llama3.2"], lmstudio: ["qwen2.5-7b"], custom: ["my-model"] }[id];
    if (!ids) return json(200, { data: [{ id: "fake/model-a:free", context_length: 32768, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["response_format", "reasoning"] }] });
    return json(200, { data: ids.map((x) => ({ id: x })) });
  }

  test("models-endpoint presets use their preferred models, in order, and skip what isn't a chat model", async () => {
    const s = stub({ models: () => json(200, { data: [{ id: "whisper-1" }, { id: "gpt-4o-mini" }, { id: "gpt-4.1-mini" }] }) });
    await client({ provider: "openai", fetch: s.fetch }).lookup(REQ);
    assert.equal(s.chats()[0].body.model, "gpt-4.1-mini");
  });

  test("a model typed in the settings is used as given", async () => {
    const s = stub();
    await client({ provider: "openrouter", model: "vendor/chosen:free", fetch: s.fetch }).lookup(REQ);
    assert.deepEqual(s.chats().map((c) => c.body.model), ["vendor/chosen:free"]);
    assert.equal(s.log.some((r) => r.path.endsWith("/models")), false, "no list needed");
  });

  test("OpenRouter: reasoning off where the model lists it; the 'don't keep my text' preference when chosen", async () => {
    const s = stub({ models: () => json(200, { data: [{ id: "fake/r:free", context_length: 9000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["response_format", "reasoning"] }] }) });
    await client({ dataCollection: "deny", fetch: s.fetch }).lookup(REQ);
    assert.deepEqual(s.chats()[0].body.reasoning, { enabled: false });
    assert.deepEqual(s.chats()[0].body.provider, { data_collection: "deny" });
  });

  test("the OpenRouter catalog filters and orders the real list shape (slice 10 section 1)", () => {
    const f = L.Catalog.filter(OR_MODELS.data ?? OR_MODELS, Date.UTC(2026, 9, 2));
    const chain = L.Catalog.ordered(f.entries, "lookup").map((m) => m.id);
    assert.ok(chain.length > 0);
    assert.ok(chain.every((id) => id.endsWith(":free") && !/guard|coder|^openrouter\//i.test(id)));
    const prefer = L.spec.models.prefer.filter((id) => chain.includes(id));
    assert.deepEqual(chain.slice(0, prefer.length), prefer, "preferred models first");
  });
});

describe("failures become slice 25 codes", () => {
  test("no key: lookup_not_set_up, and nothing is sent", async () => {
    const s = stub();
    const r = await client({ key: null, fetch: s.fetch }).lookup(REQ);
    assert.deepEqual(r, { ok: false, error: { code: "lookup_not_set_up", details: { reason: "no_key" } } });
    assert.equal(s.log.length, 0);
  });

  test("Custom without an address: lookup_not_set_up", async () => {
    const r = await client({ provider: "custom", fetch: stub().fetch }).lookup(REQ);
    assert.deepEqual(r.error, { code: "lookup_not_set_up", details: { reason: "no_url" } });
  });

  test("401: key_rejected, naming the provider", async () => {
    const s = stub({ chat: () => json(401, { error: { message: "No auth credentials found", code: 401 } }) });
    const r = await client({ fetch: s.fetch }).lookup(REQ);
    assert.deepEqual(r.error, { code: "key_rejected", details: { reason: "unauthorized", status: 401, provider: "openrouter" } });
  });

  test("the daily free limit: quota_exhausted until the next UTC midnight, no other model asked", async () => {
    const s = stub({ chat: () => json(429, { error: { message: "Rate limit exceeded: free-models-per-day", code: 429 } }) });
    const r = await client({ fetch: s.fetch }).lookup(REQ);
    assert.equal(r.error.code, "quota_exhausted");
    assert.equal(r.error.details.reason, "daily_limit");
    const at = new Date(r.error.details.retry_at);
    assert.equal(at.getUTCHours(), 0);
    assert.ok(at > new Date());
    assert.equal(s.chats().length, 1);
  });

  test("OpenRouter's own short limit with Retry-After: the same model again after the wait", async () => {
    const s = stub({ chat: (req, n) => (n === 0 ? json(429, { error: { message: "Rate limit exceeded" } }, { "retry-after": "1", "x-ratelimit-limit": "20", "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Date.now() + 1000) }) : answer(req.user)) });
    const r = await client({ fetch: s.fetch }).lookup(REQ);
    assert.equal(r.ok, true);
    assert.equal(s.chats().length, 2);
    assert.equal(s.chats()[0].body.model, s.chats()[1].body.model);
  });

  test("a busy upstream provider: the next model", async () => {
    const two = () => json(200, { data: ["a/one:free", "a/two:free"].map((id) => ({ id, context_length: 9000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["response_format"] })) });
    const s = stub({ models: two, chat: (req, n) => (n === 0 ? json(429, { error: { message: "upstream busy", metadata: { provider_name: "X" } } }) : answer(req.user)) });
    const r = await client({ fetch: s.fetch }).lookup(REQ);
    assert.equal(r.ok, true);
    assert.deepEqual(s.chats().map((c) => c.body.model), ["a/one:free", "a/two:free"]);
  });

  test("a 400 that names response_format: the same model again without it (Custom's fallback)", async () => {
    const s = stub({ chat: (req, n) => (n === 0 ? json(400, { error: { message: "response_format json_object is not supported" } }) : answer(req.user)) });
    const r = await client({ provider: "custom", baseUrl: "http://127.0.0.1:9/v1", model: "m", fetch: s.fetch }).lookup(REQ);
    assert.equal(r.ok, true);
    assert.deepEqual(s.chats().map((c) => "response_format" in c.body), [true, false]);
  });

  test("unknown models everywhere: model_unavailable", async () => {
    const s = stub({ chat: () => json(404, { error: { message: "No endpoints found" } }) });
    const r = await client({ provider: "openai", model: "gone", fetch: s.fetch }).lookup(REQ);
    assert.equal(r.error.code, "model_unavailable");
  });

  test("prose around the JSON is fine; an unreadable answer twice is bad_lookup_result", async () => {
    const prose = stub({ chat: () => json(200, { choices: [{ message: { content: `Sure! ${JSON.stringify(ANSWERS.shukran)} Hope that helps {:` } }] }) });
    assert.equal((await client({ fetch: prose.fetch }).lookup(REQ)).ok, true);
    const junk = stub({ chat: () => json(200, { choices: [{ message: { content: "I am not JSON" } }] }) });
    const r = await client({ provider: "openai", model: "m", fetch: junk.fetch }).lookup(REQ);
    assert.equal(r.error.code, "bad_lookup_result");
  });

  test("no word found is an answer (with its code), not an error", async () => {
    const s = stub({ chat: () => json(200, { choices: [{ message: { content: JSON.stringify({ intent: "add", words: [] }) } }] }) });
    const r = await client({ provider: "openai", model: "m", fetch: s.fetch }).lookup(REQ);
    assert.equal(r.ok, true);
    assert.equal(r.result.code, "no_word_found");
  });

  test("the network failing: model_unavailable after the attempts; a stall: lookup_timeout", async () => {
    const down = stub({ chat: () => Promise.reject(new TypeError("fetch failed")) });
    assert.equal((await client({ provider: "openai", model: "m", fetch: down.fetch }).lookup(REQ)).error.code, "model_unavailable");
    const stall = stub({ chat: (req) => new Promise((_, reject) => req && setTimeout(() => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), 5_000)) });
    const fetch = (url, init) => {
      if (!String(url).endsWith("/chat/completions")) return stall.fetch(url, init);
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    };
    const r = await client({ provider: "openai", model: "m", fetch, timeScale: 0.01 }).lookup(REQ);
    assert.equal(r.error.code, "lookup_timeout");
  });

  test("new settings abort a running attempt: the caller gets an AbortError and retries", async () => {
    const ctl = new AbortController();
    const fetch = (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const p = client({ provider: "openai", model: "m", fetch }).lookup(REQ, { signal: ctl.signal });
    ctl.abort();
    await assert.rejects(p, { name: "AbortError" });
  });
});

describe("quota, cache and the Test button", () => {
  test("with no free lookups left, nothing is asked: quota_exhausted at the reset", async () => {
    const s = stub({ key: { data: { label: "k", free_model_daily_requests: { used: 50, limit: 50, remaining: 0 } } } });
    const c = client({ fetch: s.fetch });
    await c.refreshQuota();
    const r = await c.lookup(REQ);
    assert.equal(r.error.code, "quota_exhausted");
    assert.equal(s.chats().length, 0);
    assert.ok(await c.quotaLow());
    assert.deepEqual((await c.status()).quota.remaining, 0);
  });

  test("a paid provider has no free-quota gate", async () => {
    const s = stub();
    const r = await client({ provider: "openai", model: "m", fetch: s.fetch }).lookup(REQ);
    assert.equal(r.ok, true);
    assert.equal(s.log.some((x) => x.path.endsWith("/key")), false);
  });

  test("a repeated lookup comes from the cache (IndexedDB), with no request", async () => {
    const store = await L.Store.open({ indexedDB: new IDBFactory() });
    const s = stub();
    const c = client({ provider: "openai", model: "m", fetch: s.fetch, store });
    const a = await c.lookup(REQ);
    const b = await c.lookup({ ...REQ, text: "  SHUKRAN " });
    assert.equal(a.cache, "miss");
    assert.equal(b.cache, "hit");
    assert.equal(s.chats().length, 1);
    assert.deepEqual(b.result.words, a.result.words);
    const fresh = await c.lookup(REQ, { fresh: true });
    assert.equal(s.chats().length, 2);
    assert.equal(fresh.ok, true);
  });

  test("the cache key covers the spec, prompt, mode, hint, recent languages, bases in order and the text", async () => {
    const c = client({ fetch: stub().fetch });
    const k = (r) => c.cacheKey({ mode: "add", ...REQ, ...r });
    assert.equal(await k({ text: "Shukran" }), await k({ text: " shukran " }));
    assert.notEqual(await k({ base_langs: ["en", "es"] }), await k({ base_langs: ["es", "en"] }));
    assert.notEqual(await k({ hint_lang: "ar" }), await k({}));
    assert.match(await k({}), /^[0-9a-f]{64}$/);
  });

  test("Test: one small lookup, one attempt, never cached", async () => {
    const s = stub({ chat: () => json(200, { choices: [{ message: { content: JSON.stringify({ intent: "add", words: [{ lang: "es", native: "hola", english: "hello", english_forms: ["hello"] }] }) } }] }) });
    const r = await client({ fetch: s.fetch }).test();
    assert.equal(r.ok, true);
    assert.equal(r.model, "fake/model-a:free");
    assert.equal(s.chats().length, 1);
    assert.equal(s.chats()[0].body.messages[1].content, "hello");
    const bad = await client({ fetch: stub({ chat: () => json(401, {}) }).fetch }).test();
    assert.equal(bad.error.code, "key_rejected");
  });

  test("respell asks for the pronunciations with the respell prompt and checks the answer", async () => {
    const s = stub({ chat: () => json(200, { choices: [{ message: { content: JSON.stringify({ items: [{ lang: "ru", native: "спасибо", base_lang: "en", pronunciation: "spa-SEE-ba" }] }) } }] }) });
    const r = await client({ fetch: s.fetch }).respell([{ lang: "ru", native: "спасибо", sense: "", base_langs: ["en"] }]);
    assert.equal(r.ok, true);
    assert.equal(r.result[0].pronunciation, "spa-SEE-ba");
    assert.match(s.chats()[0].body.messages[0].content, /respell|pronunciation/i);
  });
});

describe("PKCE (Connect OpenRouter's hook)", () => {
  test("an S256 pair, the auth URL, and the callback check", async () => {
    const { verifier, challenge } = await L.PKCE.pair();
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    assert.equal(challenge, Buffer.from(digest).toString("base64url"));
    const u = new URL(L.PKCE.authUrl({ challenge }));
    assert.equal(u.origin + u.pathname, "https://openrouter.ai/auth");
    assert.equal(u.searchParams.get("callback_url"), "https://kotiko.org/connect/");
    assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    assert.ok(L.PKCE.isCallback("https://kotiko.org/connect/?code=abc"));
    assert.ok(!L.PKCE.isCallback("https://evil.example/connect/?code=abc"));
    assert.ok(!L.PKCE.isCallback("https://kotiko.org/other/?code=abc"));
  });

  test("exchange posts the code and verifier, and returns the key", async () => {
    const sent = [];
    const key = await L.PKCE.exchange({ fetch: async (url, init) => (sent.push([url, JSON.parse(init.body)]), json(200, { key: "sk-or-new" })), code: "c", verifier: "v" });
    assert.equal(key, "sk-or-new");
    assert.deepEqual(sent, [["https://openrouter.ai/api/v1/auth/keys", { code: "c", code_verifier: "v", code_challenge_method: "S256" }]]);
    await assert.rejects(L.PKCE.exchange({ fetch: async () => json(400, {}), code: "c", verifier: "v" }), { code: "key_rejected" });
  });
});

describe("an address the learner didn't choose (slice 28 §7)", () => {
  test("when `allow` says no, nothing is sent and the key isn't even read: lookups, Test, the model list, the quota", async () => {
    const s = stub();
    let keyReads = 0;
    const asked = [];
    const c = L.Client.createClient({
      fetch: s.fetch,
      settings: async () => ({ kind: "provider", provider: "openrouter", baseUrl: "https://evil.example/v1", model: null, dataCollection: "allow" }),
      key: async () => (keyReads++, KEY),
      allow: async (id, url) => (asked.push([id, url]), false),
      sleep: async () => {},
    });
    const r = await c.lookup(REQ);
    assert.deepEqual(r, { ok: false, error: { code: "address_changed", details: { route: "lookup:openrouter" } } });
    assert.equal((await c.test()).ok, false);
    assert.equal((await c.respell([{ native: "дом", lang: "ru", gloss: "house", base_lang: "en" }])).ok, false);
    const st = await c.status();
    assert.equal(st.ready, false);
    await c.refreshQuota();
    assert.deepEqual(s.log, [], "no request at all");
    assert.equal(keyReads, 0);
    assert.deepEqual(asked[0], ["openrouter", "https://evil.example/v1"]);
  });
});
