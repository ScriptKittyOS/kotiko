// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Milestones fire once in a lifetime; page milestones at most one a day (slice 32 §4),
// claimed through extension/lib/celebrations.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { requireExt } from "../helpers/load-script.mjs";

const C = requireExt("lib/celebrations.js");
const DAY = 86_400_000;
const NOON = new Date(2026, 9, 2, 12).getTime();

test("vocab:first is claimed once, ever", () => {
  const a = C.claim(null, "vocab:first", { now: NOON });
  assert.equal(a.claimed, true);
  assert.equal(a.next.done["vocab:first"], NOON);
  assert.equal(a.next.lastPageAt, null, "vocabulary milestones don't use the page's daily limit");
  const b = C.claim(a.next, "vocab:first", { now: NOON + 5 * DAY });
  assert.deepEqual([b.claimed, b.reason], [false, "done"]);
});

test("page milestones: one a day, anywhere", () => {
  const a = C.claim(null, "page:es:all:50", { now: NOON });
  assert.equal(a.claimed, true);
  const b = C.claim(a.next, "page:first-swap", { now: NOON + 3600_000 });
  assert.deepEqual([b.claimed, b.reason], [false, "today"]);
  const c = C.claim(a.next, "page:first-swap", { now: NOON + DAY });
  assert.equal(c.claimed, true);
  assert.equal(C.claim(a.next, "vocab:first", { now: NOON + 60_000 }).claimed, true, "the first word isn't limited by a page milestone");
});

test("keys are checked; done marks are silent and never move", () => {
  assert.equal(C.claim(null, "nope", { now: NOON }).reason, "invalid");
  const s = C.markDone({ done: { "vocab:first": 1 } }, ["vocab:first", "page:first-swap"], NOON);
  assert.deepEqual(s.done, { "vocab:first": 1, "page:first-swap": NOON });
});

test("celebrations are on by default; one switch turns them off", () => {
  assert.equal(C.enabled(undefined), true);
  assert.equal(C.enabled({}), true);
  assert.equal(C.enabled({ celebrations: false }), false);
});
