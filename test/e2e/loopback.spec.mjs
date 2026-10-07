// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 54, B-01, in Chromium with the unpacked extension (reviewer B's proof,
// b-extension-v6-squat.mjs, as a test). Browsers resolve `localhost` themselves and try
// [::1] first. Kotiko's server listens on 127.0.0.1 only, so another account on the
// computer could listen on [::1] at the same port and get the token with the first sync.
// Kotiko now sends a plain-http localhost address to 127.0.0.1, so a listener on [::1]
// hears nothing.
import http from "node:http";
import { test, expect } from "./fixtures.mjs";
import { startFixtureServer } from "../helpers/fixture-server.mjs";

// Another account's listener: records every request, answers like a 0.2 Kotiko server.
async function squatter(host = "::1") {
  const heard = [];
  const server = http.createServer((req, res) => {
    heard.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? null });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"words":[]}');
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, host, resolve);
    });
  } catch {
    return null;
  }
  return { heard, port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

test("a server typed as http://localhost:PORT is asked at 127.0.0.1, so a listener on [::1] gets no token", async ({ context, extensionId }) => {
  const squat = await squatter();
  test.skip(!squat, "this machine has no IPv6 loopback");
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/privacy.html`);
    const token = "squat-test-token-0123456789abcdef";
    const res = await page.evaluate((m) => chrome.runtime.sendMessage(m), { type: "server.connect", url: `http://localhost:${squat.port}`, token });
    expect(res.ok).toBe(true);
    expect(await page.evaluate(() => chrome.runtime.sendMessage({ type: "sync", force: true }))).toEqual({ ok: true });
    // The sync has ended one way or the other: an error, or a sync time.
    const settled = () => page.evaluate(async () => {
      const { syncError, lastSync } = await chrome.storage.local.get(["syncError", "lastSync"]);
      return syncError?.code ?? (lastSync ? "synced" : null);
    });
    await expect.poll(settled).not.toBeNull();
    expect(squat.heard, "the listener on [::1] got requests (and the token)").toEqual([]);
    // Nothing listens on 127.0.0.1 at that port.
    expect(await settled()).toBe("server_unreachable");
    const { server } = await page.evaluate(() => chrome.storage.local.get("server"));
    expect(server.url).toBe(`http://127.0.0.1:${squat.port}`);
  } finally {
    await squat?.close();
  }
});

// Another account's listener at a given port, as d-squatter.py: logs every request with its
// headers and body, answers a proof with one it made up (it can't know the token), and
// anything else like a server with no words, without the server's signature.
async function squatterAt(host, port, heard) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      heard.push({ host, method: req.method, url: req.url, auth: req.headers.authorization ?? null, body: Buffer.concat(chunks).toString("utf8") });
      const body = req.url.endsWith("/proof") ? `{"proof":"${"A".repeat(43)}"}` : '{"words":[],"ok":true,"name":"kotiko"}';
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolve);
    });
  } catch {
    return null;
  }
  return { close: () => new Promise((r) => server.close(r)) };
}

// The same listener on 127.0.0.1, as when Kotiko's server is stopped and the port is free: the
// address is right, but nothing there can prove it holds the token, so it never gets it.
test("a listener at the server's own address, while the server is stopped, gets no token either", async ({ context, extensionId }) => {
  const squat = await squatter("127.0.0.1");
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/privacy.html`);
    const res = await page.evaluate((m) => chrome.runtime.sendMessage(m), { type: "server.connect", url: `http://127.0.0.1:${squat.port}`, token: "squat-test-token-0123456789abcdef" });
    expect(res.ok).toBe(true);
    await page.evaluate(() => chrome.runtime.sendMessage({ type: "sync", force: true }));
    await expect.poll(() => page.evaluate(async () => (await chrome.storage.local.get("syncError")).syncError?.code ?? null)).toBe("not_kotiko_server");
    expect(squat.heard.filter((r) => r.auth), "requests that carried the token").toEqual([]);
    expect(squat.heard.map((r) => `${r.method} ${r.url}`)).toContain("POST /api/v1/proof");
  } finally {
    await squat.close();
  }
});

// Slice 54, D-01 (reviewer D's d-b01.mjs, as a test): the extension proved the server once
// per worker life and then sent the token with every request, so when the server stopped
// (a crash, a restart, an update) and another account took its port, the next sync handed
// that listener the token. Now the token never leaves the browser: requests are signed, an
// unsigned answer is found out at once, and a word goes out only after a fresh proof.
test("after the server stops and a listener takes its port, the listener gets no token and no word", async ({ context, extensionId }) => {
  const token = "d01-test-token-0123456789abcdefghijklmn";
  const srv = await startFixtureServer({ token });
  const port = srv.port;
  const heard = [];
  const listeners = [];
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/privacy.html`);
    const send = (m) => page.evaluate((m) => chrome.runtime.sendMessage(m), m);
    const syncError = () => page.evaluate(async () => (await chrome.storage.local.get("syncError")).syncError?.code ?? null);

    // 1. Connected and synced: the server proved it holds the token.
    expect((await send({ type: "server.connect", url: srv.kotikoUrl, token })).ok).toBe(true);
    expect(await send({ type: "sync", force: true })).toEqual({ ok: true });
    expect(srv.state.log.some((r) => r.path === "/kotiko/api/v1/proof")).toBe(true);
    expect(srv.state.log.some((r) => r.path === "/kotiko/api/words" && r.auth)).toBe(true);

    // 2. The server stops; another program takes 127.0.0.1 (and [::1]) at its port at once.
    await srv.close();
    for (const host of ["127.0.0.1", "::1"]) {
      const l = await squatterAt(host, port, heard);
      if (l) listeners.push(l);
    }
    expect(listeners.length).toBeGreaterThan(0);

    // 3. The next sync, in the same worker, and then a word the learner adds.
    await send({ type: "sync", force: true });
    await expect.poll(() => heard.length, { message: "the sync reached the listener" }).toBeGreaterThan(0);
    const saved = await send({ type: "words.save", words: [{ lang: "ru", native: "котик", base_lang: "en", gloss: "kitten" }] });

    const log = heard.map((r) => `${r.method} ${r.url} auth=${r.auth ?? "-"} body=${r.body}`);
    expect(log.filter((l) => l.includes(token)), "requests that carried the token").toEqual([]);
    expect(heard.filter((r) => /Bearer/.test(r.auth ?? "")), "requests with a Bearer token").toEqual([]);
    expect(log.filter((l) => l.includes("котик") || l.includes("kitten")), "the word went out").toEqual([]);
    // Its first answer gave it away, and the word waited for a proof it couldn't give.
    expect(await syncError()).toBe("not_kotiko_server");
    expect(saved.ok).not.toBe(true);
    expect(heard.map((r) => `${r.method} ${r.url}`)).toEqual(["GET /kotiko/api/words", "POST /kotiko/api/v1/proof"]);
  } finally {
    for (const l of listeners) await l.close();
    await srv.close().catch(() => {});
  }
});
