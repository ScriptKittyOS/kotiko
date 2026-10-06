// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Kotiko's interface text (slice 50 §8). Every user-facing string is a key in
// extension/_locales/<locale>/messages.json, read with the browser's i18n API, so the
// interface follows the browser's language (English when it has no translation).
//
//   KotikoI18n.t("popup_this_page", { host: "example.com" })   -> "This page · example.com"
//   KotikoI18n.t("words_count", { count: 3 })                  -> "3 words" (plural keys)
//   KotikoI18n.parts("add_created_plain", { native: bdiNode })  -> ["Added ", bdiNode, " = …"]
//   KotikoI18n.apply(document)                                 -> fills data-i18n* attributes
//
// Placeholders are named: a message says "This page · $HOST$" and declares
// `"placeholders": {"host": {"content": "{host}"}}`, so the browser returns "{host}" and
// this helper fills it by name. Translators can reorder placeholders freely.
// Plurals: `t(key, {count})` looks up `<key>_<category>` with Intl.PluralRules in the
// interface locale (`_one`, `_other`, plus `_zero`, `_few`, `_many` where a locale needs
// them), falling back to `<key>_other`.
//
// The interface-language override (50 §8, "Kotiko's language" in the dashboard's settings,
// stored as `ui.uiLang` in storage.sync, of which the background keeps the copy pages read in
// storage.local): `await KotikoI18n.loadPreference()` reads it and,
// when it names a shipped locale, fetches `_locales/<locale>/messages.json` once and looks
// keys up itself (the browser's getMessage can't switch at runtime); missing keys fall
// back to English. Pages that await it before rendering follow the setting; the rest
// follow the browser.
(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  // Locales with a folder in _locales.
  const SHIPPED = ["en", "es"];
  const RTL = new Set(["ar", "he", "fa", "ur", "ps", "yi", "dv", "ckb", "sd", "ug"]);

  // { locale, messages, fallback } while an override is active.
  let override = null;
  let loader = async (tag) => {
    const res = await fetch(ext.runtime.getURL(`_locales/${tag}/messages.json`));
    if (!res.ok) throw new Error(`No messages for ${tag}`);
    return res.json();
  };

  // A messages.json entry as the browser renders it: $NAME$ becomes its placeholder's
  // content, "$$" a dollar sign.
  function render(entry) {
    return String(entry.message ?? "")
      .replace(/\$([A-Za-z0-9_@]+)\$/g, (m, name) => entry.placeholders?.[name.toLowerCase()]?.content ?? m)
      .replace(/\$\$/g, "$");
  }

  function raw(key) {
    if (override) {
      if (key === "@@bidi_dir") return RTL.has(override.locale.split("-")[0]) ? "rtl" : "ltr";
      const entry = override.messages[key] ?? override.fallback[key];
      return entry ? render(entry) : "";
    }
    try {
      return ext?.i18n?.getMessage(key) || "";
    } catch {
      return "";
    }
  }

  // The locale of the strings actually shown (the `ui_locale` message of the translation
  // the browser picked), so plurals, numbers and language names match the text around them.
  let cachedLocale = null;
  function locale() {
    if (cachedLocale) return cachedLocale;
    const tag = raw("ui_locale") || "en";
    try {
      cachedLocale = Intl.getCanonicalLocales(tag.replace(/_/g, "-"))[0];
    } catch {
      cachedLocale = "en";
    }
    return cachedLocale;
  }

  function dir() {
    return raw("@@bidi_dir") === "rtl" ? "rtl" : "ltr";
  }

  let numberFormat = null;
  function formatNumber(n) {
    numberFormat ??= new Intl.NumberFormat(locale());
    return numberFormat.format(n);
  }

  function resolveKey(key, params) {
    if (params && typeof params.count === "number") {
      const category = new Intl.PluralRules(locale()).select(params.count);
      if (raw(`${key}_${category}`)) return `${key}_${category}`;
      if (raw(`${key}_other`)) return `${key}_other`;
    }
    return key;
  }

  const PLACEHOLDER = /\{([a-z][a-z0-9_]*)\}/g;

  function display(name, value) {
    if (name === "count" && typeof value === "number") return formatNumber(value);
    return value;
  }

  // The message as text. A missing key returns the key itself, so gaps show up in review
  // and tests instead of rendering as nothing.
  function t(key, params = {}) {
    const k = resolveKey(key, params);
    const message = raw(k);
    if (!message) return key;
    return message.replace(PLACEHOLDER, (m, name) => (name in params ? String(display(name, params[name])) : m));
  }

  // The message split around its placeholders, with DOM nodes (or strings) put in their
  // places, so a word inside a sentence can carry its own `lang` and style while the
  // sentence stays whole for translators.
  function parts(key, params = {}) {
    const k = resolveKey(key, params);
    const message = raw(k) || key;
    const out = [];
    let last = 0;
    for (const m of message.matchAll(PLACEHOLDER)) {
      if (m.index > last) out.push(message.slice(last, m.index));
      const name = m[1];
      out.push(name in params ? display(name, params[name]) : m[0]);
      last = m.index + m[0].length;
    }
    if (last < message.length) out.push(message.slice(last));
    return out.map((p) => (typeof p === "number" ? String(p) : p));
  }

  // Fills elements marked with data-i18n (text), data-i18n-placeholder,
  // data-i18n-aria-label and data-i18n-title.
  function apply(root = document) {
    const attrs = [
      ["i18nPlaceholder", "placeholder"],
      ["i18nAriaLabel", "aria-label"],
      ["i18nTitle", "title"],
    ];
    for (const el of root.querySelectorAll("[data-i18n], [data-i18n-placeholder], [data-i18n-aria-label], [data-i18n-title]")) {
      if (el.dataset.i18n) el.textContent = t(el.dataset.i18n);
      for (const [data, attr] of attrs) if (el.dataset[data]) el.setAttribute(attr, t(el.dataset[data]));
    }
    if (root.documentElement) {
      root.documentElement.lang = locale();
      root.documentElement.dir = dir();
    }
  }

  // Language names (slice 50 §7 rule 3): in the interface language, and in the language
  // itself (the endonym), from Intl.DisplayNames, never from the model.
  const nameCache = new Map();
  function languageName(tag, inLocale = locale()) {
    const key = `${inLocale}|${tag}`;
    if (nameCache.has(key)) return nameCache.get(key);
    let name;
    try {
      name = new Intl.DisplayNames([inLocale], { type: "language", fallback: "none" }).of(tag) ?? null;
    } catch {
      name = null;
    }
    nameCache.set(key, name);
    return name;
  }

  // The endonym with its first letter capitalized the way that language does it, for
  // standalone labels such as chips ("Русский", "Español"); sentences keep the lowercase.
  function endonym(tag) {
    const name = languageName(tag, tag);
    if (!name) return null;
    const [first, ...rest] = name;
    let upper;
    try {
      upper = first.toLocaleUpperCase(tag);
    } catch {
      upper = first.toUpperCase();
    }
    return upper + rest.join("");
  }

  const resetCaches = () => {
    cachedLocale = numberFormat = null;
    nameCache.clear();
  };

  // Switches the interface to a shipped locale, or back to the browser's ("auto" or
  // anything not shipped). Resolves true when the language changed.
  async function useLocale(tag) {
    const want = SHIPPED.includes(tag) ? tag : null;
    if ((override?.locale ?? null) === want) return false;
    if (!want) {
      override = null;
      resetCaches();
      return true;
    }
    const [messages, fallback] = await Promise.all([loader(want), want === "en" ? null : loader("en")]);
    override = { locale: want, messages: messages ?? {}, fallback: fallback ?? messages ?? {} };
    resetCaches();
    return true;
  }

  // The stored preference (`ui.uiLang`, the background's copy in storage.local, which only
  // Kotiko's own pages change; SCR-448): "auto" or a shipped locale.
  async function preference() {
    try {
      const { ui } = await ext.storage.local.get({ ui: {} });
      return typeof ui?.uiLang === "string" ? ui.uiLang : "auto";
    } catch {
      return "auto";
    }
  }

  // Applies the stored preference; never rejects (a failed load keeps the browser's).
  async function loadPreference() {
    try {
      return await useLocale(await preference());
    } catch {
      return false;
    }
  }

  const api = {
    t,
    parts,
    apply,
    locale,
    dir,
    formatNumber,
    languageName,
    endonym,
    useLocale,
    preference,
    loadPreference,
    shipped: () => SHIPPED.slice(),
    overridden: () => override?.locale ?? null,
    _setLoader: (fn) => void (loader = fn),
    _reset: () => {
      override = null;
      resetCaches();
    },
  };
  globalThis.KotikoI18n = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
