# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.LLM.Policy do
  @moduledoc """
  What one lookup does after each attempt (slice 10 section 2). Pure functions, no I/O;
  `extension/lib/llm/policy.js` is the JavaScript twin and both pass
  `spec/fixtures/llm-policy.json`.

    * `classify/1`: one HTTP answer (status, headers, body) or a transport error ->
      an outcome
    * `next/2`: an outcome and the lookup's state -> an action

  An outcome is a map with `kind`: `:ok`, `:no_word` (with the pipeline's `code`),
  `:unparseable`, `:json_unsupported`, `:not_found`, `:unauthorized`, `:payment_required`,
  `:forbidden` (with a `reason`), `:platform_429` (OpenRouter's own limit, shared by every
  free model: `retry_after_ms`, `reset_in_ms`, `ratelimit_remaining`, `daily`),
  `:upstream_429` (a provider is busy), `:server_error`, `:timeout` or `:network`.

  An action is a map with `action` (`:done`, `:next_model`, `:retry_same`, `:stop`) and
  `health` (what the attempt says about the model: `:success`, `:failure`, `:skip_long`,
  `:none`); a stop has slice 25's `code`, and maybe `reason` and `retry_in_ms`; a retry
  has `wait_ms` and maybe `drop_json`.
  """

  @default_state %{
    attempts: 1,
    max_attempts: 3,
    remaining_ms: 25_000,
    min_attempt_ms: 4_000,
    daily_reset_min_ms: 120_000,
    no_word_retried: false,
    json_retried: false,
    has_key: true,
    quota_remaining: nil,
    last_model: false
  }
  @rate_limit_headers ~w(x-ratelimit-limit x-ratelimit-remaining x-ratelimit-reset)
  @busy_retry_ms 60_000
  @out_of_room %{
    unparseable: "bad_lookup_result",
    timeout: "lookup_timeout",
    not_found: "model_unavailable"
  }

  @doc "The state `next/2` assumes for keys it isn't given."
  def default_state, do: @default_state

  # ── classify ─────────────────────────────────────────────────────────

  @doc """
  Classifies a transport error (`%{transport: :timeout | other}`) or an HTTP answer that
  isn't a usable 200 (`%{status, headers, body, now_ms}`; headers as a map or a list of
  pairs, names in any case).
  """
  def classify(%{transport: :timeout}), do: %{kind: :timeout, status: nil}
  def classify(%{transport: _}), do: %{kind: :network, status: nil}

  def classify(%{status: status} = input) do
    headers = headers(input[:headers])
    body = input[:body]
    text = message(body)
    now = input[:now_ms] || System.system_time(:millisecond)
    classify_status(status, headers, body, text, now)
  end

  defp classify_status(429, headers, body, text, now) do
    cond do
      Enum.any?(@rate_limit_headers, &Map.has_key?(headers, &1)) ->
        %{
          kind: :platform_429,
          status: 429,
          retry_after_ms: retry_after(headers["retry-after"]),
          reset_in_ms: reset_in(headers["x-ratelimit-reset"], now),
          ratelimit_remaining: int(headers["x-ratelimit-remaining"])
        }

      text =~ ~r/free-models-per-day/i ->
        %{
          kind: :platform_429,
          status: 429,
          retry_after_ms: nil,
          reset_in_ms: nil,
          ratelimit_remaining: 0,
          daily: true
        }

      not (text =~ ~r/free-models-per-min/i) and upstream?(body, text) ->
        %{kind: :upstream_429, status: 429}

      # Until a recorded example says otherwise, an unknown 429 is the platform's own:
      # it wastes nothing (slice 10 section 2).
      true ->
        %{
          kind: :platform_429,
          status: 429,
          retry_after_ms: retry_after(headers["retry-after"]),
          reset_in_ms: nil,
          ratelimit_remaining: nil
        }
    end
  end

  defp classify_status(status, _headers, body, text, _now) do
    cond do
      status == 400 and text =~ ~r/response_format|json_object|json mode/i ->
        %{kind: :json_unsupported, status: 400}

      status == 404 ->
        %{kind: :not_found, status: 404}

      status == 400 and
          text =~
            ~r/not a valid model|model.{0,40}not (found|exist)|no endpoints found|is not available|unavailable/i ->
        %{kind: :not_found, status: 400}

      status == 401 ->
        %{kind: :unauthorized, status: 401}

      status == 402 ->
        %{kind: :payment_required, status: 402}

      status == 403 ->
        %{kind: :forbidden, status: 403, reason: forbidden_reason(body, text)}

      true ->
        %{kind: :server_error, status: status}
    end
  end

  defp upstream?(%{"error" => %{"metadata" => %{"provider_name" => name}}}, _text)
       when is_binary(name) and name != "",
       do: true

  defp upstream?(_body, text), do: text =~ ~r/upstream/i

  defp forbidden_reason(%{"error" => %{"metadata" => meta}}, _text)
       when is_map_key(meta, "reasons") or is_map_key(meta, "flagged_input"),
       do: "moderation"

  defp forbidden_reason(_body, text),
    do: if(text =~ ~r/guardrail/i, do: "guardrail", else: "forbidden")

  defp headers(nil), do: %{}

  defp headers(h) do
    Map.new(h, fn
      {k, [v | _]} -> {String.downcase(to_string(k)), v}
      {k, v} -> {String.downcase(to_string(k)), v}
    end)
  end

  defp message(%{"error" => %{"message" => m}}) when is_binary(m), do: m
  defp message(%{"message" => m}) when is_binary(m), do: m
  defp message(b) when is_binary(b), do: b
  defp message(_), do: ""

  defp int(nil), do: nil
  defp int(n) when is_integer(n), do: n

  defp int(v) do
    case Float.parse(String.trim(to_string(v))) do
      {f, ""} -> trunc(f)
      _ -> nil
    end
  end

  # X-RateLimit-Reset: ms since the epoch (OpenRouter), seconds since the epoch, or
  # seconds from now. Returns ms from now, never negative.
  defp reset_in(value, now) do
    case int(value) do
      nil -> nil
      n when n > 1_000_000_000_000 -> max(0, n - now)
      n when n > 1_000_000_000 -> max(0, n * 1000 - now)
      n -> max(0, n * 1000)
    end
  end

  # Retry-After in seconds (OpenRouter's form; an HTTP date is read as unknown).
  defp retry_after(value) do
    case int(value) do
      nil -> nil
      n -> max(0, n * 1000)
    end
  end

  # ── next ─────────────────────────────────────────────────────────────

  @doc """
  The next step after an attempt. `state`: `attempts` (made so far, this one included),
  `max_attempts`, `remaining_ms` (until the deadline), `min_attempt_ms` (no attempt
  starts with less), `daily_reset_min_ms`, `no_word_retried`, `json_retried` (for this
  model), `has_key`, `quota_remaining` (or nil) and `last_model` (no other model in the
  chain).
  """
  def next(outcome, state \\ %{}) do
    s = Map.merge(@default_state, state)
    room? = s.attempts < s.max_attempts and s.remaining_ms >= s.min_attempt_ms
    another? = room? and not s.last_model

    case decide(outcome, s, room?, another?) do
      :fallthrough when another? -> %{action: :next_model, health: :failure}
      :fallthrough -> stop(Map.get(@out_of_room, outcome.kind, "model_unavailable"), :failure)
      action -> action
    end
  end

  defp decide(%{kind: :ok}, _s, _room?, _another?), do: %{action: :done, health: :success}

  defp decide(%{kind: :no_word} = o, s, _room?, another?) do
    if not s.no_word_retried and another?,
      do: %{action: :next_model, health: :none, no_word: true},
      else: stop(o[:code] || "no_word_found", :none)
  end

  defp decide(%{kind: :unauthorized}, %{has_key: true}, _, _),
    do: stop("key_rejected", :none, %{reason: "unauthorized"})

  defp decide(%{kind: :unauthorized}, _s, _, _),
    do: stop("lookup_not_set_up", :none, %{reason: "no_key"})

  defp decide(%{kind: :payment_required}, _s, _, _),
    do: stop("quota_exhausted", :none, %{reason: "payment_required", retry_in_ms: nil})

  defp decide(%{kind: :forbidden} = o, _s, _, _),
    do: stop("key_rejected", :none, %{reason: o[:reason] || "forbidden"})

  defp decide(%{kind: :platform_429} = o, s, _, _), do: platform_429(o, s)

  defp decide(%{kind: :json_unsupported}, s, room?, _another?) do
    if not s.json_retried and room?,
      do: %{action: :retry_same, wait_ms: 0, drop_json: true, health: :none},
      else: :fallthrough
  end

  defp decide(%{kind: :not_found}, _s, _room?, true),
    do: %{action: :next_model, health: :skip_long}

  defp decide(%{kind: :not_found}, _s, _room?, false), do: stop("model_unavailable", :skip_long)

  defp decide(%{kind: :upstream_429}, _s, _room?, true),
    do: %{action: :next_model, health: :failure}

  defp decide(%{kind: :upstream_429}, _s, _room?, false),
    do: stop("rate_limited", :failure, %{retry_in_ms: @busy_retry_ms})

  defp decide(_outcome, _s, _room?, _another?), do: :fallthrough

  # OpenRouter's own limit is shared by every free model: never walk the list.
  defp platform_429(o, s) do
    reset = o[:reset_in_ms]
    by_quota? = o[:daily] == true or s.quota_remaining == 0

    daily? =
      by_quota? or
        (o[:ratelimit_remaining] == 0 and is_integer(reset) and reset > s.daily_reset_min_ms)

    wait = o[:retry_after_ms] || reset

    cond do
      daily? ->
        stop("quota_exhausted", :none, %{
          reason: "daily_limit",
          retry_in_ms: if(by_quota?, do: nil, else: reset)
        })

      is_integer(wait) and s.attempts < s.max_attempts and
          wait <= s.remaining_ms - s.min_attempt_ms ->
        %{action: :retry_same, wait_ms: wait, health: :none}

      true ->
        stop("rate_limited", :none, %{retry_in_ms: wait || @busy_retry_ms})
    end
  end

  defp stop(code, health, extra \\ %{}),
    do: Map.merge(%{action: :stop, code: code, health: health}, extra)
end
