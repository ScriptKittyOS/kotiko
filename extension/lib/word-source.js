// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Where the dashboard reads and writes words (slice 21 §10). Today: the self-hosted
// server's `/api/v1`, reached through the background (lib/words-v1.js). Slice 11 adds a
// source over the extension's own IndexedDB store with the same methods, and the dashboard
// picks one without changing anything else. No DOM, so it runs in extension pages
// (globalThis.KotikoWordSource) and in Node tests (module.exports).
//
//   const source = KotikoWordSource.createServerSource({ send, storage, onChanged });
//   await source.list()                    -> [record]          active and paused words
//   await source.deleted()                 -> [{id, at, word}]  tombstones, newest last
//   await source.write([{op: "patch", id, patch, if_updated_at}, {op: "delete", id}, ...])
//                                          -> [{ok, word} | {ok: false, code, message, details}]
//   await source.preview(text, {baseLangs, hintLang}) -> {candidates, rejected}
//   await source.save(words, {requestId})  -> {results, rejected}
//   await source.refreshJob(action?)       -> {state, done, total, retry_at}
//   source.subscribe(fn)                   -> unsubscribe; fn({reason}) when words may have
//                                             changed elsewhere (popup, Telegram, refresh job)
//
// Errors come back as {code, message, details} (slice 25 codes), thrown by list, preview,
// save and refreshJob and returned per operation by write.
(() => {
  const OWN_WINDOW_MS = 30_000;

  const coded = (res) => Object.assign(new Error(typeof res.error === "string" ? res.error : res.code ?? "internal"), {
    code: res.code ?? "internal",
    details: res.details ?? {},
  });

  // Keys of the pages' word list (`storage.local.words`, the legacy projection) whose
  // content differs between two versions of it.
  function changedKeys(before, after) {
    const sig = (list) => {
      const m = new Map();
      for (const w of Array.isArray(list) ? list : []) {
        if (!w || typeof w !== "object") continue;
        const k = `${w.lang}\u0001${String(w.native ?? "").normalize("NFC").toLowerCase()}`;
        m.set(k, (m.get(k) ?? "") + JSON.stringify(w));
      }
      return m;
    };
    const a = sig(before);
    const b = sig(after);
    const out = new Set();
    for (const [k, v] of a) if (b.get(k) !== v) out.add(k);
    for (const k of b.keys()) if (!a.has(k)) out.add(k);
    return out;
  }

  function createServerSource({ send, onChanged = null, now = () => Date.now(), clientId = `dash-${Math.random().toString(36).slice(2)}` }) {
    const listeners = new Set();
    // Words this page wrote recently, by lang + native key, so the background's echo of our
    // own edit (the pages' list changing a moment later) doesn't reload everything.
    const own = new Map();

    async function ask(msg) {
      let res;
      try {
        res = await send(msg);
      } catch (e) {
        throw Object.assign(new Error(String(e?.message ?? e)), { code: "internal", details: {} });
      }
      if (res?.error) throw coded(res);
      return res ?? {};
    }

    const emit = (reason) => {
      for (const fn of listeners) {
        try {
          fn({ reason });
        } catch {
          // a listener's problem isn't the source's
        }
      }
    };

    function noteOwn(words) {
      const t = now();
      for (const w of words) {
        if (!w?.lang || typeof w.native !== "string") continue;
        own.set(`${w.lang}\u0001${w.native.normalize("NFC").toLowerCase()}`, t);
      }
    }

    function explainedByOwn(keys) {
      const t = now();
      for (const [k, at] of own) if (t - at > OWN_WINDOW_MS) own.delete(k);
      for (const k of keys) if (!own.has(k)) return false;
      return true;
    }

    function onStorage(changes, area) {
      if (area !== "local") return;
      const other = changes.wordsVersion && changes.wordsVersion.newValue?.by !== clientId;
      if (other) emit("version");
      else if (changes.words) {
        const keys = changedKeys(changes.words.oldValue, changes.words.newValue);
        if (keys.size && !explainedByOwn(keys)) emit("sync");
      }
      if (changes.recentlyDeleted) emit("deleted");
    }

    return {
      kind: "server",
      clientId,
      async list() {
        const res = await ask({ type: "words.list" });
        return Array.isArray(res.words) ? res.words : [];
      },
      async deleted() {
        const res = await ask({ type: "words.deleted" });
        return Array.isArray(res.entries) ? res.entries : [];
      },
      // Writes in one message; the background runs them a few at a time. `touch` lists the
      // words (before and after) the page expects to change, for the echo filter.
      async write(ops, { touch = [] } = {}) {
        noteOwn(touch);
        let res;
        try {
          res = await send({ type: "words.write", ops, clientId });
        } catch (e) {
          res = { error: String(e?.message ?? e), code: "internal" };
        }
        if (res?.error) return ops.map(() => ({ ok: false, code: res.code ?? "internal", message: String(res.error), details: res.details ?? {} }));
        const results = Array.isArray(res?.results) ? res.results : [];
        noteOwn(results.map((r) => r?.word).filter(Boolean));
        return ops.map((_, i) => results[i] ?? { ok: false, code: "internal", message: "", details: {} });
      },
      async preview(text, { baseLangs = ["en"], hintLang = null } = {}) {
        const res = await ask({ type: "words.preview", text, base_langs: baseLangs, hint_lang: hintLang ?? undefined });
        return { candidates: Array.isArray(res.candidates) ? res.candidates : [], rejected: res.rejected ?? [], reply: res.reply ?? null };
      },
      async save(words, { requestId } = {}) {
        noteOwn(words);
        const res = await ask({ type: "words.save", words, client_request_id: requestId, clientId });
        const results = Array.isArray(res.results) ? res.results : [];
        noteOwn(results.map((r) => r?.word).filter(Boolean));
        return { results, rejected: res.rejected ?? [] };
      },
      async refreshJob(action) {
        return ask(action ? { type: "job.refresh", action } : { type: "job.refresh" });
      },
      // Asks the background to sync now (the dashboard does this when it gains focus, §10).
      async syncNow() {
        try {
          await send({ type: "sync", force: true });
        } catch {
          // the next alarm syncs anyway
        }
      },
      subscribe(fn) {
        listeners.add(fn);
        if (listeners.size === 1) onChanged?.addListener(onStorage);
        return () => {
          listeners.delete(fn);
          if (!listeners.size) onChanged?.removeListener?.(onStorage);
        };
      },
    };
  }

  const api = { createServerSource, changedKeys };
  globalThis.KotikoWordSource = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
