// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 11 in a real browser: a fresh profile keeps its words in the browser and looks
// them up with the learner's own provider (the fixture server's fake model, at the
// address the settings page points it to), with no Kotiko server; a word typed with its
// meaning needs no network at all; an add finishes with the popup closed or the worker
// stopped; and a profile from before this version, connected to a server, upgrades with
// nothing changed.
import { test, expect } from "./fixtures.mjs";

const P1 = "Thanks for visiting. This house has three rooms and a garden.";
const WORDS = [
  { id: 2, lang: "ru", language: "Russian", native: "дом", romanization: "dom", english: "house", forms: ["house", "houses"], note: null },
  { id: 1, lang: "ru", language: "Russian", native: "спасибо", romanization: "spasibo", english: "thanks", forms: ["thanks", "thank you"], note: null },
];
const P1_SWAPPED = "Спасибо for visiting. This дом has three rooms and a garden.";
const KEY = "test-provider-key-0123456789";

const storage = (page) => page.evaluate(async () => ({
  local: await chrome.storage.local.get(null),
  sync: await chrome.storage.sync.get(null),
  session: await chrome.storage.session.get(null).catch(() => ({})),
}));

// Stops the extension's service worker, as Chrome does when it's idle (or a crash):
// the next event starts a fresh one, with nothing kept in memory.
async function stopWorker(context, popupUrl) {
  const page = await context.newPage();
  await page.goto(popupUrl);
  const cdp = await context.newCDPSession(page);
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  await cdp.detach();
  await page.close();
}

// Points "Another service" at the fake model and saves a key, on the dashboard's settings.
async function setUpLookups(context, extensionId, llmUrl) {
  const dash = await context.newPage();
  await dash.goto(`chrome-extension://${extensionId}/dashboard.html#settings/lookups`);
  await dash.getByRole("radio", { name: "Another service" }).click();
  await dash.locator("#lookupBaseUrl").fill(llmUrl);
  await dash.locator("#lookupBaseUrl").press("Enter");
  await dash.locator("#lookupKey").fill(KEY);
  await dash.locator("#saveKey").click();
  await expect(dash.locator("#lookupKeyMasked")).toHaveText("Saved key: test-p…6789");
  await expect(dash.locator("#lookupState")).toHaveText("Ready to look words up.");
  return dash;
}

