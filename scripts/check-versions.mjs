// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Fails when the extension, the server and the release manifest disagree on the version,
// and, from 1.0.0 on, when SECURITY.md still calls Kotiko pre-1.0 (security review B-08).
// No dependencies, so CI can run it before `npm ci`.
import { existsSync, readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const versions = {
  ".release-please-manifest.json": JSON.parse(read(".release-please-manifest.json"))["."],
  "extension/manifest.json": JSON.parse(read("extension/manifest.json")).version,
  "server/mix.exs": read("server/mix.exs").match(/^\s*version:\s*"([^"]+)"/m)?.[1],
};

const distinct = new Set(Object.values(versions));
for (const [file, v] of Object.entries(versions)) console.log(`${v ?? "(missing)"}  ${file}`);
if (distinct.size !== 1 || distinct.has(undefined)) {
  console.error("Versions differ. Change them together (release-please does this on release).");
  process.exit(1);
}

const [version] = distinct;
const security = new URL("../SECURITY.md", import.meta.url);
if (Number(version.split(".")[0]) >= 1 && existsSync(security) && /Kotiko is (?:still )?(?:before|pre-?) ?1\.0\b/i.test(readFileSync(security, "utf8"))) {
  console.error(`SECURITY.md still says Kotiko is before 1.0, but the version is ${version}. Update its supported versions.`);
  process.exit(1);
}
