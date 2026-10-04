// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Gives words kept in this browser their pronunciation from Wiktionary (slice 49 section
// 4a), in the background: words added before pronunciations came from Wiktionary, and any
// word whose page couldn't be read when it was added. The JavaScript twin of
// Kotiko.WiktionaryPass. The state lives in the store's meta: `attempts` maps a word's id
// to "done" once it has been looked at, or to how often Wiktionary couldn't be reached.
// A few words per tick, a few seconds apart, so Wikimedia is never hurried. Each write goes
// through the store's `update` with the `updated_at` read before the request, so a word
// edited meanwhile is left alone; the learner's own pronunciation is never replaced. When
// Wiktionary can't be reached it waits ten minutes; after three failures for one word it
// moves on.
//
//   const pass = KotikoWiktionaryPass.createPass({ store, pronounce, fetchPage, cache, enabled, now, sleep });
//   await pass.tick()   -> { looked, written, waiting_until }
(() => {
  const META = "jobs.wiktionaryPronunciations";
  const PER_TICK = 5;
  const GAP_MS = 3000;
  const WAIT_MS = 10 * 60_000;
  const MAX_ATTEMPTS = 3;

  function createPass({ store, pronounce, fetchPage, cache = null, enabled = async () => true, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), perTick = PER_TICK, gapMs = GAP_MS }) {
    let ticking = null;
    const load = async () => (await store.meta.get(META)) ?? { attempts: {}, retry_at: null };
    const save = (state) => store.meta.set(META, state);

    async function next(attempts) {
      const words = await store.list({ statuses: ["active", "paused"] });
      return words.find((w) => (w.pronunciation_source == null || w.pronunciation_source === "model") && attempts[w.id] !== "done" && pronounce.eligible(w));
    }

    async function run() {
      let state = await load();
      const out = { looked: 0, written: 0, waiting_until: null };
      if (!(await enabled())) return out;
      if (state.retry_at && state.retry_at > now()) return { ...out, waiting_until: state.retry_at };
      for (let i = 0; i < perTick; i++) {
        const w = await next(state.attempts);
        if (!w) break;
        if (i > 0) await sleep(gapMs);
        const r = await pronounce.enrich(w, { fetchPage, cache });
        out.looked++;
        if (r.status === "unavailable") {
          const n = (typeof state.attempts[w.id] === "number" ? state.attempts[w.id] : 0) + 1;
          state = { attempts: { ...state.attempts, [w.id]: n >= MAX_ATTEMPTS ? "done" : n }, retry_at: now() + WAIT_MS };
          await save(state);
          return { ...out, waiting_until: state.retry_at };
        }
        if (r.status === "wiktionary") {
          const patch = { pronunciation: r.word.pronunciation, pronunciation_careful: null, pronunciation_source: "wiktionary" };
          if ("native_vocalized" in r.word && r.word.native_vocalized !== w.native_vocalized) patch.native_vocalized = r.word.native_vocalized;
          const res = await store.update(w.id, patch, { if_updated_at: w.updated_at });
          if (res?.ok) out.written++;
        }
        state = { attempts: { ...state.attempts, [w.id]: "done" }, retry_at: null };
        await save(state);
      }
      return out;
    }

    return {
      tick() {
        ticking ??= run().finally(() => {
          ticking = null;
        });
        return ticking;
      },
    };
  }

  const api = { createPass };
  globalThis.KotikoWiktionaryPass = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
