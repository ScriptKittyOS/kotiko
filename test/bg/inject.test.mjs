// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 15: tabs open before an install or update get Kotiko without a reload, with the
// manifest's own content scripts.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome } from "../helpers/fake-chrome.mjs";
import { manifest, runInVm, sleep } from "../helpers/load-script.mjs";

function load({ refuse = [] } = {}) {
  const fake = createFakeChrome({ tabs: [{ id: 1, url: "https://example.com/" }, { id: 2, url: "https://news.example/a" }] });
  fake.chrome.i18n = { getUILanguage: () => "en-US", getMessage: () => "" };
  const calls = [];
  const queried = [];
  fake.chrome.tabs.query = async (q) => (queried.push(q), [{ id: 1, url: "https://example.com/" }, { id: 2, url: "https://news.example/a" }, { id: 3, url: "https://chromewebstore.google.com/" }]);
  fake.chrome.tabs.create = async () => ({});
  fake.chrome.scripting = {
    insertCSS: async (o) => void calls.push(["css", o.target.tabId, o.files]),
    executeScript: async (o) => {
      if (refuse.includes(o.target.tabId)) throw new Error("Cannot access contents of the page");
      calls.push(["js", o.target.tabId, o.files]);
    },
  };
  fake.chrome.runtime.getManifest = () => manifest();
  const ctx = runInVm("background.js", { chrome: fake.chrome, fetch: () => Promise.reject(new TypeError("offline")) });
  return { fake, k: ctx.__kotiko, calls, queried };
}

describe("injection into open tabs (slice 15)", () => {
  test("on install and on update, every http(s) tab gets the manifest's content scripts", async () => {
    for (const reason of ["install", "update"]) {
      const { fake, calls, queried } = load({ refuse: [3] });
      await fake.fireInstalled({ reason });
      for (let i = 0; i < 50 && calls.filter((c) => c[0] === "js").length < 2; i++) await sleep(10);
      const cs = manifest().content_scripts[0];
      assert.ok(queried.some((q) => JSON.stringify(q?.url) === JSON.stringify(["http://*/*", "https://*/*"])), "asks for web pages only");
      assert.deepEqual(JSON.parse(JSON.stringify(calls.filter((c) => c[0] === "js"))), [["js", 1, cs.js], ["js", 2, cs.js]], reason);
      assert.ok(calls.some((c) => c[0] === "css" && c[1] === 1));
    }
  });

  test("a browser restart injects nothing (the manifest does it)", async () => {
    const { fake, calls } = load();
    await fake.fireInstalled({ reason: "chrome_update" });
    await sleep(50);
    assert.deepEqual(calls, []);
  });
});
