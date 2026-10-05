// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 30 §3: the store zips (scripts/build-extension.mjs). Manifest transforms, what's left
// out, refusals, and determinism: same input, same bytes, in any time zone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import {
  build, BuildError, chromeManifest, collectFiles, firefoxManifest, GECKO_ID, isIgnored, parseIgnore, resolveMtime,
} from "../../scripts/build-extension.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MTIME = 1790000000; // 2026-09-21T14:13:20Z
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

const BASE_MANIFEST = {
  manifest_version: 3,
  name: "Test",
  version: "1.2.3",
  background: { service_worker: "bg.js", scripts: ["lib/a.js", "bg.js"] },
  action: { default_popup: "popup.html" },
  browser_specific_settings: { gecko: { id: GECKO_ID, strict_min_version: "121.0" } },
};

// A small source tree and a root with the license files the zips carry.
function fixture(manifest = BASE_MANIFEST, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "kotiko-build-test-"));
  const files = {
    "ext/manifest.json": JSON.stringify(manifest),
    "ext/bg.js": "// bg\n",
    "ext/lib/a.js": "// a\n",
    "ext/lib/a.js.map": "{}",
    "ext/popup.html": "<!doctype html>\n",
    "ext/.DS_Store": "x",
    "ext/.hidden/secret.txt": "x",
    "ext/lib/notes.txt~": "x",
    "ext/lib/b.js.swp": "x",
    "ext/ui/tools/gen.mjs": "// tool\n",
    "ext/ui/tools.css": "/* kept: not the tools/ folder */\n",
    "ext/_locales/en/messages.json": "{}",
    "ext/Zeta.js": "// capital Z sorts before lowercase\n",
    "ext/.buildignore": "# comment\nui/tools/\n*.txt~\n",
    "LICENSE": "license\n",
    "NOTICE": "notice\n",
    "LICENSES/Apache-2.0.txt": "apache\n",
    ...extra,
  };
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  return dir;
}

function buildFixture(dir, opts = {}) {
  return build({ version: "1.2.3", out: join(dir, "dist"), source: join(dir, "ext"), root: dir, mtime: String(MTIME), lint: false, log: () => {}, ...opts });
}

// The central directory, read by hand, so the test checks what's actually in the file.
function centralDirectory(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let o = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(o), 0x02014b50);
    const madeBy = buf.readUInt16LE(o + 4);
    const method = buf.readUInt16LE(o + 10);
    const time = buf.readUInt16LE(o + 12);
    const date = buf.readUInt16LE(o + 14);
    const nameLen = buf.readUInt16LE(o + 28);
    const extraLen = buf.readUInt16LE(o + 30);
    const commentLen = buf.readUInt16LE(o + 32);
    const attrs = buf.readUInt32LE(o + 38);
    const name = buf.subarray(o + 46, o + 46 + nameLen).toString("utf8");
    entries.push({ name, madeBy, method, time, date, attrs });
    o += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

test("Chrome's manifest drops Firefox's keys and keeps the service worker", () => {
  const m = chromeManifest({ ...BASE_MANIFEST, options_ui: { page: "o.html", browser_style: true }, sidebar_action: {} });
  assert.equal(m.background.service_worker, "bg.js");
  assert.equal("scripts" in m.background, false);
  assert.equal("browser_specific_settings" in m, false);
  assert.equal("sidebar_action" in m, false);
  assert.equal("browser_style" in m.options_ui, false);
  assert.equal(m.version, "1.2.3");
});

test("Firefox's manifest drops the service worker and keeps the gecko id", () => {
  const m = firefoxManifest({ ...BASE_MANIFEST, minimum_chrome_version: "120" });
  assert.equal("service_worker" in m.background, false);
  assert.deepEqual(m.background.scripts, ["lib/a.js", "bg.js"]);
  assert.equal(m.browser_specific_settings.gecko.id, "kotiko@scriptkittyos.com");
  assert.equal(m.browser_specific_settings.gecko.strict_min_version, "121.0");
  assert.equal("minimum_chrome_version" in m, false);
});

test("the source manifest is never changed", () => {
  const source = structuredClone(BASE_MANIFEST);
  chromeManifest(source);
  firefoxManifest(source);
  assert.deepEqual(source, BASE_MANIFEST);
});

