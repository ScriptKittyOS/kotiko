#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Checks the built site in dist/ (slice 44 §7), with no network and no dependencies:
//
//   - every path in stable-urls.txt is built, with its #anchor;
//   - every slice 25 error code (extension/lib/errors.js) has an anchor on /help/errors/;
//   - every lookup preset (spec/providers.json) has a /providers/<id>/ page;
//   - every link and resource inside the site points at a built file, and every #anchor
//     at an element on that page;
//   - nothing on the site would make a browser fetch from another host: no external
//     src, srcset, stylesheet, icon, preload, manifest, CSS url() or @import (links people
//     follow by choice are fine);
//   - the custom domain file says kotiko.org.
//
//   node scripts/check-dist.mjs [dist]
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(SITE, "..");
export const ORIGIN = "https://kotiko.org";

// Every file under dir, as paths relative to it with "/" separators.
function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push(path.relative(base, p).split(path.sep).join("/"));
  }
  return out;
}

// The file a site path is served from, or null.
export function fileFor(dist, urlPath) {
  const clean = decodeURIComponent(urlPath.split("#")[0].split("?")[0]);
  const candidates = clean.endsWith("/") ? [`${clean}index.html`] : [clean, `${clean}/index.html`, `${clean}.html`];
  for (const c of candidates) {
    const f = path.join(dist, c);
    if (f.startsWith(dist) && fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  return null;
}

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// The ids on a page (id="…" and name="…" anchors).
export function idsOf(html) {
  const ids = new Set();
  for (const m of html.matchAll(/\s(?:id|name)="([^"]*)"/g)) ids.add(decode(m[1]));
  return ids;
}

// Every URL in a page, with what would happen to it: "fetch" (the browser loads it while
// showing the page) or "link" (only if someone follows it).
export function urlsOf(html) {
  const out = [];
  const body = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of body.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/g)) {
    const name = tag[1].toLowerCase();
    const attrs = tag[2] ?? "";
    const attr = (n) => {
      const m = attrs.match(new RegExp(`\\s${n}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
      return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : null;
    };
    const src = attr("src");
    if (src !== null) out.push({ url: src, kind: "fetch", tag: name });
    const srcset = attr("srcset");
    if (srcset) for (const part of srcset.split(",")) out.push({ url: part.trim().split(/\s+/)[0], kind: "fetch", tag: name });
    const poster = attr("poster");
    if (poster) out.push({ url: poster, kind: "fetch", tag: name });
    const data = name === "object" ? attr("data") : null;
    if (data) out.push({ url: data, kind: "fetch", tag: name });
    const href = attr("href");
    if (href !== null) {
      const rel = (attr("rel") ?? "").toLowerCase().split(/\s+/);
      // <link> loads what it names, except relations that are only metadata.
      const metaOnly = rel.every((r) => ["canonical", "alternate", "sitemap", "author", "license", "me", "help", "next", "prev", "search"].includes(r));
      // A page's canonical address names itself (404.html names /404/, which isn't a page).
      if (name === "link" && rel.includes("canonical")) continue;
      out.push({ url: href, kind: name === "link" && !metaOnly ? "fetch" : "link", tag: name });
    }
    if (name === "meta") {
      const httpEquiv = (attr("http-equiv") ?? "").toLowerCase();
      const content = attr("content") ?? "";
      if (httpEquiv === "refresh") {
        const m = content.match(/url=(.*)$/i);
        if (m) out.push({ url: m[1].trim(), kind: "link", tag: "meta-refresh" });
      }
    }
  }
  // Inline styles can load images and fonts too.
  for (const style of body.matchAll(/<style[^>]*>([\s\S]*?)<\/style>|\sstyle="([^"]*)"/g)) {
    for (const u of cssUrls(decode(style[1] ?? style[2] ?? ""))) out.push({ url: u, kind: "fetch", tag: "style" });
  }
  return out;
}

export function cssUrls(css) {
  const out = [];
  for (const m of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/g)) out.push(m[1] ?? m[2] ?? m[3]);
  for (const m of css.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/g)) out.push(m[1] ?? m[2]);
  return out.filter((u) => u !== undefined && !u.startsWith("data:") && !u.startsWith("#"));
}

// True for a URL that leaves the site (another host, or a protocol-relative URL).
export function isThirdParty(url) {
  if (/^(data|blob|mailto|tel|javascript|about):/i.test(url)) return false;
  if (url.startsWith("//")) return true;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return false;
  try {
    return new URL(url).origin !== ORIGIN;
  } catch {
    return true;
  }
}

export function stableUrls(file = path.join(SITE, "stable-urls.txt")) {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

// The codes in extension/lib/errors.js. It's a browser script (the repository's
// package.json makes .js files ES modules), so it runs in a sandbox of its own.
export function errorCodes() {
  const sandbox = { globalThis: null };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "extension/lib/errors.js"), "utf8"), sandbox);
  return Object.keys(sandbox.KotikoErrors.CODES);
}

export function providerIds() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "spec/providers.json"), "utf8")).providers.map((p) => p.id);
}

export function check(dist = path.join(SITE, "dist")) {
  const problems = [];
  if (!fs.existsSync(dist)) return [`${dist} doesn't exist: run \`npm run build\` first.`];
  const files = walk(dist);
  const pages = new Map(files.filter((f) => f.endsWith(".html")).map((f) => [f, fs.readFileSync(path.join(dist, f), "utf8")]));
  const idCache = new Map();
  const idsFor = (file) => {
    if (!idCache.has(file)) idCache.set(file, idsOf(fs.readFileSync(file, "utf8")));
    return idCache.get(file);
  };

  const mustHave = [
    ...stableUrls(),
    ...errorCodes().map((c) => `/help/errors/#${c}`),
    ...providerIds().map((id) => `/providers/${id}/`),
  ];
  for (const u of mustHave) {
    const file = fileFor(dist, u);
    if (!file) problems.push(`${u}: not built`);
    else if (u.includes("#") && !idsFor(file).has(u.split("#")[1])) problems.push(`${u}: no element with id "${u.split("#")[1]}"`);
  }

  for (const [rel, html] of pages) {
    const pagePath = `/${rel.replace(/index\.html$/, "")}`;
    for (const { url, kind, tag } of urlsOf(html)) {
      if (!url) continue;
      if (isThirdParty(url)) {
        if (kind === "fetch") problems.push(`${pagePath}: <${tag}> loads ${url} from another host`);
        continue;
      }
      if (/^(data|blob|mailto|tel|javascript|about):/i.test(url)) continue;
      // A link inside the site: resolve it and check the target and its anchor.
      const target = new URL(url, `${ORIGIN}${pagePath}`);
      if (target.origin !== ORIGIN) continue;
      const file = fileFor(dist, target.pathname);
      if (!file) {
        problems.push(`${pagePath}: broken ${kind === "fetch" ? "resource" : "link"} ${url}`);
        continue;
      }
      const hash = decodeURIComponent(target.hash.slice(1));
      if (hash && hash !== "_top" && file.endsWith(".html") && !idsFor(file).has(hash)) problems.push(`${pagePath}: link ${url} has no #${hash} on its page`);
    }
  }

  for (const rel of files.filter((f) => f.endsWith(".css"))) {
    for (const u of cssUrls(fs.readFileSync(path.join(dist, rel), "utf8"))) {
      if (isThirdParty(u)) problems.push(`/${rel}: loads ${u} from another host`);
    }
  }

  const cname = path.join(dist, "CNAME");
  if (!fs.existsSync(cname) || fs.readFileSync(cname, "utf8").trim() !== "kotiko.org") problems.push("CNAME: must contain kotiko.org");

  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  const problems = check(dist);
  for (const p of problems) console.error(p);
  if (problems.length) {
    console.error(`${problems.length} problem(s) in the built site.`);
    process.exit(1);
  }
  console.log("The built site's stable URLs, error anchors, provider pages and internal links are all there, and it loads nothing from other hosts.");
}
