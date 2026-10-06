// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// `npm test`: builds the site once, then runs every test file against that build.
// node --test runs each file in its own process, so letting each one build (tests/helpers.mjs
// ensureBuilt) started several builds into the same dist/ at once, and one of them could
// fail. SITE_SKIP_BUILD=1 with an existing dist/ skips the build here too, as CI does.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { DIST, SITE } from "../tests/helpers.mjs";

const env = { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" };
if (!(env.SITE_SKIP_BUILD === "1" && existsSync(DIST))) {
  const build = spawnSync("npm", ["run", "build"], { cwd: SITE, stdio: "inherit", env });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
const run = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), "tests/*.test.mjs"], {
  cwd: SITE,
  stdio: "inherit",
  env: { ...env, SITE_SKIP_BUILD: "1" },
});
process.exit(run.status ?? 1);
