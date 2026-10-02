# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.MigrationV2Test do
  # Slice 07 section 6: a 0.2 database, shaped like a real one, upgraded on its own file
  # (not the sandbox), with the automatic backup first.
  use ExUnit.Case, async: false
  import ExUnit.CaptureLog
  require Logger
  alias Kotiko.{LegacyDb, Migrations, Repo, UUID7, Word, Words}

  @fixture Path.expand("../fixtures/db/kotiko-0.2-words.sql", __DIR__)

  setup do
    # The backup and upgrade lines are info; the test config logs warnings only.
    level = Logger.level()
    Logger.configure(level: :info)
    on_exit(fn -> Logger.configure(level: level) end)

    dir = Path.join(System.tmp_dir!(), "kotiko-migration-#{System.unique_integer([:positive])}")
    on_exit(fn -> File.rm_rf(dir) end)
    db = LegacyDb.create!(Path.join(dir, "kotiko.db"), File.read!(@fixture))
    %{dir: dir, db: db}
  end

  defp upgrade(%{dir: dir, db: db}) do
    with_log(fn -> LegacyDb.with_repo(db, fn -> Migrations.upgrade(Repo, dir) end) end)
  end

  defp words(db) do
    LegacyDb.with_repo(db, fn -> Repo.all(Word) |> Map.new(&{&1.id, &1}) end)
  end

  defp query(db, sql), do: LegacyDb.with_repo(db, fn -> Repo.query!(sql).rows end)

  test "backs up first, then keeps every word in the v2 shape", ctx do
    {backup, log} = upgrade(ctx)

    assert backup =~ ~r"/backups/kotiko-pre-#{Kotiko.Health.version()}-\d{8}T\d{6}Z\.db$"
    assert log =~ "Backed up the database to #{backup}"
    assert log =~ "== Migrated 20261015000000"
    assert log =~ "Upgraded your words to the new word model: 9 words (1 waiting in Telegram)"
    assert log =~ "2 duplicate(s) merged"

    # The backup is the 0.2 database, untouched.
    assert File.stat!(backup).mode |> Bitwise.band(0o777) == 0o600
    assert [[11]] = query(backup, "SELECT count(*) FROM words WHERE english IS NOT NULL")

    w = words(ctx.db)
    assert map_size(w) == 11

    assert Enum.all?(
             Map.values(w),
             &(&1.base_lang == "en" and &1.origin == "migrated" and &1.sense == "")
           )

    # english is the gloss; the gloss is among the forms, deduplicated ignoring case.
    assert w[2].gloss == "thanks"
    assert Enum.map(w[2].forms, & &1.text) == ["thanks", "thank you"]
    assert w[3].forms == [%{text: "thanks", enabled: true, case: "any", ambiguous: false}]
    assert {w[12].native, w[12].gloss} == {"谢谢", "thanks"}

    # Every romanization kept byte for byte (after NFC and trim); the new fields empty.
    assert w[1].romanization == "pazhaluysta"
    assert w[12].romanization == "xièxie"

    for word <- Map.values(w) do
      assert {word.native_vocalized, word.pronunciation, word.pronunciation_careful,
              word.pronunciation_source} == {nil, nil, nil, nil}
    end

    # The note a learner wrote survives.
    assert w[2].note == "My own mnemonic"
  end

  test "merges NFD and case duplicates into the oldest and tombstones the others", ctx do
    upgrade(ctx)
    w = words(ctx.db)

    # phở: row 6 was the NFD spelling of row 5.
    assert w[5].deleted_at == nil
    assert w[6].deleted_at && w[6].merged_into == w[5].uuid
    assert w[5].native == "phở" and w[6].native == "phở"
    assert Enum.map(w[5].forms, & &1.text) == ["pho", "pho soup"]
    assert w[5].note == "Noodle soup."

    # Hund (active) and hund (a pending lookup): one live word, active, with both meanings.
    assert w[8].deleted_at == nil and w[8].status == "active"
    assert w[9].merged_into == w[8].uuid
    assert w[8].native == "Hund"
    assert Enum.map(w[8].forms, & &1.text) == ["dog", "hound"]
    # The model's language names (blank ones included, F29) are gone after slice 08's
    # migration: names come from the tag.
    refute ["language"] in query(ctx.db, "SELECT name FROM pragma_table_info('words')")
  end

  test "ids, timestamps and seq", ctx do
    upgrade(ctx)
    w = words(ctx.db)

    assert w[1].created_at == ~U[2026-09-01 10:00:00.000000Z]
    assert w[2].updated_at == ~U[2026-09-03 08:00:00.000000Z]
    # SQLite's datetime() format, with a space.
    assert w[13].created_at == ~U[2026-09-11 22:00:00.000000Z]

    assert [["2026-09-01T10:00:00.000000Z", "2026-09-01T10:00:00.000000Z"]] =
             query(ctx.db, "SELECT created_at, updated_at FROM words WHERE id = 1")

    for word <- Map.values(w) do
      assert UUID7.valid?(word.uuid)
      assert UUID7.timestamp_ms(word.uuid) == DateTime.to_unix(word.created_at, :millisecond)
    end

    by_created =
      w |> Map.values() |> Enum.sort_by(&{DateTime.to_unix(&1.created_at, :microsecond), &1.id})

    assert Enum.map(by_created, & &1.seq) == Enum.to_list(1..11)

    assert [[11, 0, 0]] =
             query(ctx.db, "SELECT last_seq, purged_through_seq, reset_epoch FROM sync_state")

    # 0.2 deleted id 14 outright: it is never handed out again.
    assert [[14]] = query(ctx.db, "SELECT seq FROM sqlite_sequence WHERE name = 'words'")

    LegacyDb.with_repo(ctx.db, fn ->
      {:ok, %{word: new}} =
        Words.add(%{
          lang: "ru",
          native: "нет",
          base_lang: "en",
          gloss: "no",
          forms: [],
          status: "active"
        })

      assert new.id == 15
      assert new.seq == 12
    end)
  end

  test "creates the indexes, the new tables and the pronunciation job", ctx do
    upgrade(ctx)

    indexes =
      query(ctx.db, "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'words'")

    assert Enum.sort(List.flatten(indexes)) -- ["sqlite_autoindex_words_1"] ==
             ~w(words_group words_natural words_seq words_status)

    assert [[sql]] = query(ctx.db, "SELECT sql FROM sqlite_master WHERE name = 'words_natural'")
    assert sql =~ "WHERE deleted_at IS NULL"

    # 9 live words, one of them pending: 8 need a pronunciation.
    assert [["running", 0, 8, "{}"]] =
             query(
               ctx.db,
               "SELECT state, done, total, attempts FROM maintenance_jobs WHERE name = 'pronunciation_refresh'"
             )

    assert [[0]] = query(ctx.db, "SELECT count(*) FROM add_requests")
  end

  test "a second run migrates nothing and makes no backup", ctx do
    {first, _} = upgrade(ctx)
    {second, log} = upgrade(ctx)

    assert second == nil
    refute log =~ "Backed up"
    refute log =~ "== Running"
    assert [_] = Path.wildcard(Path.join(ctx.dir, "backups/*.db"))
    assert File.exists?(first)
  end

  test "a new database gets no backup and a finished job", %{dir: dir} do
    db = Path.join(dir, "fresh/kotiko.db")
    File.mkdir_p!(Path.dirname(db))

    {nil, _log} =
      with_log(fn ->
        LegacyDb.with_repo(db, fn -> Migrations.upgrade(Repo, Path.dirname(db)) end)
      end)

    refute File.exists?(Path.join(dir, "fresh/backups"))
    assert [["done", 0]] = query(db, "SELECT state, total FROM maintenance_jobs")
  end

  test "if the backup can't be written, nothing is migrated", ctx do
    # A file where the backups folder should be.
    File.mkdir_p!(ctx.dir)
    File.write!(Path.join(ctx.dir, "backups"), "")

    assert_raise File.Error, fn ->
      with_log(fn -> LegacyDb.with_repo(ctx.db, fn -> Migrations.upgrade(Repo, ctx.dir) end) end)
    end

    assert [[11]] = query(ctx.db, "SELECT count(*) FROM words WHERE english IS NOT NULL")
  end

  test "keeps the newest five backups", ctx do
    backups = Path.join(ctx.dir, "backups")
    File.mkdir_p!(backups)

    for day <- 1..6,
        do: File.write!(Path.join(backups, "kotiko-pre-0.1.0-2026090#{day}T000000Z.db"), "")

    File.write!(Path.join(backups, "notes.txt"), "mine")
    {backup, _} = upgrade(ctx)

    left = backups |> File.ls!() |> Enum.sort()
    assert "notes.txt" in left
    assert Path.basename(backup) in left
    assert length(left) == 6
    refute "kotiko-pre-0.1.0-20260901T000000Z.db" in left
    refute "kotiko-pre-0.1.0-20260902T000000Z.db" in left
  end

  describe "concurrency on a real pool" do
    test "20 concurrent adds of the same word: one live row, no exceptions", %{dir: dir} do
      db = Path.join(dir, "pool/kotiko.db")
      File.mkdir_p!(Path.dirname(db))

      # Migrated on one connection first, as the server does: a pool opening a new file
      # at once races to switch it to WAL.
      LegacyDb.with_repo(db, fn ->
        capture_log(fn -> Ecto.Migrator.run(Repo, :up, all: true) end)
      end)

      LegacyDb.with_repo(
        db,
        fn pid ->
          attrs = %{
            lang: "ja",
            native: "犬",
            base_lang: "en",
            gloss: "dog",
            forms: [],
            status: "active"
          }

          results =
            1..20
            |> Task.async_stream(
              fn _ ->
                Repo.put_dynamic_repo(pid)

                try do
                  Words.add(attrs)
                rescue
                  e -> {:raised, e}
                end
              end,
              max_concurrency: 20
            )
            |> Enum.map(fn {:ok, r} -> r end)

          assert Enum.all?(results, &match?({:ok, _}, &1)), inspect(results)
          assert Enum.count(results, &match?({:ok, %{result: :created}}, &1)) == 1
          assert Repo.aggregate(Word, :count) == 1
        end,
        5
      )
    end
  end
end
