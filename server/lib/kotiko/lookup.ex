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
  alias Kotiko.{LLM, Words}

  @doc """
  Interprets `text`. Options: `:base_langs` (default `["en"]`), `:hint_lang`, `:add` (the
  add box: always an add), `:origin`, `:status` (for the saved words).

  Returns `{:ok, result}` (`Kotiko.WordSpec.process/2`'s result, with `status` and
  `origin` on each word) or `{:error, message}` when no model answered.
  """
  def interpret(text, opts \\ []) do
    bases = opts[:base_langs] || ["en"]
    llm_opts = [add: opts[:add] || false, base_langs: bases, hint_lang: opts[:hint_lang]]
    recent = Enum.map(Words.recent_languages(), & &1.lang)

    case busy(fn -> LLM.interpret(text, recent, llm_opts) end) do
      {:ok, result} ->
        extra = %{status: opts[:status] || "active", origin: opts[:origin] || "add"}
        {:ok, %{result | words: Enum.map(result.words, &Map.merge(&1, extra))}}

      {:error, _} = e ->
        e
    end
  end

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
