// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Milestones that fire once in a lifetime (slice 32 sections 3 and 4). The background
// claims a milestone for whoever wants to celebrate it, one claim at a time, so two pages
// can never both fire it. Page milestones are also limited to one a day (local calendar
// day); vocabulary milestones (the first word ever, `vocab:first`) are not.
//
// Storage, all local and included in export and "delete all my data" (slice 12):
//   celebrations: { done: { "vocab:first": 1727771234567, … }, lastPageAt }
//   prefs.celebrations: false turns every celebration off (on by default, DECISIONS)
//
//   KotikoCelebrations.claim(state, "vocab:first", { now })  -> { claimed, reason?, next }
//   KotikoCelebrations.markDone(state, ["vocab:first"], now)  -> next state (silently)
//   KotikoCelebrations.enabled(prefs)                          -> boolean
(() => {
  const KEY = /^(vocab|page):[A-Za-z0-9:_-]{1,60}$/;

  const normalize = (state) => ({
    done: state && typeof state.done === "object" && state.done ? { ...state.done } : {},
    lastPageAt: typeof state?.lastPageAt === "number" ? state.lastPageAt : null,
  });

  const sameDay = (a, b) => {
    const x = new Date(a);
    const y = new Date(b);
    return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
  };

  function claim(state, key, { now = Date.now() } = {}) {
    const s = normalize(state);
    if (!KEY.test(String(key))) return { claimed: false, reason: "invalid", next: s };
    if (s.done[key]) return { claimed: false, reason: "done", next: s };
    const page = key.startsWith("page:");
    if (page && s.lastPageAt !== null && sameDay(s.lastPageAt, now)) return { claimed: false, reason: "today", next: s };
    s.done[key] = now;
    if (page) s.lastPageAt = now;
    return { claimed: true, next: s };
  }

  function markDone(state, keys, now = Date.now()) {
    const s = normalize(state);
    for (const k of keys) if (KEY.test(k) && !s.done[k]) s.done[k] = now;
    return s;
  }

  const enabled = (prefs) => prefs?.celebrations !== false;

  const api = { claim, markDone, enabled, isKey: (k) => KEY.test(String(k)) };
  globalThis.KotikoCelebrations = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
