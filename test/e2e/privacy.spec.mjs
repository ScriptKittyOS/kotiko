// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 28 §7's audit in Chromium with the unpacked extension: a key and a server token set
// through the settings, then, from inside Kotiko's own content script (its isolated world,
// reached through the DevTools protocol, as a page that subverted it would be), every
// storage area it can open holds neither; every privileged message is refused; rewriting
// the settings it can write never sends the key to a new address; and the page's own
// scripts see no original word and no Kotiko attribute beyond the swap's own, on an
// English and on a Spanish page. The vm half is test/bg/privacy.test.mjs.
import { test, expect } from "./fixtures.mjs";
import { createFakeChrome } from "../helpers/fake-chrome.mjs";
import { runInVm } from "../helpers/load-script.mjs";

const KEY = "sk-test-provider-key-0123456789abcdef";

// Runs `fn(arg)` in the extension's content-script world of `page` and returns its result.
async function inContentScript(context, page, extensionId, fn, arg = null) {
  const cdp = await context.newCDPSession(page);
  const contexts = [];
  cdp.on("Runtime.executionContextCreated", (e) => contexts.push(e.context));
  try {
    await cdp.send("Runtime.enable");
    const mine = () => contexts.find((c) => c.auxData?.type === "isolated" && c.origin === `chrome-extension://${extensionId}`);
    await expect.poll(() => !!mine(), { message: "Kotiko's content script world" }).toBe(true);
    const res = await cdp.send("Runtime.evaluate", { contextId: mine().id, expression: `(${fn})(${JSON.stringify(arg)})`, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
    return res.result.value;
  } finally {
    await cdp.detach().catch(() => {});
  }
}

// Everything a content script can try to read.
async function readEverything() {
  const area = (a) => a.get(null).then((v) => ({ ok: v }), (e) => ({ refused: String(e?.message ?? e) }));
  const out = { local: await area(chrome.storage.local), sync: await area(chrome.storage.sync), session: await area(chrome.storage.session) };
  // The content script's IndexedDB is the page's, not the extension's.
  out.databases = (await indexedDB.databases()).map((d) => d.name);
  out.kotikoStores = await new Promise((resolve) => {
    const r = indexedDB.open("kotiko");
    r.onsuccess = () => {
      const names = [...r.result.objectStoreNames];
      r.result.close();
      indexedDB.deleteDatabase("kotiko");
      resolve(names);
    };
    r.onerror = () => resolve(["error"]);
  });
  return JSON.stringify(out);
}

// "Another service" at the fixture's fake model, with a key, on the dashboard's settings.
async function setUpLookups(context, extensionId, llmUrl) {
  const dash = await context.newPage();
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#settings/lookups`);
  await dash.getByRole("radio", { name: "Another service" }).click();
  await dash.locator("#lookupBaseUrl").fill(llmUrl);
  await dash.locator("#lookupBaseUrl").press("Enter");
  await dash.locator("#lookupKey").fill(KEY);
  await dash.locator("#saveKey").click();
  await expect(dash.locator("#lookupState")).toHaveText("Ready to look words up.");
  return dash;
}

// Every message type the background routes, and who may send it, from background.js itself.
function routes() {
  const fake = createFakeChrome({ runtimeId: "x" });
  runInVm("background.js", { chrome: fake.chrome, fetch: () => Promise.reject(new TypeError("offline")) });
  return fake.chrome.runtime.onMessage.listeners[0].routes;
}

test("a content script can read neither the key nor the token, and every privileged message refuses it", async ({ context, extensionId, server, popup }) => {
  await setUpLookups(context, extensionId, server.llmUrl);
  await popup.connect(server.kotikoUrl, server.token);

  const page = await context.newPage();
  await page.goto(server.page("basic.html"));
  await expect(page.locator("#p1")).toBeVisible();
  const seen = await inContentScript(context, page, extensionId, readEverything);
  expect(seen).not.toContain(KEY);
  expect(seen).not.toContain(server.token);
  const parsed = JSON.parse(seen);
  expect(parsed.local.ok, "content scripts do read storage.local (words, settings)").toBeTruthy();
  expect(parsed.session.refused, "storage.session is closed to content scripts").toBeTruthy();
  expect(parsed.kotikoStores, "the page's own IndexedDB, with none of Kotiko's stores").toEqual([]);

  const all = routes();
  const privileged = Object.keys(all).filter((type) => !all[type].includes("content"));
  expect(privileged.length).toBeGreaterThan(30);
  const answers = await inContentScript(context, page, extensionId, async (types) => {
    const out = {};
    for (const type of types) out[type] = await chrome.runtime.sendMessage({ type, id: "server", value: "stolen", url: "http://127.0.0.1:1", to: "server", text: "x" }).catch((e) => ({ thrown: String(e) }));
    return out;
  }, privileged);
  for (const type of privileged) expect(answers[type], type).toEqual({ error: { code: "forbidden" } });

  // Nothing changed: the same key still works, and nothing was stored from the attempts.
  const dash = await context.newPage();
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html`);
  const secrets = await dash.evaluate(() => chrome.runtime.sendMessage({ type: "secrets.describe" }));
  expect(secrets.secrets).toEqual({ "provider:custom": "sk-tes…cdef", server: expect.stringMatching(/…/) });
});

test("settings rewritten from a content script send nothing to the new address, and are put back", async ({ context, extensionId, server, popup }) => {
  await setUpLookups(context, extensionId, server.llmUrl);
  const page = await context.newPage();
  await page.goto(server.page("basic.html"));
  await expect(page.locator("#p1")).toBeVisible();
  // localhost is another origin than 127.0.0.1, served by the same fixture server.
  const elsewhere = server.llmUrl.replace("127.0.0.1", "localhost");
  await inContentScript(context, page, extensionId, async (url) => {
    const { lookup } = await chrome.storage.local.get("lookup");
    await chrome.storage.local.set({ lookup: { ...lookup, baseUrl: url } });
  }, elsewhere);

  const line = await popup.add("sobaka");
  await expect(line).toHaveText(/^Added собака/);
  const log = (await server.state()).log;
  expect(log.every((r) => r.host.startsWith("127.0.0.1:")), "nothing went to the rewritten address").toBe(true);
  const chats = log.filter((r) => r.path === "/llm/v1/chat/completions");
  expect(chats.length).toBeGreaterThanOrEqual(1);
  expect(chats.every((r) => r.auth === `Bearer ${KEY}`)).toBe(true);
  const settings = await inContentScript(context, page, extensionId, async () => (await chrome.storage.local.get("lookup")).lookup);
  expect(settings.baseUrl, "the address the learner chose is back").toBe(server.llmUrl);
});

test("a hidden address planted for a hosted service: the key pasted afterwards never reaches it", async ({ context, extensionId, server, popup, blocked }) => {
  // The learner chooses OpenAI; the dashboard has no address field for it.
  const dash = await context.newPage();
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#settings/lookups`);
  await dash.getByRole("radio", { name: "OpenAI" }).click();
  await expect(dash.locator("#lookupBaseUrl")).toBeHidden();

  const page = await context.newPage();
  await page.goto(server.page("basic.html"));
  await expect(page.locator("#p1")).toBeVisible();
  const planted = server.llmUrl.replace("127.0.0.1", "localhost");
  await inContentScript(context, page, extensionId, async (url) => {
    const { lookup } = await chrome.storage.local.get("lookup");
    await chrome.storage.local.set({ lookup: { ...lookup, baseUrl: url, model: "fake/model-a:free" } });
  }, planted);

  await dash.bringToFront();
  await dash.locator("#lookupKey").fill(KEY);
  await dash.locator("#saveKey").click();
  await expect(dash.locator("#lookupKeyMasked")).toContainText("sk-tes…cdef");
  const p = await popup.page();
  await p.locator("#addText").fill("sobaka");
  await p.locator("#addText").press("Enter");
  await expect.poll(() => blocked.filter((u) => u.startsWith("https://api.openai.com/")).length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect((await server.state()).log, "nothing reached the planted address").toEqual([]);
  // The lookup went to OpenAI's own address (blocked here, as every outside request is).
  expect(blocked.every((u) => u.startsWith("https://api.openai.com/"))).toBe(true);
  blocked.length = 0;
});

const SPANISH = [
  { lang: "en", native: "dog", base_lang: "es", gloss: "perro", forms: ["perro"], origin: "manual" },
  { lang: "ru", native: "дом", base_lang: "es", gloss: "casa", forms: ["casa"], origin: "manual" },
  { lang: "ja", native: "ありがとう", base_lang: "es", gloss: "gracias", forms: ["gracias"], origin: "manual" },
];
const ENGLISH = [
  { lang: "es", native: "perro", base_lang: "en", gloss: "dog", forms: ["dog"], origin: "manual" },
  { lang: "ru", native: "дом", base_lang: "en", gloss: "house", forms: ["house"], origin: "manual" },
  { lang: "ar", native: "شكرا", base_lang: "en", gloss: "thanks", forms: ["thanks"], origin: "manual" },
];

for (const [name, base, words, file, originals] of [
  ["English", "en", ENGLISH, "privacy-en.html", ["dog", "house", "Thanks"]],
  ["Spanish", "es", SPANISH, "privacy-es.html", ["perro", "casa", "Gracias"]],
]) {
  test(`page scripts see the swaps but no original word and no Kotiko data: ${name} page`, async ({ context, extensionId, server, serviceWorker }) => {
    await expect.poll(() => serviceWorker.evaluate(async () => !!(await chrome.storage.local.get("onboarding")).onboarding)).toBe(true);
    await serviceWorker.evaluate((b) => chrome.storage.sync.set({ ui: { uiLang: "auto", baseLangs: [b], baseLangsConfirmed: true } }), base);
    const dash = await context.newPage();
    await dash.goto(`chrome-extension://${extensionId}/dashboard.html`);
    expect((await dash.evaluate((w) => chrome.runtime.sendMessage({ type: "words.save", words: w }), words)).error).toBeUndefined();

    const page = await context.newPage();
    await page.goto(server.page(file));
    await expect(page.locator("kotiko-w")).toHaveCount(originals.length);
    const seen = await page.evaluate(() => ({
      html: document.documentElement.outerHTML,
      attrs: [...new Set([...document.querySelectorAll("kotiko-w")].map((el) => el.getAttributeNames().sort().join(",")))],
      kotikoAttrs: [...document.querySelectorAll("*")].flatMap((el) => el.getAttributeNames().filter((a) => /kotiko|slovo|^data-(en|id|word)/i.test(a))), // legacy-name-ok
    }));
    expect(seen.attrs).toEqual(["class,dir,lang,translate"]);
    expect(seen.kotikoAttrs).toEqual([]);
    for (const w of originals) expect(seen.html, `the original "${w}"`).not.toContain(w);
    for (const w of words) expect(seen.html).toContain(w.native);
  });
}

test("the bundled privacy policy opens from the settings and renders as text", async ({ context, extensionId }) => {
  const dash = await context.newPage();
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#settings/about`);
  await expect(dash.locator("#privacyLink")).toHaveText("Privacy policy");
  await dash.locator("#privacyLink").click();
  // The welcome tab the install opened is another new page; wait for the policy's.
  await expect.poll(() => context.pages().some((p) => p.url().endsWith("/privacy.html"))).toBe(true);
  const policy = context.pages().find((p) => p.url().endsWith("/privacy.html"));
  await expect(policy.locator("h1")).toHaveText("Kotiko privacy policy");
  await expect(policy).toHaveTitle("Kotiko privacy policy");
  await expect(policy.locator("h2").first()).toHaveText("The short version");
  await expect(policy.locator('a[href="https://openrouter.ai/privacy"]')).toHaveAttribute("rel", "noopener noreferrer");
  expect(await policy.locator("#policy").getAttribute("lang")).toBe("en");
});

test("the server address warns when the access key would cross a network unencrypted", async ({ context, extensionId, popup }) => {
  const dash = await context.newPage();
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#settings/connection`);
  const field = dash.locator("#serverUrl");
  const warn = dash.locator("#serverUrlWarn");
  await expect(field).toHaveValue("http://localhost:4747");
  await expect(warn).toBeHidden();
  await field.fill("http://192.168.1.5:4747");
  await expect(warn).toBeVisible();
  await expect(warn).toContainText("http://");
  await field.fill("http://100.101.102.103:4747");
  await expect(warn).toBeHidden();
  await field.fill("https://home.example");
  await expect(warn).toBeHidden();

  // The popup's Connection settings load the check on first use.
  const p = await popup.page();
  await p.locator("#openSettings").click();
  await p.locator("#serverUrl").fill("http://10.0.0.2:4747");
  await expect(p.locator("#serverUrlWarn")).toBeVisible();
  await p.locator("#serverUrl").fill("http://127.0.0.1:4747");
  await expect(p.locator("#serverUrlWarn")).toBeHidden();
});
