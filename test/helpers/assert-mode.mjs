// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Assertion mode (OpenSSF dynamic_analysis_enable_assertions). `npm test` and
// `npm run coverage` load this file first (node --import), so every test process runs the
// extension's invariant checks: lib/matcher.js checks every scan's matches, lib/backup.js
// every restore plan, lib/validate-words.js every filtered word list, and they throw when
// one doesn't hold. load-script.mjs passes the flag on to the jsdom windows and vm contexts
// the extension's scripts run in. The shipped extension never sets it, and `npm run perf`
// doesn't load this file, so the budgets measure the code as it ships.
globalThis.__KOTIKO_ASSERT__ = true;
