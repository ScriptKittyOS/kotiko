#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Submits the release's own Firefox zip to addons.mozilla.org as a new listed version
// (slice 30; security review C-06). Run by .github/workflows/release.yml:
//
//   node scripts/amo-submit.mjs --zip dist/kotiko-firefox-1.0.0.zip --sums dist/SHA256SUMS
//
// `web-ext sign` can't do this: it always builds a new zip from a folder, with new
// timestamps, so the package AMO reviewed could not be matched to SHA256SUMS or the release's
// attestation. This script first checks the zip's SHA-256 against its SHA256SUMS line, then
// hands exactly that file to web-ext's own AMO client (web-ext/util/submit-addon, the AMO v5
// API: upload, validation, new version), which sends the file's bytes unchanged. It doesn't
// wait for review. AMO signs the version after review and distributes the signed copy, which
// adds Mozilla's signature files (META-INF/) to the same files.
//
// Credentials come from the environment: WEB_EXT_API_KEY (the JWT issuer) and
// WEB_EXT_API_SECRET. --id defaults to the gecko id in extension/manifest.json.

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const AMO_BASE_URL = "https://addons.mozilla.org/api/v5/";

export const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** The SHA-256 that a sha256sum-style file gives for name, or null. */
export function listedHash(sumsText, name) {
  for (const line of sumsText.split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{64}) [ *](.+)$/);
    if (m && m[2] === name) return m[1];
  }
  return null;
}

/** Checks the zip against SHA256SUMS and submits that exact file; returns its SHA-256. */
export async function submit({ zip, sums, id, apiKey, apiSecret, amoBaseUrl = AMO_BASE_URL, signAddon }) {
  if (!apiKey || !apiSecret) throw new Error("WEB_EXT_API_KEY and WEB_EXT_API_SECRET must be set");
  const expected = listedHash(readFileSync(sums, "utf8"), basename(zip));
  if (!expected) throw new Error(`${basename(zip)} isn't listed in ${sums}`);
  const actual = sha256(zip);
  if (actual !== expected) throw new Error(`${basename(zip)} has SHA-256 ${actual}, but ${sums} says ${expected}`);
  const send = signAddon ?? (await import("web-ext/util/submit-addon")).signAddon;
  // A fresh folder for web-ext's upload cache, so nothing from another run is reused.
  const scratch = mkdtempSync(join(tmpdir(), "kotiko-amo-"));
  try {
    await send({
      apiKey,
      apiSecret,
      amoBaseUrl,
      id,
      xpiPath: zip,
      channel: "listed",
      approvalCheckTimeout: 0,
      savedUploadUuidPath: join(scratch, "upload-uuid.json"),
      downloadDir: scratch,
      userAgentString: "kotiko-release",
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return actual;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const zip = arg("--zip");
  const sums = arg("--sums");
  if (!zip || !sums) {
    console.error("Usage: node scripts/amo-submit.mjs --zip <file> --sums <SHA256SUMS> [--id <add-on id>]");
    process.exit(2);
  }
  const id = arg("--id") ?? JSON.parse(readFileSync(join(ROOT, "extension/manifest.json"), "utf8")).browser_specific_settings.gecko.id;
  try {
    const hash = await submit({ zip, sums, id, apiKey: process.env.WEB_EXT_API_KEY, apiSecret: process.env.WEB_EXT_API_SECRET });
    console.log(`Submitted ${basename(zip)} to Firefox Add-ons as ${id}, unchanged: SHA-256 ${hash}, as in ${basename(sums)}.`);
  } catch (e) {
    console.error(`amo-submit: ${e.message}`);
    process.exitCode = 1;
  }
}
