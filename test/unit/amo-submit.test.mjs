// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Security review C-06: Firefox Add-ons got a zip that `web-ext sign --source-dir` built
// again, not the release's attested zip. scripts/amo-submit.mjs checks the zip against
// SHA256SUMS and submits that exact file through web-ext's AMO v5 client. Here a fake AMO
// server on 127.0.0.1 records what arrives; nothing reaches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import { listedHash, submit } from "../../scripts/amo-submit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const hex = (buf) => createHash("sha256").update(buf).digest("hex");

// A fake AMO: upload, validation (done at once), new version. Records each request.
async function fakeAmo(t) {
  const seen = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const entry = { method: req.method, path: req.url, auth: req.headers.authorization };
    seen.push(entry);
    const json = (obj) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.method === "POST" && req.url === "/api/v5/addons/upload/") {
      const form = await new Response(body, { headers: { "content-type": req.headers["content-type"] } }).formData();
      const file = form.get("upload");
      entry.channel = form.get("channel");
      entry.filename = file.name;
      entry.bytes = Buffer.from(await file.arrayBuffer());
      return json({ uuid: "u-1" });
    }
    if (req.method === "GET" && req.url === "/api/v5/addons/upload/u-1/") return json({ uuid: "u-1", processed: true, valid: true });
    if (req.method === "PUT" && decodeURIComponent(req.url) === "/api/v5/addons/addon/kotiko@scriptkittyos.com/") {
      entry.json = JSON.parse(body.toString("utf8"));
      return json({ guid: "kotiko@scriptkittyos.com", version: { id: 7, edit_url: "https://example.invalid/edit" } });
    }
    res.writeHead(404).end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  return { seen, url: `http://127.0.0.1:${server.address().port}/api/v5/` };
}

function release(t) {
  const dir = mkdtempSync(join(tmpdir(), "kotiko-amo-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const zip = join(dir, "kotiko-firefox-9.9.9.zip");
  // web-ext reads the zip's entries (for its upload cache), so a real zip.
  writeFileSync(zip, zipSync({ "manifest.json": strToU8('{"version":"9.9.9"}\n') }, { mtime: new Date("2026-10-06T00:00:00Z") }));
  const sums = join(dir, "SHA256SUMS");
  writeFileSync(sums, `${hex(readFileSync(zip))}  kotiko-firefox-9.9.9.zip\n${"0".repeat(64)}  kotiko-chrome-9.9.9.zip\n`);
  return { dir, zip, sums };
}

test("the zip AMO receives is the release's zip, byte for byte, as a listed version", async (t) => {
  const amo = await fakeAmo(t);
  const { zip, sums } = release(t);
  const hash = await submit({ zip, sums, id: "kotiko@scriptkittyos.com", apiKey: "user:1:2", apiSecret: "s".repeat(64), amoBaseUrl: amo.url });
  const upload = amo.seen.find((r) => r.path === "/api/v5/addons/upload/");
  assert.ok(upload, "uploaded");
  assert.equal(hex(upload.bytes), hex(readFileSync(zip)), "the same bytes, not a rebuilt zip");
  assert.equal(hash, hex(readFileSync(zip)));
  assert.equal(upload.filename, "kotiko-firefox-9.9.9.zip");
  assert.equal(upload.channel, "listed");
  assert.match(upload.auth, /^JWT [\w-]+\.[\w-]+\.[\w-]+$/);
  const version = amo.seen.find((r) => r.method === "PUT");
  assert.deepEqual(version.json, { version: { upload: "u-1" } });
});

test("a zip that doesn't match SHA256SUMS, or isn't in it, is never uploaded", async (t) => {
  const amo = await fakeAmo(t);
  const { dir, zip, sums } = release(t);
  const args = { sums, id: "kotiko@scriptkittyos.com", apiKey: "k", apiSecret: "s", amoBaseUrl: amo.url };
  writeFileSync(zip, "repacked");
  await assert.rejects(submit({ ...args, zip }), /has SHA-256 [0-9a-f]{64}, but .*SHA256SUMS says/);
  const other = join(dir, "kotiko-firefox-1.0.0.zip");
  writeFileSync(other, "x");
  await assert.rejects(submit({ ...args, zip: other }), /isn't listed in/);
  await assert.rejects(submit({ ...args, zip, apiKey: "" }), /WEB_EXT_API_KEY/);
  assert.deepEqual(amo.seen, [], "no request reached AMO");
});

test("listedHash reads sha256sum's text and binary forms", () => {
  const h = "a".repeat(64);
  assert.equal(listedHash(`${h}  x.zip\n`, "x.zip"), h);
  assert.equal(listedHash(`${h} *x.zip\n`, "x.zip"), h);
  assert.equal(listedHash(`${h}  x.zip.bak\n`, "x.zip"), null);
});

test("the release workflow submits with amo-submit, not web-ext sign", () => {
  const wf = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");
  const job = wf.slice(wf.indexOf("\n  publish-firefox:"));
  assert.match(job, /node scripts\/amo-submit\.mjs --zip "dist\/kotiko-firefox-\$VERSION\.zip" --sums dist\/SHA256SUMS/);
  assert.doesNotMatch(job, /web-ext sign|unzip/);
});
