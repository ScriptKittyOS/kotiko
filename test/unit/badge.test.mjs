// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 20 §5: the toolbar badge's precedence (lib/badge.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { requireExt } from "../helpers/load-script.mjs";

const { badgeFor, OFF_COLOR } = requireExt("lib/badge.js");

test("off everywhere shows off on every tab, including browser pages", () => {
  assert.deepEqual({ ...badgeFor({ enabled: false, url: "https://example.com/a" }) }, { text: "off", titleKey: "action_title_off", host: "example.com" });
  assert.equal(badgeFor({ enabled: false, url: "chrome://newtab/" }).text, "off");
});

test("a paused site shows off on its tabs only", () => {
  const s = { enabled: true, pausedHosts: ["en.wikipedia.org"] };
  assert.deepEqual({ ...badgeFor({ ...s, url: "https://en.wikipedia.org/wiki/Cat" }) }, { text: "off", titleKey: "action_title_paused", host: "en.wikipedia.org" });
  assert.equal(badgeFor({ ...s, url: "https://es.wikipedia.org/" }).text, "");
});

test("nothing otherwise, and nothing for pages without a host", () => {
  assert.equal(badgeFor({ enabled: true, pausedHosts: [], url: "https://example.com/" }).text, "");
  assert.equal(badgeFor({ enabled: true, pausedHosts: ["x"], url: "about:blank" }).text, "");
  assert.equal(badgeFor({}).text, "");
});

test("the off color is the spec's grey", () => {
  assert.equal(OFF_COLOR, "#6B6379");
});
