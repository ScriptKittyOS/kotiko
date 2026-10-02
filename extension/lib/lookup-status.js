// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// What the lookup client reports, in the learner's words (slices 10 and 25): the free
// lookups left today, and the message for a failed lookup's code. Pure: it returns
// message keys and their values, and the page calls KotikoI18n.t() with them, so the popup
// and the dashboard say the same thing.
//
//   quotaLine(status, {locale, now})      -> {key, params} | null
//   lookupProblem(code, details, {locale}) -> {key, params} | null (null: not a lookup code)
//
// `status` is the server's GET /api/v1/llm/status (slice 10 §3), as the background keeps it
// in storage.local.lookupStatus: {provider, quota: {used, limit, remaining, resets_at,
// estimated} | null}. The line shows at `show_at_or_below` (20) or fewer lookups left.
(() => {
  const SPEC = globalThis.KOTIKO_SPEC?.models?.policy?.quota;
  const SHOW_AT = SPEC?.show_at_or_below ?? 20;
  const PROVIDERS = { openrouter: "OpenRouter" };

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

  function lookupProblem(code, details = {}, { locale = "en" } = {}) {
    const d = details ?? {};
    const provider = providerName(d.provider);
    switch (code) {
      case "quota_exhausted": {
        if (d.reason === "payment_required") {
          return provider ? { key: "error_quota_exhausted_payment_required", params: { provider } } : { key: "error_quota_exhausted_payment_required_generic", params: {} };
        }
        const at = time(d.retry_at, locale);
        return at ? { key: "error_quota_exhausted", params: { time: at } } : { key: "error_quota_exhausted_today", params: {} };
      }
      case "rate_limited":
        return { key: "error_rate_limited", params: {} };
      case "model_unavailable":
        return { key: "error_model_unavailable", params: {} };
      case "lookup_timeout":
        return { key: "error_lookup_timeout", params: {} };
      case "bad_lookup_result":
        return { key: "error_bad_lookup_result", params: {} };
      case "key_rejected":
        return provider ? { key: "error_key_rejected", params: { provider } } : { key: "error_key_rejected_generic", params: {} };
      case "lookup_not_set_up":
        return { key: "error_lookup_not_set_up", params: {} };
      default:
        return null;
    }
  }

  // Every key the two functions can return, for the locale tests.
  const KEYS = [
    "popup_lookups_left",
    "popup_lookups_none",
    "popup_lookups_none_today",
    "error_quota_exhausted",
    "error_quota_exhausted_today",
    "error_quota_exhausted_payment_required",
    "error_quota_exhausted_payment_required_generic",
    "error_rate_limited",
    "error_model_unavailable",
    "error_lookup_timeout",
    "error_bad_lookup_result",
    "error_key_rejected",
    "error_key_rejected_generic",
    "error_lookup_not_set_up",
  ];

  const api = { quotaLine, lookupProblem, providerName, KEYS, SHOW_AT };
  globalThis.KotikoLookupStatus = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
