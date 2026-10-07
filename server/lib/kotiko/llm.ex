# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.LLM do
  @moduledoc """
  Turns a free-form message into checked word entries (slice 09's prompt and pipeline)
  through any OpenAI-compatible chat API: OpenRouter's free models by default, or Ollama,
  OpenAI, etc. via LLM_URL and LLM_MODEL. Slice 10 makes it dependable:

      interpret/3: cache -> quota gate -> chain -> attempts -> Kotiko.WordSpec

    * `Kotiko.LLM.Cache`    repeated lookups are free; identical ones share one call
    * `Kotiko.LLM.Quota`    free lookups left today (OpenRouter), checked before asking
    * `Kotiko.LLM.Catalog`  which models, in what order, with what capabilities, and
                            their health
    * `Kotiko.LLM.Client`   one HTTP attempt -> an outcome
    * `Kotiko.LLM.Policy`   outcome -> next step (pure; shared fixtures with the extension)
    * `Kotiko.LLM.Slots`    at most two model calls in flight

  Every lookup has a deadline and an attempt cap from `spec/models.json`'s budgets (an add:
  25 s and 3 requests). Failures come back as slice 25's codes, never as text to match.

  **Logs.** One info line per lookup with no user text:
  `llm lookup result=ok model=<id> attempts=2 ms=3412 words=1 bases=2 cache=miss`.
  The input, the raw answer (up to 2,000 characters) and rejected words go to the debug
  log only with LOG_LOOKUPS=true; error bodies (up to 300 characters) at debug.
  Telemetry: `[:kotiko, :llm, :attempt, :stop]` and `[:kotiko, :llm, :lookup, :stop]`.
  """
  require Logger
  alias Kotiko.{Lang, Spec, WordSpec}
  alias Kotiko.LLM.{Cache, Catalog, Client, Policy, Quota, Slots}
  alias Kotiko.WordSpec.Prompt

  @no_word_codes ~w(no_word_found rejected_same_as_gloss bad_lookup_result)

  @typedoc """
  A failed lookup: slice 25's `code`, `details` (`reason`, `status`), `retry_at` (UTC,
  when known) and `attempts` (model ids and outcomes, for the debug log only).
  """
  @type error :: %{
          code: String.t(),
          details: map(),
          retry_at: DateTime.t() | nil,
          attempts: [map()]
        }

  @doc """
  Asks about `text` with the prompt of `spec/prompt.md` and checks the answer with
  `Kotiko.WordSpec.process/2`. `recent` is the list of languages the learner has been
  adding lately; it settles ambiguous input like "what's da" without asking.

  Options: `:base_langs` (default `["en"]`), `:add` (the add box), `:hint_lang`,
  `:budget` (`:add`, `:telegram`, `:extension` or `:bulk`; default `:add`), `:fresh`
  (skip the cache: "wrong meaning", "try again").

  Returns `{:ok, result}` (`Kotiko.WordSpec.process/2`'s result; with no word, its `code`
  says why) or `{:error, error}`.
  """
  @spec interpret(String.t(), [String.t()], keyword()) :: {:ok, map()} | {:error, error}
  def interpret(text, recent \\ [], opts \\ []) do
    started = now()
    add? = Keyword.get(opts, :add, false)
    bases = Keyword.get(opts, :base_langs) || ["en"]
    mode = if add?, do: "add", else: "auto"
    budget = budget(opts[:budget] || :add)
    deadline = started + scaled(budget["deadline_ms"])

    req = %{
      text: text,
      mode: mode,
      hint_lang: opts[:hint_lang],
      recent: recent,
      base_langs: bases
    }

    key = Cache.key(req)

    {result, meta} =
      case if(opts[:fresh], do: :miss, else: Cache.get(key)) do
        {:ok, cached} ->
          {{:ok, cached}, %{cache: "hit", model: nil, attempts: []}}

        :miss ->
          ask = fn -> uncached(req, budget, deadline) end

          if opts[:fresh] do
            ask.()
          else
            case Cache.run(key, deadline - now(), ask) do
              {:shared, {r, meta}} ->
                {r, %{meta | cache: "shared"}}

              {:error, :wait_timeout} ->
                {timeout_error([]), %{cache: "shared", model: nil, attempts: []}}

              other ->
                other
            end
          end
      end

    # Only results with words are kept (never no-word results, errors or chat replies).
    with {{:ok, %{words: [_ | _]} = found}, %{cache: "miss", model: model}} <- {result, meta},
         do: Cache.put(key, found, model)

    finish_lookup(result, meta, started, bases)
    result
  end

  defp uncached(req, budget, deadline) do
    case gate() do
      {:exhausted, at} ->
        {{:error, error("quota_exhausted", %{reason: "daily_limit"}, at, [])},
         %{cache: "miss", model: nil, attempts: []}}

      :ok ->
        system = Prompt.system(Map.take(req, [:base_langs, :mode, :recent, :hint_lang]))
        input = %{text: req.text, mode: req.mode, base_langs: req.base_langs}

        process = fn content ->
          log_answer(content)

          case WordSpec.process(input, content) do
            {:ok, result} -> classify_result(result, content)
            {:error, :unparseable} -> %{kind: :unparseable, status: 200}
          end
        end

        attempts(:lookup, Catalog.chain(:lookup), [system, req.text], process, budget, deadline)
    end
  end

  # A 200 that found no word is "no word" for the policy (one more model, once); real chat
  # in auto mode (Telegram) is an answer.
  defp classify_result(%{words: [_ | _]} = result, content) do
    language_check(content)
    %{kind: :ok, result: result}
  end

  defp classify_result(%{code: code} = result, _content) when code in @no_word_codes do
    log_rejected(result)
    %{kind: :no_word, code: code, result: result}
  end

  defp classify_result(result, _content), do: %{kind: :ok, result: result}

  @doc """
  The one-time pronunciation refresh's request (slice 07 section 8): `items` are
  `%{lang, native, sense, base_langs}`, at most 20. Uses the bulk budget (45 s, 2
  attempts) and the respell order of `spec/models.json` (`prefer_respell`).

  Returns `{:ok, [item]}` with the answer's items checked by
  `Kotiko.WordSpec.process_respell/2` (a failing field is nil), or `{:error, error}`.
  """
  def respell(items) do
    started = now()
    budget = budget(:bulk)
    deadline = started + scaled(budget["deadline_ms"])

    {result, meta} =
      case gate() do
        {:exhausted, at} ->
          {{:error, error("quota_exhausted", %{reason: "daily_limit"}, at, [])},
           %{model: nil, attempts: []}}

        :ok ->
          system = Prompt.respell_system(items)
          text = Jason.encode!(%{items: items})

          process = fn content ->
            log_answer(content)

            case WordSpec.process_respell(items, content) do
              {:ok, %{items: answers}} -> %{kind: :ok, result: answers}
              {:error, :unparseable} -> %{kind: :unparseable, status: 200}
            end
          end

          attempts(:respell, Catalog.chain(:respell), [system, text], process, budget, deadline)
      end

    ms = now() - started

    {code, n} =
      if match?({:ok, _}, result),
        do: {"ok", length(elem(result, 1))},
        else: {elem(result, 1).code, 0}

    Logger.info(
      "llm respell result=#{code} model=#{meta.model || "none"} attempts=#{length(meta.attempts)} " <>
        "ms=#{ms} items=#{n}"
    )

    result
  end

  @doc """
  For `GET /api/v1/llm/status`: the provider, the models a lookup would ask now, where
  that list came from, models skipped for failing, the free lookups left today (OpenRouter
  with a key; else nil) and the last lookup's result code.
  """
  def status do
    catalog = Catalog.status()
    quota = Quota.snapshot()

    %{
      provider: provider(),
      models: catalog.models,
      models_source: catalog.source,
      skipped: catalog.skipped,
      quota:
        quota &&
          %{
            used: quota.used,
            limit: quota.limit,
            remaining: quota.remaining,
            resets_at: quota.resets_at && Kotiko.Word.timestamp(quota.resets_at),
            estimated: quota.estimated
          },
      last_result: last_result()
    }
  end

  @doc "`openrouter`, or the host of LLM_URL."
  def provider do
    if Client.openrouter?(),
      do: "openrouter",
      else: URI.parse(Application.fetch_env!(:kotiko, :llm_url)).host
  end

  @doc """
  A duration from `spec/models.json` in real milliseconds: tests set `:llm_time_scale`
  so a 25 s deadline takes a fraction of a second.
  """
  def scaled(ms) when is_integer(ms),
    do: round(ms * Application.get_env(:kotiko, :llm_time_scale, 1))

  defp unscaled(ms), do: round(ms / Application.get_env(:kotiko, :llm_time_scale, 1))

  # ── the attempts ─────────────────────────────────────────────────────

  # Walks the chain under the policy. Returns {{:ok, result} | {:error, error}, meta}.
  defp attempts(kind, chain, [system, user], process, budget, deadline) do
    ctx = %{
      kind: kind,
      messages: [%{role: "system", content: system}, %{role: "user", content: user}],
      process: process,
      budget: budget,
      deadline: deadline,
      max_tokens: Spec.llm_policy(:max_tokens)[to_string(kind)]
    }

    st = %{
      chain: chain,
      attempts: 0,
      log: [],
      no_word_retried: false,
      json_retried: false,
      json: nil,
      no_word: nil
    }

    if chain == [] do
      {{:error, error("lookup_not_set_up", %{reason: "no_model"}, nil, [])},
       %{cache: "miss", model: nil, attempts: []}}
    else
      step(ctx, st)
    end
  end

  defp step(ctx, %{chain: [model | rest]} = st) do
    min_ms = Spec.llm_policy(:min_attempt_ms)
    remaining = ctx.deadline - now()

    if remaining < scaled(min_ms) do
      done(ctx, st, model.id, timeout_error(st.log))
    else
      json? = if st.json == false, do: false, else: model.caps.json_mode
      outcome = attempt(ctx, model, json?)

      st = %{
        st
        | attempts: st.attempts + 1,
          log: [%{model: model.id, outcome: outcome.kind} | st.log]
      }

      # Every answer but a 429 counts against the free quota.
      if outcome[:status] && outcome[:status] != 429, do: Quota.counted()
      quota_remaining = after_429(outcome, ctx)

      state = %{
        attempts: st.attempts,
        max_attempts: ctx.budget["max_attempts"],
        remaining_ms: unscaled(ctx.deadline - now()),
        min_attempt_ms: min_ms,
        daily_reset_min_ms: Spec.llm_policy(:daily_reset_min_ms),
        no_word_retried: st.no_word_retried,
        json_retried: st.json_retried,
        has_key: Client.key?(),
        quota_remaining: quota_remaining,
        last_model: rest == []
      }

      action = Policy.next(outcome, state)
      Catalog.report(model.id, ctx.kind, action.health)
      st = if outcome.kind == :no_word, do: %{st | no_word: outcome.result}, else: st

      case action do
        %{action: :done} ->
          done(ctx, st, model.id, {:ok, outcome.result})

        %{action: :next_model} = a ->
          step(ctx, %{
            st
            | chain: rest,
              no_word_retried: st.no_word_retried or a[:no_word] == true,
              json_retried: false,
              json: nil
          })

        %{action: :retry_same, wait_ms: wait} = a ->
          if wait > 0, do: Process.sleep(scaled(wait))
          json = if a[:drop_json], do: false, else: st.json
          step(ctx, %{st | json: json, json_retried: st.json_retried or a[:drop_json] == true})

        %{action: :stop, code: code} = a ->
          done(ctx, st, model.id, stopped(code, a, outcome, st))
      end
    end
  end

  defp attempt(ctx, model, json?) do
    t = now()

    outcome =
      case Slots.run(ctx.deadline - t, fn ->
             timeout = min(scaled(ctx.budget["attempt_ms"]), ctx.deadline - now())

             if timeout <= 0 do
               %{kind: :timeout, status: nil, detail: "deadline"}
             else
               Client.attempt(model.id, model.caps, ctx.messages,
                 timeout_ms: timeout,
                 json: json?,
                 max_tokens: ctx.max_tokens
               )
             end
           end) do
        {:content, content} -> content |> ctx.process.() |> Map.put(:status, 200)
        {:error, :no_slot} -> %{kind: :timeout, status: nil, detail: "no free slot"}
        outcome -> outcome
      end

    if outcome[:detail], do: Logger.debug("llm #{model.id}: #{outcome.kind} #{outcome.detail}")

    :telemetry.execute(
      [:kotiko, :llm, :attempt, :stop],
      %{duration: now() - t},
      %{kind: ctx.kind, model: model.id, outcome: outcome.kind, status: outcome[:status]}
    )

    outcome
  end

  # Right after any 429, read the quota again (rate-limited attempts may not count, so
  # the estimate can be off either way). Returns what is left, or nil when unknown.
  defp after_429(%{kind: k}, ctx) when k in [:platform_429, :upstream_429] do
    if Quota.enabled?() do
      budget = ctx.deadline - now() - scaled(Spec.llm_policy(:min_attempt_ms))
      timeout = min(scaled(Spec.llm_policy(:quota)["timeout_ms"]), budget)
      if timeout > 0, do: Quota.refresh(timeout)
      quota_remaining()
    end
  end

  defp after_429(_outcome, _ctx), do: quota_remaining()

  defp quota_remaining do
    case Quota.snapshot() do
      %{remaining: r} -> r
      _ -> nil
    end
  end

  defp done(ctx, st, model, result) do
    if match?({:error, %{code: "model_unavailable"}}, result) and
         Enum.all?(st.log, &(&1.outcome == :not_found)) do
      Catalog.refresh_async()
    end

    if match?({:error, %{code: "model_unavailable"}}, result) do
      Logger.warning("No model answered the #{ctx.kind}: #{attempt_summary(st.log)}")
    end

    {put_attempts(result, st.log), %{cache: "miss", model: model, attempts: Enum.reverse(st.log)}}
  end

  # A no-word stop returns the last checked result (its rejections and code reach the
  # learner); anything else is an error.
  defp stopped(code, _a, _outcome, %{no_word: %{} = result}) when code in @no_word_codes,
    do: {:ok, result}

  defp stopped(code, a, outcome, _st) do
    retry_at =
      cond do
        is_integer(a[:retry_in_ms]) ->
          DateTime.add(DateTime.utc_now(), a.retry_in_ms, :millisecond)

        code == "quota_exhausted" and a[:reason] == "daily_limit" ->
          quota_reset()

        true ->
          nil
      end

    details =
      %{reason: a[:reason], status: outcome[:status]}
      |> Map.reject(fn {_k, v} -> is_nil(v) end)

    {:error, error(code, details, retry_at, [])}
  end

  defp timeout_error(log), do: {:error, error("lookup_timeout", %{reason: "deadline"}, nil, log)}

  defp put_attempts({:error, e}, log), do: {:error, %{e | attempts: Enum.reverse(log)}}
  defp put_attempts(ok, _log), do: ok

  defp error(code, details, retry_at, attempts) do
    details =
      if code in ~w(key_rejected quota_exhausted),
        do: Map.put(details, :provider, provider()),
        else: details

    %{code: code, details: details, retry_at: retry_at, attempts: attempts}
  end

  defp quota_reset do
    case Quota.snapshot() do
      %{resets_at: %DateTime{} = at} -> at
      _ -> Quota.next_midnight(DateTime.utc_now())
    end
  end

  # The gate applies when every model is free: OpenRouter's daily count is for free models.
  defp gate do
    Quota.maybe_refresh()

    case Quota.check() do
      {:exhausted, at} ->
        if Enum.all?(Catalog.chain(:lookup), & &1.caps.free), do: {:exhausted, at}, else: :ok

      :ok ->
        :ok
    end
  end

  defp budget(name), do: Spec.llm_policy(:budgets) |> Map.fetch!(to_string(name))

  defp now, do: System.monotonic_time(:millisecond)

  # ── logs and telemetry ───────────────────────────────────────────────

  defp finish_lookup(result, meta, started, bases) do
    ms = now() - started

    {code, words} =
      case result do
        {:ok, %{words: words} = r} -> {r[:code] || "ok", length(words)}
        {:error, e} -> {e.code, 0}
      end

    put_last_result(code)

    Logger.info(
      "llm lookup result=#{code} model=#{meta.model || "none"} attempts=#{length(meta.attempts)} " <>
        "ms=#{ms} words=#{words} bases=#{length(bases)} cache=#{meta.cache}"
    )

    if match?({:error, _}, result) and meta.attempts != [] do
      Logger.debug("llm lookup attempts: #{attempt_summary(Enum.reverse(meta.attempts))}")
    end

    :telemetry.execute(
      [:kotiko, :llm, :lookup, :stop],
      %{duration: ms},
      %{
        result: code,
        model: meta.model,
        attempts: length(meta.attempts),
        words: words,
        bases: length(bases),
        cache: meta.cache
      }
    )
  end

  defp attempt_summary(log),
    do: log |> Enum.reverse() |> Enum.map_join(", ", &"#{&1.model} #{&1.outcome}")

  defp put_last_result(code), do: :persistent_term.put({__MODULE__, :last_result}, code)
  defp last_result, do: :persistent_term.get({__MODULE__, :last_result}, nil)

  @doc """
  Whether the learner's words may be logged: only with LOG_LOOKUPS=true, and then only at
  debug level. Every debug line that carries a word, a gloss or typed text checks this.
  """
  def log_lookups?, do: Application.get_env(:kotiko, :log_lookups, false)

  defp log_answer(content) do
    if log_lookups?(), do: Logger.debug("llm answer: #{String.slice(content, 0, 2000)}")
  end

  defp log_rejected(%{rejected: rejected}) when rejected != [] do
    reasons = rejected |> Enum.map(& &1.reason) |> Enum.uniq() |> Enum.join(", ")
    Logger.debug("llm: rejected the words it returned (#{reasons})")
    if log_lookups?(), do: Logger.debug("llm rejected: #{inspect(rejected)}")
  end

  defp log_rejected(_result), do: :ok

  # The model's "language" is a self-check only (slice 08 section 4): names come from the
  # tag. A disagreement is logged for prompt tuning.
  defp language_check(content) do
    with %{"words" => words} when is_list(words) <- WordSpec.extract(content) do
      for %{"lang" => lang, "language" => name} <- words,
          is_binary(name),
          {:ok, tag} <- [Lang.canonical(lang)],
          String.downcase(Lang.name(tag, "en")) != String.downcase(name) do
        Logger.debug(
          "llm: the model called #{tag} #{inspect(name)}; Kotiko calls it #{Lang.name(tag, "en")}"
        )
      end
    end

    :ok
  end
end
