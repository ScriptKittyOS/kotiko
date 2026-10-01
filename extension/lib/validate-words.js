// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
// SPDX-License-Identifier: Apache-2.0

// Checks a word-list response before anything is cached or inserted into pages (slice 26,
// research 06 F31 and 03 E2). No DOM or extension APIs, so the same file runs in the
// background worker (globalThis.WordValidator) and in Node tests (module.exports).
//
//   validateWordsResponse({ status: 200, contentType: "application/json", body: "{...}" })
//     -> { ok: true, words, dropped: 0, reasons: {} }
//     -> { ok: false, code: "not_mira_server", message, details }
(() => {
  // Until slice 09's shared rules land, these constants are the client checks.
  const LIMITS = {
    maxWords: 20_000,
    maxLang: 35,
    maxNative: 64,
    // One character is allowed: a learner may add "I" or "a". Whether to swap such short
    // forms on a page is the matcher's call (slices 14 and 16), not the sync check's.
    minForm: 1,
    maxForm: 40,
    maxForms: 10,
  };

  // Length in characters (code points), not UTF-16 units.
  const len = (s) => [...s].length;
  const isTag = (v) => typeof v === "string" && v.length > 0 && v.length <= LIMITS.maxLang;
  const formText = (f) => (typeof f === "string" ? f : f && typeof f === "object" && typeof f.text === "string" ? f.text : null);
  const isForm = (f) => {
    const text = formText(f);
    if (text === null) return false;
    const n = len(text.trim());
    return n >= LIMITS.minForm && n <= LIMITS.maxForm;
  };

  // Returns null for a word that may be cached, or the reason it can't.
  function checkWord(w) {
    if (!w || typeof w !== "object" || Array.isArray(w)) return "not_an_object";
    if (!(Number.isInteger(w.id) || (typeof w.id === "string" && w.id.length > 0))) return "bad_id";
    if (!isTag(w.lang)) return "bad_lang";
    if ("base_lang" in w && w.base_lang !== undefined && !isTag(w.base_lang)) return "bad_base_lang";
    if (typeof w.native !== "string" || /[\r\n]/.test(w.native)) return "bad_native";
    const n = len(w.native);
    if (n < 1 || n > LIMITS.maxNative) return "bad_native";
    if (w.forms != null && !Array.isArray(w.forms)) return "bad_forms";
    // Bad individual forms are removed by cleanForms; a word is only dropped when nothing
    // usable is left (no valid form and no valid `english` to fall back on).
    if (!cleanForms(w.forms ?? []).length && !isForm(w.english)) return "bad_forms";
    return null;
  }

  // Valid forms only, at most LIMITS.maxForms, in their original order.
  const cleanForms = (forms) => forms.filter(isForm).slice(0, LIMITS.maxForms);

  // Keeps the valid words (at most LIMITS.maxWords) and counts the rest by reason.
  function filterWords(list) {
    const reasons = {};
    const count = (r, n = 1) => (reasons[r] = (reasons[r] ?? 0) + n);
    let input = list;
    if (input.length > LIMITS.maxWords) {
      count("too_many_words", input.length - LIMITS.maxWords);
      input = input.slice(0, LIMITS.maxWords);
    }
    const words = [];
    let droppedForms = 0;
    for (const w of input) {
      const reason = checkWord(w);
      if (reason) {
        count(reason);
        continue;
      }
      // Keep the word object untouched unless some of its forms had to go, so a clean
      // response caches byte-identical to what the server sent.
      const forms = w.forms ?? [];
      const kept = cleanForms(forms);
      if (kept.length === forms.length) words.push(w);
      else {
        droppedForms += forms.length - kept.length;
        words.push({ ...w, forms: kept });
      }
    }
    const dropped = Object.values(reasons).reduce((a, b) => a + b, 0);
    return { words, dropped, reasons, droppedForms };
  }

  const error = (code, message, details = {}) => ({ ok: false, code, message, details });

  // raw: { status, contentType, body } where body is the response text.
  function validateWordsResponse(raw) {
    const status = raw?.status;
    const contentType = String(raw?.contentType ?? "");
    let body;
    try {
      body = JSON.parse(raw?.body ?? "");
    } catch {
      body = null;
    }
    const serverError = body && typeof body.error === "string" ? body.error.slice(0, 200) : undefined;

    if (status === 401) return error("server_key_rejected", "The server rejected the API token (401).", { status });
    if (status === 421) return error("server_address_invalid", "The server refused this address (421).", { status });
    if (status >= 500) {
      return error("internal", `The server answered ${status}.`, serverError ? { status, error: serverError } : { status });
    }
    if (status !== 200) return error("not_mira_server", `The address answered ${status}, not a word list.`, { status });
    if (!/application\/json/i.test(contentType)) {
      return error("not_mira_server", `The address answered with ${contentType || "no content type"}, not JSON.`, {
        status,
        contentType,
      });
    }
    if (!body || typeof body !== "object" || !Array.isArray(body.words)) {
      return error("not_mira_server", "The answer isn't a word list.", { status });
    }
    return { ok: true, ...filterWords(body.words) };
  }

  const api = { LIMITS, checkWord, cleanForms, filterWords, validateWordsResponse };
  globalThis.WordValidator = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
