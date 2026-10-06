// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The docs site's browser checks (slice 44 §7): every built page in Chromium, light and
// dark, with axe and a log of every request. Build first (`npm run build`); the tests serve
// dist/ themselves on 127.0.0.1 and block anything else.
import { defineConfig } from "@playwright/test";

const CI = !!process.env.CI;

export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.spec.mjs",
  outputDir: "test-results",
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
  use: { browserName: "chromium" },
});
