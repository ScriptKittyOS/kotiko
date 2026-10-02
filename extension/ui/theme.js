// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Applies the theme preference before first paint (slice 06 §2), so a page never flashes
// the wrong theme. Loaded as the first script in <head>. `prefs.theme` ("system", "light"
// or "dark") is set in the dashboard's settings (slice 21); this reads the copy cached in
// localStorage synchronously, then refreshes the cache from extension storage.
(() => {
  const KEY = "kotiko.theme";
  const root = document.documentElement;
  const set = (theme) => {
    if (theme === "light" || theme === "dark") root.dataset.theme = theme;
    else delete root.dataset.theme;
  };
  try {
    set(localStorage.getItem(KEY));
  } catch {
    // storage blocked: follow the system
  }
  const ext = globalThis.browser ?? globalThis.chrome;
  Promise.resolve(ext?.storage?.local?.get({ prefs: {} }))
    .then((s) => {
      const theme = s?.prefs?.theme ?? "system";
      set(theme);
      try {
        localStorage.setItem(KEY, theme);
      } catch {
        // ignore
      }
    })
    .catch(() => {});
})();
