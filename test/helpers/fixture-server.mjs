// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// One local HTTP server for tests, on 127.0.0.1 and a random port:
//
//   /pages/*      static fixture pages (test/fixtures/pages)
//   /vendor/*     vendored libraries (test/fixtures/vendor)
//   /npm/react.js, /npm/react-dom.js   React 18's production builds from node_modules
//                 (devDependencies, MIT), for slice 15's react-list.html
//   /kotiko/*       a fake Kotiko server: GET /health, GET/POST /api/words, DELETE /api/words/:id,
//                 and the /api/v1 routes the dashboard uses (slice 07 §5, in memory): words
//                 (GET, GET :id, POST with preview, POST batch, PATCH, DELETE, restore),
//                 jobs/pronunciation-refresh (GET, POST pause/resume) and llm/status
//                 (slice 10: the quota is `llmRemaining` of 50; each add uses one)
//   /llm/v1/*     a fake OpenAI-compatible model: /models, /key, /chat/completions
//   /__control    POST to switch behaviours, GET to read state and the request log
//
// Control body (every field optional):
//   { "reset": true,                       back to seed words and normal behaviour
//     "kotiko": "slow" | "401" | "html" | "500" | null,
//     "delayMs": 1500,                     how slow "slow" is
//     "llm": "401" | "429" | "429-headers" | "429-once" | "stall" | "prose" | null,
//     "llmRemaining": 40 | null,           free requests /key reports (null: not reported)
//     "llmDelayMs": 0,                     how long the fake model thinks before answering
//     "words": [...],                      replace the fake server's word list (0.2 shape)
//     "v1Words": [...],                    or set full slice 07 records (missing fields filled)
//     "job": {state, done, total, retry_at}  the pronunciation-refresh job
//     "failNext": {method, path, status, code, details}  one v1 request (or a legacy POST
//                                          /api/words, with a 0.2 string error) answers this error
//     "token": "..." }                     the bearer token /kotiko/api expects
//
// Run it by hand with `node test/helpers/fixture-server.mjs [port]`.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
const NODE_MODULES = path.resolve(FIXTURES, "../../node_modules");
const NPM = { "react.js": "react/umd/react.production.min.js", "react-dom.js": "react-dom/umd/react-dom.production.min.js" };
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(FIXTURES, rel), "utf8"));

// 43 characters, like a token from `openssl rand -base64 32`.
export const TEST_TOKEN = "test-token-0123456789abcdefghijklmnopqrstuv";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".vtt": "text/vtt; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
const nativeKey = (native) => String(native ?? "").normalize("NFC").toLowerCase().replaceAll("ς", "σ");
// A fixed UUIDv7-shaped id for a 0.2 integer id, so tests can name words.
export const uuidFor = (n) => `01900000-0000-7000-8000-${Number(n).toString(16).padStart(12, "0")}`;

// --- The in-memory /api/v1 word store -----------------------------------------------------
const FORM = (f) => (typeof f === "string" ? { text: f, enabled: true, case: "any", ambiguous: false } : { enabled: true, case: "any", ambiguous: false, ...f });
let clockMs = Date.UTC(2026, 8, 1, 12, 0, 0);
// Strictly increasing timestamps, so if_updated_at always tells versions apart.
const stamp = () => {
  clockMs = Math.max(clockMs + 1, Date.now());
  return new Date(clockMs).toISOString();
};

function record(fields, i = 0) {
  const at = fields.created_at ?? new Date(Date.UTC(2026, 8, 30, 12, 0, 0) - i * 3_600_000).toISOString();
  return {
    id: fields.id ?? uuidFor(fields.legacy_id ?? 9000 + i),
    legacy_id: fields.legacy_id ?? null,
    lang: fields.lang,
    native: fields.native,
    base_lang: fields.base_lang ?? "en",
    sense: fields.sense ?? "",
    romanization: fields.romanization ?? null,
    native_vocalized: fields.native_vocalized ?? null,
    gloss: fields.gloss ?? fields.english ?? null,
    forms: (fields.forms ?? [fields.gloss ?? fields.english]).filter(Boolean).map(FORM),
    pronunciation: fields.pronunciation ?? null,
    pronunciation_careful: fields.pronunciation_careful ?? null,
    pronunciation_source: fields.pronunciation_source ?? (fields.pronunciation ? "model" : null),
    note: fields.note ?? null,
    status: fields.status ?? "active",
    origin: fields.origin ?? "add",
    source_text: fields.source_text ?? null,
    created_at: at,
    updated_at: fields.updated_at ?? at,
    deleted_at: fields.deleted_at ?? null,
    merged_into: null,
    language: fields.language ?? null,
  };
}

