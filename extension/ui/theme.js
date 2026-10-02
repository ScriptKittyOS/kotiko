// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Applies the theme preference before first paint (slice 06 §2), so a page never flashes
// the wrong theme. Loaded as the first script in <head>. `prefs.theme` ("system", "light"
// or "dark") and `prefs.motion` ("system" or "reduce", 27 §4) are set in the dashboard's
// settings (slice 21); this reads the copies cached in localStorage synchronously, then
// refreshes them from extension storage, and follows later changes.
(() => {
  const KEY = "kotiko.theme";
  const MOTION_KEY = "kotiko.motion";
  const root = document.documentElement;
  const set = (theme) => {
    if (theme === "light" || theme === "dark") root.dataset.theme = theme;
    else delete root.dataset.theme;
  };
  const setMotion = (motion) => {
    if (motion === "reduce") root.dataset.motion = "reduce";
    else delete root.dataset.motion;
  };
  try {
    set(localStorage.getItem(KEY));
    setMotion(localStorage.getItem(MOTION_KEY));
  } catch {
    // storage blocked: follow the system
  }
  const apply = (prefs) => {
    const theme = prefs?.theme ?? "system";
    const motion = prefs?.motion ?? "system";
    set(theme);
    setMotion(motion);
    try {
      localStorage.setItem(KEY, theme);
      localStorage.setItem(MOTION_KEY, motion);
    } catch {
      // ignore
    }
  };
  const ext = globalThis.browser ?? globalThis.chrome;
  Promise.resolve(ext?.storage?.local?.get({ prefs: {} }))
    .then((s) => apply(s?.prefs))
    .catch(() => {});
  try {
    ext?.storage?.onChanged?.addListener((changes, area) => {
      if (area === "local" && changes.prefs) apply(changes.prefs.newValue);
    });
  } catch {
    // no storage events here
  }
})();
