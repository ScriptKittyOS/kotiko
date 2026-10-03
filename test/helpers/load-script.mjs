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
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const EXT_DIR = path.join(ROOT, "extension");

export const extPath = (rel) => path.join(EXT_DIR, rel);
export const readExt = (rel) => fs.readFileSync(extPath(rel), "utf8");
export const manifest = () => JSON.parse(readExt("manifest.json"));

// Loads a lib file in this realm, like `require`, and returns its module.exports.
// (The root package.json says "type": "module", so Node's own require would treat a .js
// file as ESM; this wraps it the way CommonJS does instead.)
export function requireExt(rel) {
  const module = { exports: {} };
  const wrapper = vm.runInThisContext(`(function (module, exports) {${readExt(rel)}\n})`, {
    filename: extPath(rel),
  });
  wrapper(module, module.exports);
  return module.exports;
}

// Runs an extension script inside a jsdom window (created with runScripts: "outside-only").
export function runInWindow(dom, rel) {
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
// serves them from the package; anything else goes to `fetch`, the test's network.
const OWN_FILE = /^(?:chrome|moz)-extension:\/\/[^/]+\/(.+)$/;
function withOwnFiles(fetch) {
  return (url, init) => {
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
    ...globals,
  });
  ctx.fetch = withOwnFiles(ctx.fetch);
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
