// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Plain-language errors (slice 25): the catalog of error codes, and the one place that turns
// a failure into what the learner reads, for the popup, the dashboard and the welcome tab.
// Codes travel on the wire and in storage; words are chosen here, in the interface language.
//
//   toError(anything)  -> {code, details} | null   (exceptions, replies, syncError, strings)
//   describe(err, ctx) -> {code, severity, key, params, actions, details} | null
//   message(err, ctx)  -> the main line, through KotikoI18n.t()
//   fromStatus(status) -> the code for an HTTP status that came without one
//   copyText(err, {version, browser}), copy(err) -> "Copy details", never the learner's words
//
// ctx: {n: words that work on pages, local: lookups run in this browser, online, surface:
// "banner" | "line", text: what was typed, base: a base's name, language: a word's language
// name}. Severities (25 §3): state, waiting, failed, blocking, info. `details` is technical
// text for "Details", never translated, never word data.
(() => {
  // Every code a learner can meet: its severity and its line's actions.
  const CODES = {
    offline: { severity: "state", transient: true },
    server_unreachable: { severity: "state", actions: ["retry", "settings"], transient: true },
    server_address_invalid: { severity: "blocking", actions: ["settings"] },
    not_kotiko_server: { severity: "blocking", actions: ["settings"] },
    server_key_rejected: { severity: "blocking", actions: ["settings"] },
    server_outdated: { severity: "state" },
    address_changed: { severity: "blocking", actions: ["settings"] },
    permission_missing: { severity: "blocking", actions: ["allow"] },
    lookup_not_set_up: { severity: "info", actions: ["setupLookups"] },
    key_rejected: { severity: "blocking", actions: ["setupLookups"] },
    quota_exhausted: { severity: "waiting", transient: true },
    rate_limited: { severity: "waiting", actions: ["retry"], transient: true },
    model_unavailable: { severity: "waiting", actions: ["retry"], transient: true },
    lookup_timeout: { severity: "waiting", actions: ["retry"], transient: true },
    bad_lookup_result: { severity: "failed", actions: ["retry"] },
    no_word_found: { severity: "failed" },
    rejected_same_as_gloss: { severity: "failed" },
    input_too_long: { severity: "failed", actions: ["bulk"] },
    empty_input: { severity: "failed" },
    invalid_word: { severity: "failed" },
    word_conflict: { severity: "failed" },
    word_gone: { severity: "info" },
    storage_full: { severity: "blocking" },
    vocabulary_full: { severity: "failed" },
    unsupported_page: { severity: "state" },
    internal: { severity: "failed", actions: ["retry"] },
  };

  // Codes that read as another: request errors and the background's guards are bugs or old
  // servers to the learner, nothing to fix in a form.
  const ALIASES = {
    not_found: "server_outdated",
    invalid_request: "internal",
    request_too_large: "internal",
    forbidden: "internal",
    invalid_message: "internal",
    job_gone: "internal",
    invalid_lang: "invalid_word",
    script_mismatch: "invalid_word",
  };

  // Codes that never reach a message: a job cancelled or a sync superseded on purpose.
  const SILENT = new Set(["cancelled", "superseded"]);

  // An HTTP status with no code of its own (an old server, a proxy in front of it).
  function fromStatus(status) {
    if (status === 401) return "server_key_rejected";
    if (status === 404 || status === 405) return "server_outdated";
    if (status === 421) return "server_address_invalid";
    if (status === 429) return "rate_limited";
    // A gateway or proxy that couldn't reach Kotiko: the server is down, not broken.
    if (status === 502 || status === 503 || status === 504 || status === 408) return "server_unreachable";
    return "internal";
  }

  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const offlineNow = () => globalThis.navigator?.onLine === false;

  function canonical(code, details) {
    if (code === "http_error") return fromStatus(details.status);
    if (Object.hasOwn(CODES, code) || SILENT.has(code)) return code;
    return ALIASES[code] ?? "internal";
  }

  // Anything a failure can be, as {code, details}; `details.text` keeps the background's or
  // the server's English message, for "Details" only.
  function toError(x) {
    if (x === null || x === undefined || x === false) return null;
    if (typeof x === "string") return { code: "internal", details: { text: x } };
    if (typeof x !== "object") return { code: "internal", details: { text: String(x) } };
    // A reply {error: {code, message, details}} or {error: "text", code, details}.
    const inner = isObj(x.error) ? x.error : null;
    const raw = (typeof x.code === "string" && x.code) || (typeof inner?.code === "string" && inner.code) || null;
    const details = { ...(isObj(inner?.details) ? inner.details : {}), ...(isObj(x.details) ? x.details : {}) };
    const text = typeof x.error === "string" ? x.error : typeof inner?.message === "string" ? inner.message : typeof x.message === "string" ? x.message : null;
    if (text && !details.text) details.text = text;
    if (!raw) {
      // A fetch that failed before any answer.
      if (x.name === "TypeError") return { code: offlineNow() ? "offline" : "server_unreachable", details: { reason: "network", ...details } };
      if (x.name === "QuotaExceededError") return { code: "storage_full", details: { reason: "QuotaExceededError", ...details } };
      if (typeof x.status === "number" && !x.ok) return { code: fromStatus(x.status), details: { status: x.status, ...details } };
      return { code: "internal", details };
    }
    const code = canonical(raw, details);
    if (code !== raw) details.code = raw;
    return { code, details };
  }

  const providerName = (p) => globalThis.KotikoLookupStatus?.providerName?.(p) ?? p ?? null;
  const time = (iso, locale) => globalThis.KotikoLookupStatus?.time?.(iso, locale) ?? null;
  const locale = () => globalThis.KotikoI18n?.locale?.() ?? "en";

  function resolve(code, d, ctx) {
    const n = typeof ctx.n === "number" ? ctx.n : 0;
    const count = (key) => (n ? { key, params: { count: n } } : { key: `${key}_empty`, params: {} });
    const provider = providerName(d.provider);
    switch (code) {
      case "offline":
        return count("error_offline");
      case "server_unreachable":
        return count("error_server_unreachable");
      case "server_key_rejected":
        // No access key saved yet: not an error on a banner; an add says to connect.
        if (d.reason === "no_token") return ctx.surface === "banner" ? null : { key: "error_add_not_connected" };
        return { key: "error_server_key_rejected" };
      case "server_address_invalid":
        return { key: d.reason === "host_not_allowed" ? "error_server_address_invalid_host_not_allowed" : "error_server_address_invalid" };
      case "not_kotiko_server":
        // Nothing there proved it holds the token, so it wasn't sent (slice 54, B-01): an
        // older server, or another program at the address.
        return { key: d.reason === "no_proof" ? "error_not_kotiko_server_no_proof" : "error_not_kotiko_server" };
      case "address_changed":
        return { key: "error_address_changed", actions: String(d.route ?? "").startsWith("lookup:") ? ["setupLookups"] : ["settings"] };
      case "quota_exhausted": {
        if (d.reason === "payment_required") return provider ? { key: "error_quota_exhausted_payment_required", params: { provider } } : { key: "error_quota_exhausted_payment_required_generic" };
        const at = time(d.retry_at, locale());
        return at ? { key: "error_quota_exhausted", params: { time: at } } : { key: "error_quota_exhausted_today" };
      }
      case "key_rejected": {
        const key = ctx.local ? "error_key_rejected_local" : "error_key_rejected";
        // The server's key is fixed on the server, not in the extension's settings.
        const actions = ctx.local ? ["setupLookups"] : [];
        return provider ? { key, params: { provider }, actions } : { key: `${key}_generic`, actions };
      }
      case "lookup_not_set_up":
        return ctx.local ? { key: "error_lookup_not_set_up_local" } : { key: "error_lookup_not_set_up", actions: [] };
      case "no_word_found":
        return ctx.text ? { key: "error_no_word_found", params: { text: ctx.text } } : { key: "error_no_word_found_any" };
      case "rejected_same_as_gloss":
        if (ctx.text && ctx.base) return { key: "error_rejected_same_as_gloss", params: { text: ctx.text, base: ctx.base } };
        return resolve("no_word_found", d, ctx);
      case "word_conflict":
        if (d.reason !== "duplicate") return { key: "error_word_conflict" };
        return ctx.language ? { key: "error_word_conflict_duplicate", params: { language: ctx.language } } : { key: "error_word_conflict_duplicate_any" };
      case "storage_full":
        return { key: STORAGE[d.reason] ?? "error_storage_full" };
      default:
        return { key: `error_${code}` };
    }
  }

  // Why the browser's storage failed: full, held open by an older page, refused, or deleted.
  const STORAGE = {
    blocked: "error_storage_full_blocked",
    no_indexeddb: "error_storage_full_unavailable",
    open_failed: "error_storage_full_unavailable",
    InvalidStateError: "error_storage_full_unavailable",
    SecurityError: "error_storage_full_unavailable",
    deleting: "error_storage_full_deleted",
    deleted: "error_storage_full_deleted",
  };

  // Facts a self-hoster can act on; nothing the learner typed or saved.
  const TECHNICAL = ["text", "hint", "status", "reason", "provider", "route", "field", "retry_at", "ref", "error", "code"];
  function technical(d) {
    const lines = [];
    for (const k of TECHNICAL) {
      const v = d[k];
      if (v === null || v === undefined || v === "" || typeof v === "object") continue;
      lines.push(k === "text" || k === "error" ? String(v) : k === "status" ? `HTTP ${v}` : `${k}: ${v}`);
    }
    return [...new Set(lines)].join("\n");
  }

  function describe(input, ctx = {}) {
    const err = toError(input);
    if (!err || SILENT.has(err.code)) return null;
    let code = err.code;
    const d = err.details;
    // Offline explains every network failure better than "can't reach".
    if (code === "server_unreachable" && ctx.online === false) code = "offline";
    const r = resolve(code, d, ctx);
    if (!r) return null;
    const entry = CODES[code];
    let severity = entry.severity;
    // Banners (25 §3) are states, blocking problems or information.
    if (ctx.surface === "banner" && (severity === "failed" || severity === "waiting")) severity = "state";
    return { code, severity, key: r.key, params: r.params ?? {}, actions: r.actions ?? entry.actions ?? [], details: technical(d) };
  }

  function message(input, ctx = {}) {
    const p = describe(input, ctx);
    return p ? globalThis.KotikoI18n.t(p.key, p.params) : "";
  }

  // "Copy details" (25 §3): no word data, and no address but the server's.
  function copyText(input, { version = "", browser = "" } = {}) {
    const err = toError(input) ?? { code: "internal", details: {} };
    return [`Kotiko ${version}`.trim(), browser, `code: ${err.code}`, technical(err.details)].filter(Boolean).join("\n");
  }

  // The Copy details button: copyText() with this Kotiko's version and the browser's.
  async function copy(input) {
    const version = (globalThis.browser ?? globalThis.chrome)?.runtime?.getManifest?.()?.version ?? "";
    return globalThis.navigator.clipboard.writeText(copyText(input, { version, browser: globalThis.navigator.userAgent }));
  }

  const isTransient = (code) => CODES[code]?.transient === true;

  const api = { CODES, ALIASES, SILENT, STORAGE, toError, describe, message, fromStatus, copyText, copy, isTransient, technical };
  globalThis.KotikoErrors = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
