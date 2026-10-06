# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Bot.Prefs do
  @moduledoc """
  What the bot remembers per Telegram user (slice 41 section 9), in `telegram_prefs`:
  the language chosen with `/language` (nil: follow the Telegram app) and the one-time
  notes already shown (`noted`: note name -> the value it was shown for).

  Only Telegram user ids the server already allows get a row, and only once they send
  `/language` or are shown a one-time note.
  """
  import Ecto.Query
  alias Kotiko.{Repo, Word, Words, WriteLock}

  @doc "`%{locale, noted}` for a Telegram user; empty when the bot knows nothing of them."
  def get(telegram_id) when is_integer(telegram_id) do
    from(p in "telegram_prefs",
      where: p.telegram_id == ^telegram_id,
      select: %{locale: p.locale, noted: p.noted}
    )
    |> Repo.one()
    |> case do
      nil -> empty()
      row -> %{row | noted: decode(row.noted)}
    end
  end

  def get(_telegram_id), do: empty()

  @doc "Stores the user's `/language` choice; nil goes back to the Telegram app's language."
  def put_locale(telegram_id, locale), do: upsert(telegram_id, %{locale: locale}, [:locale])

  @doc "Records that the note `name` was shown for `value` (shown again when it changes)."
  def noted(telegram_id, name, value) do
    noted = Map.put(get(telegram_id).noted, name, value)
    upsert(telegram_id, %{noted: Jason.encode!(noted)}, [:noted])
  end

  defp upsert(telegram_id, fields, replace) when is_integer(telegram_id) do
    base = %{
      telegram_id: telegram_id,
      locale: nil,
      noted: "{}",
      updated_at: Word.timestamp(Words.now())
    }

    WriteLock.run(fn ->
      Repo.insert_all("telegram_prefs", [Map.merge(base, fields)],
        on_conflict: {:replace, replace ++ [:updated_at]},
        conflict_target: :telegram_id
      )
    end)

    :ok
  end

  defp upsert(_telegram_id, _fields, _replace), do: :ok

  defp empty, do: %{locale: nil, noted: %{}}

  defp decode(json) do
    case Jason.decode(json || "{}") do
      {:ok, map} when is_map(map) -> map
      _ -> %{}
    end
  end
end