const fromLegacy = (w, i) => record({ ...w, id: uuidFor(w.id), legacy_id: w.id, gloss: w.english }, i);
const api = (r) => {
  const out = { ...r };
  delete out.legacy_id;
  return out;
};
const toLegacy = (r) => ({
  id: r.legacy_id,
  lang: r.lang,
  language: r.language,
  native: r.native,
  romanization: r.romanization,
  english: r.gloss,
  forms: r.forms.filter((f) => f.enabled).map((f) => f.text),
  note: r.note,
  base_lang: r.base_lang,
  native_vocalized: r.native_vocalized,
  pronunciation: r.pronunciation,
  pronunciation_careful: r.pronunciation_careful,
  pronunciation_source: r.pronunciation_source,
});

function send(res, status, body, headers = {}) {
  const isText = typeof body === "string";
  res.writeHead(status, {
    "content-type": isText ? "text/plain; charset=utf-8" : "application/json",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(isText ? body : JSON.stringify(body));
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { __invalid: raw };
  }
}

function serveStatic(res, dir, rel) {
  const file = path.resolve(dir, "." + path.posix.normalize("/" + decodeURIComponent(rel)));
  if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, "not found");
  }
  res.writeHead(200, {
    "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  fs.createReadStream(file).pipe(res);
}

export async function startFixtureServer({ port = 0, host = "127.0.0.1", token = TEST_TOKEN } = {}) {
  const answers = readJson("llm/answers.json");
  const seed = () => readJson("api/words.json").words;

  const state = {
    token,
    kotiko: null,
    llm: null,
    delayMs: 1500,
    words: seed(),
    nextId: 1000,
    v1: [],
    job: { state: "done", done: 0, total: 0 },
    failNext: null,
    llmRemaining: null,
    llmDelayMs: 0,
    log: [],
  };
  state.v1 = state.words.map(fromLegacy);
  const reset = () => {
    Object.assign(state, { token, kotiko: null, llm: null, delayMs: 1500, words: seed(), nextId: 1000, job: { state: "done", done: 0, total: 0 }, failNext: null, llmRemaining: null, llmDelayMs: 0 });
    state.v1 = state.words.map(fromLegacy);
    state.log.length = 0;
  };

  // The 0.2 list the background syncs: live, active records for English pages, newest
  // first, each with a 0.2 integer id. Rebuilt after every write.
  function syncLegacy() {
    for (const r of state.v1) r.legacy_id ??= state.nextId++;
    state.words = state.v1
      .filter((r) => !r.deleted_at && r.status === "active" && r.base_lang === "en")
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
      .map(toLegacy);
  }

  const v1Error = (res, status, code, message, details = {}) => send(res, status, { error: { code, message, details } });
  const live = (r) => !r.deleted_at;
  const sameKey = (a, b) => a.lang === b.lang && nativeKey(a.native) === nativeKey(b.native) && (a.sense ?? "") === (b.sense ?? "") && a.base_lang === b.base_lang;

  // Saves a structured word (07 merge-not-overwrite, reduced): an existing live word with the
  // same key is "unchanged".
  function saveWord(w, origin) {
    const existing = state.v1.find((r) => live(r) && sameKey(r, { ...w, base_lang: w.base_lang ?? "en" }));
    if (existing) return { result: "unchanged", word: api(existing) };
    const now = stamp();
    const r = record({ ...w, id: undefined, origin: w.origin ?? origin, created_at: now, updated_at: now, legacy_id: state.nextId++ });
    r.id = `0190${Date.now().toString(16).slice(-4)}-${String(state.nextId).padStart(4, "0")}-7000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;
    state.v1.unshift(r);
    return { result: "created", word: api(r) };
  }

  const candidatesFor = (text, bases) =>
    (answerFor(text).words ?? []).map(({ english_forms: forms, english, ...w }) => ({
      ...w,
      base_lang: bases?.[0] ?? "en",
      sense: "",
      gloss: english,
      forms: forms?.length ? forms : [english],
      status: "active",
      origin: "add",
    }));

  async function v1(req, res, route) {
    const fail = state.failNext;
    if (fail && (!fail.method || fail.method === req.method) && (!fail.path || route.startsWith(fail.path))) {
      state.failNext = null;
      return v1Error(res, fail.status ?? 500, fail.code ?? "internal", fail.message ?? "Failing on purpose.", fail.details ?? {});
    }
    const url = new URL(req.url, "http://fixture.invalid");
    if (route === "/llm/status" && req.method === "GET") {
      const r = state.llmRemaining;
      const midnight = new Date();
      midnight.setUTCHours(24, 0, 0, 0);
      const quota = r === null ? null : { used: 50 - r, limit: 50, remaining: r, resets_at: midnight.toISOString(), estimated: false };
      return send(res, 200, { provider: "openrouter", models: ["fake/model-a:free"], models_source: "live", skipped: [], quota, last_result: null });
    }
    if (route === "/words" && req.method === "GET") {
      const statuses = (url.searchParams.get("status") ?? "active,paused").split(",");
      const words = state.v1.filter((r) => live(r) && statuses.includes(r.status)).map(api);
      return send(res, 200, { words, cursor: String(state.v1.length) });
    }
    if (route === "/jobs/pronunciation-refresh") {
      if (req.method === "POST") {
        const body = await readBody(req);
        if (body.action === "pause" && ["running", "waiting"].includes(state.job.state)) state.job = { ...state.job, state: "paused" };
        else if (body.action === "resume" && state.job.state === "paused") state.job = { ...state.job, state: "running" };
        else if (!["pause", "resume"].includes(body.action)) return v1Error(res, 400, "invalid_request", "Send an action.", { field: "action" });
      }
      return send(res, 200, state.job);
    }
    if (route === "/words" && req.method === "POST") {
      const body = await readBody(req);
      if (body.word && typeof body.word === "object") {
        const out = saveWord(body.word, "manual");
        syncLegacy();
        return send(res, 200, { results: [out], rejected: [], dropped_fields: [] });
      }
      if (typeof body.text !== "string" || !body.text.trim()) return v1Error(res, 400, "empty_input", "Type a word to add.");
      if (!Array.isArray(body.base_langs) || !body.base_langs.length) return v1Error(res, 400, "invalid_request", "base_langs", { field: "base_langs" });
      // A lookup uses a free one, with or without saving (the real server's quota).
      if (state.llmRemaining !== null) state.llmRemaining = Math.max(0, state.llmRemaining - 1);
      const candidates = candidatesFor(body.text, body.base_langs);
      if (body.preview === true) return send(res, 200, { candidates, rejected: [], dropped_fields: [] });
      const results = candidates.map((c) => saveWord(c, "add"));
      syncLegacy();
      return send(res, 200, { results, rejected: [], dropped_fields: [] });
    }
    if (route === "/words/batch" && req.method === "POST") {
      const body = await readBody(req);
      if (!Array.isArray(body.words)) return v1Error(res, 400, "invalid_request", "Send words.", { field: "words" });
      const results = body.words.map((w, index) => ({ ...saveWord(w, "bulk"), index }));
      syncLegacy();
      return send(res, 200, { results, rejected: [], dropped_fields: [] });
    }
    const m = route.match(/^\/words\/([^/]+)(\/restore)?$/);
    const r = m ? state.v1.find((x) => x.id === decodeURIComponent(m[1])) : null;
    if (m && m[2] && req.method === "POST") {
      if (!r) return v1Error(res, 404, "word_gone", "That word was already removed.");
      if (r.deleted_at) {
        if (state.v1.some((x) => x !== r && live(x) && sameKey(x, r))) return v1Error(res, 409, "word_conflict", "Another word already has that key.", { reason: "duplicate" });
        r.deleted_at = null;
        r.updated_at = stamp();
        syncLegacy();
      }
      return send(res, 200, { word: api(r) });
    }
    if (m && req.method === "GET") return r && live(r) ? send(res, 200, { word: api(r) }) : v1Error(res, 404, "word_gone", "That word was already removed.");
    if (m && req.method === "DELETE") {
      if (!r) return v1Error(res, 404, "word_gone", "That word was already removed.");
      if (!r.deleted_at) {
        r.deleted_at = r.updated_at = stamp();
        syncLegacy();
      }
      return send(res, 200, { word: api(r) });
    }
    if (m && req.method === "PATCH") {
      if (!r || !live(r)) return v1Error(res, 404, "word_gone", "That word was already removed.");
      const body = await readBody(req);
      if (body.if_updated_at && body.if_updated_at !== r.updated_at) {
        return v1Error(res, 409, "word_conflict", "This word changed since.", { reason: "stale", word: api(r) });
      }
      const next = { ...r };
      for (const k of ["lang", "native", "romanization", "native_vocalized", "gloss", "pronunciation", "pronunciation_careful", "pronunciation_source", "note", "status", "sense"]) {
        if (k in body) next[k] = typeof body[k] === "string" ? body[k].trim() || null : body[k];
      }
      if ("forms" in body) next.forms = (Array.isArray(body.forms) ? body.forms : []).map(FORM).filter((f) => f.text);
      if (!next.native || !next.gloss) return v1Error(res, 400, "invalid_word", "That change isn't a valid word.", { field: !next.native ? "native" : "gloss", reason: "missing_field" });
      if (!next.forms.some((f) => f.enabled)) return v1Error(res, 400, "invalid_word", "That change isn't a valid word.", { field: "forms", reason: "no_usable_forms" });
      if (!["active", "paused"].includes(next.status)) return v1Error(res, 400, "invalid_word", "That change isn't a valid word.", { field: "status", reason: "bad_value" });
      if ("pronunciation" in body && !body.pronunciation) Object.assign(next, { pronunciation: null, pronunciation_careful: null, pronunciation_source: null });
      else if (("pronunciation" in body || "pronunciation_careful" in body) && !("pronunciation_source" in body)) next.pronunciation_source = "user";
      if (next.pronunciation && /^[A-Z-]+$/.test(next.pronunciation) && next.pronunciation.includes("-")) {
        return v1Error(res, 400, "invalid_word", "That change isn't a valid word.", { field: "pronunciation", reason: "bad_pronunciation" });
      }
      const other = state.v1.find((x) => x !== r && live(x) && sameKey(x, next));
      if (other) return v1Error(res, 409, "word_conflict", "Another word already has that key.", { reason: "duplicate", other_id: other.id });
      Object.assign(r, next, { updated_at: stamp() });
      syncLegacy();
      return send(res, 200, { word: api(r) });
    }
    return v1Error(res, 404, "not_found", "No such route.");
  }

  // Finds the canned model answer for a user's text.
  const answerFor = (text) => answers[norm(text)] ?? { intent: "add", words: [] };

  async function kotiko(req, res, route) {
    if (state.kotiko === "slow") await sleep(state.delayMs);
    if (route === "/health" && req.method === "GET") return send(res, 200, "ok");
    if (state.kotiko === "401") return send(res, 401, "unauthorized");
    if (state.kotiko === "500") return send(res, 500, { error: "Something broke on the fake server." });
    if (state.kotiko === "html") {
      return send(res, 200, "<!doctype html><title>Sign in to the Wi-Fi</title><p>Captive portal</p>", {
        "content-type": "text/html; charset=utf-8",
      });
    }
    if (req.headers.authorization !== `Bearer ${state.token}`) return send(res, 401, "unauthorized");

    if (route.startsWith("/api/v1/")) return v1(req, res, route.slice("/api/v1".length));
    if (route === "/api/words" && req.method === "GET") return send(res, 200, { words: state.words });

    if (route === "/api/words" && req.method === "POST") {
      const body = await readBody(req);
      if (typeof body.text !== "string" || !body.text) return send(res, 400, { error: 'Send {"text": "..."}' });
      const fail = state.failNext;
      if (fail && (!fail.method || fail.method === "POST") && fail.path === "/api/words") {
        state.failNext = null;
        return send(res, fail.status ?? 502, { error: fail.message ?? "Failing on purpose.", code: fail.code, details: fail.details ?? {} });
      }
      if (state.llmRemaining !== null) state.llmRemaining = Math.max(0, state.llmRemaining - 1);
      const answer = answerFor(body.text);
      if (!answer.words?.length) {
        return send(res, 200, { words: [], reply: answer.reply ?? "I couldn't find a word in that." });
      }
      const saved = answer.words.map(({ english_forms: forms, ...w }) => {
        const existing = state.words.find((x) => x.lang === w.lang && x.native === w.native);
        const word = { ...w, forms: forms?.length ? forms : [w.english], id: existing?.id ?? state.nextId++ };
        state.words = [word, ...state.words.filter((x) => x !== existing)];
        // The same word in the v1 store, so the dashboard sees it.
        const old = state.v1.find((r) => live(r) && r.lang === w.lang && r.native === w.native && r.base_lang === "en");
        const now = stamp();
        if (old) Object.assign(old, { gloss: w.english, forms: word.forms.map(FORM), updated_at: now });
        else state.v1.unshift(record({ ...word, legacy_id: word.id, id: uuidFor(word.id), created_at: now, updated_at: now }));
        return word;
      });
      return send(res, 200, { words: saved });
    }

    const del = route.match(/^\/api\/words\/([^/]+)$/);
    if (del && req.method === "DELETE") {
      const id = Number(decodeURIComponent(del[1]));
      const before = state.words.length;
      state.words = state.words.filter((w) => w.id !== id);
      for (const r of state.v1) if (r.legacy_id === id && !r.deleted_at) r.deleted_at = r.updated_at = stamp();
      return state.words.length < before ? send(res, 200, { ok: true }) : send(res, 404, { error: "No such word." });
    }
    return send(res, 404, "not found");
  }

  async function llm(req, res, route) {
    if (route === "/models" && req.method === "GET") return send(res, 200, readJson("llm/models.json"));
    if (route === "/key" && req.method === "GET") {
      const key = readJson("llm/key.json");
      if (state.llmRemaining !== null) key.data.free_model_daily_requests = { remaining: state.llmRemaining };
      return send(res, 200, key);
    }
    if (route !== "/chat/completions" || req.method !== "POST") return send(res, 404, { error: { message: "not found" } });

    const body = await readBody(req);
    if (state.llm === "stall") return; // never answers; closed when the server stops
    if (state.llm === "401") return send(res, 401, { error: { message: "No auth credentials found", code: 401 } });
    if (state.llm === "429") return send(res, 429, { error: { message: "Rate limit exceeded", code: 429 } });
    if (state.llm === "429-once") {
      state.llm = null;
      return send(res, 429, { error: { message: "Rate limit exceeded", code: 429 } }, {
        "x-ratelimit-reset": String(Date.now() + 150),
      });
    }
    if (state.llm === "429-headers") {
      return send(res, 429, { error: { message: "Rate limit exceeded", code: 429 } }, {
        "retry-after": "2",
        "x-ratelimit-limit": "20",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(Date.now() + 2000),
      });
    }

    if (state.llmDelayMs) await sleep(state.llmDelayMs);
    const user = [...(body.messages ?? [])].reverse().find((m) => m.role === "user");
    if (state.llmRemaining !== null) state.llmRemaining = Math.max(0, state.llmRemaining - 1);
    let content = JSON.stringify(answerFor(user?.content ?? ""));
    if (state.llm === "prose") content = `Sure! Here is the JSON you asked for:\n${content}\nHope that helps {:`;
    return send(res, 200, {
      id: `chatcmpl-fake-${state.log.length}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: body.model ?? "fake/model-a:free",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }

  async function control(req, res) {
    if (req.method === "GET") return send(res, 200, state);
    const body = await readBody(req);
    if (body.reset) reset();
    for (const k of ["kotiko", "llm", "delayMs", "token", "job", "failNext", "llmRemaining", "llmDelayMs"]) if (k in body) state[k] = body[k];
    if (Array.isArray(body.words)) {
      state.words = body.words;
      state.v1 = body.words.map(fromLegacy);
    }
    if (Array.isArray(body.v1Words)) {
      state.v1 = body.v1Words.map((w, i) => record(w, i));
      syncLegacy();
    }
    return send(res, 200, { ok: true });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, "http://fixture.invalid");
      if (pathname === "/__control") return await control(req, res);
      if (pathname.startsWith("/pages/")) return serveStatic(res, path.join(FIXTURES, "pages"), pathname.slice(7));
      if (pathname.startsWith("/vendor/")) return serveStatic(res, path.join(FIXTURES, "vendor"), pathname.slice(8));
      if (pathname.startsWith("/npm/") && NPM[pathname.slice(5)]) return serveStatic(res, NODE_MODULES, NPM[pathname.slice(5)]);
      if (pathname.startsWith("/kotiko/")) {
        state.log.push({ method: req.method, path: pathname, auth: req.headers.authorization ?? null });
        return await kotiko(req, res, pathname.slice("/kotiko".length));
      }
      if (pathname.startsWith("/llm/v1/")) {
        state.log.push({ method: req.method, path: pathname, auth: req.headers.authorization ?? null });
        return await llm(req, res, pathname.slice(7));
      }
      return send(res, 404, "not found");
    } catch (e) {
      if (!res.headersSent) send(res, 500, { error: String(e?.message ?? e) });
      else res.destroy();
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const url = `http://${host}:${server.address().port}`;

  return {
    url,
    port: server.address().port,
    token,
    state,
    reset,
    kotikoUrl: `${url}/kotiko`,
    llmUrl: `${url}/llm/v1`,
    pageUrl: (name) => `${url}/pages/${name}`,
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const srv = await startFixtureServer({ port: Number(process.argv[2] ?? 0) });
  console.log(`Fixture server on ${srv.url}  (token ${srv.token})`);
  console.log(`  pages ${srv.url}/pages/basic.html\n  kotiko  ${srv.kotikoUrl}\n  llm   ${srv.llmUrl}`);
}
