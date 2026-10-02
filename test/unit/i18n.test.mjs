// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 50 §8 checks for the locale files and the t() helper (lib/i18n.js).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createI18n, LOCALES, readMessages } from "../helpers/fake-i18n.mjs";
import { manifest, readExt } from "../helpers/load-script.mjs";
import vm from "node:vm";

const LAUNCH = ["en", "es"];
const placeholdersIn = (message) => [...message.matchAll(/\$([A-Za-z0-9_]+)\$/g)].map((m) => m[1].toLowerCase()).sort();

// Loads lib/i18n.js against a fake chrome.i18n in its own context.
function loadI18n(locale) {
  const ctx = vm.createContext({ chrome: { i18n: createI18n(locale) }, Intl, console });
  vm.runInContext(readExt("lib/i18n.js"), ctx);
  return ctx.KotikoI18n;
}

describe("locale files", () => {
  test("the launch locales ship", () => {
    for (const l of LAUNCH) assert.ok(LOCALES.includes(l), `_locales/${l} is missing`);
    assert.equal(manifest().default_locale, "en");
  });

  test("en and es have exactly the same keys", () => {
    const en = Object.keys(readMessages("en")).sort();
    for (const l of LOCALES) assert.deepEqual(Object.keys(readMessages(l)).sort(), en, `${l} keys differ from en`);
  });

  test("every key has a message and a description for translators", () => {
    for (const l of LOCALES) {
      for (const [key, entry] of Object.entries(readMessages(l))) {
        assert.equal(typeof entry.message, "string", `${l}/${key}`);
        assert.ok(entry.message.length > 0, `${l}/${key} is empty`);
        assert.ok(entry.description?.length > 0, `${l}/${key} has no description`);
      }
    }
  });

  test("placeholders are declared, named the same in every locale, and filled by name", () => {
    const en = readMessages("en");
    for (const l of LOCALES) {
      for (const [key, entry] of Object.entries(readMessages(l))) {
        const used = placeholdersIn(entry.message);
        const declared = Object.keys(entry.placeholders ?? {}).sort();
        assert.deepEqual([...new Set(used)], declared, `${l}/${key}: $NAME$ in the message must match its placeholders`);
        for (const [name, p] of Object.entries(entry.placeholders ?? {})) {
          assert.equal(p.content, `{${name}}`, `${l}/${key}: placeholder ${name} must have content "{${name}}"`);
        }
        // A translation may drop a placeholder (Spanish "one" forms say "Tu palabra"), but
        // never invent one.
        const enNames = Object.keys(en[key].placeholders ?? {});
        for (const name of declared) assert.ok(enNames.includes(name), `${l}/${key}: $${name.toUpperCase()}$ isn't in en`);
      }
    }
  });

  test("plural keys come in complete sets for each locale's plural rules", () => {
    for (const l of LOCALES) {
      const keys = Object.keys(readMessages(l));
      const bases = new Set(keys.filter((k) => /_(zero|one|two|few|many|other)$/.test(k)).map((k) => k.replace(/_(zero|one|two|few|many|other)$/, "")));
      const categories = new Intl.PluralRules(l).resolvedOptions().pluralCategories;
      for (const base of bases) {
        for (const c of categories) {
          // Every category falls back to _other; the categories a locale uses must exist.
          if (c === "other" || c === "one") assert.ok(keys.includes(`${base}_${c}`), `${l}: ${base}_${c} is missing`);
        }
      }
    }
  });

  test("ui_locale names its own folder", () => {
    for (const l of LOCALES) assert.equal(readMessages(l).ui_locale.message, l);
  });

  test("no interface string says sync, token or known (20 acceptance; 05 §3 rule 7)", () => {
    for (const l of LOCALES) {
      for (const [key, entry] of Object.entries(readMessages(l))) {
        assert.doesNotMatch(entry.message, /sync|token|known|\bAPI\b|\bLLM\b|\.env/i, `${l}/${key}`);
      }
    }
  });

  test("the manifest's name and description come from the locale files", () => {
    const m = manifest();
    assert.equal(m.name, "__MSG_extName__");
    assert.equal(m.description, "__MSG_extDescription__");
    for (const l of LOCALES) {
      const msgs = readMessages(l);
      assert.ok(msgs.extName && msgs.extDescription, l);
      assert.ok(msgs.extName.message.length <= 45 && msgs.extDescription.message.length <= 132, `${l}: store limits`);
    }
  });

  test("every key the dashboard uses exists", () => {
    const en = readMessages("en");
    const src = readExt("dashboard.html") + readExt("dashboard.js") + readExt("lib/dashboard-model.js");
    const used = new Set([
      ...[...src.matchAll(/data-i18n(?:-[a-z-]+)?="([a-z_A-Z]+)"/g)].map((m) => m[1]),
      ...[...src.matchAll(/\b(?:t|parts)\("([a-zA-Z_]+)"/g)].map((m) => m[1]),
      ...[...src.matchAll(/"(dash_[a-z_]+)"/g)].map((m) => m[1]),
    ]);
    assert.deepEqual([...used].filter((k) => !(k in en) && !(`${k}_other` in en)), []);
  });

  test("every key the popup uses exists", () => {
    const en = readMessages("en");
    const html = readExt("popup.html");
    const js = readExt("popup.js") + readExt("background.js");
    const used = new Set([
      ...[...html.matchAll(/data-i18n(?:-[a-z-]+)?="([a-z_A-Z]+)"/g)].map((m) => m[1]),
      ...[...js.matchAll(/\bt\("([a-zA-Z_]+)"/g)].map((m) => m[1]),
      ...[...js.matchAll(/parts\("([a-zA-Z_]+)"/g)].map((m) => m[1]),
      ...[...js.matchAll(/"((?:error|popup|settings|add|undo|action|badge)_[a-z_]+)"/g)].map((m) => m[1]),
    ]);
    const exists = (k) => k in en || `${k}_other` in en;
    const missing = [...used].filter((k) => !exists(k) && !/_(shown|hidden)$/.test(k));
    assert.deepEqual(missing, []);
  });
});

describe("KotikoI18n.t", () => {
  test("fills named placeholders", () => {
    const { t } = loadI18n("en");
    assert.equal(t("popup_this_page", { host: "example.com" }), "This page · example.com");
    assert.equal(t("add_looking_up", { text: "sobaka" }), "Looking up sobaka…");
  });

  test("chooses plural keys with Intl.PluralRules and formats the count", () => {
    const en = loadI18n("en");
    assert.equal(en.t("popup_word_count", { count: 1 }), "1 word");
    assert.equal(en.t("popup_word_count", { count: 2 }), "2 words");
    assert.equal(en.t("popup_word_count", { count: 12345 }), "12,345 words");
    const es = loadI18n("es");
    assert.equal(es.t("popup_word_count", { count: 1 }), "1 palabra");
    assert.equal(es.t("popup_word_count", { count: 2 }), "2 palabras");
    assert.equal(es.t("popup_word_count", { count: 0 }), "0 palabras");
  });

  test("follows the browser's language", () => {
    const es = loadI18n("es");
    assert.equal(es.locale(), "es");
    assert.equal(es.t("popup_languages_title"), "Idiomas");
    assert.equal(es.t("popup_this_page", { host: "elnuevodia.com" }), "Esta página · elnuevodia.com");
  });

  test("Kotiko's language (50 §8): a shipped locale overrides the browser's, missing keys fall back to English", async () => {
    const ctx = vm.createContext({
      chrome: { i18n: createI18n("en"), storage: { sync: { get: async () => ({ ui: { uiLang: "es" } }) } } },
      Intl,
      console,
    });
    vm.runInContext(readExt("lib/i18n.js"), ctx);
    const i = ctx.KotikoI18n;
    const es = readMessages("es");
    delete es.popup_languages_title;
    i._setLoader(async (l) => (l === "es" ? es : readMessages(l)));
    assert.equal(await i.preference(), "es");
    assert.equal(await i.loadPreference(), true);
    assert.equal(i.locale(), "es");
    assert.equal(i.dir(), "ltr");
    assert.equal(i.t("dash_title"), "Tus palabras");
    assert.equal(i.t("popup_word_count", { count: 1234 }), "1234 palabras");
    assert.equal(i.languageName("ja"), "japonés");
    assert.equal(i.t("popup_languages_title"), "Languages", "a missing key falls back to English");
    assert.equal(i.t("popup_this_page", { host: "a.com" }), "Esta página · a.com", "placeholders render like the browser's");
    assert.equal(await i.useLocale("auto"), true);
    assert.equal(i.t("dash_title"), "Your words");
    assert.equal(await i.useLocale("xx"), false, "an unshipped locale is the browser's");
    assert.deepEqual([...i.shipped()], ["en", "es"]);
  });

  test("a missing key shows the key, so gaps are visible", () => {
    assert.equal(loadI18n("en").t("no_such_key"), "no_such_key");
  });

  test("parts keeps nodes in their places", () => {
    const { parts } = loadI18n("en");
    const node = { node: "собака" };
    const out = parts("add_created_plain", { native: node, gloss: "dog", lang: "Russian" });
    assert.deepEqual(Array.from(out), ["Added ", node, " = ", "dog", " · ", "Russian"]);
  });

  test("language names follow the interface language; endonyms are capitalized for chips", () => {
    const en = loadI18n("en");
    const es = loadI18n("es");
    assert.equal(en.languageName("ja"), "Japanese");
    assert.equal(es.languageName("ja"), "japonés");
    assert.equal(en.endonym("ru"), "Русский");
    assert.equal(en.endonym("es"), "Español");
    assert.equal(en.endonym("ja"), "日本語");
    assert.equal(en.languageName("qqq-zz-unknown"), null);
  });
});
