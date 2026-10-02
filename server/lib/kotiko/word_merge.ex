# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.WordMerge do
  @moduledoc """
  Slice 07 section 4's merge rules: what a re-add of a word the learner already has may
  change. Nothing the learner wrote is ever overwritten; empty fields are filled, forms
  are unioned, and the meaning (`gloss`) stays.

  Pure: `changes/3` takes the existing word and the incoming one as maps and returns only
  the fields that change. Used by `Kotiko.Words.add/2` and by the v2 migration.
  """
  alias Kotiko.{Text, WordSpec}
  alias Kotiko.Word.Forms

  @fill ~w(romanization native_vocalized note source_text)a

  @doc """
  The fields of `existing` that `incoming` changes, as a map (empty when nothing changes).
  `opts[:explicit]` is true for the learner's own add (the add box, Telegram "add"): it
  un-pauses a paused word.
  """
  def changes(existing, incoming, opts \\ []) do
    %{}
    |> fill(existing, incoming)
    |> pronunciation(existing, incoming)
    |> forms(existing, incoming)
    |> status(existing, incoming, opts)
  end

  # Filled only when the existing value is blank. Never overwritten.
  defp fill(acc, existing, incoming) do
    Enum.reduce(@fill, acc, fn f, acc ->
      if Text.blank?(existing[f]) and not Text.blank?(incoming[f]),
        do: Map.put(acc, f, incoming[f]),
        else: acc
    end)
  end

  # The three fields move together, and only into a word with no pronunciation, so a
  # learner's edit survives and an everyday form is never paired with another answer's
  # careful form.
  defp pronunciation(acc, existing, incoming) do
    if Text.blank?(existing[:pronunciation]) and not Text.blank?(incoming[:pronunciation]) do
      Map.merge(acc, %{
        pronunciation: incoming[:pronunciation],
        pronunciation_careful: incoming[:pronunciation_careful],
        pronunciation_source: incoming[:pronunciation_source] || "model"
      })
    else
      acc
    end
  end

  # Union by case-insensitive text. Existing forms keep their flags (a disabled form stays
  # disabled); new ones are appended with theirs. A different incoming gloss becomes a
  # form. Existing forms win when the cap is hit, and are never dropped by it.
  defp forms(acc, existing, incoming) do
    old = Enum.map(existing[:forms] || [], &Forms.form/1)
    gloss = if incoming[:gloss], do: [Forms.form(%{text: incoming[:gloss]})], else: []
    seen = MapSet.new(old, &Text.fold(&1.text))

    new =
      (Enum.map(incoming[:forms] || [], &Forms.form/1) ++ gloss)
      |> Enum.reject(&(is_nil(&1.text) or MapSet.member?(seen, Text.fold(&1.text))))
      |> Enum.uniq_by(&Text.fold(&1.text))
      |> Enum.take(max(WordSpec.max_forms() - length(old), 0))

    if new == [], do: acc, else: Map.put(acc, :forms, old ++ new)
  end

  defp status(acc, existing, incoming, opts) do
    to =
      case {existing[:status], incoming[:status]} do
        {"pending", s} when s in ["active", "paused"] -> s
        {"paused", "active"} -> if opts[:explicit], do: "active", else: "paused"
        {s, _} -> s
      end

    if to != existing[:status], do: Map.put(acc, :status, to), else: acc
  end
end
