// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// lib/settings.js (SCR-448): the trusted copy and its mirror, and the check of a page's
// `settings.set`.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome } from "../helpers/fake-chrome.mjs";
import { requireExt } from "../helpers/load-script.mjs";

const S = requireExt("lib/settings.js");
const plain = (v) => JSON.parse(JSON.stringify(v));

// The store's `meta` rows, in memory.
function memoryMeta(rows = {}) {
  const data = new Map(Object.entries(rows));
  return {
    data,
    entries: async (prefix) => [...data].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value })),
    write: async (puts, deletes) => {
      for (const r of puts) data.set(r.key, r.value);
      for (const k of deletes) data.delete(k);
    },
  };
}

describe("same and canon", () => {
  test("objects equal whatever their keys' order, as Chrome's storage gives them back", () => {
    assert.equal(S.same({ a: 1, b: { c: [1, { d: 2, e: 3 }] } }, { b: { c: [1, { e: 3, d: 2 }] }, a: 1 }), true);
    assert.equal(S.same({ a: 1 }, { a: 2 }), false);
    assert.equal(S.same([1, 2], [2, 1]), false);
    assert.equal(S.same({ a: undefined }, {}), true);
    assert.equal(S.same(undefined, null), true);
    assert.equal(S.canon([undefined]), "[null]");
  });
});

describe("the trusted copy and its mirror", () => {
  test("reads like storage.get, from the trusted copy; writes go to it, then the mirror", async () => {
    const fake = createFakeChrome();
    const meta = memoryMeta({ "area:enabled": false, "other:key": 1 });
    const changed = [];
    const area = S.createArea({ meta, mirror: fake.chrome.storage.local, onChange: (k) => changed.push(...k) });
    assert.deepEqual(plain(await area.get(null)), { enabled: false });
    assert.deepEqual(plain(await area.get("enabled")), { enabled: false });
    assert.deepEqual(plain(await area.get(["enabled", "nope"])), { enabled: false });
    assert.deepEqual(plain(await area.get({ enabled: true, pausedHosts: [] })), { enabled: false, pausedHosts: [] });
    await area.set({ pausedHosts: ["a.example"], skipped: undefined });
    await area.set({});
    assert.deepEqual(meta.data.get("area:pausedHosts"), ["a.example"]);
    assert.deepEqual(plain(fake.store.local), { pausedHosts: ["a.example"] });
    await area.remove("pausedHosts");
    await area.remove([]);
    assert.equal(meta.data.has("area:pausedHosts"), false);
    assert.deepEqual(changed, ["pausedHosts", "pausedHosts"]);
    assert.equal(await area.has("enabled"), true);
    // A value handed out is a copy.
    const got = await area.get({ prefs: { a: 1 } });
    got.prefs.a = 2;
    assert.deepEqual(plain(await area.get({ prefs: { a: 1 } })), { prefs: { a: 1 } });
  });

  test("heal: puts back changed values, removes unknown keys, restores removed ones; its own writes cost nothing", async () => {
    const fake = createFakeChrome({ local: { enabled: true, junk: 1, prefs: { b: 2, a: 1 } } });
    const area = S.createArea({ meta: memoryMeta({ "area:enabled": false, "area:hiddenLangs": ["ja"], "area:prefs": { a: 1, b: 2 } }), mirror: fake.chrome.storage.local });
    assert.deepEqual(plain(await area.heal()), { restored: ["enabled", "hiddenLangs"], removed: ["junk"] });
    assert.deepEqual(plain(fake.store.local), { enabled: false, prefs: { b: 2, a: 1 }, hiddenLangs: ["ja"] });
    // An event that matches the trusted copy (in another key order) does nothing.
    const before = fake.calls.set.length;
    assert.deepEqual(plain(await area.heal({ enabled: { newValue: false }, prefs: { newValue: { b: 2, a: 1 } } })), { restored: [], removed: [] });
    assert.deepEqual(plain(await area.heal({ gone: { oldValue: 1 } })), { restored: [], removed: [] });
    assert.equal(fake.calls.set.length, before);
    // A stale event: the mirror already holds the trusted value again.
    assert.deepEqual(plain(await area.heal({ enabled: { newValue: true } })), { restored: [], removed: [] });
    await fake.chrome.storage.local.remove("hiddenLangs");
    assert.deepEqual(plain(await area.heal({ hiddenLangs: { oldValue: ["ja"] } })), { restored: ["hiddenLangs"], removed: [] });
    // After "delete everything" the next read loads again.
    area.reset();
    assert.deepEqual(plain(await area.get("enabled")), { enabled: false });
  });
});

