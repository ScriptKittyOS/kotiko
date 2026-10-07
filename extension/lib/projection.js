// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The words content scripts read (slice 11 section 2): after any committed write to the
// store, the background waits 100 ms and writes `words`, `baseLangs` and `wordsVersion`
// to storage.local in one `set`. Only swappable words (active), only for the learner's
// current bases, in the compact shape the matcher and the word card read today: forms as
// the texts of enabled forms, newest first, and the optional fields left out when empty.
// No DOM, so it runs in the background (globalThis.KotikoProjection) and in Node tests.
//
//   KotikoProjection.project(records, bases) -> [compact word]
//   const p = KotikoProjection.createProjector({ list, storage, bases, enabled, debounceMs });
//   p.schedule({by: clientId}); await p.flush();
(() => {
  const SWAP = new Set(["active", "well_known"]);
  const OPTIONAL = ["romanization", "note", "native_vocalized", "pronunciation", "pronunciation_careful", "pronunciation_source", "sense"];

  function project(records, bases) {
    const want = new Set(Array.isArray(bases) ? bases : []);
    const out = [];
    for (const w of records) {
      if (!w || w.deleted_at || !SWAP.has(w.status)) continue;
      if (want.size && !want.has(w.base_lang)) continue;
      // Forms as their text, or { text, case } when 07's case flag says more than "any"
      // (slice 16's rules read it).
      const forms = (w.forms ?? [])
        .filter((f) => f && (typeof f === "string" || f.enabled !== false))
        .map((f) => (typeof f === "string" ? f : f.case && f.case !== "any" ? { text: f.text, case: f.case } : f.text))
        .filter((f) => (typeof f === "string" ? f : f?.text));
      if (!forms.length) continue;
      const c = { id: w.id, lang: w.lang, native: w.native, base_lang: w.base_lang, gloss: w.gloss, forms, status: w.status, created_at: w.created_at };
      for (const k of OPTIONAL) if (w[k] !== null && w[k] !== undefined && w[k] !== "") c[k] = w[k];
      out.push(c);
    }
    // Newest first: the matcher keeps the newest word per form and language.
    return out.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  }

  function createProjector({ list, storage, bases, enabled = async () => true, debounceMs = 100, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, onError = () => {} }) {
    let timer = null;
    let running = Promise.resolve();
    let waiters = [];
    let n = 0;
    // Who caused the writes since the last projection: one page's client id, or null
    // (several writers, the popup, the background). The dashboard ignores its own echoes.
    let by;

    async function write(writer) {
      if (!(await enabled())) return false;
      const items = async (get) => {
        const b = await bases(get);
        const words = project(await list(), b);
        const prev = (await get({ wordsVersion: null })).wordsVersion;
        n = Math.max(n, typeof prev?.n === "number" ? prev.n : 0) + 1;
        return { words, baseLangs: b, wordsVersion: { n, at: now(), by: writer ?? null } };
      };
      // The bases are read and the list for them written in one step where the storage
      // can (the background's trusted copy, `update`): a change of bases while the store's
      // list is read is then never written over with the old ones (slice 54, C-08).
      if (typeof storage.update === "function") await storage.update(items);
      else await storage.set(await items((q) => storage.get(q)));
      return true;
    }

    function run() {
      timer = null;
      const done = waiters;
      const writer = by;
      waiters = [];
      by = undefined;
      running = running.then(() => write(writer)).then(
        (r) => done.forEach((w) => w.resolve(r)),
        (e) => {
          onError(e);
          done.forEach((w) => w.resolve(false));
        },
      );
      return running;
    }

    return {
      // Coalesces writes: one projection 100 ms after the last change.
      schedule({ by: writer = null } = {}) {
        by = by === undefined || by === writer ? writer : null;
        if (timer) clearTimer(timer);
        timer = setTimer(run, debounceMs);
        return new Promise((resolve) => waiters.push({ resolve }));
      },
      // Writes now (tests, mode switches); resolves once written.
      flush({ by: writer = null } = {}) {
        by = by === undefined || by === writer ? writer : null;
        if (timer) clearTimer(timer);
        const p = new Promise((resolve) => waiters.push({ resolve }));
        run();
        return p;
      },
    };
  }

  const api = { project, createProjector };
  globalThis.KotikoProjection = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
