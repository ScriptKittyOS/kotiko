// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// What the lookup client reports, in the learner's words (slice 10): the free lookups
// left today. Pure: it returns message keys and their values, and the page calls
// KotikoI18n.t() with them, so the popup and the dashboard say the same thing. A failed
// lookup's message is lib/errors.js's (slice 25), which uses providerName() and time().
//
//   quotaLine(status, {locale, now})      -> {key, params} | null
//
// `status` is the server's GET /api/v1/llm/status (slice 10 §3), as the background keeps it
// in storage.local.lookupStatus: {provider, quota: {used, limit, remaining, resets_at,
// estimated} | null}. The line shows at `show_at_or_below` (20) or fewer lookups left.
(() => {
  const SPEC = globalThis.KOTIKO_SPEC?.models?.policy?.quota;
  const SHOW_AT = SPEC?.show_at_or_below ?? 20;
  const PROVIDERS = { openrouter: "OpenRouter", openai: "OpenAI", anthropic: "Anthropic", gemini: "Google Gemini", groq: "Groq", ollama: "Ollama", lmstudio: "LM Studio" };

  function time(iso, locale) {
    const at = Date.parse(iso ?? "");
    if (!Number.isFinite(at)) return null;
    try {
      return new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(new Date(at));
    } catch {
      return new Date(at).toISOString().slice(11, 16);
    }
  }

  function quotaLine(status, { locale = "en", now = Date.now(), showAt = SHOW_AT } = {}) {
    const q = status?.quota;
    if (!q || typeof q.remaining !== "number") return null;
    // Numbers from before the last reset say nothing about today.
    if (q.resets_at && Date.parse(q.resets_at) <= now) return null;
    if (q.remaining > showAt) return null;
    if (q.remaining <= 0) {
      const at = time(q.resets_at, locale);
      return at ? { key: "popup_lookups_none", params: { time: at } } : { key: "popup_lookups_none_today", params: {} };
    }
    return { key: "popup_lookups_left", params: { count: q.remaining } };
  }

  // The provider's name for a message: OpenRouter, or the host the server reported.
  function providerName(provider) {
    if (!provider) return null;
    return PROVIDERS[provider] ?? provider;
  }

  // Every key quotaLine() can return, for the locale tests.
  const KEYS = ["popup_lookups_left", "popup_lookups_none", "popup_lookups_none_today"];

  const api = { quotaLine, providerName, time, KEYS, SHOW_AT };
  globalThis.KotikoLookupStatus = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