describe("edit: what a page may change", () => {
  const edit = (current, msg) => S.edit(current, msg);

  test("set, merge, add and remove, applied to the current values", () => {
    assert.deepEqual(edit({ pausedHosts: ["a"], prefs: { theme: "dark", neverSwap: ["x"] } }, {
      set: { enabled: false },
      merge: { prefs: { motion: "reduce" }, mixing: { focus: ["ja"] } },
      add: { pausedHosts: ["a", "b"], "prefs.neverSwap": ["y"], hiddenLangs: ["ja"] },
      remove: { pausedHosts: ["a"], "prefs.sensitiveAllowed": ["bank"] },
    }).patch, {
      enabled: false,
      prefs: { theme: "dark", neverSwap: ["x", "y"], motion: "reduce", sensitiveAllowed: [] },
      mixing: { focus: ["ja"] },
      pausedHosts: ["b"],
      hiddenLangs: ["ja"],
    });
    assert.deepEqual(edit({}, { set: { mixing: null, backupSnooze: 5, onboarding: null, speech: null, prefs: null } }).patch, { mixing: null, backupSnooze: 5, onboarding: null, speech: null, prefs: null });
    assert.deepEqual(edit({ ui: { uiLang: "auto" } }, { merge: { ui: { baseLangs: ["es"], baseLangsDetected: [], baseLangsConfirmed: true, uiLang: "pt_BR" } } }).patch.ui, { uiLang: "pt_BR", baseLangs: ["es"], baseLangsDetected: [], baseLangsConfirmed: true });
    assert.deepEqual(edit({ prefs: "broken" }, { add: { "prefs.neverSwap": ["x"] } }).patch, { prefs: { neverSwap: ["x"] } });
    assert.deepEqual(edit({ hiddenLangs: "broken" }, { add: { hiddenLangs: ["ja"] } }).patch, { hiddenLangs: ["ja"] });
  });

  test("anything else is refused", () => {
    const bad = [
      null,
      {},
      { set: [] },
      { set: { lookup: {} } },
      { merge: { enabled: {} } },
      { merge: { prefs: [] } },
      { add: { "prefs.a.b": ["x"] } },
      { add: { nope: ["x"] } },
      { add: { pausedHosts: [] } },
      { add: { pausedHosts: "a" } },
      { add: { hiddenLangs: ["not a tag"] } },
      { set: { pausedHosts: ["has space"] } },
      { set: { baseLangs: ["en", "es", "fr", "de", "it"] } },
      { set: { backupSnooze: "soon" } },
      { set: { ui: { uiLang: "x".repeat(40) } } },
      { set: { ui: { baseLangsConfirmed: "yes" } } },
      { set: { ui: { baseLangsDetected: ["a b"] } } },
      { set: { ui: [] } },
      { set: { prefs: { neverSwap: "x" } } },
    ];
    for (const msg of bad) assert.ok(edit({}, msg).error, JSON.stringify(msg));
  });

  test("language tags are checked by the caller's rule when it gives one", () => {
    assert.ok(S.edit({}, { set: { baseLangs: ["xx-notreal"] } }, { isTag: () => false }).error);
    assert.deepEqual(S.edit({}, { set: { baseLangs: ["en"] } }, { isTag: () => true }).patch, { baseLangs: ["en"] });
    assert.ok(S.PAGE_KEYS.includes("enabled") && !S.PAGE_KEYS.includes("lookup"));
  });
});
