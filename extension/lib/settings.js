// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Settings and state only Kotiko itself may change (SCR-448). Chrome and Firefox let
// content scripts write `storage.local` and `storage.sync`, and Firefox has no way to stop
// them (`setAccessLevel` isn't implemented there). So the background keeps the real copy of
// everything it acts on in its own IndexedDB store, which content scripts can't open, and
// `storage.local` is only a mirror of it for content scripts and pages to read:
//
// - every read in the background comes from the trusted copy, never from storage.local;
// - every write goes to the trusted copy first, then to the mirror;
// - a change to the mirror that the background didn't make (a content script's) is put
//   back (`heal`), and keys it doesn't hold are removed.
//
// Kotiko's pages change settings with the `settings.set` message (pages only), checked
// here by `edit` against an allowlist of keys and their shapes. No DOM, so it runs in the
// background (globalThis.KotikoSettings) and in Node tests (module.exports).
//
//   const area = KotikoSettings.createArea({ meta, mirror: ext.storage.local, onChange });
//   await area.get({ enabled: true })        like storage.local.get, from the trusted copy
//   await area.set({ enabled: false })       trusted copy, then mirror
//   await area.update(async (get) => items)  a read and a write with nothing in between
//   await area.heal(changes)                 puts back what someone else wrote
//   KotikoSettings.edit(current, msg, { isTag }) -> { patch } | { error }
//   KotikoSettings.same(a, b)                equal as storage keeps them (key order aside)
(() => {
  // Trusted copies live in the store's `meta` under this prefix, one row per key.
  const PREFIX = "area:";

  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  // JSON with object keys sorted: Chrome hands objects back from storage with their keys
  // in its own order, so two copies of one value can differ only in that.
  function canon(v) {
    if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canon(x))).join(",")}]`;
    if (isObj(v)) {
      const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
    }
    return JSON.stringify(v ?? null);
  }
  const same = (a, b) => canon(a) === canon(b);

  // storage.get's query forms: null (everything), a key, a list of keys, or defaults.
  function pick(all, query) {
    if (query == null) return clone(Object.fromEntries(all));
    if (typeof query === "string" || Array.isArray(query)) {
      const out = {};
      for (const k of [query].flat()) if (all.has(k)) out[k] = clone(all.get(k));
      return out;
    }
    const out = {};
    for (const [k, d] of Object.entries(query)) out[k] = all.has(k) ? clone(all.get(k)) : clone(d);
    return out;
  }

  // meta: {entries(prefix), write(puts, deletes)} over the store's `meta` (lib/store.js).
  // mirror: the storage area content scripts read (storage.local).
  // onChange(keys): after the trusted copy changed (not after a heal).
  function createArea({ meta, mirror, onChange = () => {} }) {
    let cache = null;
    // Each trusted value's canonical form, made once per write (the word list is large).
    const canons = new Map();
    const canonOf = (k) => {
      if (!canons.has(k)) canons.set(k, canon(cache.get(k)));
      return canons.get(k);
    };
    const matches = (k, v) => canon(v) === canonOf(k);
    let chain = Promise.resolve();
    // One write or heal at a time, so a heal never puts back a value a write just replaced.
    const serial = (fn) => {
      const p = chain.then(fn);
      chain = p.catch(() => {});
      return p;
    };

    async function load() {
      if (cache) return cache;
      const rows = await meta.entries(PREFIX);
      cache = new Map(rows.map((r) => [r.key.slice(PREFIX.length), r.value]));
      return cache;
    }

    async function get(query) {
      return pick(await load(), query);
    }

    const entriesOf = (items) => Object.entries(items ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [k, clone(v)]);

    // Inside `serial` only.
    async function write(entries) {
      if (!entries.length) return;
      const all = await load();
      await meta.write(entries.map(([k, v]) => ({ key: PREFIX + k, value: v })), []);
      for (const [k, v] of entries) {
        all.set(k, v);
        canons.delete(k);
      }
      await mirror.set(Object.fromEntries(entries));
      onChange(entries.map(([k]) => k));
    }

    function set(items) {
      const entries = entriesOf(items);
      if (!entries.length) return Promise.resolve();
      return serial(() => write(entries));
    }

    // Reads and writes in one step: `fn(get)` reads the trusted copy and returns what to
    // set (or nothing), and no other write or heal runs between its reads and that write.
    // `fn` must not call this area's set, remove, heal or update.
    function update(fn) {
      return serial(async () => write(entriesOf(await fn(get))));
    }

    function remove(keys) {
      const list = [keys].flat().filter((k) => typeof k === "string");
      if (!list.length) return Promise.resolve();
      return serial(async () => {
        const all = await load();
        await meta.write([], list.map((k) => PREFIX + k));
        for (const k of list) {
          all.delete(k);
          canons.delete(k);
        }
        await mirror.remove(list);
        onChange(list);
      });
    }

    // Puts the mirror back where it differs from the trusted copy: values restored, keys the
    // background doesn't hold removed. With `changes` (a storage.onChanged event) only those
    // keys are checked, and a change that matches the trusted copy (the background's own
    // write) costs one comparison; without, the whole mirror is checked.
    function heal(changes = null) {
      return serial(async () => {
        const all = await load();
        let keys;
        if (changes) {
          keys = Object.keys(changes).filter((k) => !(all.has(k) ? matches(k, changes[k].newValue) : changes[k].newValue === undefined));
          if (!keys.length) return { restored: [], removed: [] };
        }
        // The event may be stale (written over since): compare with what is there now.
        const now = await mirror.get(keys ?? null);
        if (!keys) keys = [...new Set([...Object.keys(now), ...all.keys()])];
        const restore = {};
        const removed = [];
        for (const k of keys) {
          if (!all.has(k)) {
            if (k in now) removed.push(k);
          } else if (!(k in now) || !matches(k, now[k])) restore[k] = clone(all.get(k));
        }
        if (removed.length) await mirror.remove(removed);
        if (Object.keys(restore).length) await mirror.set(restore);
        return { restored: Object.keys(restore), removed };
      });
    }

    return {
      get,
      set,
      update,
      remove,
      heal,
      // Whether the trusted copy holds a key (the one-time adoption takes only missing ones).
      has: async (k) => (await load()).has(k),
      // After "delete everything": the next read loads from the new, empty store.
      reset: () => {
        cache = null;
        canons.clear();
      },
    };
  }

  // ── what Kotiko's pages may change (`settings.set`) ────────────────────────────

  const TAG = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/;
  const bytes = (v) => JSON.stringify(v ?? null).length;
  const strings = (v, { max, len, test = () => true, min = 0 }) =>
    Array.isArray(v) && v.length >= min && v.length <= max && v.every((x) => typeof x === "string" && x.length >= 1 && x.length <= len && test(x));
  const plain = (v, max) => isObj(v) && bytes(v) <= max;

  // One rule per key: `ok(value, ctx)` for a whole value, `lists` for the lists inside an
  // object that `add` and `remove` may change one item at a time.
  const KEYS = {
    enabled: { ok: (v) => typeof v === "boolean" },
    pausedHosts: { ok: (v) => strings(v, { max: 1000, len: 253, test: (h) => !/[\s/]/.test(h) }), list: { len: 253 } },
    hiddenLangs: { ok: (v, c) => strings(v, { max: 200, len: 35, test: c.isTag }), list: { len: 35, tag: true } },
    baseLangs: { ok: (v, c) => strings(v, { min: 1, max: 4, len: 35, test: c.isTag }) },
    mixing: { ok: (v) => v === null || plain(v, 4096), object: true },
    prefs: {
      ok: (v) => v === null || (plain(v, 65536) && ["neverSwap", "sensitiveAllowed"].every((k) => v[k] === undefined || strings(v[k], { max: 5000, len: 253 }))),
      object: true,
      lists: { neverSwap: { len: 200 }, sensitiveAllowed: { len: 253 } },
    },
    speech: { ok: (v) => v === null || plain(v, 8192), object: true },
    onboarding: { ok: (v) => v === null || plain(v, 2048), object: true },
    backupSnooze: { ok: (v) => v === null || (typeof v === "number" && Number.isFinite(v)) },
    // storage.sync `ui` (slice 50): only these fields.
    ui: {
      ok: (v, c) =>
        isObj(v) &&
        Object.keys(v).every((k) => ["uiLang", "baseLangs", "baseLangsDetected", "baseLangsConfirmed"].includes(k)) &&
        (v.uiLang === undefined || (typeof v.uiLang === "string" && (v.uiLang === "auto" || (v.uiLang.length <= 35 && c.isTag(v.uiLang.replace(/_/g, "-")))))) &&
        (v.baseLangs === undefined || strings(v.baseLangs, { min: 1, max: 4, len: 35, test: c.isTag })) &&
        (v.baseLangsDetected === undefined || strings(v.baseLangsDetected, { max: 4, len: 35, test: c.isTag })) &&
        (v.baseLangsConfirmed === undefined || typeof v.baseLangsConfirmed === "boolean"),
      object: true,
    },
  };
  const PAGE_KEYS = Object.freeze(Object.keys(KEYS));

  // `name` for a whole key, `name.list` for a list inside an object key.
  function listOf(path) {
    const [key, sub, extra] = String(path).split(".");
    const rule = KEYS[key];
    if (!rule || extra !== undefined) return null;
    if (sub === undefined) return rule.list ? { key, sub: null, rule: rule.list } : null;
    return rule.lists?.[sub] ? { key, sub, rule: rule.lists[sub] } : null;
  }

  // The change a page asked for, applied to `current` (the trusted values of the keys it
  // names): {patch} with the new values, or {error}. Operations, in this order:
  //   set:    {key: value}            replaces the value
  //   merge:  {key: {field: value}}   for object keys; null fields are kept as null
  //   add:    {path: [items]}         adds to a list (no duplicates); path "key" or "key.list"
  //   remove: {path: [items]}         takes items out of a list
  function edit(current, msg, { isTag = (t) => TAG.test(t) } = {}) {
    const ctx = { isTag };
    const ops = ["set", "merge", "add", "remove"];
    if (!isObj(msg) || !ops.some((o) => msg[o] !== undefined)) return { error: "nothing to change" };
    for (const o of ops) if (msg[o] !== undefined && !isObj(msg[o])) return { error: `${o} must be an object` };
    const next = {};
    const value = (k) => (k in next ? next[k] : clone(current?.[k]));
    for (const [k, v] of Object.entries(msg.set ?? {})) {
      if (!KEYS[k]) return { error: `${k} can't be changed here` };
      next[k] = clone(v);
    }
    for (const [k, v] of Object.entries(msg.merge ?? {})) {
      if (!KEYS[k]?.object) return { error: `${k} can't be merged` };
      if (!isObj(v)) return { error: `merge.${k} must be an object` };
      const base = value(k);
      next[k] = { ...(isObj(base) ? base : {}), ...clone(v) };
    }
    for (const op of ["add", "remove"]) {
      for (const [path, items] of Object.entries(msg[op] ?? {})) {
        const l = listOf(path);
        if (!l) return { error: `${path} isn't a list` };
        if (!strings(items, { min: 1, max: 100, len: l.rule.len, test: l.rule.tag ? isTag : () => true })) return { error: `${op}.${path} must list 1 to 100 items` };
        const holder = l.sub ? value(l.key) : null;
        const list = l.sub ? (isObj(holder) && Array.isArray(holder[l.sub]) ? holder[l.sub] : []) : Array.isArray(value(l.key)) ? value(l.key) : [];
        const out = op === "add" ? [...list, ...items.filter((x) => !list.includes(x))] : list.filter((x) => !items.includes(x));
        next[l.key] = l.sub ? { ...(isObj(holder) ? holder : {}), [l.sub]: out } : out;
      }
    }
    for (const [k, v] of Object.entries(next)) if (!KEYS[k].ok(v, ctx)) return { error: `${k} isn't a valid value` };
    return { patch: next };
  }

  const api = { PREFIX, PAGE_KEYS, createArea, edit, canon, same };
  globalThis.KotikoSettings = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
