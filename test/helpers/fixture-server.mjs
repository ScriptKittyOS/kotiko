// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// One local HTTP server for tests, on 127.0.0.1 and a random port:
//
//   /pages/*      static fixture pages (test/fixtures/pages)
//   /vendor/*     vendored libraries (test/fixtures/vendor)
//   /kotiko/*       a fake Kotiko server: GET /health, GET/POST /api/words, DELETE /api/words/:id
//   /llm/v1/*     a fake OpenAI-compatible model: /models, /key, /chat/completions
//   /__control    POST to switch behaviours, GET to read state and the request log
//
// Control body (every field optional):
//   { "reset": true,                       back to seed words and normal behaviour
//     "kotiko": "slow" | "401" | "html" | "500" | null,
//     "delayMs": 1500,                     how slow "slow" is
//     "llm": "429" | "429-headers" | "429-once" | "stall" | "prose" | null,
//     "llmRemaining": 40 | null,           free requests /key reports (null: not reported)
//     "words": [...],                      replace the fake server's word list
//     "token": "..." }                     the bearer token /kotiko/api expects
//
// Run it by hand with `node test/helpers/fixture-server.mjs [port]`.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
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
    llmRemaining: null,
    log: [],
  };
  const reset = () => {
    Object.assign(state, { token, kotiko: null, llm: null, delayMs: 1500, words: seed(), nextId: 1000, llmRemaining: null });
    state.log.length = 0;
  };

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

    if (route === "/api/words" && req.method === "GET") return send(res, 200, { words: state.words });

    if (route === "/api/words" && req.method === "POST") {
      const body = await readBody(req);
      if (typeof body.text !== "string" || !body.text) return send(res, 400, { error: 'Send {"text": "..."}' });
      const answer = answerFor(body.text);
      if (!answer.words?.length) {
        return send(res, 200, { words: [], reply: answer.reply ?? "I couldn't find a word in that." });
      }
      const saved = answer.words.map(({ english_forms: forms, ...w }) => {
        const existing = state.words.find((x) => x.lang === w.lang && x.native === w.native);
        const word = { ...w, forms: forms?.length ? forms : [w.english], id: existing?.id ?? state.nextId++ };
        state.words = [word, ...state.words.filter((x) => x !== existing)];
        return word;
      });
      return send(res, 200, { words: saved });
    }

    const del = route.match(/^\/api\/words\/([^/]+)$/);
    if (del && req.method === "DELETE") {
      const id = Number(decodeURIComponent(del[1]));
      const before = state.words.length;
      state.words = state.words.filter((w) => w.id !== id);
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
    for (const k of ["kotiko", "llm", "delayMs", "token", "llmRemaining"]) if (k in body) state[k] = body[k];
    if (Array.isArray(body.words)) state.words = body.words;
    return send(res, 200, { ok: true });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, "http://fixture.invalid");
      if (pathname === "/__control") return await control(req, res);
      if (pathname.startsWith("/pages/")) return serveStatic(res, path.join(FIXTURES, "pages"), pathname.slice(7));
      if (pathname.startsWith("/vendor/")) return serveStatic(res, path.join(FIXTURES, "vendor"), pathname.slice(8));
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
