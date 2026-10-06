// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Routes runtime messages to handlers that declare who may call them (slice 26, research
// 03 E3): content scripts in web pages must not be able to add or delete words. No DOM,
// so the same file runs in the background worker (globalThis.MessageRouter) and in Node
// tests (module.exports).
//
//   ext.runtime.onMessage.addListener(MessageRouter.createMessageRouter({
//     runtime: ext.runtime,
//     handlers: {
//       sync: { from: ["page", "content"], run: (msg, sender) => ... },
//       add:  { from: ["page"], check: (msg) => ..., run: ... },
//     },
//   }));
//
// Sender kinds:
//   "page"     an extension page (popup, options, a tab showing an extension page)
//   "content"  a content script in an http(s) page
//   "docs"     a content script on the docs site (`docsOrigin`): content/connect.js
// A known type from a sender it doesn't allow answers {error: {code: "forbidden"}}; an
// unknown type gets no answer, so another listener could still take it.
(() => {
  function senderKinds(sender, runtime, docsOrigin = null) {
    const kinds = new Set();
    if (!sender || !runtime || sender.id !== runtime.id) return kinds;
    const url = typeof sender.url === "string" ? sender.url : "";
    const base = runtime.getURL("");
    if (url && base && url.startsWith(base)) kinds.add("page");
    else if (sender.tab && /^https?:\/\//i.test(url)) {
      kinds.add("content");
      try {
        if (docsOrigin && new URL(url).origin === docsOrigin) kinds.add("docs");
      } catch {
        // not a URL; plain content
      }
    }
    return kinds;
  }

  function isAllowed(handler, kinds) {
    return (handler.from ?? []).some((k) => kinds.has(k));
  }

  function createMessageRouter({ runtime, handlers, docsOrigin = null, onError = null }) {
    function onMessage(msg, sender, sendResponse) {
      const type = msg && typeof msg === "object" ? msg.type : undefined;
      if (typeof type !== "string" || !Object.hasOwn(handlers, type)) return undefined;
      const handler = handlers[type];

      if (!isAllowed(handler, senderKinds(sender, runtime, docsOrigin))) {
        sendResponse({ error: { code: "forbidden" } });
        return undefined;
      }
      // A check names the problem, or gives slice 25's code for it: {code, message}.
      const problem = handler.check ? handler.check(msg) : null;
      if (problem) {
        sendResponse({ error: typeof problem === "object" ? { code: problem.code, message: problem.message } : { code: "invalid_message", message: problem } });
        return undefined;
      }

      Promise.resolve()
        .then(() => handler.run(msg, sender))
        .then(sendResponse, (e) => {
          if (onError) onError(e, msg);
          if (!e || typeof e.code !== "string") return sendResponse({ error: String(e?.message ?? e) });
          // Details (an HTTP status, a reason) let the UI choose its words (slice 25).
          const details = e.details && typeof e.details === "object" && Object.keys(e.details).length ? e.details : null;
          sendResponse({ error: String(e.message ?? e.code), code: e.code, ...(details ? { details } : {}) });
        });
      return true;
    }
    // Every type and who may send it, for the audit that sends each one from a content
    // script (slice 28 §7), so a new privileged message is covered the day it is added.
    onMessage.routes = Object.freeze(Object.fromEntries(Object.entries(handlers).map(([type, h]) => [type, Object.freeze([...(h.from ?? [])])])));
    return onMessage;
  }

  // Payload checks shared by handlers.
  const checks = {
    text: (v, max = 200) =>
      typeof v === "string" && v.length >= 1 && v.length <= max ? null : `text must be 1 to ${max} characters`,
    // The text of an add: too long or empty is the learner's to fix, so it has a code.
    addText: (v, max = 200) => {
      if (typeof v !== "string") return "text must be a string";
      if (!v.trim()) return { code: "empty_input", message: "text is empty" };
      // In characters (code points), as slice 09's max_input_chars counts them.
      return [...v].length <= max ? null : { code: "input_too_long", message: `text must be at most ${max} characters` };
    },
    id: (v) => (Number.isInteger(v) || (typeof v === "string" && v.length > 0) ? null : "id must be a string or an integer"),
  };

  const api = { senderKinds, createMessageRouter, checks };
  globalThis.MessageRouter = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
