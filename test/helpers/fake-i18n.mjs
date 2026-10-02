// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// A fake `chrome.i18n` that reads extension/_locales the way Chrome does: a message's
// $NAME$ becomes its placeholder's content, "$1".."$9" in a content take substitutions,
// "$$" is a dollar sign, and an unknown key returns "". Missing keys fall back to `en`
// (the manifest's default_locale), as browsers do.
//
//   fake.chrome.i18n = createI18n("es");
import fs from "node:fs";
import path from "node:path";
import { EXT_DIR } from "./load-script.mjs";

export function readMessages(locale) {
  return JSON.parse(fs.readFileSync(path.join(EXT_DIR, "_locales", locale, "messages.json"), "utf8"));
}

export const LOCALES = fs.readdirSync(path.join(EXT_DIR, "_locales")).sort();

export function createI18n(locale = "en") {
  const own = readMessages(locale);
  const fallback = locale === "en" ? own : readMessages("en");
  const render = (entry, subs = []) => {
    const list = Array.isArray(subs) ? subs : [subs];
    const sub = (text) => text.replace(/\$(\d)/g, (_m, i) => String(list[Number(i) - 1] ?? ""));
    return entry.message
      .replace(/\$([A-Za-z0-9_@]+)\$/g, (m, name) => {
        const p = entry.placeholders?.[name.toLowerCase()];
        return p ? sub(p.content) : m;
      })
      .replace(/\$\$/g, "$");
  };
  return {
    getMessage(key, subs) {
      if (key === "@@bidi_dir") return "ltr";
      if (key === "@@ui_locale") return locale;
      const entry = own[key] ?? fallback[key];
      return entry ? render(entry, subs) : "";
    },
    getUILanguage: () => locale,
  };
}
