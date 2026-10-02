// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Fails when the extension, the server and the release manifest disagree on the version.
// No dependencies, so CI can run it before `npm ci`.
import { readFileSync } from "node:fs";

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
