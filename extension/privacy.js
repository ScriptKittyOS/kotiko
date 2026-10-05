// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The privacy policy page (slice 28 §2). Renders extension/privacy/<locale>.md (a copy of
// docs/privacy/<locale>.md, made by scripts/sync-privacy.mjs) in the interface language,
// falling back to English, the reference text, with lib/policy.js.
(() => {
  const { parse, render } = globalThis.KotikoPolicy;

  async function main() {
    const ext = globalThis.browser ?? globalThis.chrome;
    const I18n = globalThis.KotikoI18n;
    const root = document.getElementById("policy");
    // Kotiko's own language setting, else the browser's (the interface's locale).
    await I18n.loadPreference();
    document.title = I18n.t("privacy_title");
    document.documentElement.lang = I18n.locale();
    const ui = I18n.locale();
    for (const locale of [...new Set([ui, ui.split("-")[0], "en"])]) {
      try {
        const res = await fetch(ext.runtime.getURL(`privacy/${locale}.md`));
        if (!res.ok) continue;
        root.lang = locale;
        render(document, root, parse(await res.text()));
        root.removeAttribute("aria-busy");
        return;
      } catch {
        // not shipped in this language: the next one
      }
    }
    root.append(Object.assign(document.createElement("p"), { textContent: I18n.t("privacy_unavailable") }));
    root.removeAttribute("aria-busy");
  }

  main();
})();
