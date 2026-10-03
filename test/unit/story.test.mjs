// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The "Why Kotiko?" story has one source (slice 05 §1). docs/story/en.md is generated from
// it, every docs/story/<locale>.md is copied into extension/story/ unchanged, and the
// dashboard's About (slice 22) renders the copy. This fails when any copy drifts.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { check, extractStory, ROOT } from "../../scripts/sync-story.mjs";
import { requireExt } from "../helpers/load-script.mjs";

const Story = requireExt("lib/story.js");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("every copy of the story matches its single source", () => {
  assert.deepEqual(check(), [], "run: node scripts/sync-story.mjs");
});

test("the English story is slice 05 §1's block quote, word for word", () => {
  const paragraphs = extractStory(read("slices/05-brand-identity/SPEC.md"));
  assert.equal(paragraphs.length, 7);
  assert.match(paragraphs[0], /^In Russian, котик \(kotik\) means "kitty\."/);
  assert.equal(paragraphs.at(-1), "Look. The world is wonderful. It's just been waiting for us to understand each other.");
  const shipped = Story.parse(read("extension/story/en.md"));
  assert.deepEqual([shipped.title, shipped.paragraphs, shipped.placeholder], ["Why Kotiko?", paragraphs, false]);
});

test("the Spanish story is marked as a placeholder until the native writer's version", () => {
  const es = Story.parse(read("extension/story/es.md"));
  assert.equal(es.placeholder, true);
  assert.equal(es.title, "¿Por qué Kotiko?");
  // 05's brief: open with the Russian and Latin meanings; the Spanish one lands last.
  const reveal = es.paragraphs.find((p) => p.includes("мира"));
  assert.ok(reveal.indexOf("ruso") < reveal.indexOf("latín") && reveal.indexOf("latín") < reveal.indexOf("español"), reveal);
});

test("the dashboard loads the interface language's story, else English", async () => {
  Story._setLoader(async (l) => {
    if (l === "fr") throw new Error("none");
    return read(`extension/story/${l}.md`);
  });
  assert.equal((await Story.load("es")).title, "¿Por qué Kotiko?");
  assert.equal((await Story.load("fr")).title, "Why Kotiko?");
});
