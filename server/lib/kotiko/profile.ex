# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Profile do
  @moduledoc """
  The learner's languages on the server (slice 41 section 9), so the Telegram bot looks
  words up in the right languages and talks in the learner's own:

  - `base_langs`: the languages the learner reads, primary first, each a base tag
    (`Kotiko.Lang.base_tag/1`: `es-PR` -> `es`), at most `max_base_langs` (4);
  - `ui_lang`: the interface language the learner chose in the extension, or nil when
    they left it on automatic.

  One row, written by the extension (`PUT /api/v1/profile`, slice 50's `s:ui`) or by the
  bot's `/bases`. A server that has never been told has no profile (`get/0` is nil), and
  the bot falls back to the Telegram app's language. Slice 48 moves the row to per-user.
  """
  import Ecto.Query
  alias Kotiko.{Lang, Repo, Spec, Word, WriteLock}

  @max_tag 35

  @doc "The profile: `%{base_langs, ui_lang, updated_at}`, or nil when none was set."
  def get do
    from(p in "profile",
      where: p.id == 1,
      select: %{base_langs: p.base_langs, ui_lang: p.ui_lang, updated_at: p.updated_at}
    )
    |> Repo.one()
    |> case do
      nil ->
        nil

      row ->
        case Jason.decode(row.base_langs) do
          {:ok, [_ | _] = bases} -> %{row | base_langs: Enum.filter(bases, &is_binary/1)}
          _ -> nil
        end
    end
  end

  @doc """
  Sets the profile from a request body: `base_langs` (required) and `ui_lang` (a language
  tag; omitted, null or "auto" means none chosen). `{:ok, profile}` or `{:error, details}`
  naming the field.
  """
  def put(body) when is_map(body) do
    with {:ok, bases} <- base_langs(body["base_langs"]),
         {:ok, ui} <- ui_lang(body["ui_lang"]) do
      {:ok, write(bases, ui)}
    end
  end

  def put(_body), do: base_langs(nil)

  @doc "Sets only the base languages (the bot's `/bases`), keeping the interface language."
  def put_bases(list) do
    with {:ok, bases} <- base_langs(list) do
      {:ok, write(bases, (get() || %{ui_lang: nil}).ui_lang)}
    end
  end

  @doc """
  Checks a list of base languages: 1 to `max_base_langs` tags, each reduced to its base
  tag, duplicates dropped, order kept. `{:ok, bases}` or `{:error, %{field, max}}`.
  """
  def base_langs(list) when is_list(list) and list != [] do
    bases = Enum.map(list, &base_tag/1)

    if length(list) <= max() and Enum.all?(bases, &is_binary/1),
      do: {:ok, Enum.uniq(bases)},
      else: {:error, %{field: "base_langs", max: max()}}
  end

  def base_langs(_), do: {:error, %{field: "base_langs", max: max()}}

  @doc "The most base languages a learner can have (spec/rules.json)."
  def max, do: Spec.rule(:max_base_langs)

  defp ui_lang(v) when v in [nil, "auto"], do: {:ok, nil}

  defp ui_lang(v) do
    case base_tag(v) do
      nil -> {:error, %{field: "ui_lang"}}
      tag -> {:ok, tag}
    end
  end

  defp base_tag(v) when is_binary(v) and byte_size(v) <= @max_tag, do: Lang.base_tag(v)
  defp base_tag(_), do: nil

  defp write(bases, ui) do
    now = Word.timestamp(Kotiko.Words.now())
    row = %{id: 1, base_langs: Jason.encode!(bases), ui_lang: ui, updated_at: now}

    WriteLock.run(fn ->
      Repo.insert_all("profile", [row],
        on_conflict: {:replace, [:base_langs, :ui_lang, :updated_at]},
        conflict_target: :id
      )
    end)

    %{base_langs: bases, ui_lang: ui, updated_at: now}
  end

  @doc "The profile as `GET /api/v1/profile` returns it; with none set, empty."
  def to_api(nil), do: %{base_langs: [], ui_lang: nil, updated_at: nil}
  def to_api(p), do: Map.take(p, [:base_langs, :ui_lang, :updated_at])
end
