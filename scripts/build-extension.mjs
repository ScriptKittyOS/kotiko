#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Builds the store zips from extension/ (slice 30 §3):
//
//   node scripts/build-extension.mjs --version 0.3.0 --out dist/
//
// writes dist/kotiko-chrome-0.3.0.zip and dist/kotiko-firefox-0.3.0.zip. Each store gets its
// own manifest (Chrome: no background.scripts or browser_specific_settings; Firefox: no
// background.service_worker). The zips are reproducible: entries sorted by path, one fixed
// timestamp (the commit's time, or SOURCE_DATE_EPOCH), fixed permissions, no directory
// entries, and deflate from fflate, which is plain JavaScript, so the bytes don't depend on
// the Node version, its bundled zlib or the CPU. Building the same commit twice gives
// byte-identical files. The Firefox tree is then checked with `web-ext lint` (listed
// channel); errors fail the build.
//
// Options: --source <dir> (default extension/), --mtime <unix seconds>, --skip-lint.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { VERSION_RE } from "./release-notes.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const GECKO_ID = "kotiko@scriptkittyos.com";

// Files at the repository root that go into both zips, so whoever gets a zip also gets the
// licenses that cover it (Apache-2.0 §4; the brand, CLDR and stopwords notices).
export const LICENSE_FILES = ["LICENSE", "NOTICE"];
export const LICENSE_DIRS = ["LICENSES"];

// Left out whatever .buildignore says: dotfiles and dot-folders, source maps, editor and OS
// leftovers.
const ALWAYS_IGNORED = [/(^|\/)\./, /\.map$/, /~$/, /\.sw[op]$/, /\.orig$/, /\.rej$/, /(^|\/)Thumbs\.db$/i, /(^|\/)desktop\.ini$/i];

// Keys only Firefox understands; Chrome warns about each one.
const FIREFOX_ONLY_KEYS = ["browser_specific_settings", "applications", "sidebar_action", "developer", "protocol_handlers", "theme_experiment", "user_scripts"];
// Keys only Chrome understands; web-ext lint warns about each one.
const CHROME_ONLY_KEYS = ["minimum_chrome_version", "side_panel", "oauth2", "export", "import", "update_url"];

export class BuildError extends Error {}

/** Turns one .buildignore line into a RegExp over "/"-separated relative paths. */
export function patternToRegExp(line) {
  let p = line.trim();
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);
  const anchored = p.startsWith("/") || p.includes("/");
  if (p.startsWith("/")) p = p.slice(1);
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*" && p[i + 1] === "*") {
      re += ".*";
      i++;
      if (p[i + 1] === "/") i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const head = anchored ? "^" : "(^|/)";
  const tail = dirOnly ? "/" : "(/|$)";
  return new RegExp(head + re + tail);
}

export function parseIgnore(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map(patternToRegExp);
}

export function isIgnored(path, patterns) {
  return ALWAYS_IGNORED.some((re) => re.test(path)) || patterns.some((re) => re.test(path));
}

function walk(dir, base, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(base, full).split(sep).join("/");
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push(rel);
    else throw new BuildError(`Not a regular file or folder: ${rel} (symlinks aren't packaged)`);
  }
  return out;
}

