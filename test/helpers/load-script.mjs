// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Evaluates extension scripts the way a browser would: classic scripts in a jsdom window
// (content scripts) or in a vm context (the background script), plus a CommonJS-style
// loader for the pure modules in extension/lib/.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import jsdomUtils from "jsdom/lib/generated/idl/utils.js";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const EXT_DIR = path.join(ROOT, "extension");

export const extPath = (rel) => path.join(EXT_DIR, rel);
export const readExt = (rel) => fs.readFileSync(extPath(rel), "utf8");
export const manifest = () => JSON.parse(readExt("manifest.json"));

// Loads a lib file in this realm, like `require`, and returns its module.exports.
// (The root package.json says "type": "module", so Node's own require would treat a .js
// file as ESM; this wraps it the way CommonJS does instead.)
// vm.compileFunction takes the file as the function's body, with no wrapper text before
// it, so code coverage offsets line up with the file whichever way a test loaded it.
export function requireExt(rel) {
  const module = { exports: {} };
  const wrapper = vm.compileFunction(readExt(rel), ["module", "exports"], { filename: extPath(rel) });
  wrapper(module, module.exports);
  return module.exports;
}

// Assertion mode (helpers/assert-mode.mjs): the flag is passed on to every window and vm
// context an extension script runs in, so its invariant checks run there too.
const assertMode = () => globalThis.__KOTIKO_ASSERT__ === true;

// Runs an extension script inside a jsdom window (created with runScripts: "outside-only").
export function runInWindow(dom, rel) {
  if (assertMode()) dom.window.__KOTIKO_ASSERT__ = true;
  return vm.runInContext(readExt(rel), dom.getInternalVMContext(), { filename: extPath(rel) });
}

// jsdom doesn't implement isContentEditable; content.js relies on it to skip editors.
function polyfillContentEditable(window) {
  if ("isContentEditable" in window.HTMLElement.prototype) return;
  Object.defineProperty(window.HTMLElement.prototype, "isContentEditable", {
    configurable: true,
    get() {
      for (let el = this; el; el = el.parentElement) {
        const v = el.getAttribute("contenteditable");
        if (v === null) continue;
        return v !== "false";
      }
      return false;
    },
  });
}

// Dispatches a jsdom event as the browser's own (isTrusted true), as a real click, key or
// pointer event from the learner is. dispatchEvent() always makes an event untrusted, and
// the word card ignores those (security review A-04); tests that stand in for the learner
// use this. Returns false when a listener cancelled the event, as dispatchEvent() does.
export function dispatchTrusted(target, event) {
  const impl = jsdomUtils.implForWrapper(event);
  impl.isTrusted = true;
  return jsdomUtils.implForWrapper(target)._dispatch(impl);
}

// A jsdom page with `chrome` installed, ready for content scripts.
// A page for content scripts. A fragment becomes an English page (lang="en"), as most real
// pages declare their language; pass a whole document to declare another or none.
export function createPage({ html = "", url = "https://example.com/", chrome } = {}) {
  const doc = /<html[\s>]/i.test(html) ? html : `<!doctype html><html lang="en"><head></head><body>${html}</body></html>`;
  const dom = new JSDOM(doc, { url, runScripts: "outside-only", pretendToBeVisual: true });
  polyfillContentEditable(dom.window);
  if (chrome) dom.window.chrome = chrome;
  return dom;
}

// Runs the manifest's content scripts in order, as the browser injects them.
export function injectContentScripts(dom) {
  for (const rel of manifest().content_scripts[0].js) runInWindow(dom, rel);
}

// The extension's own files (chrome-extension://<id>/spec/…), served from disk as a browser
// serves them from the package; Wiktionary (slice 49 §4a) answered by the test's
// `wiktionary(url)` or offline, so no test ever reaches the real site; anything else goes to
// `fetch`, the test's network.
const OWN_FILE = /^(?:chrome|moz)-extension:\/\/[^/]+\/(.+)$/;
const WIKTIONARY = /^https:\/\/en\.wiktionary\.org\//;
function withOwnFiles(fetch, wiktionary) {
  return (url, init) => {
    if (WIKTIONARY.test(String(url))) return wiktionary ? Promise.resolve(wiktionary(String(url), init)) : Promise.reject(new TypeError("offline (tests never reach Wiktionary)"));
    const own = OWN_FILE.exec(String(url));
    if (!own) return fetch(url, init);
    try {
      return Promise.resolve(new Response(readExt(own[1])));
    } catch {
      return Promise.resolve(new Response("", { status: 404 }));
    }
  };
}

// Runs a script in a fresh vm context with the given globals (for background.js).
// The context gets its own built-ins; timers, fetch and friends come from Node unless
// overridden (the extension's own files are always served from disk), and a fresh, empty
// IndexedDB (fake-indexeddb) per context. Returns the context, whose properties are the
// script's globals.
export function runInVm(rel, globals = {}) {
  const ctx = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    structuredClone,
    URL,
    URLSearchParams,
    AbortController,
    AbortSignal,
    Headers,
    Request,
    Response,
    TextEncoder,
    TextDecoder,
    crypto: globalThis.crypto,
    btoa,
    indexedDB: new IDBFactory(),
    IDBKeyRange,
    fetch: () => Promise.reject(new TypeError("fetch is not stubbed in this test")),
    ...(assertMode() ? { __KOTIKO_ASSERT__: true } : {}),
    ...globals,
  });
  ctx.fetch = withOwnFiles(ctx.fetch, globals.wiktionary);
  ctx.self = ctx;
  // importScripts, as in a service worker: paths resolve against the script's folder.
  if (!("importScripts" in globals)) {
    ctx.importScripts = (...urls) => {
      for (const url of urls) {
        const file = path.posix.join(path.posix.dirname(rel), url);
        vm.runInContext(readExt(file), ctx, { filename: extPath(file) });
      }
    };
  }
  vm.runInContext(readExt(rel), ctx, { filename: extPath(rel) });
  return ctx;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
