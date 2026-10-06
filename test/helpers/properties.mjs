// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Property-based tests (OpenSSF dynamic_analysis) with fast-check: each property runs on
// 100 generated inputs per test run, a new random seed each time, so CI keeps exploring.
// A failure prints the seed and the shrunk counterexample; to replay it exactly:
//
//   FC_SEED=<seed> FC_PATH=<path> node --test --import ./test/helpers/assert-mode.mjs test/unit/properties/<file>
//
// FC_NUM_RUNS=<n> runs more (or fewer) inputs, for a longer local hunt.
import fc from "fast-check";

const env = (name) => (process.env[name] ? process.env[name] : undefined);
fc.configureGlobal({
  numRuns: Number(env("FC_NUM_RUNS") ?? 100),
  ...(env("FC_SEED") ? { seed: Number(env("FC_SEED")) } : {}),
  ...(env("FC_PATH") ? { path: env("FC_PATH") } : {}),
});

export { fc };
