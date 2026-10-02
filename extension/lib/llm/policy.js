// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The lookup client's policy (slice 10 §2), the JavaScript twin of Kotiko.LLM.Policy.
// Pure functions, no I/O, so both runtimes pass spec/fixtures/llm-policy.json:
//
//   classify({status, headers, body, now_ms} | {transport})  -> outcome
//   next(outcome, state)                                     -> action
//
// An outcome is {kind, status, ...}: ok, no_word (with the pipeline's code), unparseable,
// json_unsupported, not_found, unauthorized, payment_required, forbidden (with a reason),
// platform_429 (OpenRouter's own limit: retry_after_ms, reset_in_ms, ratelimit_remaining,
// daily), upstream_429 (a provider is busy), server_error, timeout, network.
//
// An action is {action: "done" | "next_model" | "retry_same" | "stop", health, code,
// reason, retry_in_ms, wait_ms, drop_json, no_word}; `health` is what the attempt says
// about the model (success, failure, skip_long, none). Slice 11's client uses it; the
// server has its own copy in Elixir.
(() => {
  const DEFAULT_STATE = {
    attempts: 1,
    max_attempts: 3,
    remaining_ms: 25000,
    min_attempt_ms: 4000,
    daily_reset_min_ms: 120000,
    no_word_retried: false,
    json_retried: false,
    has_key: true,
    quota_remaining: null,
    last_model: false,
  };
  const RATE_LIMIT_HEADERS = ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"];
  const BUSY_RETRY_MS = 60000;

  const lower = (headers) => Object.fromEntries(Object.entries(headers ?? {}).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]));

  function message(body) {
    if (body && typeof body === "object") {
      const m = body.error?.message ?? body.message;
      return typeof m === "string" ? m : "";
    }
    return typeof body === "string" ? body : "";
  }

  function int(value) {
    if (value === null || value === undefined) return null;
    const n = Number(String(value).trim());
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }

  // X-RateLimit-Reset: a time in ms since the epoch (OpenRouter), or seconds since the
  // epoch, or seconds from now. Returns ms from now, never negative.
  function resetIn(value, nowMs) {
    const n = int(value);
    if (n === null) return null;
    if (n > 1e12) return Math.max(0, n - nowMs);
    if (n > 1e9) return Math.max(0, n * 1000 - nowMs);
    return Math.max(0, n * 1000);
  }

  // Retry-After in seconds (OpenRouter's form; an HTTP date is read as unknown).
  function retryAfter(value) {
    const n = int(value);
    return n === null ? null : Math.max(0, n * 1000);
  }

  function classify(input) {
    if (input.transport) {
      return { kind: input.transport === "timeout" ? "timeout" : "network", status: null };
    }
    const status = input.status;
    const headers = lower(input.headers);
    const body = input.body;
    const text = message(body);
    const nowMs = input.now_ms ?? Date.now();

    if (status === 429) {
      if (RATE_LIMIT_HEADERS.some((h) => h in headers)) {
        return {
          kind: "platform_429",
          status,
          retry_after_ms: retryAfter(headers["retry-after"]),
          reset_in_ms: resetIn(headers["x-ratelimit-reset"], nowMs),
          ratelimit_remaining: int(headers["x-ratelimit-remaining"]),
        };
      }
      if (/free-models-per-day/i.test(text)) {
        return { kind: "platform_429", status, retry_after_ms: null, reset_in_ms: null, ratelimit_remaining: 0, daily: true };
      }
      const upstream = !/free-models-per-min/i.test(text) && (body?.error?.metadata?.provider_name || /upstream/i.test(text));
      if (upstream) return { kind: "upstream_429", status };
      return { kind: "platform_429", status, retry_after_ms: retryAfter(headers["retry-after"]), reset_in_ms: null, ratelimit_remaining: null };
    }
    if (status === 400 && /response_format|json_object|json mode/i.test(text)) return { kind: "json_unsupported", status };
    if (status === 404) return { kind: "not_found", status };
    if (status === 400 && /not a valid model|model.{0,40}not (found|exist)|no endpoints found|is not available|unavailable/i.test(text)) {
      return { kind: "not_found", status };
    }
    if (status === 401) return { kind: "unauthorized", status };
    if (status === 402) return { kind: "payment_required", status };
    if (status === 403) {
      const meta = body?.error?.metadata;
      const reason = meta?.reasons || meta?.flagged_input ? "moderation" : /guardrail/i.test(text) ? "guardrail" : "forbidden";
      return { kind: "forbidden", status, reason };
    }
    return { kind: "server_error", status };
  }

  function stop(code, health, extra = {}) {
    return { action: "stop", code, health, ...extra };
  }

  // What a failed attempt leads to when no other attempt fits.
  const OUT_OF_ROOM = { unparseable: "bad_lookup_result", timeout: "lookup_timeout", not_found: "model_unavailable" };

  function next(outcome, partial = {}) {
    const s = { ...DEFAULT_STATE, ...partial };
    const attemptLeft = s.attempts < s.max_attempts;
    const room = attemptLeft && s.remaining_ms >= s.min_attempt_ms;
    const anotherModel = room && !s.last_model;

    switch (outcome.kind) {
      case "ok":
        return { action: "done", health: "success" };
      case "no_word":
        if (!s.no_word_retried && anotherModel) return { action: "next_model", health: "none", no_word: true };
        return stop(outcome.code ?? "no_word_found", "none");
      case "unauthorized":
        return s.has_key ? stop("key_rejected", "none", { reason: "unauthorized" }) : stop("lookup_not_set_up", "none", { reason: "no_key" });
      case "payment_required":
        return stop("quota_exhausted", "none", { reason: "payment_required", retry_in_ms: null });
      case "forbidden":
        return stop("key_rejected", "none", { reason: outcome.reason ?? "forbidden" });
      case "platform_429":
        return platform429(outcome, s);
      case "json_unsupported":
        if (!s.json_retried && room) return { action: "retry_same", wait_ms: 0, drop_json: true, health: "none" };
        break;
      case "not_found":
        return anotherModel ? { action: "next_model", health: "skip_long" } : stop("model_unavailable", "skip_long");
      case "upstream_429":
        return anotherModel ? { action: "next_model", health: "failure" } : stop("rate_limited", "failure", { retry_in_ms: BUSY_RETRY_MS });
      default:
        break;
    }
    if (anotherModel) return { action: "next_model", health: "failure" };
    return stop(OUT_OF_ROOM[outcome.kind] ?? "model_unavailable", "failure");
  }

  // OpenRouter's own limit is shared by every free model: never walk the list.
  function platform429(o, s) {
    const daily = o.daily === true || s.quota_remaining === 0 || (o.ratelimit_remaining === 0 && o.reset_in_ms !== null && o.reset_in_ms > s.daily_reset_min_ms);
    if (daily) {
      const retry = o.daily === true || s.quota_remaining === 0 ? null : o.reset_in_ms;
      return stop("quota_exhausted", "none", { reason: "daily_limit", retry_in_ms: retry });
    }
    const wait = o.retry_after_ms ?? o.reset_in_ms ?? null;
    if (wait !== null && s.attempts < s.max_attempts && wait <= s.remaining_ms - s.min_attempt_ms) {
      return { action: "retry_same", wait_ms: wait, health: "none" };
    }
    return stop("rate_limited", "none", { retry_in_ms: wait ?? BUSY_RETRY_MS });
  }

  const api = { classify, next, DEFAULT_STATE };
  globalThis.KotikoLLMPolicy = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
