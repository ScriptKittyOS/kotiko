// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Add jobs that never block the interface (slice 11 section 5, the core of slice 24):
// every add is persisted in storage.local `addJobs` before any network call, runs in the
// background, survives the popup closing and the worker restarting, and waits (instead of
// failing) when the model is busy, the free lookups ran out or no provider is set up yet.
// Pages render the jobs from storage; replies never carry results.
//
//   const q = KotikoAddQueue.createAddQueue({ storage, lookup, save, now, isFunctionWord });
//   await q.add({id, text, hintLang, baseLangs, surface})   persisted, then run
//   await q.choose(id, keys)  a needs_choice job saves the words whose key it lists
//   await q.setUndo(id, key, patch)  writes an Undo's outcome on the word's results
//   q.kick()            run due jobs (the alarm, `online`)
//   q.wake()            waiting jobs are due now (a key was saved, the provider changed)
//   q.abortRunning()    stop running attempts; they run again with the new settings
//   await q.resume()    at worker start: jobs left looking_up are queued again (same id)
//
// lookup(job, signal) -> {ok: true, result: {words, rejected, missing_bases, code}}
//                      | {ok: false, error: {code, details}}
// save(job, words)    -> [{result, word, previous}]  (one transaction keyed by job.id)
//
// Job (slice 24 section 1): {id, surface, text, hintLang, baseLangs, manual, state,
// createdAt, startedAt, attempts, waits, error, candidates, results, rejected, missingBases,
// retryAt, seen}. States: queued, looking_up, waiting, needs_choice, done, failed,
// cancelled. A word's key is its language and native spelling: one target word, whatever
// the number of bases it has a record for (犬 for es and en is one word).
(() => {
  const MAX_JOBS = 20;
  const KEEP_MS = 7 * 86_400_000;
  const MAX_WAIT_MS = 3 * 86_400_000;
  const BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000];
  const SHORT_TIMER_MS = 5 * 60_000;
  const OFFLINE_MS = 10 * 60_000;
  // A retry time already past (or a wait of a few milliseconds) still waits this long, so a
  // busy provider is never asked in a tight loop.
  const MIN_WAIT_MS = 2_000;
  // Slice 24 section 2: these wait and retry; everything else fails.
  // address_changed (slice 28 §7): the settings pointed somewhere the learner didn't choose.
  // The background puts the trusted address back at once, so the job tries again shortly
  // (the gate still sends nothing anywhere else).
  const WAIT = new Set(["offline", "server_unreachable", "rate_limited", "model_unavailable", "lookup_timeout", "quota_exhausted", "user_quota_exhausted", "lookup_not_set_up", "address_changed"]);
  const FINISHED = new Set(["done", "failed", "cancelled"]);
  // Slice 24 section 2: a lookup that finds this many target words asks before saving.
  const CONFIRM_AT = 4;
  const keyOf = (w) => `${w?.lang}\u001f${w?.native}`;

  function createAddQueue({
    storage,
    lookup,
    save,
    now = () => Date.now(),
    maxRunning = 2,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (t) => clearTimeout(t),
    onSettled = () => {},
    onError = () => {},
    // Function words (the target language's stopwords) start unticked in needs_choice.
    isFunctionWord = () => false,
  }) {
    const running = new Map(); // id -> AbortController
    let timer = null;
    let queue = Promise.resolve();

    // Every read-modify-write of addJobs goes through one queue.
    function serial(fn) {
      const p = queue.then(fn);
      queue = p.catch(() => {});
      return p;
    }

    async function read() {
      const { addJobs } = await storage.get({ addJobs: [] });
      return Array.isArray(addJobs) ? addJobs : [];
    }

    // The 20 most recent jobs; finished ones older than 7 days go. Unfinished jobs are
    // never dropped.
    function trim(jobs) {
      const t = now();
      const kept = jobs.filter((j) => !(FINISHED.has(j.state) && t - (j.finishedAt ?? j.createdAt) > KEEP_MS));
      const unfinished = kept.filter((j) => !FINISHED.has(j.state));
      const finished = kept.filter((j) => FINISHED.has(j.state)).slice(0, Math.max(MAX_JOBS - unfinished.length, 0));
      const ids = new Set([...unfinished, ...finished].map((j) => j.id));
      return kept.filter((j) => ids.has(j.id));
    }

    function change(id, fn) {
      return serial(async () => {
        const jobs = await read();
        const i = jobs.findIndex((j) => j.id === id);
        if (i < 0) return null;
        const next = fn({ ...jobs[i] });
        if (!next) return jobs[i];
        jobs[i] = next;
        await storage.set({ addJobs: trim(jobs) });
        return next;
      });
    }

    async function add(input) {
      const job = {
        id: input.id,
        surface: input.surface ?? "popup",
        text: input.text,
        hintLang: input.hintLang ?? null,
        baseLangs: input.baseLangs ?? [],
        manual: input.manual ?? null,
        // 24 §6: the job this one re-adds in another language, {id, key}; its word is
        // retired once this one succeeds.
        replaces: input.replaces ?? null,
        state: "queued",
        createdAt: now(),
        startedAt: null,
        finishedAt: null,
        attempts: 0,
        waits: 0,
        error: null,
        results: [],
        rejected: [],
        missingBases: [],
        retryAt: null,
        seen: false,
      };
      const stored = await serial(async () => {
        const jobs = await read();
        const existing = jobs.find((j) => j.id === job.id);
        if (existing) return existing;
        await storage.set({ addJobs: trim([job, ...jobs]) });
        return job;
      });
      kick();
      return stored;
    }

    const due = (j) => j.state === "queued" || (j.state === "waiting" && j.retryAt !== null && j.retryAt <= now());

    function schedule(jobs) {
      if (timer) clearTimer(timer);
      timer = null;
      const next = jobs.filter((j) => j.state === "waiting" && j.retryAt !== null).map((j) => j.retryAt - now());
      if (!next.length) return;
      const wait = Math.max(0, Math.min(...next));
      // Longer waits are picked up by the background's minute alarm (a worker may sleep).
      if (wait <= SHORT_TIMER_MS) timer = setTimer(() => kick(), wait + 5);
    }

    function kick() {
      return serial(async () => {
        const jobs = await read();
        // Oldest first; the list is newest first, so a later position is an older job.
        const startable = jobs
          .map((j, i) => [j, i])
          .filter(([j]) => due(j) && !running.has(j.id))
          .sort(([a, i], [b, k]) => a.createdAt - b.createdAt || k - i)
          .map(([j]) => j);
        const room = Math.max(maxRunning - running.size, 0);
        for (const j of startable.slice(0, room)) start(j.id);
        schedule(jobs);
      });
    }

    function start(id) {
      const ctl = new AbortController();
      running.set(id, ctl);
      run(id, ctl.signal)
        .catch((e) => onError(e))
        .finally(() => {
          running.delete(id);
          kick();
        });
    }

    function waitFor(job, error) {
      const tooLong = now() - job.createdAt > MAX_WAIT_MS;
      if (tooLong) return { ...job, state: "failed", error, finishedAt: now(), retryAt: null };
      const at = Date.parse(error.details?.retry_at ?? "");
      // No provider yet: wait until settings are saved (wake), not on a timer. A changed
      // address retries after MIN_WAIT_MS: the repair's wake can come before this job is
      // marked waiting, so waiting for a wake alone could wait forever. Offline: the
      // `online` event wakes it; the alarm looks again after OFFLINE_MS in case the event
      // came while the worker slept.
      const retryAt = error.code === "lookup_not_set_up" ? null : error.code === "address_changed" ? now() + MIN_WAIT_MS : error.code === "offline" ? now() + OFFLINE_MS : Number.isFinite(at) ? Math.max(at, now() + MIN_WAIT_MS) : now() + BACKOFF_MS[Math.min(job.waits, BACKOFF_MS.length - 1)];
      return { ...job, state: "waiting", error, retryAt, waits: job.waits + 1 };
    }

    async function run(id, signal) {
      const job = await change(id, (j) => (due(j) ? { ...j, state: "looking_up", startedAt: now(), attempts: j.attempts + 1, retryAt: null } : null));
      if (!job || job.state !== "looking_up") return;
      let res;
      try {
        res = await lookup(job, signal);
      } catch (e) {
        if (e?.name === "AbortError") {
          // New settings: run again with them, as if never started.
          await change(id, (j) => (j.state === "looking_up" ? { ...j, state: "queued", attempts: Math.max(j.attempts - 1, 0) } : null));
          return;
        }
        res = { ok: false, error: { code: typeof e?.code === "string" ? e.code : "internal", details: e?.details ?? {} } };
      }
      if (signal.aborted) {
        await change(id, (j) => (j.state === "looking_up" ? { ...j, state: "queued", attempts: Math.max(j.attempts - 1, 0) } : null));
        return;
      }
      let next;
      const words = res.ok ? res.result?.words ?? [] : [];
      if (words.length && !job.manual && new Set(words.map(keyOf)).size >= CONFIRM_AT) {
        // Many words from one add (a pasted sentence): nothing is saved until the learner
        // picks, function words unticked.
        const candidates = words.map((w) => ({ ...w, unticked: !!isFunctionWord(w) }));
        next = (j) => ({ ...j, state: "needs_choice", error: null, candidates, rejected: res.result.rejected ?? [], missingBases: res.result.missing_bases ?? [] });
      } else if (words.length) {
        next = await saved(job, words, res.result);
      } else if (res.ok) {
        const code = res.result?.code ?? "no_word_found";
        const error = { code, details: res.result?.reply ? { reply: res.result.reply } : {} };
        next = (j) => ({ ...j, state: "failed", error, rejected: res.result?.rejected ?? [], finishedAt: now() });
      } else {
        const error = res.error ?? { code: "internal", details: {} };
        // bad_lookup_result fails after one retry; the others in WAIT wait. A provider that
        // wants payment (402) won't answer later either: it fails, with no retry (25 §2).
        const unpaid = error.code === "quota_exhausted" && error.details?.reason === "payment_required";
        if (error.code === "bad_lookup_result" && job.attempts < 2) next = (j) => ({ ...j, state: "waiting", error, retryAt: now() + BACKOFF_MS[0], waits: j.waits + 1 });
        else if (WAIT.has(error.code) && !unpaid) next = (j) => waitFor(j, error);
        else next = (j) => ({ ...j, state: "failed", error, finishedAt: now() });
      }
      const settled = await change(id, (j) => (j.state === "looking_up" ? next(j) : null));
      if (settled) onSettled(settled);
    }

    // Saves a job's words; the change that finishes the job.
    async function saved(job, words, result = {}) {
      try {
        const results = await save(job, words);
        return (j) => ({
          ...j,
          state: "done",
          finishedAt: now(),
          error: null,
          candidates: null,
          results: results.map((r) => ({ wordId: r.word?.id ?? null, baseLang: r.word?.base_lang ?? null, result: r.result, word: r.word, previous: r.previous ?? null, undo: null })),
          rejected: result.rejected ?? j.rejected ?? [],
          missingBases: result.missing_bases ?? j.missingBases ?? [],
        });
      } catch (e) {
        const error = { code: typeof e?.code === "string" ? e.code : "internal", details: e?.details ?? {} };
        return (j) => (WAIT.has(error.code) ? waitFor(j, error) : { ...j, state: "failed", error, finishedAt: now() });
      }
    }

    // The learner's pick in needs_choice: the listed words are saved; none cancels.
    async function choose(id, keys) {
      const want = new Set(keys);
      const job = (await read()).find((j) => j.id === id);
      if (!job || job.state !== "needs_choice") return job ?? null;
      const words = (job.candidates ?? []).filter((w) => want.has(keyOf(w))).map((w) => Object.fromEntries(Object.entries(w).filter(([k]) => k !== "unticked")));
      if (!words.length) return change(id, (j) => (j.state === "needs_choice" ? { ...j, state: "cancelled", candidates: null, finishedAt: now() } : null));
      const next = await saved({ ...job, chosen: true }, words);
      const done = await change(id, (j) => (j.state === "needs_choice" ? next(j) : null));
      if (done) onSettled(done);
      return done;
    }

    return {
      add,
      kick,
      // Waiting jobs are due now: a key was saved, the provider changed, the network is back.
      wake() {
        return serial(async () => {
          const jobs = await read();
          let changed = false;
          const next = jobs.map((j) => {
            if (j.state !== "waiting") return j;
            changed = true;
            return { ...j, retryAt: now() };
          });
          if (changed) await storage.set({ addJobs: next });
        }).then(() => kick());
      },
      abortRunning() {
        for (const ctl of running.values()) ctl.abort();
      },
      async resume() {
        await serial(async () => {
          const jobs = await read();
          let changed = false;
          const next = jobs.map((j) => {
            if (j.state !== "looking_up" || running.has(j.id)) return j;
            changed = true;
            return { ...j, state: "queued" };
          });
          if (changed) await storage.set({ addJobs: next });
        });
        return kick();
      },
      retry: (id) => change(id, (j) => (j.state === "failed" || j.state === "waiting" ? { ...j, state: "queued", error: null, retryAt: null, finishedAt: null } : null)).then((j) => (kick(), j)),
      cancel: (id) => change(id, (j) => (FINISHED.has(j.state) ? null : { ...j, state: "cancelled", finishedAt: now(), retryAt: null })).then((j) => {
        running.get(id)?.abort();
        return j;
      }),
      dismiss: (id) => serial(async () => {
        const jobs = await read();
        const next = jobs.filter((j) => j.id !== id || !FINISHED.has(j.state));
        if (next.length !== jobs.length) await storage.set({ addJobs: next });
      }),
      choose,
      // Sets fields on a job (replacedBy, after a re-add in another language succeeded).
      patch: (id, fields) => change(id, (j) => ({ ...j, ...fields })),
      markUndo: (id, wordId, undo) => change(id, (j) => ({ ...j, results: j.results.map((r) => (r.wordId === wordId ? { ...r, undo } : r)) })),
      // An Undo's outcome on every record of one word: {undo: "pending" | "done" | "failed",
      // undoError?, word?} (word: the restored record, after "Add it back").
      setUndo: (id, key, patch) => change(id, (j) => ({ ...j, results: j.results.map((r) => (keyOf(r.word) === key ? { ...r, ...patch } : r)) })),
      markSeen: (ids) => serial(async () => {
        const jobs = await read();
        const want = new Set(ids);
        if (!jobs.some((j) => want.has(j.id) && !j.seen && FINISHED.has(j.state))) return;
        await storage.set({ addJobs: jobs.map((j) => (want.has(j.id) && FINISHED.has(j.state) ? { ...j, seen: true } : j)) });
      }),
      // True while an add job is running or waiting: background jobs (the pronunciation
      // refresh) wait, so the learner's adds always go first.
      async busy() {
        if (running.size) return true;
        return (await read()).some((j) => j.state === "queued" || j.state === "looking_up" || (j.state === "waiting" && j.error?.code !== "lookup_not_set_up"));
      },
      running: () => running.size,
    };
  }

  const api = { createAddQueue, WAIT, MAX_JOBS, CONFIRM_AT, keyOf };
  globalThis.KotikoAddQueue = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
