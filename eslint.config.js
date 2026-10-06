// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

import js from "@eslint/js";
import globals from "globals";
import nounsanitized from "eslint-plugin-no-unsanitized";

// Words, notes and model answers are untrusted text: the extension builds DOM with
// textContent and DOM methods, never HTML strings (research 03 E1).
const NO_HTML_STRINGS = ["innerHTML", "outerHTML", "insertAdjacentHTML"].map((property) => ({
  property,
  message: "Build DOM with textContent and DOM methods; never parse strings as HTML.",
}));

export default [
  {
    ignores: [
      "node_modules/",
      "server/",
      "test-results/",
      "playwright-report/",
      "blob-report/",
      "test/fixtures/vendor/",
      // The docs site's build output and caches (slice 44).
      "site/dist/",
      "site/.astro/",
      "site/test-results/",
      "site/playwright-report/",
    ],
  },
  js.configs.recommended,
  {
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  {
    // Extension code runs as classic scripts in the browser (content scripts, the
    // background worker, the popup).
    files: ["extension/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "script",
      globals: { ...globals.browser, ...globals.webextensions },
    },
    plugins: { "no-unsanitized": nounsanitized },
    rules: {
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",
      "no-restricted-properties": ["error", ...NO_HTML_STRINGS],
    },
  },
  {
    // The background script runs as a service worker in Chrome (importScripts) and as an
    // event page in Firefox.
    files: ["extension/background.js"],
    languageOptions: { globals: { importScripts: "readonly" } },
  },
  {
    // Pure modules also export themselves for Node tests when `module` exists.
    files: ["extension/lib/**/*.js", "extension/bulk/**/*.js", "extension/ui/**/*.js", "extension/spec/**/*.js", "extension/content/engine.js"],
    languageOptions: { globals: { module: "readonly" } },
  },
  {
    files: ["**/*.mjs", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
  {
    // Callbacks passed to page.evaluate() run in the browser. Playwright fixtures must
    // destructure their first argument, even when it's empty.
    files: ["test/e2e/**/*.mjs", "test/visual/**/*.mjs", "test/helpers/axe.mjs", "test/helpers/a11y-checks.mjs", "site/tests/**/*.spec.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser, ...globals.webextensions } },
    rules: { "no-empty-pattern": ["error", { allowObjectPatternsAsParameters: true }] },
  },
];
