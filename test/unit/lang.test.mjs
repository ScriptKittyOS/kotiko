// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 08: extension/lib/lang.js against the shared fixtures (server/test/kotiko/
// lang_test.exs reads the same files), plus the display names the extension gets from
// Intl.DisplayNames.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, requireExt } from "../helpers/load-script.mjs";

const spec = requireExt("spec/spec.js");
const Lang = requireExt("lib/lang.js").createLang(spec);
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "spec/fixtures", name), "utf8"));
const tags = fixture("lang-tags.json");
const bases = fixture("base-tags.json");

test("lang-tags.json has at least 80 cases and base-tags.json at least 30", () => {
  assert.ok(tags.cases.length >= 80);
  assert.ok(bases.cases.length >= 30);
});

describe("canonical (lang-tags.json)", () => {
  for (const c of tags.cases) {
    test(`${JSON.stringify(c.input)}: ${c.note}`, () => {
      if (c.error) assert.deepEqual(Lang.canonical(c.input), { ok: false, code: c.error });
      else {
        assert.deepEqual(Lang.canonical(c.input), { ok: true, tag: c.tag, known: c.known });
        assert.equal(Lang.known(c.tag), c.known);
      }
    });
  }
});

describe("checkScript (lang-tags.json)", () => {
  for (const c of tags.script_checks) {
    test(`${c.tag} ${c.native}: ${c.note}`, () => {
      const expected = c.error ? { ok: false, code: c.error } : { ok: true, tag: c.result };
      assert.deepEqual(Lang.checkScript(c.tag, c.native), expected);
    });
  }
});

test("names and endonyms from the data (lang-tags.json)", () => {
  for (const { tag, locale, name } of tags.names) assert.equal(Lang.dataName(tag, locale), name, `${tag} ${locale}`);
  for (const { tag, endonym } of tags.endonyms) assert.equal(Lang.endonym(tag), endonym, tag);
});

describe("baseTagOf and sameBase (base-tags.json)", () => {
  for (const c of bases.cases) {
    test(`base of ${JSON.stringify(c.input)} is ${c.base}`, () => assert.equal(Lang.baseTagOf(c.input), c.base));
  }
  test("sameBase, both ways", () => {
    for (const { a, b, same } of bases.same_base) {
      assert.equal(Lang.sameBase(a, b), same, `${a} / ${b}`);
      assert.equal(Lang.sameBase(b, a), same, `${b} / ${a}`);
    }
  });
});

describe("display names (slice 08 section 4)", () => {
  test("Intl.DisplayNames in the interface language, never the model's name", () => {
    assert.equal(Lang.displayName("yue", "en"), "Cantonese");
    assert.equal(Lang.displayName("yue", "es"), "cantonés");
    assert.equal(Lang.displayName("zh-Hant", "en"), "Traditional Chinese");
    assert.equal(Lang.displayName("pt-BR", "es"), "portugués de Brasil");
    assert.equal(Lang.displayName("ja", "es"), "japonés");
  });
  test("falls back to the data for tags Intl can't name", () => {
    assert.equal(Lang.displayName("x-dothraki", "en"), "Dothraki");
    assert.equal(Lang.displayName("not a tag", "en"), null);
  });
});

test("the acceptance cases of slice 08", () => {
  const tag = (i) => Lang.canonical(i).tag;
  assert.equal(tag("zh-TW"), "zh-Hant");
  assert.equal(tag("cmn"), "zh");
  assert.equal(tag("iw"), "he");
  assert.equal(tag("i-klingon"), "tlh");
  assert.equal(tag("pt-BR"), "pt-BR");
  assert.equal(tag("de-AT"), "de");
  assert.equal(tag("ar-EG"), "arz");
  assert.equal(tag("en"), "en");
  assert.equal(tag("en-GB"), "en-GB");
  assert.equal(Lang.baseTagOf("es-PR"), "es");
  assert.equal(Lang.baseTagOf("zh-TW"), "zh-Hant");
  assert.equal(Lang.baseTagOf("zh-CN"), "zh-Hans");
  assert.equal(Lang.baseTagOf("pt-BR"), "pt-BR");
  assert.equal(Lang.baseTagOf("en-US"), "en");
  assert.deepEqual(Lang.checkScript("sr", "hvala"), { ok: true, tag: "sr-Latn" });
  assert.deepEqual(Lang.checkScript("ru", "spasibo"), { ok: false, code: "script_mismatch" });
  assert.deepEqual(Lang.checkScript("ja", "ありがとう"), { ok: true, tag: "ja" });
});
