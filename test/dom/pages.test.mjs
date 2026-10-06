// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The three small page scripts: the privacy policy page (privacy.js with lib/policy.js,
// slice 28 §2), the theme applied before first paint (ui/theme.js, slice 06 §2) and the
// "Connect OpenRouter" return page's content script (content/connect.js, slice 11 §4).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createFakeChrome } from "../helpers/fake-chrome.mjs";
import { createI18n } from "../helpers/fake-i18n.mjs";
import { readExt, runInWindow, sleep } from "../helpers/load-script.mjs";

// Polls `fn` until it returns something truthy (no fixed waits: a slow machine only waits longer).
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await sleep(5);
  }
}

describe("privacy page (slice 28 §2)", () => {
  // The page as the browser opens it. `files` answers the extension's own files by path
  // (missing ones are a 404); `failing` paths make fetch reject, as a blocked request does.
  function openPrivacy({ locale = "en", sync = {}, files = null, failing = [] } = {}) {
    const fake = createFakeChrome({ sync });
    // The browser's language; a locale Kotiko has no translation for shows English text.
    const i18n = createI18n(locale === "es" ? "es" : "en");
    fake.chrome.i18n = { ...i18n, getMessage: (key, subs) => (key === "@@ui_locale" || key === "ui_locale" ? locale.replace("-", "_") : i18n.getMessage(key, subs)) };
    const dom = new JSDOM(readExt("privacy.html"), { url: "chrome-extension://fake-extension-id/privacy.html", runScripts: "outside-only" });
    dom.window.chrome = fake.chrome;
    const asked = [];
    dom.window.fetch = async (url) => {
      const rel = String(url).replace(/^chrome-extension:\/\/[^/]+\//, "");
      asked.push(rel);
      if (failing.includes(rel)) throw new TypeError("Failed to fetch");
      if (files && rel in files) return files[rel] === null ? new Response("", { status: 404 }) : new Response(files[rel]);
      try {
        return new Response(readExt(rel));
      } catch {
        return new Response("", { status: 404 });
      }
    };
    for (const rel of ["lib/i18n.js", "lib/policy.js", "privacy.js"]) runInWindow(dom, rel);
    const root = dom.window.document.getElementById("policy");
    const done = () => until(() => !root.hasAttribute("aria-busy"));
    return { dom, root, asked, done, doc: dom.window.document };
  }

  test("renders the shipped policy as elements, never as HTML from the file", async () => {
    const { root, done, doc } = openPrivacy();
    await done();
    assert.equal(root.lang, "en");
    assert.equal(doc.title, createI18n("en").getMessage("privacy_title"));
    assert.equal(doc.documentElement.lang, "en");
    assert.match(root.querySelector("h1").textContent, /Kotiko privacy policy/);
    assert.ok(root.querySelectorAll("h2").length >= 3, "the sections are headings");
    assert.ok(root.querySelectorAll("ul li").length >= 5, "the short version is a list");
    for (const a of root.querySelectorAll("a")) {
      assert.match(a.href, /^https:\/\//);
      assert.equal(a.rel, "noopener noreferrer");
      assert.equal(a.target, "_blank");
    }
  });

  test("a policy line with HTML in it stays text", async () => {
    const md = "# Title\n\nSome <img src=x onerror=alert(1)> **bold** and `code` at <https://kotiko.org/>.\n\n- one\n  continued\n- two";
    const { root, done } = openPrivacy({ files: { "privacy/en.md": md } });
    await done();
    assert.equal(root.querySelector("img"), null);
    const p = root.querySelector("p");
    assert.match(p.textContent, /<img src=x onerror=alert\(1\)>/);
    assert.equal(p.querySelector("strong").textContent, "bold");
    assert.equal(p.querySelector("code").textContent, "code");
    assert.equal(p.querySelector("a").href, "https://kotiko.org/");
    assert.deepEqual([...root.querySelectorAll("li")].map((li) => li.textContent), ["one continued", "two"]);
  });

  test("follows Kotiko's language setting, and falls back to English when the policy isn't translated", async () => {
    const { root, asked, done, doc } = openPrivacy({ sync: { ui: { uiLang: "es" } }, files: { "privacy/es.md": null } });
    await done();
    assert.equal(doc.documentElement.lang, "es");
    assert.equal(doc.title, createI18n("es").getMessage("privacy_title"));
    assert.deepEqual(asked.filter((p) => p.startsWith("privacy/")), ["privacy/es.md", "privacy/en.md"]);
    assert.equal(root.lang, "en", "the English text says it's English");
  });

  test("a regional interface language tries its own policy, then the language's, then English", async () => {
    const { root, asked, done } = openPrivacy({ locale: "pt-BR", files: { "privacy/pt.md": "# Política" }, failing: ["privacy/pt-BR.md"] });
    await done();
    assert.deepEqual(asked.filter((p) => p.startsWith("privacy/")), ["privacy/pt-BR.md", "privacy/pt.md"]);
    assert.equal(root.lang, "pt");
    assert.equal(root.querySelector("h1").textContent, "Política");
  });

  test("says so when no policy can be read", async () => {
    const { root, done } = openPrivacy({ files: { "privacy/en.md": null } });
    await done();
    assert.equal(root.children.length, 1);
    assert.equal(root.firstElementChild.localName, "p");
    assert.equal(root.textContent, createI18n("en").getMessage("privacy_unavailable"));
  });
});

describe("theme before first paint (slice 06 §2)", () => {
  // A page with ui/theme.js run first. `cached` is what localStorage held from last time;
  // `blocked` makes localStorage throw, as it does with site data blocked.
  function openPage({ cached = {}, prefs = undefined, blocked = false, chrome = true } = {}) {
    const fake = createFakeChrome({ local: prefs === undefined ? {} : { prefs } });
    const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "https://kotiko.test/dashboard.html", runScripts: "outside-only" });
    if (chrome) dom.window.chrome = fake.chrome;
    for (const [k, v] of Object.entries(cached)) dom.window.localStorage.setItem(k, v);
    if (blocked) {
      Object.defineProperty(dom.window, "localStorage", {
        get() {
          throw new dom.window.DOMException("The operation is insecure.", "SecurityError");
        },
      });
    }
    runInWindow(dom, "ui/theme.js");
    const root = dom.window.document.documentElement;
    return { dom, fake, root, stored: (k) => (blocked ? null : dom.window.localStorage.getItem(k)) };
  }

  test("applies the cached theme and motion synchronously, before storage answers", () => {
    const { root } = openPage({ cached: { "kotiko.theme": "dark", "kotiko.motion": "reduce" }, prefs: { theme: "dark", motion: "reduce" } });
    assert.equal(root.dataset.theme, "dark");
    assert.equal(root.dataset.motion, "reduce");
  });

  test("an unknown cached value follows the system", () => {
    const { root } = openPage({ cached: { "kotiko.theme": "sepia", "kotiko.motion": "fast" } });
    assert.equal(root.dataset.theme, undefined);
    assert.equal(root.dataset.motion, undefined);
  });

  test("the stored preference replaces a stale cache and is cached for next time", async () => {
    const { root, stored } = openPage({ cached: { "kotiko.theme": "dark" }, prefs: { theme: "light", motion: "reduce" } });
    await until(() => root.dataset.theme === "light");
    assert.equal(root.dataset.motion, "reduce");
    assert.equal(stored("kotiko.theme"), "light");
    assert.equal(stored("kotiko.motion"), "reduce");
  });

  test("no preference saved yet means the system's theme", async () => {
    const { root, stored } = openPage({ cached: { "kotiko.theme": "dark", "kotiko.motion": "reduce" } });
    await until(() => stored("kotiko.theme") === "system");
    assert.equal(root.dataset.theme, undefined);
    assert.equal(root.dataset.motion, undefined);
    assert.equal(stored("kotiko.motion"), "system");
  });

  test("follows a change made in another page, and ignores other areas and keys", async () => {
    const { root, fake, stored } = openPage({ prefs: { theme: "light" } });
    await until(() => root.dataset.theme === "light");
    await fake.chrome.storage.sync.set({ prefs: { theme: "dark" } });
    await fake.chrome.storage.local.set({ words: [] });
    await fake.idle();
    assert.equal(root.dataset.theme, "light");
    await fake.chrome.storage.local.set({ prefs: { theme: "dark", motion: "reduce" } });
    await fake.idle();
    assert.equal(root.dataset.theme, "dark");
    assert.equal(root.dataset.motion, "reduce");
    assert.equal(stored("kotiko.theme"), "dark");
  });

  test("blocked site data: no cache, but the stored preference still applies", async () => {
    const { root } = openPage({ blocked: true, prefs: { theme: "dark" } });
    await until(() => root.dataset.theme === "dark");
  });

  test("a storage read that fails keeps the cached theme, and a page without storage events still loads", async () => {
    const fake = createFakeChrome();
    fake.chrome.storage.local.get = async () => {
      throw new Error("storage unavailable");
    };
    fake.chrome.storage.onChanged = {
      addListener() {
        throw new Error("no storage events in this context");
      },
    };
    const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "https://kotiko.test/popup.html", runScripts: "outside-only" });
    dom.window.chrome = fake.chrome;
    dom.window.localStorage.setItem("kotiko.theme", "light");
    runInWindow(dom, "ui/theme.js");
    const root = dom.window.document.documentElement;
    assert.equal(root.dataset.theme, "light");
    await fake.idle();
    await sleep(0);
    assert.equal(root.dataset.theme, "light");
    assert.equal(dom.window.localStorage.getItem("kotiko.theme"), "light");
  });
});

