// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
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
//   "docs"     a content script on the docs site (`docsOrigin`); none exists yet
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
    return function onMessage(msg, sender, sendResponse) {
      const type = msg && typeof msg === "object" ? msg.type : undefined;
      if (typeof type !== "string" || !Object.hasOwn(handlers, type)) return undefined;
      const handler = handlers[type];

      if (!isAllowed(handler, senderKinds(sender, runtime, docsOrigin))) {
        sendResponse({ error: { code: "forbidden" } });
        return undefined;
      }
      const problem = handler.check ? handler.check(msg) : null;
      if (problem) {
        sendResponse({ error: { code: "invalid_message", message: problem } });
        return undefined;
      }

      Promise.resolve()
        .then(() => handler.run(msg, sender))
        .then(sendResponse, (e) => {
          if (onError) onError(e, msg);
          sendResponse(e && typeof e.code === "string"
            ? { error: String(e.message ?? e.code), code: e.code }
            : { error: String(e?.message ?? e) });
        });
      return true;
    };
  }

  // Payload checks shared by handlers.
  const checks = {
    text: (v, max = 200) =>
      typeof v === "string" && v.length >= 1 && v.length <= max ? null : `text must be 1 to ${max} characters`,
    id: (v) => (Number.isInteger(v) || (typeof v === "string" && v.length > 0) ? null : "id must be a string or an integer"),
  };

  const api = { senderKinds, createMessageRouter, checks };
  globalThis.MessageRouter = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
