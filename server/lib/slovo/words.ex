defmodule Slovo.Words do
  import Ecto.Query
  alias Slovo.{Repo, Word}

  def active(lang) do
    from(w in Word,
      where: w.status == "active" and w.lang == ^lang,
      order_by: [desc: w.inserted_at]
    )
    |> Repo.all()
  end

  def recent(limit \\ 15) do
    from(w in Word, where: w.status == "active", order_by: [desc: w.updated_at], limit: ^limit)
    |> Repo.all()
  end

  def count_active, do: Repo.aggregate(from(w in Word, where: w.status == "active"), :count)

  def get(id), do: Repo.get(Word, id)

  def get_by(lang, native), do: Repo.get_by(Word, lang: lang, native: native)

  @doc "Insert, or update the existing (lang, native) row."
  def upsert(attrs, status) do
    attrs = Map.put(attrs, :status, status)

    case get_by(attrs.lang, attrs.native) do
      nil -> %Word{} |> Word.changeset(attrs) |> Repo.insert()
      w -> w |> Word.changeset(attrs) |> Repo.update()
    end
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