test("a manifest with a key, a wrong gecko id or an update_url is refused", () => {
  assert.throws(() => chromeManifest({ ...BASE_MANIFEST, key: "MIIB" }), BuildError);
  assert.throws(() => firefoxManifest({ ...BASE_MANIFEST, key: "MIIB" }), BuildError);
  assert.throws(() => firefoxManifest({ ...BASE_MANIFEST, browser_specific_settings: { gecko: { id: "other@x" } } }), /gecko\.id/);
  assert.throws(() => firefoxManifest({ ...BASE_MANIFEST, browser_specific_settings: undefined }), /gecko\.id/);
  assert.throws(() => firefoxManifest({ ...BASE_MANIFEST, browser_specific_settings: { gecko: { id: GECKO_ID, update_url: "https://x/u.json" } } }), /update_url/);
});

test(".buildignore patterns and the files that are always left out", () => {
  const p = parseIgnore("# c\n\nui/tools/\n*.log\n/top.js\ndocs/**/draft.md\n");
  assert.equal(isIgnored("ui/tools/gen.mjs", p), true);
  assert.equal(isIgnored("ui/tools.css", p), false);
  assert.equal(isIgnored("lib/x.log", p), true);
  assert.equal(isIgnored("top.js", p), true);
  assert.equal(isIgnored("lib/top.js", p), false);
  assert.equal(isIgnored("docs/a/b/draft.md", p), true);
  assert.equal(isIgnored("docs/draft.md", p), true);
  for (const f of [".DS_Store", "lib/.eslintrc", ".git/config", "a.js.map", "a.js~", "a.js.swp", "a.orig", "Thumbs.db"]) {
    assert.equal(isIgnored(f, []), true, f);
  }
  assert.equal(isIgnored("lib/a.js", []), false);
});

test("the zips hold the extension's files and the licenses, sorted, with no folders or leftovers", (t) => {
  const dir = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { chrome, firefox } = buildFixture(dir);
  const expected = [
    "LICENSE", "LICENSES/Apache-2.0.txt", "NOTICE", "Zeta.js", "_locales/en/messages.json", "bg.js", "lib/a.js",
    "manifest.json", "popup.html", "ui/tools.css",
  ];
  for (const z of [chrome, firefox]) {
    const entries = centralDirectory(readFileSync(z.file));
    assert.deepEqual(entries.map((e) => e.name), expected);
    for (const e of entries) {
      assert.equal(e.madeBy >> 8, 3, "made on Unix");
      assert.equal(e.attrs >>> 16, 0o100644, `${e.name} is a rw-r--r-- file`);
      assert.equal(e.method, 8, "deflated");
      // DOS time of 2026-09-21 14:13:20 UTC.
      assert.equal(e.date, ((2026 - 1980) << 9) | (9 << 5) | 21);
      assert.equal(e.time, (14 << 11) | (13 << 5) | (20 >> 1));
    }
  }
  const files = unzipSync(readFileSync(chrome.file));
  assert.equal(new TextDecoder().decode(files["lib/a.js"]), "// a\n");
  const cm = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
  assert.equal("scripts" in cm.background, false);
  const fm = JSON.parse(new TextDecoder().decode(unzipSync(readFileSync(firefox.file))["manifest.json"]));
  assert.equal("service_worker" in fm.background, false);
  assert.ok(chrome.file.endsWith("kotiko-chrome-1.2.3.zip"));
  assert.ok(firefox.file.endsWith("kotiko-firefox-1.2.3.zip"));
});

test("building twice gives byte-identical zips, whatever the time zone", (t) => {
  const dir = fixture();
  const tz = process.env.TZ;
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });
  const hashes = [];
  for (const [i, zone] of ["UTC", "America/Los_Angeles", "Asia/Kolkata"].entries()) {
    process.env.TZ = zone;
    const r = buildFixture(dir, { out: join(dir, `dist${i}`) });
    hashes.push([sha(r.chrome.file), sha(r.firefox.file)]);
  }
  assert.deepEqual(hashes[1], hashes[0]);
  assert.deepEqual(hashes[2], hashes[0]);
  assert.notEqual(hashes[0][0], hashes[0][1]);
});

