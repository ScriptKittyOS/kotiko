# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Lookup do
  @moduledoc """
  Free-form text to checked words: asks the model (`Kotiko.LLM`), whose answer
  `Kotiko.WordSpec` extracts, normalises and validates (slice 09). Shared by the add
  routes and the Telegram bot. Saving is the caller's choice, so a preview saves nothing.

  While a lookup runs, `busy?/0` is true, so background jobs (the pronunciation refresh)
  wait and the learner's own adds always go first.
  """
  require Logger
  alias Kotiko.{LLM, Pronounce, Words}

  @doc """
  Interprets `text`. Options: `:base_langs` (default `["en"]`), `:hint_lang`, `:add` (the
  add box: always an add), `:origin`, `:status` (for the saved words), `:budget` and
  `:fresh` (`Kotiko.LLM.interpret/3`).

  Returns `{:ok, result}` (`Kotiko.WordSpec.process/2`'s result, with `status` and
  `origin` on each word) or `{:error, error}` (`t:Kotiko.LLM.error/0`: slice 25's code,
  details and `retry_at`) when the lookup failed.
  """
  def interpret(text, opts \\ []) do
    bases = opts[:base_langs] || ["en"]

    llm_opts = [
      add: opts[:add] || false,
      base_langs: bases,
      hint_lang: opts[:hint_lang],
      budget: opts[:budget] || :add,
      fresh: opts[:fresh] || false
    ]

    recent = Enum.map(Words.recent_languages(), & &1.lang)

    case busy(fn -> LLM.interpret(text, recent, llm_opts) end) do
      {:ok, result} ->
        extra = %{status: opts[:status] || "active", origin: opts[:origin] || "add"}
        words = result.words |> Enum.map(&Map.merge(&1, extra)) |> pronounce()
        {:ok, %{result | words: words}}

      {:error, _} = e ->
        e
    end
  end

  # Slice 49 §4a: pronunciations from Wiktionary for targets with lexical stress. A page
  # that can't be read in time leaves the model's; the background pass tries it again.
  defp pronounce(words) do
    if Application.get_env(:kotiko, :pronounce_enabled, true) do
      fetch = &Pronounce.fetch_page(&1, max_wait_ms: 2_000)

      Enum.map(words, fn w ->
        try do
          w |> Pronounce.enrich(fetch_page: fetch) |> elem(0)
        rescue
          e ->
            Logger.warning("Wiktionary pronunciation failed: #{Exception.message(e)}")
            w
        end
      end)
    else
      words
    end
  end

  # ── failed lookups as HTTP answers (slice 25's codes) ────────────────

  @doc """
  How a failed lookup answers over HTTP: `{status, retry_after_seconds | nil, message,
  details}`. `details` carries `reason`, the provider's HTTP `status` and `retry_at`
  (ISO 8601, UTC) when known; `message` is plain English for clients that show text (the
  extension renders the code with its own catalog).
  """
  def http_error(%{code: code} = e) do
    retry_at = e[:retry_at]

    details =
      (e[:details] || %{})
      |> Map.take([:reason, :status, :provider])
      |> then(
        &if(retry_at, do: Map.put(&1, :retry_at, Kotiko.Word.timestamp(retry_at)), else: &1)
      )

    {http_status(code), retry_after(retry_at), message(code, e[:details] || %{}, retry_at),
     details}
  end

  defp http_status(code) when code in ~w(quota_exhausted rate_limited), do: 429
  defp http_status(code) when code in ~w(lookup_not_set_up lookup_timeout), do: 503
  defp http_status(_code), do: 502

  defp retry_after(nil), do: nil

  defp retry_after(at),
    do: max(1, ceil(DateTime.diff(at, DateTime.utc_now(), :millisecond) / 1000))

  @doc "A one-line plain message for a failed lookup's code (the bot and curl users)."
  def message(code, details \\ %{}, retry_at \\ nil)

  def message("quota_exhausted", %{reason: "payment_required"} = d, _at),
    do:
      "#{provider_name(d)} needs credit on your account before it will look up words, " <>
        "even free ones. Add credit there, or add words yourself."

  def message("quota_exhausted", _d, %DateTime{} = at),
    do:
      "You've used today's free lookups. Add words yourself, or try again after " <>
        "#{Calendar.strftime(at, "%H:%M")} UTC."

  def message("quota_exhausted", _d, _at),
    do: "You've used today's free lookups. Add words yourself, or try again tomorrow."

  def message("rate_limited", _d, _at), do: "Word lookup is busy. Try again in a minute."

  def message("model_unavailable", _d, _at),
    do: "Word lookup isn't answering right now. Try again in a little while."

  def message("lookup_timeout", _d, _at), do: "That lookup took too long. Try again."

  def message("bad_lookup_result", _d, _at),
    do: "The lookup came back garbled. Try again, or add the word yourself."

  def message("key_rejected", d, _at),
    do:
      "#{provider_name(d)} didn't accept the server's key (LLM_API_KEY). Check it, then restart the server."

  def message("lookup_not_set_up", _d, _at),
    do: "Word lookup isn't set up: add LLM_API_KEY to the server's .env and restart it."

  def message(_code, _d, _at), do: "The lookup failed. Try again."

  defp provider_name(%{provider: "openrouter"}), do: "OpenRouter"
  defp provider_name(%{provider: host}) when is_binary(host), do: host
  defp provider_name(_), do: "The lookup service"

  @doc "The `rejected` and `dropped_fields` entry fields that say which word it was."
  def summary(attrs),
    do: %{native: attrs[:native], gloss: attrs[:gloss], base_lang: attrs[:base_lang]}

  @doc """
  Saves checked words in one transaction. Returns `{:ok, results}` with each word's
  `Kotiko.Words.add/2` result, in order. `opts` go to `Kotiko.Words.add/2`; `after_save`
  runs in the same transaction with the results (to keep an idempotent response).
  """
  def save(words, opts \\ [], after_save \\ fn results -> results end) do
    Words.transaction(fn ->
      {:ok, words |> Enum.map(&Words.add(&1, opts)) |> after_save.()}
    end)
  end

  @doc "Creates the counter behind `busy?/0`. Called once at boot."
  def init, do: counter()

  @doc "True while a lookup for the learner is waiting on the model."
  def busy?, do: :counters.get(counter(), 1) > 0

  @doc "Runs `fun` counted as a lookup in progress."
  def busy(fun) do
    :counters.add(counter(), 1, 1)

    try do
      fun.()
    after
      :counters.sub(counter(), 1, 1)
    end
  end

  defp counter do
    case :persistent_term.get(__MODULE__, nil) do
      nil ->
        c = :counters.new(1, [:atomics])
        :persistent_term.put(__MODULE__, c)
        c

      c ->
        c
    end
  end
end
