// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

import js from "@eslint/js";
import globals from "globals";
import nounsanitized from "eslint-plugin-no-unsanitized";
import stylistic from "@stylistic/eslint-plugin";

// Words, notes and model answers are untrusted text: the extension builds DOM with
// textContent and DOM methods, never HTML strings (research 03 E1).
const NO_HTML_STRINGS = ["innerHTML", "outerHTML", "insertAdjacentHTML"].map((property) => ({
  property,
  message: "Build DOM with textContent and DOM methods; never parse strings as HTML.",
}));

// Beyond the recommended set: rules that catch real mistakes (loose equality, shadowed
// names, unused arguments, eval and its relatives) and keep the code in one modern idiom.
// The whole code base passes them; see docs/CODING_STANDARDS.md.
const STRICTER = {
  "array-callback-return": "error",
  "block-scoped-var": "error",
  curly: ["error", "multi-line"],
  "default-case-last": "error",
  "dot-notation": "error",
  // `x == null` is the one loose comparison allowed: it means null or undefined.
  eqeqeq: ["error", "always", { null: "ignore" }],
  "guard-for-in": "error",
  "logical-assignment-operators": "error",
  "no-caller": "error",
  "no-constructor-return": "error",
  "no-else-return": ["error", { allowElseIf: false }],
  "no-eval": "error",
  "no-extend-native": "error",
  "no-implicit-coercion": ["error", { allow: ["!!"] }],
  "no-implied-eval": "error",
  "no-inner-declarations": "error",
  "no-iterator": "error",
  "no-labels": "error",
  "no-lone-blocks": "error",
  "no-lonely-if": "error",
  "no-loop-func": "error",
  "no-multi-str": "error",
  "no-new": "error",
  "no-new-func": "error",
  "no-new-wrappers": "error",
  "no-object-constructor": "error",
  "no-octal-escape": "error",
  "no-param-reassign": "error",
  "no-proto": "error",
  "no-return-assign": "error",
  "no-self-compare": "error",
  "no-shadow": "error",
  "no-template-curly-in-string": "error",
  "no-throw-literal": "error",
  "no-unassigned-vars": "error",
  "no-unneeded-ternary": "error",
  "no-unreachable-loop": "error",
  "no-unused-expressions": "error",
  "no-unused-vars": ["error", { args: "all", argsIgnorePattern: "^_", caughtErrors: "all", caughtErrorsIgnorePattern: "^_" }],
  "no-useless-call": "error",
  "no-useless-computed-key": "error",
  "no-useless-concat": "error",
  "no-useless-constructor": "error",
  "no-useless-rename": "error",
  "no-useless-return": "error",
  "no-var": "error",
  "object-shorthand": "error",
  "operator-assignment": "error",
  "prefer-arrow-callback": "error",
  "prefer-const": ["error", { destructuring: "all" }],
  "prefer-exponentiation-operator": "error",
  "prefer-numeric-literals": "error",
  "prefer-object-has-own": "error",
  "prefer-object-spread": "error",
  "prefer-promise-reject-errors": "error",
  "prefer-regex-literals": "error",
  "prefer-rest-params": "error",
  "prefer-spread": "error",
  radix: "error",
  "symbol-description": "error",
  "unicode-bom": "error",
  yoda: "error",
};

// The layout the code already follows, written down so a tool checks it: two-space
// indent, double quotes, semicolons, trailing commas on multi-line lists, a ternary's `?`
// and `:` at the start of a continued line, and the usual spacing. `eslint --fix` applies
// it. There is no line-length limit: lines are as long as reads well.
const LAYOUT = {
  "@stylistic/array-bracket-newline": ["error", "consistent"],
  "@stylistic/array-bracket-spacing": ["error", "never"],
  "@stylistic/arrow-parens": ["error", "always"],
  "@stylistic/arrow-spacing": "error",
  "@stylistic/block-spacing": "error",
  "@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: true }],
  "@stylistic/comma-dangle": ["error", "always-multiline"],
  "@stylistic/comma-spacing": "error",
  "@stylistic/comma-style": "error",
  "@stylistic/computed-property-spacing": "error",
  "@stylistic/dot-location": ["error", "property"],
  "@stylistic/eol-last": "error",
  "@stylistic/function-call-spacing": "error",
  "@stylistic/generator-star-spacing": ["error", "after"],
  "@stylistic/indent": ["error", 2, { flatTernaryExpressions: true }],
  "@stylistic/key-spacing": "error",
  "@stylistic/keyword-spacing": "error",
  "@stylistic/linebreak-style": ["error", "unix"],
  "@stylistic/new-parens": "error",
  "@stylistic/no-extra-semi": "error",
  "@stylistic/no-floating-decimal": "error",
  "@stylistic/no-mixed-spaces-and-tabs": "error",
  "@stylistic/no-multi-spaces": "error",
  "@stylistic/no-multiple-empty-lines": ["error", { max: 1, maxBOF: 0, maxEOF: 0 }],
  "@stylistic/no-tabs": "error",
  "@stylistic/no-trailing-spaces": "error",
  "@stylistic/no-whitespace-before-property": "error",
  "@stylistic/object-curly-newline": ["error", { consistent: true }],
  "@stylistic/object-curly-spacing": ["error", "always"],
  "@stylistic/operator-linebreak": ["error", "after", { overrides: { "?": "before", ":": "before" } }],
  "@stylistic/padded-blocks": ["error", "never"],
  "@stylistic/quote-props": ["error", "as-needed"],
  "@stylistic/quotes": ["error", "double", { avoidEscape: true, allowTemplateLiterals: "avoidEscape" }],
  "@stylistic/rest-spread-spacing": "error",
  "@stylistic/semi": ["error", "always"],
  "@stylistic/semi-spacing": "error",
  "@stylistic/space-before-blocks": "error",
  "@stylistic/space-before-function-paren": ["error", { anonymous: "always", named: "never", asyncArrow: "always" }],
  "@stylistic/space-in-parens": "error",
  "@stylistic/space-infix-ops": "error",
  "@stylistic/space-unary-ops": "error",
  "@stylistic/spaced-comment": ["error", "always"],
  "@stylistic/switch-colon-spacing": "error",
  "@stylistic/template-curly-spacing": "error",
  "@stylistic/wrap-iife": ["error", "inside"],
  "@stylistic/yield-star-spacing": ["error", "after"],
};

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
  { rules: STRICTER },
  {
    // extension/spec/spec.js is generated (spec/tools/sync-extension.mjs) as compact JSON.
    ignores: ["extension/spec/spec.js"],
    plugins: { "@stylistic": stylistic },
    rules: LAYOUT,
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
    // destructure their first argument, even when it's empty. Such a callback can't see
    // the test's variables, so it takes them as an argument under the same name
    // (`page.evaluate((id) => ..., id)`): shadowing is the idiom there, not a mistake.
    files: ["test/e2e/**/*.mjs", "test/visual/**/*.mjs", "test/helpers/axe.mjs", "test/helpers/a11y-checks.mjs", "site/tests/**/*.spec.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser, ...globals.webextensions } },
    rules: {
      "no-empty-pattern": ["error", { allowObjectPatternsAsParameters: true }],
      "no-shadow": "off",
    },
  },
];