describe("the Connect OpenRouter return page (slice 11 §4)", () => {
  const STATUS = '<p id="kotiko-connect-status"></p>';
  function openReturnPage({ url = "https://kotiko.org/connect/?code=abc123", answer = () => ({ ok: true }), body = STATUS } = {}) {
    const fake = createFakeChrome({ onSendMessage: (msg) => answer(msg) });
    fake.chrome.i18n = createI18n("en");
    const dom = new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`, { url, runScripts: "outside-only" });
    dom.window.chrome = fake.chrome;
    for (const rel of ["lib/i18n.js", "content/connect.js"]) runInWindow(dom, rel);
    const status = () => dom.window.document.getElementById("kotiko-connect-status")?.textContent;
    return { dom, fake, status, sent: fake.calls.sendMessage };
  }
  const msg = (key) => createI18n("en").getMessage(key);

  test("hands the code to the background, says it worked and takes the code out of the address", async () => {
    const { dom, status, sent } = openReturnPage();
    assert.equal(status(), msg("connect_working"));
    await until(() => status() === msg("connect_done"));
    assert.deepEqual(sent, [{ type: "oauth.code", code: "abc123" }]);
    await until(() => dom.window.location.href === "https://kotiko.org/connect/");
  });

  test("an expired code says so; any other refusal is a plain failure", async () => {
    const expired = openReturnPage({ answer: () => ({ ok: false, code: "key_rejected", details: { reason: "expired" } }) });
    await until(() => expired.status() === msg("connect_expired"));
    const rejected = openReturnPage({ answer: () => ({ ok: false, code: "key_rejected", details: { reason: "invalid" } }) });
    await until(() => rejected.status() === msg("connect_failed"));
    const nothing = openReturnPage({ answer: () => undefined });
    await until(() => nothing.status() === msg("connect_failed"));
  });

  test("a background that can't be reached is a failure, and the code still leaves the address", async () => {
    const { dom, status } = openReturnPage({
      answer: () => {
        throw new Error("Could not establish connection. Receiving end does not exist.");
      },
    });
    await until(() => status() === msg("connect_failed"));
    await until(() => dom.window.location.search === "");
  });

  test("works without a status line on the page", async () => {
    const { dom, sent } = openReturnPage({ body: "" });
    await until(() => dom.window.location.search === "");
    assert.equal(sent.length, 1);
  });

  for (const [why, url] of [
    ["another site", "https://example.com/connect/?code=abc123"],
    ["another page of the docs site", "https://kotiko.org/other/?code=abc123"],
    ["no code", "https://kotiko.org/connect/"],
    ["an empty code", "https://kotiko.org/connect/?code="],
  ]) {
    test(`does nothing on ${why}`, async () => {
      const { dom, status, sent, fake } = openReturnPage({ url });
      await fake.idle();
      assert.equal(sent.length, 0);
      assert.equal(status(), "");
      assert.equal(dom.window.location.href, url);
    });
  }
});
