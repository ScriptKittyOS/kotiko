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

// Another account's listener on [::1]: records every request, answers like a Kotiko server.
async function squatter() {
  const heard = [];
  const server = http.createServer((req, res) => {
    heard.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? null });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"words":[]}');
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "::1", resolve);
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
