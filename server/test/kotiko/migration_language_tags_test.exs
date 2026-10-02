# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.MigrationLanguageTagsTest do
  # Slice 08 section 7: a database with old codes (cmn next to zh, zh-TW, iw), blank names
  # and words in the wrong script, upgraded on its own file after the automatic backup.
  use ExUnit.Case, async: false
  import ExUnit.CaptureLog
  require Logger
  alias Kotiko.{LegacyDb, Migrations, Repo, Word, Words}

  @rows """
  INSERT INTO words (id, lang, language, native, romanization, english, english_forms, note, status, source_text, inserted_at, updated_at) VALUES
    (1, 'zh', 'Chinese', '猫', 'māo', 'cat', 'cat
  cats', NULL, 'active', 'mao', '2026-09-01T10:00:00', '2026-09-01T10:00:00'),
    (2, 'cmn', 'Mandarin', '猫', NULL, 'cat', 'cat
  kitty', 'My note: sounds like meow.', 'active', 'cat in mandarin', '2026-09-02T10:00:00', '2026-09-02T10:00:00'),
    (3, 'zh-TW', 'Chinese', '愛', 'ài', 'love', 'love', NULL, 'active', NULL, '2026-09-03T10:00:00', '2026-09-03T10:00:00'),
    (4, 'iw', '', 'שלום', 'shalom', 'hello', 'hello', NULL, 'active', NULL, '2026-09-04T10:00:00', '2026-09-04T10:00:00'),
    (5, 'sr', 'Serbian', 'hvala', 'hvala', 'thanks', 'thanks', NULL, 'active', NULL, '2026-09-05T10:00:00', '2026-09-05T10:00:00'),
    (6, 'ru', 'Russian', 'spasibo', NULL, 'thank you', 'thank you', NULL, 'active', NULL, '2026-09-06T10:00:00', '2026-09-06T10:00:00'),
    (7, 'ru', 'Russian', 'да', 'da', 'yes', 'yes', NULL, 'active', NULL, '2026-09-07T10:00:00', '2026-09-07T10:00:00'),
    (8, 'i', 'Klingon', 'Qapla''', NULL, 'success', 'success', NULL, 'active', NULL, '2026-09-08T10:00:00', '2026-09-08T10:00:00');
  """

  setup do
    level = Logger.level()
    Logger.configure(level: :info)
    on_exit(fn -> Logger.configure(level: level) end)

    dir = Path.join(System.tmp_dir!(), "kotiko-langtags-#{System.unique_integer([:positive])}")
    on_exit(fn -> File.rm_rf(dir) end)
    db = LegacyDb.create!(Path.join(dir, "kotiko.db"), @rows)
    %{dir: dir, db: db}
  end

  defp upgrade(%{dir: dir, db: db}) do
    with_log(fn -> LegacyDb.with_repo(db, fn -> Migrations.upgrade(Repo, dir) end) end)
  end

  defp words(db), do: LegacyDb.with_repo(db, fn -> Repo.all(Word) |> Map.new(&{&1.id, &1}) end)
  defp query(db, sql), do: LegacyDb.with_repo(db, fn -> Repo.query!(sql).rows end)

  test "re-tags every word, merges cmn into zh keeping the note, and drops the name column",
       ctx do
    {backup, log} = upgrade(ctx)
    assert backup =~ "/backups/kotiko-pre-"
    assert log =~ "== Migrated 20261020000000"
    w = words(ctx.db)

    # cmn and zh were one word: the older survives with the learner's note and both forms.
    assert w[1].lang == "zh" and w[1].deleted_at == nil
    assert w[1].note == "My note: sounds like meow."
    assert Enum.map(w[1].forms, & &1.text) == ["cat", "cats", "kitty"]
    assert w[2].deleted_at && w[2].merged_into == w[1].uuid

    assert w[3].lang == "zh-Hant"
    assert w[4].lang == "he"
    # The script decides between Serbian's two scripts.
    assert w[5].lang == "sr-Latn"
    assert log =~ "4 word(s) now use the standard code"
    assert log =~ "1 duplicate(s) merged"

    # Suspect words are kept as they were and counted, never deleted.
    assert {w[6].lang, w[6].deleted_at} == {"ru", nil}
    assert {w[8].lang, w[8].deleted_at} == {"i", nil}
    assert log =~ "2 word(s) may have the wrong language"
    refute log =~ "spasibo"

    refute ["language"] in query(ctx.db, "SELECT name FROM pragma_table_info('words')")
    # Names now come from the tag.
    assert Word.to_api(w[3]).language == "中文"
    assert Word.to_legacy_json(w[4]).language == "Hebrew"
  end

  test "changed rows get a new seq and a later updated_at; unchanged rows keep theirs", ctx do
    upgrade(ctx)
    w = words(ctx.db)

    assert w[7].seq <= 8
    assert w[7].updated_at == ~U[2026-09-07 10:00:00.000000Z]

    for id <- [1, 2, 3, 4, 5] do
      assert w[id].seq > 8, "row #{id}"
      assert DateTime.compare(w[id].updated_at, ~U[2026-10-01 00:00:00Z]) == :gt
    end

    [[last]] = query(ctx.db, "SELECT last_seq FROM sync_state")
    assert last == w |> Map.values() |> Enum.map(& &1.seq) |> Enum.max()
  end

  test "a second boot runs no migration and changes nothing", ctx do
    upgrade(ctx)
    before = words(ctx.db)
    {backup, _log} = upgrade(ctx)
    assert backup == nil
    assert words(ctx.db) == before
  end

  test "the natural key still holds after the merge", ctx do
    upgrade(ctx)

    LegacyDb.with_repo(ctx.db, fn ->
      assert {:ok, %{result: :unchanged}} =
               Words.add(%{
                 lang: "zh",
                 native: "猫",
                 base_lang: "en",
                 gloss: "cat",
                 forms: [],
                 status: "active"
               })
    end)
  end
end
