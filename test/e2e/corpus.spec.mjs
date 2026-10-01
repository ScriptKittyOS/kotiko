// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
// SPDX-License-Identifier: Apache-2.0

// The fixture corpus (test/fixtures/pages). Every page loads offline with the extension
// running; the behaviour each page exists for is a `fixme` until its slice lands.
import { test, expect } from "./fixtures.mjs";

const PAGES = [
  "basic.html",
  "boundaries.html",
  "react-list.html",
  "turbo-swap.html",
  "self-healing.html",
  "shadow.html",
  "iframes.html",
  "rtl.html",
  "non-english.html",
  "editors.html",
  "controls.html",
  "big.html",
  "captions.html",
];

test("every corpus page loads offline with the extension running, without page errors", async ({ context, server, popup }) => {
  test.setTimeout(90_000);
  await popup.connect(server.miraUrl, server.token);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
  for (const name of PAGES) {
    const res = await page.goto(server.page(name), { waitUntil: "load" });
    expect(res.status(), name).toBe(200);
    await page.waitForTimeout(300);
  }
  expect(errors).toEqual([]);
});

test.describe("slice 14: matcher engine", () => {
  test.fixme("boundaries.html: contractions, hyphens, accents, acronyms and single letters aren't half-swapped", async () => {});
  test.fixme("big.html: the first pass over 100,000 text nodes stays inside the matcher budget", async () => {});
});

test.describe("slice 15: framework-safe swapping", () => {
  // React 18's UMD build gets vendored into test/fixtures/vendor/ (MIT, with LICENSE) in
  // slice 15; until then react-list.html imitates React's text-node bookkeeping by hand.
  test.fixme("react-list.html: a React 18 list keeps re-rendering and unmounts without errors", async () => {});
  test.fixme("turbo-swap.html: words are swapped again after document.body is replaced and after document.open()", async () => {});
  test.fixme("self-healing.html: rewriting stops after a few reverts (no ping-pong)", async () => {});
  test.fixme("big.html: no long task over the budget while swapping", async () => {});
});

test.describe("slice 16: what not to swap", () => {
  test.fixme("non-english.html: a German page keeps die, Gift and Kind; the lang=en island swaps", async () => {});
  test.fixme("editors.html: textarea, contenteditable, role=textbox, CodeMirror-like editors and translate=no are untouched", async () => {});
  test.fixme("controls.html: buttons, nav, labels and form fields stay English", async () => {});
});

test.describe("slice 17: casing and script display", () => {
  test.fixme("rtl.html: swapped words in right-to-left pages are isolated and readable", async () => {});
});

test.describe("slice 42: frames and shadow DOM", () => {
  test.fixme("shadow.html: open and closed shadow roots and nested custom elements are swapped", async () => {});
  test.fixme("iframes.html: same-origin, srcdoc and about:blank frames are swapped; the tiny ad frame is skipped", async () => {});
});

test.describe("slice 52: video captions", () => {
  test.fixme("captions.html: a caption line updating every 100 ms is swapped without flicker", async () => {});
});
