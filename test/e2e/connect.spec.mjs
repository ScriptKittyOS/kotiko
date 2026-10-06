// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// "Connect OpenRouter" (slice 11 §4) with the docs site's return page (slice 44): Kotiko's
// content script for https://kotiko.org/connect/ hands `?code=` to the background, which
// trades it for a key, and the page's status line says how it went. The sign-in starts from
// the buttons learners see: the dashboard's Word lookups and the welcome tab. kotiko.org and
// OpenRouter's sign-in page are served here by Playwright (stand-ins; the return page keeps
// the real one's status line and CSP); OpenRouter's key exchange is stubbed inside the
// service worker, so nothing leaves the machine.
import { test, expect } from "./fixtures.mjs";

const CALLBACK = "https://kotiko.org/connect/";
// The live page's own CSP (no script at all) is kept: Kotiko's content script runs in its
// own world and isn't bound by it.
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'"><title>Connecting</title></head>
<body><main><h1>Connecting Kotiko to OpenRouter</h1>
<p id="kotiko-connect-status" role="status">If Kotiko is installed in this browser, it is finishing your sign-in now.</p>
</main></body></html>`;

const SIGN_IN = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>OpenRouter</title></head><body><h1>Sign in</h1></body></html>`;

// Serves the stand-in for kotiko.org and example.org, and for OpenRouter's sign-in page;
// those requests are expected, so they're taken out of the "left localhost" list at the end.
async function serveSite(context, blocked) {
  await context.route(/^https:\/\/(kotiko|example)\.org\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: PAGE }));
  await context.route(/^https:\/\/openrouter\.ai\/auth\?/, (route) => route.fulfill({ status: 200, contentType: "text/html", body: SIGN_IN }));
  return () => {
    for (let i = blocked.length - 1; i >= 0; i--) if (/^https:\/\/(kotiko\.org|example\.org|openrouter\.ai\/auth)/.test(blocked[i])) blocked.splice(i, 1);
  };
}

const status = (page) => page.locator("#kotiko-connect-status");

// OpenRouter's key exchange, answered inside the service worker; it records what it got.
// The worker's own requests can't be routed by Playwright, so its fetch is replaced.
async function stubExchange(serviceWorker) {
  await serviceWorker.evaluate(() => {
    const real = globalThis.fetch;
    globalThis.__exchanges = [];
    globalThis.fetch = async (url, init) => {
      if (String(url) === "https://openrouter.ai/api/v1/auth/keys") {
        globalThis.__exchanges.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ key: "sk-or-v1-0123456789abcdef0123456789abcdef" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      // Connecting also asks OpenRouter for the key's free quota and the free models.
      if (String(url).startsWith("https://openrouter.ai/api/v1/")) {
        const body = String(url).includes("/models") ? { data: [] } : { data: { label: "Kotiko", usage: 0, limit: null, is_free_tier: true } };
        return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return real(url, init);
    };
  });
}

// Selects a "Connect OpenRouter" button and returns OpenRouter's sign-in tab it opened.
async function signInTab(context, button) {
  const isSignIn = (p) => p.url().startsWith("https://openrouter.ai/auth?");
  await button.click();
  // The tab opens on about:blank and then loads OpenRouter's address.
  await expect.poll(() => context.pages().some(isSignIn)).toBe(true);
  const tab = context.pages().find(isSignIn);
  const auth = new URL(tab.url());
  expect(auth.searchParams.get("callback_url")).toBe(CALLBACK);
  expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
  expect(auth.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(auth.searchParams.get("key_label")).toBe("Kotiko");
  return tab;
}

test("the return page hands the code to Kotiko, which saves the key and says so", async ({ context, serviceWorker, extensionId, blocked }) => {
  const done = await serveSite(context, blocked);
  await stubExchange(serviceWorker);

  // The settings' "Connect OpenRouter" button: the background keeps a verifier and opens
  // OpenRouter's sign-in in a new tab, whose callback is the docs site's page.
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extensionId}/dashboard.html#settings/lookups`);
  const connect = ext.locator("#connectOpenRouter");
  if (!(await connect.isVisible())) await ext.locator("#providerOptions [role=radio]").first().click();
  await expect(connect).toBeVisible();
  await expect(connect).toHaveText("Connect OpenRouter");
  const tab = await signInTab(context, connect);
  await expect(ext.locator("#lookupState")).toHaveText("Waiting for OpenRouter… Finish signing in on the other tab.");

  // OpenRouter sends the browser back with a code, in the same tab.
  const page = tab;
  await page.goto(`${CALLBACK}?code=test-code-0123456789`);
  await expect(status(page)).toHaveText("Connected. Kotiko now looks words up with OpenRouter's free models. You can close this tab.");
  // The code is gone from the address, so a reload doesn't send it again.
  await expect.poll(() => page.url()).toBe(CALLBACK);

  const exchanges = await serviceWorker.evaluate(() => globalThis.__exchanges);
  expect(exchanges).toHaveLength(1);
  expect(exchanges[0].code).toBe("test-code-0123456789");
  expect(exchanges[0].code_challenge_method).toBe("S256");
  expect(exchanges[0].code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);

  const { secrets } = await ext.evaluate(() => chrome.runtime.sendMessage({ type: "secrets.describe" }));
  expect(Object.keys(secrets)).toContain("provider:openrouter");
  const { lookup } = await serviceWorker.evaluate(() => chrome.storage.local.get("lookup"));
  expect(lookup).toMatchObject({ kind: "provider", provider: "openrouter" });
  // The settings tab, still open, shows the key that arrived.
  await expect(ext.locator("#lookupKeyMasked")).toHaveText(/^Saved key: sk-or-…/);
  await expect(ext.locator("#oauthRow")).toBeHidden();
  done();
});

test("the welcome tab's Connect OpenRouter (free) waits for the sign-in, then says Connected", async ({ context, serviceWorker, extensionId, blocked }) => {
  const done = await serveSite(context, blocked);
  await stubExchange(serviceWorker);
  const welcome = await context.newPage();
  await welcome.goto(`chrome-extension://${extensionId}/welcome.html`);
  const connect = welcome.locator("#aiConnect");
  await expect(connect).toBeVisible();
  await expect(connect).toHaveText("Connect OpenRouter (free)");
  const tab = await signInTab(context, connect);
  await expect(welcome.locator("#connectStatus")).toHaveText("Waiting for OpenRouter… Finish signing in on the other tab.");
  await tab.goto(`${CALLBACK}?code=welcome-code-0123456789`);
  await expect(status(tab)).toHaveText(/^Connected\./);
  await expect(welcome.locator("#aiConnectedText")).toHaveText("Connected to OpenRouter, free models.");
  done();
});

test("a code with no sign-in waiting is refused, and the page says it expired", async ({ context, blocked }) => {
  const done = await serveSite(context, blocked);
  const page = await context.newPage();
  await page.goto(`${CALLBACK}?code=stale-0123456789`);
  await expect(status(page)).toHaveText("This sign-in has expired. Open Kotiko's settings and select Connect OpenRouter again.");
  done();
});

test("no other page's code is read: the same path on another site stays untouched", async ({ context, blocked }) => {
  const done = await serveSite(context, blocked);
  const page = await context.newPage();
  await page.goto("https://example.org/connect/?code=0123456789");
  // Give a content script time to have acted, then check nothing did.
  await page.waitForTimeout(1000);
  await expect(status(page)).toHaveText(/it is finishing your sign-in now/);
  expect(page.url()).toContain("code=0123456789");
  done();
});
