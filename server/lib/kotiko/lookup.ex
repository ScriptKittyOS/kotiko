# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Lookup do
  @moduledoc """
  Free-form text to checked words: asks the model (`Kotiko.LLM`), then checks each entry
  (`Kotiko.WordInput`). Shared by the add routes and the Telegram bot. Saving is the
  caller's choice, so a preview saves nothing.

  While a lookup runs, `busy?/0` is true, so background jobs (the pronunciation refresh)
  wait and the learner's own adds always go first.
  """
  alias Kotiko.{LLM, Text, WordInput, Words}

  @max_words 5

  @doc """
  Interprets `text`. Options: `:base_langs` (default `["en"]`), `:hint_lang`, `:add` (the
  add box: always an add), `:origin`, `:status` (for the saved words).

  Returns `{:ok, %{intent, words: [attrs], rejected: [map], dropped_fields: [map], reply}}`
  or `{:error, message}` when no model answered.
  """
  def interpret(text, opts \\ []) do
    bases = opts[:base_langs] || ["en"]

    llm_opts = [add: opts[:add] || false, base_langs: bases, hint_lang: opts[:hint_lang]]

    case busy(fn -> LLM.interpret(text, Words.recent_languages(), llm_opts) end) do
      {:ok, %{intent: intent, words: words, reply: reply}} ->
        {:ok, check(words, intent, reply, bases, opts)}

      {:error, _} = e ->
        e
    end
  end

  defp check(words, intent, reply, bases, opts) do
    checked =
      Enum.map(words, fn w ->
        WordInput.validate(w,
          base_langs: bases,
          source: :model,
          origin: opts[:origin] || "add",
          status: opts[:status] || "active"
        )
      end)

    {valid, dropped} =
      for {:ok, attrs, d} <- checked, reduce: {[], []} do
        {vs, ds} -> {vs ++ [attrs], ds ++ Enum.map(d, &Map.merge(&1, summary(attrs)))}
      end

    {valid, too_many} = cap_words(valid)

    rejected =
      for({:error, reason, s} <- checked, do: Map.put(s, :reason, to_string(reason))) ++
        Enum.map(too_many, &Map.put(summary(&1), :reason, "too_many_words"))

    %{
      intent: intent,
      words: valid |> share_target_fields(bases),
      rejected: rejected,
      dropped_fields: dropped,
      reply: reply
    }
  end

  # At most @max_words distinct target words; their entries for several bases count once.
  defp cap_words(valid) do
    keys = valid |> Enum.map(&group/1) |> Enum.uniq() |> Enum.take(@max_words) |> MapSet.new()
    Enum.split_with(valid, &MapSet.member?(keys, group(&1)))
  end

  # Entries for the same target word get the romanization and native_vocalized of the
  # primary base's entry (or the first that has one), so a group's records agree.
  defp share_target_fields(valid, bases) do
    by_group = Enum.group_by(valid, &group/1)

    Enum.map(valid, fn attrs ->
      entries =
        Enum.sort_by(
          by_group[group(attrs)],
          &(Enum.find_index(bases, fn b -> b == &1.base_lang end) || 99)
        )

      Map.merge(attrs, %{
        romanization: Enum.find_value(entries, & &1.romanization),
        native_vocalized: Enum.find_value(entries, & &1.native_vocalized)
      })
    end)
  end

  defp group(attrs), do: {attrs.lang, Text.native_key(attrs.native), attrs.sense}

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
