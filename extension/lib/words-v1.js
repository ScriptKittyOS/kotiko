// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The background's word routes for extension pages (slice 21, server mode): read, edit,
// delete, restore and add words through the server's `/api/v1` (slice 07 §5), and the
// pronunciation-refresh job. Message handlers for MessageRouter; only extension pages may
// call them. No DOM, so the same file runs in the background (globalThis.KotikoWordsV1)
// and in Node tests (module.exports).
//
//   handlers: { ...KotikoWordsV1.createWordHandlers({ call, storage, afterWrite }) }
//
//   call(path, { method, body })  -> parsed JSON, or throws {code, message, details}
//   storage                       -> ext.storage.local
//   afterWrite()                  -> refresh the pages' word list (the legacy sync)
//
// Slice 11 replaces this with the extension's own IndexedDB store; the dashboard reaches
// either through lib/word-source.js.
(() => {
  const DELETED_DAYS = 30;
  const MAX_DELETED = 5000;
  const MAX_OPS = 1000;
  const CONCURRENCY = 6;
  const DAY = 86_400_000;

  const isId = (v) => typeof v === "string" && v.length > 0 && v.length <= 64;
  const OPS = new Set(["patch", "delete", "restore"]);

  function checkOps(msg) {
    if (!Array.isArray(msg.ops) || !msg.ops.length || msg.ops.length > MAX_OPS) return `ops must be 1 to ${MAX_OPS} operations`;
    for (const op of msg.ops) {
      if (!op || !OPS.has(op.op) || !isId(op.id)) return "each op needs op (patch, delete or restore) and an id";
      if (op.op === "patch" && (!op.patch || typeof op.patch !== "object" || Array.isArray(op.patch))) return "a patch op needs a patch object";
    }
    return null;
  }

  // Runs `fn` over `items` with at most `n` at a time; results keep the items' order.
  async function pool(items, n, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
    return out;
  }

  const failure = (e) => ({
    ok: false,
    code: typeof e?.code === "string" ? e.code : "internal",
    message: String(e?.message ?? e ?? ""),
    details: e?.details && typeof e.details === "object" ? e.details : {},
  });

  function createWordHandlers({ call, storage, afterWrite = () => {}, now = () => Date.now(), from = ["page"] }) {
    // Storage writes of `recentlyDeleted` and `wordsVersion` go through one queue, each
    // reading the current value inside it.
    let queue = Promise.resolve();
    const serial = (fn) => {
      const p = queue.then(fn);
      queue = p.catch(() => {});
      return p;
    };

    // Words deleted from this browser, for the dashboard's Recently deleted (§3): the server
    // keeps tombstones 30 days but has no route that lists them.
    function recordDeletes(results, ops, clientId) {
      return serial(async () => {
        const { recentlyDeleted = [] } = await storage.get({ recentlyDeleted: [] });
        const t = now();
        let list = recentlyDeleted.filter((e) => e && t - (e.at ?? 0) < DELETED_DAYS * DAY);
        ops.forEach((op, i) => {
          const r = results[i];
          if (op.op === "delete" && r.ok) {
            list = list.filter((e) => e.id !== op.id);
            list.push({ id: op.id, at: t, word: r.word });
          }
          if (op.op === "restore" && (r.ok || r.code === "word_gone")) list = list.filter((e) => e.id !== op.id);
        });
        if (list.length > MAX_DELETED) list = list.slice(-MAX_DELETED);
        await storage.set({ recentlyDeleted: list, wordsVersion: { at: t, by: typeof clientId === "string" ? clientId : null } });
      });
    }

    async function runOp(op) {
      const id = encodeURIComponent(op.id);
      try {
        if (op.op === "patch") {
          const body = { ...op.patch };
          if (typeof op.if_updated_at === "string") body.if_updated_at = op.if_updated_at;
          return { ok: true, ...(await call(`/api/v1/words/${id}`, { method: "PATCH", body })) };
        }
        if (op.op === "delete") return { ok: true, ...(await call(`/api/v1/words/${id}`, { method: "DELETE" })) };
        return { ok: true, ...(await call(`/api/v1/words/${id}/restore`, { method: "POST", body: {} })) };
      } catch (e) {
        return failure(e);
      }
    }

    return {
      "words.list": {
        from,
        async run() {
          const res = await call("/api/v1/words?status=active,paused", { method: "GET" });
          return { words: Array.isArray(res?.words) ? res.words : [], cursor: res?.cursor ?? null };
        },
      },
      "words.write": {
        from,
        check: checkOps,
        async run(msg) {
          const results = await pool(msg.ops, CONCURRENCY, runOp);
          if (results.some((r) => r.ok) || msg.ops.some((o) => o.op === "restore")) {
            await recordDeletes(results, msg.ops, msg.clientId);
            Promise.resolve().then(afterWrite).catch(() => {});
          }
          return { results };
        },
      },
      "words.deleted": {
        from,
        async run() {
          const { recentlyDeleted = [] } = await storage.get({ recentlyDeleted: [] });
          const t = now();
          return { entries: recentlyDeleted.filter((e) => e && t - (e.at ?? 0) < DELETED_DAYS * DAY) };
        },
      },
      "words.preview": {
        from,
        check: (msg) =>
          typeof msg.text !== "string" || !msg.text.trim() || [...msg.text].length > 200
            ? "text must be 1 to 200 characters"
            : !Array.isArray(msg.base_langs) || !msg.base_langs.length || msg.base_langs.length > 4
              ? "base_langs must list 1 to 4 languages"
              : null,
        async run(msg) {
          const body = { text: msg.text, preview: true, base_langs: msg.base_langs };
          if (typeof msg.hint_lang === "string" && msg.hint_lang) body.hint_lang = msg.hint_lang;
          return call("/api/v1/words", { method: "POST", body });
        },
      },
      "words.save": {
        from,
        check: (msg) =>
          !Array.isArray(msg.words) || !msg.words.length || msg.words.length > 500 || msg.words.some((w) => !w || typeof w !== "object")
            ? "words must be 1 to 500 word objects"
            : null,
        async run(msg) {
          const crid = typeof msg.client_request_id === "string" ? msg.client_request_id : undefined;
          const res =
            msg.words.length === 1
              ? await call("/api/v1/words", { method: "POST", body: { word: msg.words[0], client_request_id: crid } })
              : await call("/api/v1/words/batch", { method: "POST", body: { words: msg.words, client_request_id: crid } });
          await serial(() => storage.set({ wordsVersion: { at: now(), by: typeof msg.clientId === "string" ? msg.clientId : null } }));
          Promise.resolve().then(afterWrite).catch(() => {});
          return res;
        },
      },
      "job.refresh": {
        from,
        check: (msg) => (msg.action === undefined || msg.action === "pause" || msg.action === "resume" ? null : "action must be pause or resume"),
        async run(msg) {
          if (msg.action) return call("/api/v1/jobs/pronunciation-refresh", { method: "POST", body: { action: msg.action } });
          return call("/api/v1/jobs/pronunciation-refresh", { method: "GET" });
        },
      },
    };
  }

  const api = { createWordHandlers, checkOps, pool, DELETED_DAYS };
  globalThis.KotikoWordsV1 = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
