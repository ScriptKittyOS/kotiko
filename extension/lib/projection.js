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
      const forms = (w.forms ?? []).filter((f) => f && (typeof f === "string" || f.enabled !== false)).map((f) => (typeof f === "string" ? f : f.text)).filter(Boolean);
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
      const b = await bases();
      const words = project(await list(), b);
      const prev = (await storage.get({ wordsVersion: null })).wordsVersion;
      n = Math.max(n, typeof prev?.n === "number" ? prev.n : 0) + 1;
      await storage.set({ words, baseLangs: b, wordsVersion: { n, at: now(), by: writer ?? null } });
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
