# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Migrations.WordModelV2 do
  @moduledoc """
  The data side of migration `20261015000000_word_model_v2` (slice 07 section 6): turns
  0.2's `words` table into the v2 record, keeping every word.

  SQLite can't change a column's constraints in place, so the table is rebuilt: the rows
  are read, converted here, written to a new table that replaces the old one, and the
  indexes and the new tables are created. It all runs inside the migration's transaction,
  so a failure leaves the database as it was (and the backup taken before is untouched).

  Per row: `inserted_at` becomes `created_at`; timestamps get microseconds and a "Z";
  `english` becomes `gloss` and `english_forms` becomes Form objects (with the gloss); the
  row gets a UUIDv7 from its creation time, `base_lang` "en" (every 0.2 word was looked up
  for English pages), `origin` "migrated", `sense` "" and a `native_key`. Text is NFC and
  trimmed; `romanization` keeps its value. Rows that now share a natural key (NFD/NFC or
  case duplicates the old index allowed) are merged into the oldest, and the others become
  tombstones pointing at it. Integer ids are kept, so legacy clients and Telegram buttons
  still find their words.
  """
  require Logger
  alias Kotiko.{Text, UUID7, WordMerge}

  @columns ~w(id uuid lang native native_key sense base_lang romanization native_vocalized
              pronunciation pronunciation_careful pronunciation_source gloss forms note
              status origin source_text language created_at updated_at deleted_at
              merged_into seq)

  @create_words """
  CREATE TABLE words_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    lang TEXT NOT NULL,
    native TEXT NOT NULL,
    native_key TEXT NOT NULL,
    sense TEXT NOT NULL DEFAULT '',
    base_lang TEXT NOT NULL,
    romanization TEXT,
    native_vocalized TEXT,
    pronunciation TEXT,
    pronunciation_careful TEXT,
    pronunciation_source TEXT,
    gloss TEXT NOT NULL,
    forms TEXT NOT NULL DEFAULT '[]',
    note TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    origin TEXT NOT NULL DEFAULT 'add',
    source_text TEXT,
    language TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    merged_into TEXT,
    seq INTEGER NOT NULL
  )
  """

  @doc "Runs the migration on `repo` (inside the migration's transaction)."
  def up(repo) do
    if column?(repo, "words", "uuid") do
      Logger.info("The words table already has the v2 shape; nothing to convert.")
    else
      now = DateTime.utc_now() |> DateTime.truncate(:millisecond) |> usec()
      rows = read(repo)
      {records, stats} = convert(rows, now)
      old_sequence = sequence(repo, "words")

      repo.query!(@create_words)
      Enum.each(records, &insert(repo, &1))
      repo.query!("DROP TABLE words")
      repo.query!("ALTER TABLE words_v2 RENAME TO words")
      keep_sequence(repo, old_sequence)
      create_indexes(repo)
      create_tables(repo, records, now)
      log(stats)
    end
  end

  # ── reading 0.2 rows ─────────────────────────────────────────────────

  defp read(repo) do
    %{columns: columns, rows: rows} = repo.query!("SELECT * FROM words ORDER BY id")
    Enum.map(rows, fn row -> columns |> Enum.zip(row) |> Map.new() end)
  end

  defp column?(repo, table, column) do
    %{rows: rows} = repo.query!("SELECT name FROM pragma_table_info('#{table}')")
    [column] in rows
  end

  # The highest id the old table ever handed out (0 without AUTOINCREMENT ids).
  defp sequence(repo, table) do
    %{rows: [[exists]]} =
      repo.query!("SELECT count(*) FROM sqlite_master WHERE name = 'sqlite_sequence'")

    with 1 <- exists,
         %{rows: [[n]]} <- repo.query!("SELECT seq FROM sqlite_sequence WHERE name = ?", [table]) do
      n
    else
      _ -> 0
    end
  end

  # ── converting ───────────────────────────────────────────────────────

  @doc false
  # Public for the tests: 0.2 rows (maps with string keys) to v2 records and counts.
  def convert(rows, now) do
    {records, bad_times} =
      Enum.map_reduce(rows, 0, fn row, bad ->
        {record, ok?} = record(row, now)
        {record, if(ok?, do: bad, else: bad + 1)}
      end)

    {records, merged} = merge_duplicates(records, now)

    records =
      records
      |> Enum.sort_by(&{DateTime.to_unix(&1.created_at, :microsecond), &1.id})
      |> Enum.with_index(1)
      |> Enum.map(fn {r, seq} -> %{r | seq: seq} end)

    {records,
     %{
       words: length(records),
       merged: merged,
       bad_times: bad_times,
       blank_languages:
         Enum.count(rows, &(Text.blank?(&1["language"]) and &1["language"] != nil)),
       pending: Enum.count(records, &(&1.status == "pending" and is_nil(&1.deleted_at)))
     }}
  end

  defp record(row, now) do
    created = parse_time(row["inserted_at"] || row["created_at"])
    updated = parse_time(row["updated_at"])
    gloss = nfc(row["english"] || row["gloss"]) || ""
    native = nfc(row["native"]) || ""

    record = %{
      id: row["id"],
      uuid: UUID7.generate(created || now),
      lang: row["lang"],
      native: native,
      native_key: Text.native_key(native),
      sense: "",
      base_lang: "en",
      romanization: nfc(row["romanization"]),
      native_vocalized: nil,
      pronunciation: nil,
      pronunciation_careful: nil,
      pronunciation_source: nil,
      gloss: gloss,
      forms: forms(row["english_forms"], gloss),
      note: nfc(row["note"]),
      status: if(row["status"] in ~w(active paused pending), do: row["status"], else: "active"),
      origin: "migrated",
      source_text: row["source_text"],
      language: if(Text.blank?(row["language"]), do: nil, else: row["language"]),
      created_at: created || now,
      updated_at: updated || created || now,
      deleted_at: nil,
      merged_into: nil,
      seq: nil
    }

    {record, created != nil and updated != nil}
  end

  # The union Word.forms/1 made in 0.2: the newline-separated forms plus the gloss,
  # deduplicated ignoring case, as Form objects.
  defp forms(english_forms, gloss) do
    (String.split(english_forms || "", "\n") ++ [gloss])
    |> Enum.map(&nfc/1)
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq_by(&Text.fold/1)
    |> Enum.map(&%{text: &1, enabled: true, case: "any", ambiguous: false})
  end

  # Keeps the oldest of each natural key; merges the others into it and tombstones them.
  defp merge_duplicates(records, now) do
    records
    |> Enum.group_by(&{&1.lang, &1.native_key, &1.sense, &1.base_lang})
    |> Enum.flat_map_reduce(0, fn {_key, group}, merged ->
      [survivor | others] =
        Enum.sort_by(group, &{DateTime.to_unix(&1.created_at, :microsecond), &1.id})

      survivor =
        Enum.reduce(others, survivor, fn other, acc ->
          case WordMerge.changes(acc, other) do
            changes when changes == %{} ->
              acc

            changes ->
              acc
              |> Map.merge(changes)
              |> Map.put(:updated_at, latest(acc.updated_at, other.updated_at))
          end
        end)

      tombstones =
        Enum.map(others, &%{&1 | deleted_at: now, updated_at: now, merged_into: survivor.uuid})

      {[survivor | tombstones], merged + length(others)}
    end)
  end

  defp latest(a, b), do: if(DateTime.compare(a, b) == :lt, do: b, else: a)

  # 0.2 wrote naive "YYYY-MM-DDTHH:MM:SS"; SQLite's datetime() writes a space instead of T.
  defp parse_time(text) when is_binary(text) do
    case text |> String.trim() |> String.replace(" ", "T") |> NaiveDateTime.from_iso8601() do
      {:ok, naive} -> naive |> DateTime.from_naive!("Etc/UTC") |> usec()
      _ -> nil
    end
  end

  defp parse_time(_), do: nil

  defp usec(%DateTime{microsecond: {us, _}} = dt), do: %{dt | microsecond: {us, 6}}

  defp nfc(nil), do: nil

  defp nfc(s) when is_binary(s) do
    case s |> :unicode.characters_to_nfc_binary() |> String.trim() do
      "" -> nil
      s -> s
    end
  end

  # ── writing ──────────────────────────────────────────────────────────

  defp insert(repo, record) do
    placeholders = Enum.map_join(@columns, ", ", fn _ -> "?" end)

    values =
      Enum.map(@columns, fn c ->
        case Map.fetch!(record, String.to_existing_atom(c)) do
          %DateTime{} = dt -> DateTime.to_iso8601(dt)
          forms when c == "forms" -> Jason.encode!(forms)
          v -> v
        end
      end)

    repo.query!(
      "INSERT INTO words_v2 (#{Enum.join(@columns, ", ")}) VALUES (#{placeholders})",
      values
    )
  end

  # Ids deleted in 0.2 are never handed out again: an old Telegram button or popup Undo
  # with such an id must not reach a new word.
  defp keep_sequence(repo, old) do
    %{rows: [[max_id]]} = repo.query!("SELECT coalesce(max(id), 0) FROM words")
    seq = max(old, max_id)
    repo.query!("DELETE FROM sqlite_sequence WHERE name = 'words'")
    repo.query!("INSERT INTO sqlite_sequence (name, seq) VALUES ('words', ?)", [seq])
  end

  defp create_indexes(repo) do
    repo.query!(
      "CREATE UNIQUE INDEX words_natural ON words(lang, native_key, sense, base_lang) " <>
        "WHERE deleted_at IS NULL"
    )

    repo.query!("CREATE INDEX words_group ON words(lang, native_key)")
    repo.query!("CREATE INDEX words_seq ON words(seq)")
    repo.query!("CREATE INDEX words_status ON words(status)")
  end

  defp create_tables(repo, records, now) do
    repo.query!("""
    CREATE TABLE sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_seq INTEGER NOT NULL,
      purged_through_seq INTEGER NOT NULL DEFAULT 0,
      reset_epoch INTEGER NOT NULL DEFAULT 0
    )
    """)

    repo.query!("INSERT INTO sync_state (id, last_seq) VALUES (1, ?)", [length(records)])

    repo.query!("""
    CREATE TABLE add_requests (
      client_request_id TEXT PRIMARY KEY,
      response TEXT NOT NULL,
      inserted_at TEXT NOT NULL
    )
    """)

    repo.query!("""
    CREATE TABLE maintenance_jobs (
      name TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      done INTEGER NOT NULL,
      total INTEGER NOT NULL,
      attempts TEXT NOT NULL DEFAULT '{}',
      retry_at TEXT,
      finished_at TEXT
    )
    """)

    # Section 8's one-time refresh: every live saved word needs a pronunciation, and
    # every migrated record is for English pages, which have a respelling key.
    total = Enum.count(records, &(is_nil(&1.deleted_at) and &1.status != "pending"))

    {state, finished} =
      if total == 0, do: {"done", DateTime.to_iso8601(now)}, else: {"running", nil}

    repo.query!(
      "INSERT INTO maintenance_jobs (name, state, done, total, finished_at) " <>
        "VALUES ('pronunciation_refresh', ?, 0, ?, ?)",
      [state, total, finished]
    )
  end

  defp log(%{words: 0}), do: :ok

  defp log(stats) do
    Logger.info(
      "Upgraded your words to the new word model: #{stats.words - stats.merged} words " <>
        "(#{stats.pending} waiting in Telegram), every one kept. " <>
        "#{stats.merged} duplicate(s) merged into the oldest copy."
    )

    if stats.bad_times > 0 do
      Logger.warning(
        "#{stats.bad_times} word(s) had a saved time that couldn't be read; they now carry " <>
          "the time of this upgrade instead."
      )
    end
  end
end
