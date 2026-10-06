// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Stands in for @devicefarmer/adbkit, which web-ext uses only for
// `web-ext run --target firefox-android`. The real package pulls in node-forge, which has a
// high-severity advisory with no fixed version (GHSA-86w9-cpqp-85rv). Kotiko runs web-ext
// only for `lint` and `sign`, which never load adbkit, so package.json's "overrides" points
// it here and node-forge leaves the dependency tree. Remove the override once node-forge
// ships a fix, or to run Kotiko on Firefox for Android through web-ext.
throw new Error(
  "Kotiko's dev setup replaces adbkit with a stub (node-forge advisory GHSA-86w9-cpqp-85rv). " +
    'Remove "@devicefarmer/adbkit" from "overrides" in package.json to use web-ext with Android.',
);
