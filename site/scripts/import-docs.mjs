#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Pulls the repository's own documents into the site before every build, so each has one
// source (slice 44 §9, `documentation_current`): the privacy policy (slice 28), the server
// references, the contributor documents, the "Why Kotiko?" story and the changelog. The
// copies are written under src/content/docs/ and are git-ignored; edit the sources.
//
// Relative links are rewritten: to the page that publishes the target when there is one,
// otherwise to the file on GitHub. The build fails if a source is missing.
//
// It also copies the brand files the site shows (logo, favicon, demo, mascot) from brand/,
// so the site serves them itself instead of keeping its own copies in git.
//
//   node scripts/import-docs.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT = path.resolve(SITE, "..");
const DOCS = path.join(SITE, "src/content/docs");
const REPO = "https://github.com/ScriptKittyOS/kotiko";

// Source (from the repository root) -> page (under src/content/docs) and its front matter.
export const SOURCES = [
  { from: "docs/privacy/en.md", to: "privacy.md", title: "Kotiko privacy policy", description: "What Kotiko keeps, what it sends, and to whom." },
  { from: "docs/reference/configuration.md", to: "server/configuration.md", title: "Server configuration reference", description: "Every setting the Kotiko server reads." },
  { from: "docs/reference/http-api.md", to: "server/api.md", title: "HTTP API reference", description: "The Kotiko server's HTTP API, version 1." },
  { from: "docs/story/en.md", to: "why.md", title: "Why Kotiko?", description: "Where the name comes from, and what Kotiko is for." },
  { from: "docs/verify.md", to: "install/verify.md", title: "Checking a download", description: "How to check that a Kotiko release was built from this repository." },
  { from: "CHANGELOG.md", to: "changelog.md", title: "What's new", description: "Every change to Kotiko, newest first." },
  { from: "CONTRIBUTING.md", to: "contribute/index.md", title: "Contributing", description: "How to help build Kotiko." },
  { from: "docs/ARCHITECTURE.md", to: "contribute/architecture.md", title: "Architecture", description: "How the extension, the shared spec and the server fit together." },
  { from: "docs/CODING_STANDARDS.md", to: "contribute/coding-standards.md", title: "Coding standards", description: "The rules Kotiko's code follows." },
  { from: "GOVERNANCE.md", to: "contribute/governance.md", title: "Governance", description: "How decisions are made and who maintains what." },
  { from: "ROADMAP.md", to: "contribute/roadmap.md", title: "Roadmap", description: "What comes next." },
  { from: "docs/security/requirements.md", to: "contribute/security-requirements.md", title: "Security requirements", description: "What Kotiko promises about security." },
  { from: "docs/security/assurance-case.md", to: "contribute/assurance-case.md", title: "Assurance case", description: "Why Kotiko meets its security requirements." },
];

// Brand files the site serves: from brand/ to src/assets/brand/ (processed and resized by
// Astro) or public/brand/ (served as they are).
export const BRAND = [
  { from: "brand/logo/cat-128.png", to: "src/assets/brand/cat-128.png" },
  { from: "brand/illustrations/hero-words-moon.png", to: "src/assets/brand/hero-words-moon.png" },
  { from: "brand/illustrations/kitten-curious.png", to: "src/assets/brand/kitten-curious.png" },
  { from: "brand/illustrations/kitten-happy.png", to: "src/assets/brand/kitten-happy.png" },
  { from: "brand/illustrations/kitten-oops.png", to: "src/assets/brand/kitten-oops.png" },
  { from: "brand/demo/kotiko-demo.gif", to: "public/brand/kotiko-demo.gif" },
  { from: "brand/logo/icon-32.png", to: "public/brand/icon-32.png" },
  { from: "brand/logo/icon-128.png", to: "public/brand/icon-128.png" },
  { from: "brand/social/social-card-1200x630.jpg", to: "public/brand/social-card.jpg" },
];

// Where a repository file is published on the site, by its path.
const PUBLISHED = new Map(SOURCES.map((s) => [s.from, `/${s.to.replace(/(index)?\.md$/, "").replace(/\/?$/, "/")}`]));
PUBLISHED.set("README.md", "/");

function github(rel) {
  const abs = path.join(ROOT, rel);
  const kind = fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? "tree" : "blob";
  return `${REPO}/${kind}/main/${rel}`;
}

// A link target as written in `fromFile`, as the site should write it.
export function rewriteTarget(target, fromFile) {
  if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target) || target === "") return target;
  const [rawPath, ...frag] = target.split("#");
  const hash = frag.length ? `#${frag.join("#")}` : "";
  if (rawPath === "") return target;
  const rel = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), rawPath)).replace(/\/$/, "");
  if (rel.startsWith("..")) return target;
  if (PUBLISHED.has(rel)) return PUBLISHED.get(rel) + hash;
  return github(rel) + hash;
}

// The page's Markdown: no leading comment or H1 (Starlight writes the title), links
// rewritten outside code.
export function transform(text, fromFile) {
  let body = text.replace(/^\uFEFF/, "");
  body = body.replace(/^(\s*<!--[\s\S]*?-->\s*)+/, "");
  body = body.replace(/^# .*\n+/, "");
  let fenced = false;
  return body
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) return line;
      return line
        .replace(/(\]\()([^)\s]+)(\))/g, (_, a, t, b) => a + rewriteTarget(t, fromFile) + b)
        .replace(/^(\[[^\]]+\]:\s*)(\S+)/, (_, a, t) => a + rewriteTarget(t, fromFile))
        .replace(/((?:href|src)=")([^"]+)(")/g, (_, a, t, b) => a + rewriteTarget(t, fromFile) + b);
    })
    .join("\n");
}

const yaml = (s) => JSON.stringify(s);

export function page(source) {
  const file = path.join(ROOT, source.from);
  if (!fs.existsSync(file)) throw new Error(`${source.from} is missing: the site publishes it (site/scripts/import-docs.mjs).`);
  const text = fs.readFileSync(file, "utf8");
  return [
    "---",
    `title: ${yaml(source.title)}`,
    `description: ${yaml(source.description)}`,
    `editUrl: ${yaml(`${REPO}/edit/main/${source.from}`)}`,
    "---",
    "",
    `<!-- Generated from ${source.from} by site/scripts/import-docs.mjs. Edit that file, not this one. -->`,
    "",
    transform(text, source.from).trimEnd(),
    "",
  ].join("\n");
}

// Resized copies for pages that show an image at a fixed size, made with sharp (which Astro
// itself uses for images). The home page's logo keeps its wide shape this way; Starlight's
// hero would crop it to a square.
export const RESIZED = [{ from: "brand/logo/kotiko-logo.png", to: "public/brand/kotiko-logo-640.webp", width: 640 }];

export async function run() {
  for (const s of SOURCES) {
    const out = path.join(DOCS, s.to);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, page(s));
  }
  for (const b of BRAND) {
    const src = path.join(ROOT, b.from);
    if (!fs.existsSync(src)) throw new Error(`${b.from} is missing: the site shows it (site/scripts/import-docs.mjs).`);
    const out = path.join(SITE, b.to);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(src, out);
  }
  const { default: sharp } = await import("sharp");
  for (const r of RESIZED) {
    const out = path.join(SITE, r.to);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await sharp(path.join(ROOT, r.from)).resize({ width: r.width }).webp({ quality: 90 }).toFile(out);
  }
  console.log(`Imported ${SOURCES.length} documents and ${BRAND.length + RESIZED.length} brand files.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
