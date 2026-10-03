// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The pronunciation refresh for words kept in this browser (slice 07 section 8, slice 11
// section 5): words saved without a pronunciation (migrated, imported, added by hand) get
// one through the extension's own lookup client, the JavaScript twin of
// Kotiko.PronunciationRefresh. Up to 20 target words per request, one request at a time,
// only while no add job is waiting or running (the learner's adds go first), and never
// with 10 or fewer free lookups left (they're kept for the learner's own adds). Each write
// goes through the store's `update` with the `updated_at` read before the request, so a
// word edited meanwhile is left alone; one projection follows each batch.
//
//   const job = KotikoRefreshJob.createRefreshJob({ store, client, busy, enabled, now });
//   await job.tick()                     one batch when it may run
//   await job.status()                   {state, done, total, retry_at} (the server's shape)
//   await job.control("pause" | "resume")
//   await job.nudge()                    new words without a pronunciation: run again
(() => {
  const META = "jobs.pronunciationRefresh";
  const BATCH = 20;
  const MAX_ATTEMPTS = 2;

  const nextMidnight = (ms) => {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  };
  const nativeKey = (s) => globalThis.KotikoWordMerge.nativeKey(s);

  function createRefreshJob({ store, client, busy = async () => false, enabled = async () => true, now = () => Date.now(), hasKey = (base) => !!globalThis.KotikoWordSpec?.langData?.(base)?.respelling }) {
    let ticking = null;

    async function load() {
      return (await store.meta.get(META)) ?? { state: "running", done: 0, total: 0, retry_at: null, attempts: {} };
    }
    const save = (job) => store.meta.set(META, job);

    async function eligible(attempts = {}) {
      const words = await store.list({ statuses: ["active", "paused"] });
      return words
        .filter((w) => (w.pronunciation === null || w.pronunciation === undefined || w.pronunciation === "") && hasKey(w.base_lang) && (attempts[w.id] ?? 0) < MAX_ATTEMPTS)
        .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
    }

    const publicState = (job) => {
      const out = { state: job.state, done: job.done, total: job.total };
      if (job.state === "waiting" && job.retry_at) out.retry_at = new Date(job.retry_at).toISOString();
      return out;
    };

    async function wait(job, retryAt) {
      const next = { ...job, state: "waiting", retry_at: retryAt };
      await save(next);
      return next;
    }

    async function batch(job) {
      const words = await eligible(job.attempts);
      if (!words.length) {
        const next = { ...job, state: "done", retry_at: null, total: job.done };
        await save(next);
        return next;
      }
      const groups = new Map();
      for (const w of words) {
        const k = `${w.lang}\u0000${nativeKey(w.native)}\u0000${w.sense ?? ""}`;
        if (!groups.has(k) && groups.size >= BATCH) continue;
        (groups.get(k) ?? groups.set(k, []).get(k)).push(w);
      }
      const items = [...groups.values()].map(([w, ...rest]) => ({ lang: w.lang, native: w.native, sense: w.sense ?? "", base_langs: [w, ...rest].map((x) => x.base_lang) }));
      const res = await client.respell(items);
      if (!res.ok) {
        const at = Date.parse(res.error?.details?.retry_at ?? "");
        if (res.error.code === "rate_limited") return wait(job, Number.isFinite(at) ? at : now() + 60_000);
        if (res.error.code === "quota_exhausted") return wait(job, Number.isFinite(at) ? at : nextMidnight(now()));
        return wait(job, now() + 5 * 60_000);
      }
      const attempts = { ...job.attempts };
      let written = 0;
      for (const w of [...groups.values()].flat()) {
        const a = res.result.find((x) => x.lang === w.lang && x.base_lang === w.base_lang && nativeKey(x.native) === nativeKey(w.native));
        if (!a || typeof a.pronunciation !== "string") {
          attempts[w.id] = (attempts[w.id] ?? 0) + 1;
          continue;
        }
        const patch = { pronunciation: a.pronunciation, pronunciation_careful: a.pronunciation_careful ?? null, pronunciation_source: "model" };
        if (!w.native_vocalized && a.native_vocalized) patch.native_vocalized = a.native_vocalized;
        const r = await store.update(w.id, patch, { if_updated_at: w.updated_at });
        if (r.ok) written++;
      }
      const done = job.done + written;
      const left = (await eligible(attempts)).length;
      const next = { ...job, state: left ? "running" : "done", retry_at: null, done, total: done + left, attempts };
      await save(next);
      return next;
    }

    async function tick() {
      if (ticking) return ticking;
      ticking = (async () => {
        let job = await load();
        if (job.state === "paused" || job.state === "done") return publicState(job);
        if (!(await enabled())) return publicState(job);
        if (job.state === "waiting" && job.retry_at && job.retry_at > now()) return publicState(job);
        if (await busy()) return publicState(job);
        const low = await client.quotaLow();
        if (low) return publicState(await wait(job, low));
        job = await batch({ ...job, state: "running" });
        return publicState(job);
      })().finally(() => {
        ticking = null;
      });
      return ticking;
    }

    return {
      tick,
      async status() {
        const job = await load();
        let out = job;
        if (job.state === "running" && !job.total) {
          const total = job.done + (await eligible(job.attempts)).length;
          out = { ...job, total, state: total > job.done ? "running" : "done" };
        }
        // No provider set up: it waits for one, with no time (the server's shape for "no key").
        if ((out.state === "running" || out.state === "waiting") && !(await enabled())) return { state: "waiting", done: out.done, total: out.total };
        return publicState(out);
      },
      async control(action) {
        const job = await load();
        if (action === "pause" && (job.state === "running" || job.state === "waiting")) await save({ ...job, state: "paused" });
        if (action === "resume" && job.state === "paused") await save({ ...job, state: "running", retry_at: null });
        return this.status();
      },
      async nudge() {
        const job = await load();
        if (job.state === "done") await save({ ...job, state: "running", total: 0 });
      },
    };
  }

  const api = { createRefreshJob, META };
  globalThis.KotikoRefreshJob = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
