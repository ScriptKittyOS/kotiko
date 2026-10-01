# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Slovo.Words do
  @moduledoc "Database functions for words, shared by the API router and the bot."
  import Ecto.Query
  alias Slovo.{Repo, Word}

  @doc "Active words, newest first. `langs` limits them to some languages; nil means all."
  def active(langs \\ nil) do
    from(w in Word, where: w.status == "active", order_by: [desc: w.inserted_at])
    |> where_langs(langs)
    |> Repo.all()
  end

  defp where_langs(q, nil), do: q
  defp where_langs(q, langs), do: from(w in q, where: w.lang in ^langs)

  def recent(limit \\ 15, langs \\ nil) do
    from(w in Word, where: w.status == "active", order_by: [desc: w.updated_at], limit: ^limit)
    |> where_langs(langs)
    |> Repo.all()
  end

  def count_active, do: Repo.aggregate(from(w in Word, where: w.status == "active"), :count)

  @doc "Every language with active words: [%{lang, language, count}], biggest first."
  def languages do
    from(w in Word,
      where: w.status == "active",
      group_by: w.lang,
      select: %{lang: w.lang, language: max(w.language), count: count(w.id)},
      order_by: [desc: count(w.id)]
    )
    |> Repo.all()
  end

  @doc "Languages of the most recently touched words, newest first. Hints for the model."
  def recent_languages(limit \\ 5) do
    from(w in Word,
      group_by: w.lang,
      select: %{lang: w.lang, language: max(w.language)},
      order_by: [desc: max(w.updated_at)],
      limit: ^limit
    )
    |> Repo.all()
  end

  @doc "Resolves \"arabic\", \"Arabic\" or \"ar\" to the stored language codes."
  def langs_matching(term) do
    t = term |> String.trim() |> String.downcase()

    languages()
    |> Enum.filter(fn l ->
      String.downcase(l.lang) == t or String.downcase(l.language || "") == t
    end)
    |> Enum.map(& &1.lang)
  end

  def get(id), do: Repo.get(Word, id)

  def get_by(lang, native), do: Repo.get_by(Word, lang: lang, native: native)

  @doc "Insert, or update the existing (lang, native) row."
  def upsert(attrs, status) do
    attrs = attrs |> Map.put(:status, status) |> keep_language_name()

    case get_by(attrs.lang, attrs.native) do
      nil -> %Word{} |> Word.changeset(attrs) |> Repo.insert()
      w -> w |> Word.changeset(attrs) |> Repo.update()
    end
  end

  # The model may call zh "Chinese" one day and "Mandarin" the next. Once a language
  # has a name, keep using it so cards and the extension stay consistent.
  defp keep_language_name(%{lang: lang} = attrs) do
    existing =
      from(w in Word,
        where: w.lang == ^lang and not is_nil(w.language),
        select: w.language,
        limit: 1
      )
      |> Repo.one()

    if existing, do: Map.put(attrs, :language, existing), else: attrs
  end

  def activate(%Word{} = w), do: w |> Word.changeset(%{status: "active"}) |> Repo.update()

  def delete(%Word{} = w), do: Repo.delete(w)

  @doc """
  Find words matching a term by native form, romanization or English.
  Done in Elixir because SQLite's lower() only folds ASCII, not Cyrillic.
  """
  def find(term) do
    t = term |> String.trim() |> String.downcase()

    Repo.all(Word)
    |> Enum.filter(fn w ->
      Enum.any?([w.native, w.romanization, w.english], &(&1 && String.downcase(&1) == t))
    end)
  end
end
