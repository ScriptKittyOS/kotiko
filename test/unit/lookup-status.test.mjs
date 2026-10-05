// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 10: the free lookups left, as the popup and the dashboard word them
// (extension/lib/lookup-status.js). Lookup errors are lib/errors.js's (test/unit/errors.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EXT_DIR, requireExt } from "../helpers/load-script.mjs";

const S = requireExt("lib/lookup-status.js");
const messages = (l) => JSON.parse(fs.readFileSync(path.join(EXT_DIR, "_locales", l, "messages.json"), "utf8"));
const NOW = Date.UTC(2026, 9, 2, 15, 0);
const RESETS = "2026-10-03T00:00:00.000Z";
const status = (remaining, resets_at = RESETS) => ({ provider: "openrouter", quota: { used: 50 - remaining, limit: 50, remaining, resets_at, estimated: false } });

// English is the one complete locale; others fall back to it per key (DECISIONS 2026-10-05).
test("every key it can return exists in en (plural keys as _one and _other)", () => {
  for (const l of ["en"]) {
    const m = messages(l);
    for (const key of S.KEYS) assert.ok(key in m || (`${key}_one` in m && `${key}_other` in m), `${l}: ${key}`);
  }
});

test("the quota line: at 20 or fewer, none at 0 with the reset time, nothing when unknown or stale", () => {
  assert.equal(S.quotaLine(status(21), { now: NOW }), null);
  assert.deepEqual(S.quotaLine(status(20), { now: NOW }), { key: "popup_lookups_left", params: { count: 20 } });
  assert.deepEqual(S.quotaLine(status(1), { now: NOW }), { key: "popup_lookups_left", params: { count: 1 } });
  const none = S.quotaLine(status(0), { now: NOW, locale: "en-GB" });
  assert.equal(none.key, "popup_lookups_none");
  assert.match(none.params.time, /^\d{2}:\d{2}$/);
  assert.deepEqual(S.quotaLine(status(0, null), { now: NOW }), { key: "popup_lookups_none_today", params: {} });
  assert.equal(S.quotaLine(status(3, "2026-10-02T00:00:00.000Z"), { now: NOW }), null, "numbers from before the reset");
  assert.equal(S.quotaLine({ provider: "localhost", quota: null }, { now: NOW }), null);
  assert.equal(S.quotaLine(null), null);
});

test("no lookup message names a model, an API or a status number", () => {
  for (const l of ["en", "es"]) {
    const m = messages(l);
    for (const key of S.KEYS) {
      for (const k of [key, `${key}_one`, `${key}_other`]) {
        if (m[k]) assert.doesNotMatch(m[k].message, /model|modelo|\bAPI\b|\bLLM\b|token|\b[45]\d\d\b/i, `${l}/${k}`);
      }
    }
  }
});