test("a fresh profile: words live in the browser, the first run offers lookups, a word is looked up with the learner's own provider and swapped", async ({ context, extensionId, server, popup }) => {
  let p = await popup.page();
  // Slice 22: until the first run is done, the card's Get started brings the welcome tab
  // (opened at install) to the front instead of opening another.
  await expect(p.locator("#firstRunTitle")).toHaveText("Finish setting up Kotiko");
  await expect(p.locator("#getStarted")).toHaveText("Get started");
  await p.locator("#getStarted").click();
  await expect.poll(() => p.isClosed()).toBe(true);
  // The background opens the welcome tab after the popup closes; wait for it.
  await expect.poll(() => context.pages().filter((x) => x.url().includes("welcome.html")).length).toBe(1);
  const welcome = context.pages().find((x) => x.url().includes("welcome.html"));
  await welcome.locator("#skip").click();
  await expect.poll(() => welcome.isClosed()).toBe(true);
  p = await popup.page();
  await expect(p.locator("#firstRunTitle")).toHaveText("Add your first word");
  await expect(p.locator("#getStarted")).toHaveText("Set up lookups");
  await expect(p.locator("#banners .banner")).toHaveCount(0);

  // "Set up lookups" opens the dashboard's settings: the key is never typed in the popup.
  const [dashFromPopup] = await Promise.all([context.waitForEvent("page"), p.locator("#getStarted").click()]);
  await expect(dashFromPopup).toHaveURL(/dashboard\.html#settings\/lookups$/);
  await expect(dashFromPopup.locator("#setLookupsTitle")).toHaveText("Word lookups");
  await dashFromPopup.close();

  const dash = await setUpLookups(context, extensionId, server.llmUrl);
  await dash.locator("#testLookup").click();
  await expect(dash.locator("#lookupState")).toHaveText(/^It works\. fake\/model-a:free answered in [\d.]+ s\.$/);

  const line = await popup.add("shukran");
  await expect(line).toHaveText(/^Added شكرا \(shukran\) = thanks · Arabic\s*Undo$/);

  const page = await context.newPage();
  await page.goto(server.page("basic.html"));
  await expect(page.locator("#p1")).toHaveText("شكرا for visiting. This house has three rooms and a garden.");

  const log = (await server.state()).log;
  const chats = log.filter((r) => r.path === "/llm/v1/chat/completions");
  expect(chats.length).toBeGreaterThanOrEqual(2); // the Test and the add
  expect(chats.every((r) => r.auth === `Bearer ${KEY}`)).toBe(true);
  expect(log.filter((r) => r.path.startsWith("/kotiko/"))).toEqual([]);

  // The key is in no storage area (content scripts can read storage.local).
  const all = JSON.stringify(await storage(dash));
  expect(all).not.toContain(KEY);
  const s = await storage(dash);
  expect(s.local.wordsHome).toBe("local");
  expect(s.local.keys).toEqual({ server: false, providers: { custom: true } });
});

test("with no provider at all, 'word = meaning' adds and swaps with no network request from the extension", async ({ context, server, popup }) => {
  const line = await popup.add("дом = house");
  await expect(line).toHaveText(/^Added дом = house · Russian\s*Undo$/);
  const page = await context.newPage();
  await page.goto(server.page("basic.html"));
  await expect(page.locator("#p1")).toHaveText("Thanks for visiting. This дом has three rooms and a garden.");
  expect((await server.state()).log).toEqual([]);

  // Undo takes it off the page again.
  await line.locator('[data-action="undo"]').click();
  await expect(line).toHaveText(/^Removed дом/);
  await expect(page.locator("#p1")).toHaveText(P1);
});

// Slice 24 §7: with no lookups at all, a word that needs one waits; "Add it yourself" saves
// it from a small form, with the language from the picker (a real <dialog> here).
test("Add it yourself: the form in the line, the language picker, saved with no lookup", async ({ server, popup }) => {
  const line = await popup.add("gatto");
  await expect(line.locator(".job-text p")).toHaveText("gatto will be looked up once lookups are set up.");
  await line.locator('[data-action="manual"]').click();
  const form = line.locator("form.manual-form");
  await expect(form.locator('[name="native"]')).toHaveValue("gatto");
  await form.locator('[name="meaning-en"]').fill("cat");
  await form.locator('[data-action="language"]').click();
  const picker = (await popup.page()).locator("dialog.picker");
  await expect(picker).toBeVisible();
  await picker.locator("input[type=search]").fill("ital");
  await picker.locator('[data-lang="it"]').click();
  await expect(picker).toHaveCount(0);
  await expect(form.locator('[data-action="language"]')).toHaveText("Italian");
  await form.locator('[data-action="save"]').click();
  const p = await popup.page();
  await expect(p.locator('#jobs [data-kind="word"] .job-text').first()).toHaveText("Added gatto = cat · Italian");
  expect((await server.state()).log).toEqual([], "no request from the extension");
});

test("closing the popup during a lookup still saves the word; reopening shows the result", async ({ context, extensionId, server, popup }) => {
  await setUpLookups(context, extensionId, server.llmUrl);
  await server.control({ llmDelayMs: 1500 });
  const p = await popup.page();
  await p.locator("#addText").fill("sobaka");
  await p.locator("#addText").press("Enter");
  await expect(p.locator("#addText")).toHaveValue("");
  await expect(p.locator("#jobs li .job-text").first()).toHaveText("Looking up sobaka…");
  await p.close();

  const page = await context.newPage();
  await page.goto(server.page("basic.html"));
  await page.evaluate(() => {
    const el = document.createElement("p");
    el.id = "late";
    el.textContent = "A dog arrives.";
    document.body.append(el);
  });
  await expect(page.locator("#late")).toHaveText("A собака arrives.", { timeout: 10_000 });

  const again = await popup.page();
  await expect(again.locator("#jobs li").first()).toHaveText("While you were away");
  await expect(again.locator('#jobs [data-kind="word"]').first()).toHaveText(/^Added собака \(sobaka\) = dog · Russian\s*Undo$/);
});

test("stopping the worker mid-lookup: the job runs again with the same id when it wakes, and the word is saved once", async ({ context, extensionId, server, popup }) => {
  const dash = await setUpLookups(context, extensionId, server.llmUrl);
  await server.control({ llmDelayMs: 2500 });
  const p = await popup.page();
  await p.locator("#addText").fill("kniga");
  await p.locator("#addText").press("Enter");
  await expect.poll(async () => (await storage(p)).local.addJobs?.[0]?.state).toBe("looking_up");
  await stopWorker(context, popup.url);
  await server.control({ llmDelayMs: 0 });

  // Any event wakes it: here a page asking for its words.
  const page = await context.newPage();
  await page.goto(server.page("basic.html"));
  await expect.poll(async () => (await storage(p)).local.addJobs?.[0]?.state, { timeout: 15_000 }).toBe("done");
  const list = await dash.evaluate(() => chrome.runtime.sendMessage({ type: "words.list" }));
  expect(list.words.filter((w) => w.native === "книга")).toHaveLength(1);
  const chats = (await server.state()).log.filter((r) => r.path === "/llm/v1/chat/completions");
  // The one the stopped worker never heard back from, the rerun (and maybe the
  // pronunciation refresh for the new word).
  expect(chats.length).toBeGreaterThanOrEqual(2);
  await expect(p.locator("#jobs li").first()).toHaveText(/^Added книга \(kniga\) = book · Russian\s*Undo$/);
});

test("an existing server install upgrades with nothing changed: same words on pages, same server, the token out of reach of pages", async ({ context, serviceWorker, server, popup }) => {
  await server.control({ words: WORDS });
  // A profile from before this version: the address and token in storage.local, the cached
  // word list, no word store. The running worker is frozen first so it can't adopt them.
  await serviceWorker.evaluate(async ({ url, token, words }) => {
    // background.js's own top-level bindings (a classic script's globals): the store and
    // the upgrade never settle in this worker again.
    // eslint-disable-next-line no-undef
    readyP = new Promise(() => {});
    // eslint-disable-next-line no-undef
    const store = await storeP;
    store.close();
    // eslint-disable-next-line no-undef
    storeP = new Promise(() => {});
    await new Promise((resolve) => {
      const r = indexedDB.deleteDatabase("kotiko");
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    });
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ serverUrl: url, token, words, enabled: true, hiddenLangs: [], pausedHosts: [], lastSync: Date.now() });
  }, { url: server.kotikoUrl, token: server.token, words: WORDS });

  // The new code starts: a worker start with no finished upgrade runs it (slice 11 §8;
  // reloading an unpacked extension disables it in this harness, so the worker is
  // restarted instead, which is the path an interrupted upgrade takes too).
  await stopWorker(context, popup.url);

  const page = await context.newPage();
  await page.goto(server.page("basic.html"));
  await expect(page.locator("#p1")).toHaveText(P1_SWAPPED);

  const p = await popup.page();
  await expect(p.locator("#count")).toHaveText("2 words");
  await expect(p.locator("#firstRun")).toBeHidden();
  await expect(p.locator("#banners .banner")).toHaveCount(0);
  await p.locator("#openSettings").click();
  await expect(p.locator("#serverUrl")).toHaveValue(server.kotikoUrl);
  await expect(p.locator("#connStatus")).toHaveText(/^Connected\. Your server has 2 words\./);
  await p.locator("#closeSettings").click();

  await expect.poll(async () => (await storage(p)).local.token).toBeUndefined();
  const s = await storage(p);
  expect(s.local.serverUrl).toBeUndefined();
  expect(s.local.wordsHome).toBe("server");
  expect(s.local.lookup.kind).toBe("server");
  expect(JSON.stringify(s)).not.toContain(server.token);
  expect(s.local.words).toEqual(WORDS);

  // Adds go to the same server, which looks words up and keeps them, as an add job
  // (slice 24): its lookup, then the save under the job's id.
  const line = await popup.add("sobaka");
  await expect(line).toHaveText(/^Added собака \(sobaka\) = dog · Russian\s*Undo$/);
  const log = (await server.state()).log;
  expect(log.some((r) => r.method === "POST" && r.path === "/kotiko/api/v1/words")).toBe(true);
  expect(log.some((r) => r.method === "POST" && r.path === "/kotiko/api/v1/words/batch")).toBe(true);
  // Every request but the server's proof (slice 54, B-01) is signed with the token, and none
  // carries it (D-01).
  expect(log.filter((r) => r.path.startsWith("/kotiko/") && r.path !== "/kotiko/api/v1/proof").every((r) => r.signed)).toBe(true);
  expect(log.filter((r) => r.auth?.includes(server.token))).toEqual([]);
  expect(log.filter((r) => r.path === "/kotiko/api/v1/proof").every((r) => r.auth === null)).toBe(true);
  expect(log.filter((r) => r.path.startsWith("/llm/"))).toEqual([]);
});
