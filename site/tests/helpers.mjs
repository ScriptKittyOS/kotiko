// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Shared pieces for the site's tests: paths, the build, and the extension's browser
// scripts loaded in a sandbox (the repository's package.json makes .js files ES modules,
// so they can't be require()d).
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT = path.resolve(SITE, "..");
export const DIST = path.join(SITE, "dist");

// Builds the site unless SITE_SKIP_BUILD=1 and dist/ exists: for running one test file on
// its own. `npm test` (scripts/test.mjs) builds once and sets SITE_SKIP_BUILD for every file.
let built = false;
export function ensureBuilt() {
  if (built) return DIST;
  if (!(process.env.SITE_SKIP_BUILD === "1" && fs.existsSync(DIST))) {
    execFileSync("npm", ["run", "build"], { cwd: SITE, stdio: "ignore", env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" } });
  }
  built = true;
  return DIST;
}

export const read = (rel) => fs.readFileSync(path.join(DIST, rel), "utf8");

// Runs an extension script (an IIFE that sets globalThis.Kotiko…) and returns its global.
export function extensionGlobal(rel, name) {
  const sandbox = { URL, TextEncoder, btoa, crypto: globalThis.crypto };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), sandbox);
  return sandbox[name];
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#x27": "'", nbsp: " " };
export const decode = (s) =>
  s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (ENTITIES[e.toLowerCase()] !== undefined) return ENTITIES[e.toLowerCase()];
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return m;
  });

// An element's text: tags removed, entities decoded, whitespace collapsed.
export const text = (html) => decode(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