/** Relative paths of the files that ship, sorted by UTF-16 code unit (not locale). */
export function collectFiles(sourceDir) {
  let patterns = [];
  try {
    patterns = parseIgnore(readFileSync(join(sourceDir, ".buildignore"), "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  return walk(sourceDir, sourceDir, [])
    .filter((p) => !isIgnored(p, patterns))
    .sort(compareBytes);
}

export function compareBytes(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

function checkCommon(manifest) {
  if ("key" in manifest) {
    throw new BuildError("manifest.json has a \"key\"; store packages must not (each store assigns its own id).");
  }
}

export function chromeManifest(source) {
  checkCommon(source);
  const m = clone(source);
  for (const k of FIREFOX_ONLY_KEYS) delete m[k];
  if (m.background) {
    if (!m.background.service_worker) throw new BuildError("Chrome needs background.service_worker.");
    delete m.background.scripts;
    delete m.background.persistent;
  }
  for (const k of ["action", "options_ui", "page_action"]) if (m[k]) delete m[k].browser_style;
  return m;
}

export function firefoxManifest(source) {
  checkCommon(source);
  const m = clone(source);
  for (const k of CHROME_ONLY_KEYS) delete m[k];
  if (m.background) {
    if (!m.background.scripts?.length) throw new BuildError("Firefox needs background.scripts.");
    delete m.background.service_worker;
  }
  const id = m.browser_specific_settings?.gecko?.id;
  if (id !== GECKO_ID) {
    throw new BuildError(`browser_specific_settings.gecko.id is ${JSON.stringify(id)}; expected ${GECKO_ID}.`);
  }
  if (m.browser_specific_settings.gecko.update_url) {
    throw new BuildError("gecko.update_url must not be set: the add-on is listed on AMO, which sends updates itself.");
  }
  return m;
}

/** The zip's timestamp: --mtime, else SOURCE_DATE_EPOCH, else the commit time of HEAD. */
export function resolveMtime(arg, env = process.env, cwd = ROOT) {
  const raw = arg ?? env.SOURCE_DATE_EPOCH ?? execFileSync("git", ["log", "-1", "--format=%ct"], { cwd, encoding: "utf8" }).trim();
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 315532800) throw new BuildError(`Bad timestamp ${JSON.stringify(raw)} (unix seconds, 1980 or later).`);
  return n;
}

// fflate writes the zip's DOS date from the Date's local-time fields. Building the Date from
// the UTC fields makes the stored time the same in every time zone (the CLI also sets TZ=UTC,
// which removes daylight-saving gaps).
function dosDate(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
}

const FILE_ATTRS = (0o100644 << 16) >>> 0; // regular file, rw-r--r--
const UNIX = 3;

/** entries: [[path, Uint8Array]], already sorted. Returns the zip bytes. */
export function zipEntries(entries, unixSeconds) {
  const mtime = dosDate(unixSeconds);
  const input = {};
  for (const [path, data] of entries) {
    // Object keys that look like array indices would be reordered by JavaScript.
    if (/^\d+$/.test(path)) throw new BuildError(`Can't package a file named ${path}.`);
    input[path] = [data, { level: 9, mtime, os: UNIX, attrs: FILE_ATTRS }];
  }
  return zipSync(input, { level: 9, mtime, os: UNIX, attrs: FILE_ATTRS });
}

function manifestBytes(m) {
  return new TextEncoder().encode(JSON.stringify(m, null, 2) + "\n");
}

/**
 * Builds both zips. Returns { chrome, firefox }, each with the zip's path (file), its entry
 * names and its manifest. With lint, the Firefox files are unpacked to a temp folder for
 * web-ext lint and removed afterwards.
 */
export function build({ version, out, source = join(ROOT, "extension"), root = ROOT, mtime, lint = true, log = console.log }) {
  // X.Y.Z, or X.Y.Z-rc.N for a release candidate, whose manifest says X.Y.Z because browsers
  // only accept dotted numbers.
  const v = VERSION_RE.exec(version ?? "");
  if (!v) throw new BuildError(`--version must look like 1.2.3 or 1.2.3-rc.4, not ${JSON.stringify(version)}.`);
  const core = `${v[1]}.${v[2]}.${v[3]}`;
  const sourceManifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
  if (sourceManifest.version !== core) {
    throw new BuildError(`extension/manifest.json says ${sourceManifest.version}, but this build is ${version}. Release from a commit whose versions match (node scripts/check-versions.mjs).`);
  }
  const seconds = resolveMtime(mtime, process.env, root);

  const files = collectFiles(source).filter((p) => p !== "manifest.json");
  const shared = files.map((p) => [p, new Uint8Array(readFileSync(join(source, p)))]);
  for (const name of LICENSE_FILES) shared.push([name, new Uint8Array(readFileSync(join(root, name)))]);
  for (const dir of LICENSE_DIRS) {
    for (const p of walk(join(root, dir), root, [])) shared.push([p, new Uint8Array(readFileSync(join(root, p)))]);
  }

  const targets = { chrome: chromeManifest(sourceManifest), firefox: firefoxManifest(sourceManifest) };
  mkdirSync(out, { recursive: true });
  const result = {};
  for (const [store, manifest] of Object.entries(targets)) {
    const entries = [...shared, ["manifest.json", manifestBytes(manifest)]];
    const seen = new Set();
    for (const [p] of entries) {
      if (seen.has(p)) throw new BuildError(`${p} would be in the zip twice.`);
      seen.add(p);
    }
    entries.sort((a, b) => compareBytes(a[0], b[0]));
    const file = join(out, `kotiko-${store}-${version}.zip`);
    writeFileSync(file, zipEntries(entries, seconds));
    result[store] = { file, entries: entries.map(([p]) => p), manifest };
    log(`${relative(process.cwd(), file) || file}  (${entries.length} files)`);
  }

  if (lint) {
    const tree = mkdtempSync(join(tmpdir(), "kotiko-firefox-"));
    try {
      for (const [p, data] of [...shared, ["manifest.json", manifestBytes(targets.firefox)]]) {
        mkdirSync(dirname(join(tree, p)), { recursive: true });
        writeFileSync(join(tree, p), data);
      }
      const webExt = join(root, "node_modules", ".bin", "web-ext");
      // Listed on AMO, so no --self-hosted: the linter applies the store's rules.
      execFileSync(webExt, ["lint", "--source-dir", tree, "--no-config-discovery"], { stdio: "inherit" });
    } catch (e) {
      if (e instanceof BuildError) throw e;
      throw new BuildError(`web-ext lint failed on the Firefox tree (${e.message.split("\n")[0]}).`);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  }
  return result;
}

function parseArgs(argv) {
  const args = { lint: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new BuildError(`${a} needs a value.`);
      return v;
    };
    if (a === "--version") args.version = next();
    else if (a === "--out") args.out = next();
    else if (a === "--source") args.source = resolve(next());
    else if (a === "--mtime") args.mtime = next();
    else if (a === "--skip-lint") args.lint = false;
    else throw new BuildError(`Unknown option ${a}.`);
  }
  if (!args.version || !args.out) throw new BuildError("Usage: node scripts/build-extension.mjs --version X.Y.Z --out dist/ [--source dir] [--mtime secs] [--skip-lint]");
  return args;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.env.TZ = "UTC";
  try {
    build(parseArgs(process.argv.slice(2)));
  } catch (e) {
    if (!(e instanceof BuildError)) throw e;
    console.error(`build-extension: ${e.message}`);
    process.exit(1);
  }
}