test("a different timestamp or file changes the bytes", (t) => {
  const dir = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const a = sha(buildFixture(dir, { out: join(dir, "a") }).chrome.file);
  const b = sha(buildFixture(dir, { out: join(dir, "b"), mtime: String(MTIME + 2) }).chrome.file);
  writeFileSync(join(dir, "ext/bg.js"), "// changed\n");
  const c = sha(buildFixture(dir, { out: join(dir, "c") }).chrome.file);
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test("the build refuses a version that differs from the manifest's, or isn't a release version", (t) => {
  const dir = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => buildFixture(dir, { version: "1.2.4" }), /says 1\.2\.3, but this build is 1\.2\.4/);
  for (const v of ["1.2", "v1.2.3", "1.2.3-beta.1", "1.2.3-rc", ""]) {
    assert.throws(() => buildFixture(dir, { version: v }), /--version must look like/, v);
  }
});

test("a release candidate builds from its release's manifest and says rc in the file name", (t) => {
  const dir = fixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = buildFixture(dir, { version: "1.2.3-rc.2" });
  assert.ok(r.chrome.file.endsWith("kotiko-chrome-1.2.3-rc.2.zip"));
  assert.equal(r.chrome.manifest.version, "1.2.3");
});

test("a manifest with a key fails the whole build", (t) => {
  const dir = fixture({ ...BASE_MANIFEST, key: "MIIBIjAN" });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => buildFixture(dir), /"key"/);
});

test("the timestamp comes from --mtime, then SOURCE_DATE_EPOCH, then the commit", () => {
  assert.equal(resolveMtime("1790000000", {}), 1790000000);
  assert.equal(resolveMtime(undefined, { SOURCE_DATE_EPOCH: "1790000002" }), 1790000002);
  assert.ok(resolveMtime(undefined, {}, ROOT) > 1700000000);
  assert.throws(() => resolveMtime("yesterday", {}), BuildError);
  assert.throws(() => resolveMtime("0", {}), /1980/);
});

test("the real extension: tools stay out, runtime files go in", () => {
  const files = collectFiles(join(ROOT, "extension"));
  assert.ok(files.includes("manifest.json"));
  assert.ok(files.includes("story/en.md"), "the story is read at run time");
  assert.ok(files.includes("spec/prompt.md"), "the prompt is read at run time");
  assert.ok(files.includes("_locales/en/messages.json"));
  assert.equal(files.some((f) => f.startsWith("ui/tools/")), false);
  assert.equal(files.some((f) => f.split("/").some((s) => s.startsWith("."))), false);
  // Every file the manifest names ships.
  const m = JSON.parse(readFileSync(join(ROOT, "extension/manifest.json"), "utf8"));
  const named = [
    ...m.background.scripts, m.background.service_worker, ...m.content_scripts.flatMap((c) => [...c.js, ...c.css]),
    m.action.default_popup, m.options_ui.page, ...Object.values(m.icons),
  ];
  for (const f of named) assert.ok(files.includes(f), `${f} is in the zip`);
});

test("the real extension builds into both zips with matching file lists", (t) => {
  const out = mkdtempSync(join(tmpdir(), "kotiko-build-real-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const version = JSON.parse(readFileSync(join(ROOT, "extension/manifest.json"), "utf8")).version;
  const r = build({ version, out, mtime: String(MTIME), lint: false, log: () => {} });
  assert.deepEqual(r.chrome.entries, r.firefox.entries);
  assert.equal("browser_specific_settings" in r.chrome.manifest, false);
  assert.equal("scripts" in r.chrome.manifest.background, false);
  assert.equal("key" in r.chrome.manifest, false);
  assert.equal("service_worker" in r.firefox.manifest.background, false);
  assert.equal(r.firefox.manifest.browser_specific_settings.gecko.id, "kotiko@scriptkittyos.com");
  const again = build({ version, out: join(out, "again"), mtime: String(MTIME), lint: false, log: () => {} });
  assert.equal(sha(again.chrome.file), sha(r.chrome.file));
  assert.equal(sha(again.firefox.file), sha(r.firefox.file));
});
