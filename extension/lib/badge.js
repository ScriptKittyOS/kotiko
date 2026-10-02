// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The toolbar badge and tooltip for one tab (slice 20 §5). No DOM or extension APIs, so the
// same file runs in the background worker (globalThis.KotikoBadge) and in Node tests.
//
//   KotikoBadge.badgeFor({ enabled, pausedHosts, url })
//     -> { text: "off" | "", titleKey, host }
//
// Precedence: off everywhere or paused on this site shows "off"; otherwise nothing. The
// "•" while an add job runs ([24]) and coverage ([32]) slot in below "off" when they ship.
(() => {
  // The background grey from 20 §5: white text on it is 5.70:1.
  const OFF_COLOR = "#6B6379";

  function hostOf(url) {
    try {
      const u = new URL(url);
      return /^https?:$/.test(u.protocol) ? u.hostname || null : null;
    } catch {
      return null;
    }
  }

  function badgeFor({ enabled = true, pausedHosts = [], url = "" } = {}) {
    const host = hostOf(url);
    if (enabled === false) return { text: "off", titleKey: "action_title_off", host };
    if (host && Array.isArray(pausedHosts) && pausedHosts.includes(host)) {
      return { text: "off", titleKey: "action_title_paused", host };
    }
    return { text: "", titleKey: "action_title", host };
  }

  const api = { badgeFor, hostOf, OFF_COLOR };
  globalThis.KotikoBadge = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
