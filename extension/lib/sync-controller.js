// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
// SPDX-License-Identifier: Apache-2.0

// Keeps one word-list sync running at a time and makes sure every requested sync reflects
// the server at or after the moment it was requested (slice 26, research 06 F10 and F11).
// No DOM or extension APIs, so the same file runs in the background worker
// (globalThis.SyncController) and in Node tests (module.exports).
//
//   const sync = SyncController.createSyncController({
//     readCreds,                       // () => Promise<{serverUrl, token}>
//     fetchWords,                      // (creds, signal) => Promise<raw response>
//     validate,                        // raw => {ok: true, words, ...} | {ok: false, code, ...}
//     writeResult,                     // result => Promise, called only for current results
//   });
//   sync.request({ reason: "page" });  // never rejects
//   sync.credentialsChanged();         // abort the running request and start over
//   sync.update(fn, { reason: "add" }) // apply a local change, then sync
//
// A request made while a run is in flight doesn't share that run's (possibly older)
// answer: it waits for one follow-up run, which any number of such requests share.
// Results of a run superseded by new credentials or a local change are never written.
(() => {
  const DISCARD = Symbol("discard");

  function createSyncController({
    readCreds,
    fetchWords,
    writeResult,
    validate = (raw) => raw,
    now = () => Date.now(),
    timeoutMs = 20_000,
    throttleMs = 5_000,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (t) => clearTimeout(t),
  }) {
    let generation = 0;
    let running = null; // { gen, controller, promise, replacement }
    let pending = null; // { promise, resolve }
    let lastStartedAt = null;

    // Every write (sync results and local changes) goes through one queue, in order.
    let queue = Promise.resolve();
    function serial(fn) {
      const p = queue.then(fn);
      queue = p.catch(() => {});
      return p;
    }

    // Rejects as soon as `signal` aborts, even if `fetchWords` ignores the signal.
    function whenAborted(signal) {
      return new Promise((_, reject) => {
        const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (signal.aborted) fail();
        else signal.addEventListener("abort", fail, { once: true });
      });
    }

    function finish(run, result) {
      return serial(async () => {
        if (run.gen !== generation) return DISCARD;
        await writeResult(result);
        return result;
      });
    }

    async function execute(run) {
      try {
        const creds = await readCreds();
        if (run.gen !== generation) return DISCARD;
        if (!creds?.token) {
          return await finish(run, {
            ok: false,
            code: "server_key_rejected",
            message: "No API token is set.",
            details: { reason: "no_token" },
          });
        }

        let timedOut = false;
        const timer = setTimer(() => {
          timedOut = true;
          run.controller.abort();
        }, timeoutMs);
        let result;
        try {
          const { signal } = run.controller;
          const raw = await Promise.race([fetchWords(creds, signal), whenAborted(signal)]);
          if (run.gen !== generation) return DISCARD;
          result = validate(raw);
        } catch (e) {
          // Aborted because the credentials changed, or superseded: not an error.
          if (run.gen !== generation) return DISCARD;
          if (timedOut) {
            result = {
              ok: false,
              code: "server_unreachable",
              message: `No answer within ${Math.round(timeoutMs / 1000)} s.`,
              details: { reason: "timeout" },
            };
          } else if (e && typeof e.code === "string") {
            result = { ok: false, code: e.code, message: String(e.message ?? ""), details: e.details ?? {} };
          } else {
            result = {
              ok: false,
              code: "server_unreachable",
              message: String(e?.message ?? e),
              details: { reason: "network" },
            };
          }
        } finally {
          clearTimer(timer);
        }
        return await finish(run, result);
      } catch (e) {
        // readCreds or writeResult failed; nothing more we can do for this run.
        return { ok: false, code: "internal", message: String(e?.message ?? e), details: {} };
      }
    }

    function startRun() {
      const run = { gen: generation, controller: new AbortController(), promise: null, replacement: null };
      running = run;
      lastStartedAt = now();
      run.promise = execute(run).then((result) => {
        let next = null;
        if (running === run) {
          running = null;
          if (pending) {
            const p = pending;
            pending = null;
            p.resolve(startRun());
            next = p.promise;
          }
        }
        if (result !== DISCARD) return result;
        // A superseded run answers with the run that replaced it.
        return run.replacement ?? next ?? { ok: false, code: "superseded", message: "", details: {} };
      });
      return run.promise;
    }

    function request({ reason = "manual", force = false } = {}) {
      if (
        !force &&
        reason === "page" &&
        !pending &&
        lastStartedAt !== null &&
        now() - lastStartedAt < throttleMs
      ) {
        return Promise.resolve({ ok: true, skipped: true });
      }
      if (!running) return startRun();
      if (!pending) {
        let resolve;
        const promise = new Promise((r) => (resolve = r));
        pending = { promise, resolve };
      }
      return pending.promise;
    }

    function credentialsChanged() {
      generation++;
      const old = running;
      running = null;
      const fresh = startRun();
      if (old) {
        old.replacement = fresh;
        old.controller.abort();
      }
      if (pending) {
        const p = pending;
        pending = null;
        p.resolve(fresh);
      }
      return fresh;
    }

    // Applies a local change (an add or a remove) through the write queue, drops whatever
    // the running request returns (it may predate the change), then syncs.
    async function update(fn, { reason = "update" } = {}) {
      await serial(async () => {
        await fn();
        if (running) generation++;
      });
      return request({ reason, force: true });
    }

    return {
      request,
      credentialsChanged,
      update,
      // For tests and debugging.
      state: () => ({ generation, running: !!running, pending: !!pending, lastStartedAt }),
    };
  }

  const api = { createSyncController };
  globalThis.SyncController = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
