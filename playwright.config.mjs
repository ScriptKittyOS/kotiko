// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// End-to-end tests: the unpacked extension in Playwright's bundled Chromium, against the
// local fixture server (test/helpers/fixture-server.mjs). The browser is launched by the
// `context` fixture in test/e2e/fixtures.mjs, which also blocks and fails on any request
// that leaves localhost.
import { defineConfig } from "@playwright/test";

const CI = !!process.env.CI;

export default defineConfig({
  // test/e2e, and the security review's proofs turned into regression tests (slice 54 §6).
  testDir: "test",
  testMatch: ["e2e/**/*.spec.mjs", "security/**/*.spec.mjs"],
  globalSetup: "./test/e2e/global-setup.mjs",
  outputDir: "test-results",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // One fake server holds the word list and behaviour switches, so tests run one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
});
