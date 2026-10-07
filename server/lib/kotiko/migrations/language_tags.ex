# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Migrations.LanguageTags do
  @moduledoc """
  The data side of migration `20261020000000_language_tags` (slice 08 section 7):

  1. Every `lang` becomes its canonical tag (`cmn` -> `zh`, `iw` -> `he`, `zh-TW` ->
     `zh-Hant`), written in the script its `native` is in where the language has several
     (`sr` with "hvala" -> `sr-Latn`); every `base_lang` becomes its base tag. Live words
     that now share a natural key are merged into the oldest with slice 07's rules, and
     the others become tombstones pointing at it.
  2. Live words whose `native` isn't in their language's script are left as they are and
     counted in the log, never deleted.
  3. The `language` column (the model's name for the language) is dropped: names come
     from the tag.

  Every changed row gets a new `seq` and a later `updated_at`, so sync carries it. It all
  runs inside the migration's transaction, after `Kotiko.Migrations` has backed the
  database up; a failure leaves the database as it was. Running it again changes nothing.
  """
  require Logger
  alias Kotiko.{Lang, WordMerge}
  alias Kotiko.Word.Forms

  @fields ~w(id uuid lang native native_key sense base_lang romanization native_vocalized
             pronunciation pronunciation_careful pronunciation_source gloss forms note status
             source_text created_at updated_at deleted_at)

  @doc "Runs the migration on `repo` (inside the migration's transaction)."
  def up(repo) do
    now = DateTime.utc_now() |> DateTime.truncate(:millisecond) |> usec()
    rows = read(repo)
    {changes, stats} = plan(rows, now)
    # Without the unique index while rows move, a word can take a key another word is
    # leaving; the index comes back as slice 07 made it.
    repo.query!("DROP INDEX IF EXISTS words_natural")
    write(repo, changes)

    repo.query!(
      "CREATE UNIQUE INDEX words_natural ON words(lang, native_key, sense, base_lang) " <>
        "WHERE deleted_at IS NULL"
    )

    drop_language(repo)
    log(stats)
    stats
  end

  defp read(repo) do
    %{columns: columns, rows: rows} =
      repo.query!("SELECT #{Enum.join(@fields, ", ")} FROM words ORDER BY id")

    Enum.map(rows, fn row ->
      columns
      |> Enum.zip(row)
      |> Map.new(fn {k, v} -> {String.to_existing_atom(k), v} end)
      |> Map.update!(:forms, &decode_forms/1)
      |> Map.update!(:created_at, &parse_time/1)
      |> Map.update!(:updated_at, &parse_time/1)
    end)
  end

  defp decode_forms(json) do
    case Forms.load(json) do
      {:ok, forms} -> forms
      :error -> []
    end
  end

  @doc false
  # Public for the tests: rows (maps with atom keys) to the changes to write, in order,
  # as {id, %{column => value}}, and counts for the log.
  def plan(rows, now) do
    retagged = Enum.map(rows, &retag/1)

    {live, gone} = Enum.split_with(retagged, &is_nil(&1.row.deleted_at))

    {merged_live, tombstones} =
      live
      |> Enum.group_by(&{&1.row.lang, &1.row.native_key, &1.row.sense, &1.row.base_lang})
      |> Enum.flat_map_reduce([], fn {_key, group}, tombstones ->
        [survivor | others] = Enum.sort_by(group, &{time(&1.row.created_at), &1.row.id})
        survivor = Enum.reduce(others, survivor, &absorb(&2, &1))

        losers =
          Enum.map(others, fn o ->
            %{
              o
              | row: Map.merge(o.row, %{deleted_at: now, merged_into: survivor.row.uuid}),
                changed: true
            }
          end)

        {[survivor], tombstones ++ losers}
      end)

    # Tombstones first: they free their natural key before a survivor takes its new tag.
    ordered =
      Enum.sort_by(tombstones, & &1.row.id) ++ Enum.sort_by(merged_live ++ gone, & &1.row.id)

    changes = for %{changed: true} = r <- ordered, do: {r.row.id, columns(r, now)}

    {changes,
     %{
       retagged: Enum.count(retagged, &(&1.retagged and is_nil(&1.row.deleted_at))),
       merged: length(tombstones),
       suspect: Enum.count(merged_live, & &1.suspect),
       suspect_words: for(r <- merged_live, r.suspect, do: {r.row.lang, r.row.native})
     }}
  end

  # The canonical tag and base tag of one row, and whether its native fits the script.
  defp retag(row) do
    lang =
      case Lang.canonical(row.lang) do
        {:ok, tag} -> tag
        {:error, _} -> row.lang
      end

    {lang, suspect} =
      case Lang.check_script(lang, row.native) do
        {:ok, tag} -> {tag, false}
        {:error, _} -> {lang, true}
      end

    base = Lang.base_tag(row.base_lang) || row.base_lang
    changed = lang != row.lang or base != row.base_lang
    suspect = suspect or match?({:error, _}, Lang.canonical(row.lang))

    %{
      row: %{row | lang: lang, base_lang: base},
      original: row,
      retagged: changed,
      changed: changed,
      merge: %{},
      suspect: suspect and is_nil(row.deleted_at) and row.native_key != row.uuid
    }
  end

  # Slice 07's merge rules: the survivor keeps what it has and takes what it lacks.
  defp absorb(survivor, other) do
    case WordMerge.changes(survivor.row, other.row) do
      changes when changes == %{} ->
        survivor

      changes ->
        %{
          survivor
          | row: Map.merge(survivor.row, changes),
            merge: Map.merge(survivor.merge, changes),
            changed: true
        }
    end
  end

  defp columns(r, now) do
    base = Map.take(r.row, [:lang, :base_lang])

    tomb =
      Map.take(r.row, [:deleted_at, :merged_into])
      |> Enum.reject(&is_nil(elem(&1, 1)))
      |> Map.new()

    base
    |> Map.merge(r.merge)
    |> Map.merge(tomb)
    |> Map.put(:updated_at, later(now, r.original.updated_at))
  end

  defp write(_repo, []), do: :ok

  defp write(repo, changes) do
    %{rows: [[last]]} = repo.query!("SELECT last_seq FROM sync_state WHERE id = 1")

    last =
      Enum.reduce(changes, last, fn {id, cols}, seq ->
        seq = seq + 1
        cols = Map.put(cols, :seq, seq)
        names = Map.keys(cols)
        set = Enum.map_join(names, ", ", &"#{&1} = ?")
        values = Enum.map(names, &value(&1, cols[&1]))
        repo.query!("UPDATE words SET #{set} WHERE id = ?", values ++ [id])
        seq
      end)

    repo.query!("UPDATE sync_state SET last_seq = ? WHERE id = 1", [last])
  end

  defp value(:forms, forms), do: Jason.encode!(Enum.map(forms, &Forms.form/1))
  defp value(_, %DateTime{} = dt), do: DateTime.to_iso8601(dt)
  defp value(_, v), do: v

  defp drop_language(repo) do
    %{rows: rows} = repo.query!("SELECT name FROM pragma_table_info('words')")
    if ["language"] in rows, do: repo.query!("ALTER TABLE words DROP COLUMN language")
  end

  defp later(now, nil), do: now

  defp later(now, prev) do
    if DateTime.compare(now, prev) == :gt, do: now, else: DateTime.add(prev, 1, :millisecond)
  end

  defp time(nil), do: 0
  defp time(%DateTime{} = dt), do: DateTime.to_unix(dt, :microsecond)

  defp parse_time(text) when is_binary(text) do
    case DateTime.from_iso8601(text) do
      {:ok, dt, _} -> usec(dt)
      _ -> nil
    end
  end

  defp parse_time(_), do: nil

  defp usec(%DateTime{microsecond: {us, _}} = dt), do: %{dt | microsecond: {us, 6}}

  defp log(%{retagged: 0, merged: 0, suspect: 0}), do: :ok

  defp log(stats) do
    if stats.retagged > 0 or stats.merged > 0 do
      Logger.info(
        "Language codes: #{stats.retagged} word(s) now use the standard code for their " <>
          "language (for example cmn is now zh); #{stats.merged} duplicate(s) merged into " <>
          "the oldest copy. Names now come from the code."
      )
    end

    if stats.suspect > 0 do
      Logger.warning(
        "#{stats.suspect} word(s) may have the wrong language (the word isn't written in " <>
          "that language's script); they are unchanged. Check them in the dashboard."
      )

      # The words themselves are the learner's: only at debug, with LOG_LOOKUPS (B-07).
      if Kotiko.LLM.log_lookups?(),
        do:
          Logger.debug("Words that may have the wrong language: #{inspect(stats.suspect_words)}")
    end
  end
end
