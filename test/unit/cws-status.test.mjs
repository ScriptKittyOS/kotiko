// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 30 §4: the daily Chrome Web Store status line on the release page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { END, sameStatus, START, summarize, withStatus } from "../../scripts/cws-status.mjs";

const DAY = new Date("2026-11-03T06:00:00Z");

test("a version in review, with the previous one live", () => {
  const line = summarize({
    submittedItemRevisionStatus: { state: "PENDING_REVIEW", distributionChannels: [{ crxVersion: "0.3.0", deployPercentage: 100 }] },
    publishedItemRevisionStatus: { state: "PUBLISHED", distributionChannels: [{ crxVersion: "0.2.0", deployPercentage: 100 }] },
  }, "0.3.0", DAY);
  assert.equal(line, "**Chrome Web Store** (checked 2026-11-03): submitted: 0.3.0 in review; live: 0.2.0 published.");
});

test("the release's version live, a staged rollout, a rejection, a takedown", () => {
  assert.match(summarize({ publishedItemRevisionStatus: { state: "PUBLISHED", distributionChannels: [{ crxVersion: "0.3.0", deployPercentage: 100 }] } }, "0.3.0", DAY), /: 0\.3\.0 is live\. live: 0\.3\.0 published\.$/);
  assert.match(summarize({ publishedItemRevisionStatus: { state: "PUBLISHED", distributionChannels: [{ crxVersion: "0.3.0", deployPercentage: 10 }] } }, "0.3.0", DAY), /published to 10 % of users/);
  assert.match(summarize({ submittedItemRevisionStatus: { state: "REJECTED", distributionChannels: [{ crxVersion: "0.3.0" }] } }, "0.3.0", DAY), /submitted: 0\.3\.0 rejected/);
  assert.match(summarize({ takenDown: true, warned: true }, "0.3.0", DAY), /\*\*taken down\*\*.*policy warning/);
  assert.match(summarize({}, "0.3.0", DAY), /no status yet\.$/);
  assert.match(summarize({ submittedItemRevisionStatus: { state: "SOMETHING_NEW" } }, "0.3.0", DAY), /submitted: something new/);
});

test("the status block is added once, then replaced in place", () => {
  const body = "Notes.\n\n---\nFooter\n";
  const once = withStatus(body, "first");
  assert.equal(once, `Notes.\n\n---\nFooter\n\n${START}\nfirst\n${END}\n`);
  const twice = withStatus(once, "second");
  assert.equal(twice, once.replace("first", "second"));
  assert.equal(twice.split(START).length, 2);
});

test("only a change of status counts as a change, not the date", () => {
  const a = withStatus("x", "**Chrome Web Store** (checked 2026-11-02): submitted: 0.3.0 in review.");
  const b = withStatus(a, "**Chrome Web Store** (checked 2026-11-03): submitted: 0.3.0 in review.");
  const c = withStatus(a, "**Chrome Web Store** (checked 2026-11-03): 0.3.0 is live. live: 0.3.0 published.");
  assert.equal(sameStatus(a, b), true);
  assert.equal(sameStatus(a, c), false);
});
