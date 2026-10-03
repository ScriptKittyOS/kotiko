// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The "Why Kotiko?" story (slice 05 section 1) for the dashboard's About (slice 22). Its
// single source is slices/05-brand-identity/SPEC.md; scripts/sync-story.mjs writes
// docs/story/<locale>.md from it and copies each file into extension/story/, so this
// reads the copy shipped with the extension and never keeps its own text.
//
//   KotikoStory.parse(markdown)    -> { title, paragraphs, placeholder }
//   await KotikoStory.load("es")   -> the Spanish story, else the English one, else null
(() => {
  const ext = globalThis.browser ?? globalThis.chrome;

  // Headings, blank-line paragraphs and HTML comments only: the story uses nothing else.
  function parse(md) {
    const text = String(md ?? "");
    const placeholder = /<!--[\s\S]*?PLACEHOLDER[\s\S]*?-->/.test(text);
    const body = text.replace(/<!--[\s\S]*?-->/g, "").trim();
    let title = null;
    const paragraphs = [];
    for (const block of body.split(/\n\s*\n/)) {
      const b = block.trim();
      if (!b) continue;
      const h = /^#\s+(.+)$/.exec(b);
      if (h && title === null) title = h[1].trim();
      else paragraphs.push(b.replace(/\s*\n\s*/g, " "));
    }
    return { title, paragraphs, placeholder };
  }

  let loader = async (locale) => {
    const res = await fetch(ext.runtime.getURL(`story/${locale}.md`));
    if (!res.ok) throw new Error(`No story for ${locale}`);
    return res.text();
  };

  async function load(locale) {
    for (const l of [...new Set([String(locale ?? "en").split("-")[0], "en"])]) {
      try {
        const story = parse(await loader(l));
        if (story.title && story.paragraphs.length) return { ...story, locale: l };
      } catch {
        // not shipped in this language: the next one
      }
    }
    return null;
  }

  const api = { parse, load, _setLoader: (fn) => void (loader = fn) };
  globalThis.KotikoStory = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
