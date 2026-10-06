# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.MigrationBotLanguageTest do
  # Slice 41 section 9: an existing install gains two empty tables and keeps its words.
  use ExUnit.Case, async: false
  import ExUnit.CaptureLog
  alias Kotiko.{Bot.Learner, Bot.Prefs, LegacyDb, Migrations, Profile, Repo, Word}

  @rows """
  INSERT INTO words (id, lang, language, native, romanization, english, english_forms, note, status, source_text, inserted_at, updated_at) VALUES
    (1, 'ru', 'Russian', 'да', 'da', 'yes', 'yes', NULL, 'active', NULL, '2026-09-07T10:00:00', '2026-09-07T10:00:00');
  """

  setup do
    dir = Path.join(System.tmp_dir!(), "kotiko-botlang-#{System.unique_integer([:positive])}")
    on_exit(fn -> File.rm_rf(dir) end)
    %{dir: dir, db: LegacyDb.create!(Path.join(dir, "kotiko.db"), @rows)}
  end

  test "adds an empty profile and telegram_prefs; the words and the bot's old behaviour stay",
       %{dir: dir, db: db} do
    {backup, _log} =
      with_log(fn -> LegacyDb.with_repo(db, fn -> Migrations.upgrade(Repo, dir) end) end)

    assert backup =~ "/backups/kotiko-pre-"

    LegacyDb.with_repo(db, fn ->
      assert [%Word{native: "да", base_lang: "en", gloss: "yes"}] = Repo.all(Word)

      for table <- ["profile", "telegram_prefs"] do
        assert %{rows: [[0]]} = Repo.query!("SELECT count(*) FROM #{table}")
      end

      assert Profile.get() == nil
      assert Prefs.get(4242) == %{locale: nil, noted: %{}}

      # No profile and no app language: the existing words' base, as before.
      assert %{bases: ["en"], bases_source: :words, locale: "en"} = Learner.resolve(4242, nil)
      # An app in Spanish is no longer answered with English meanings.
      assert %{bases: ["es"], bases_source: :telegram} = Learner.resolve(4242, "es-PR")

      # The single-row rule holds.
      assert_raise Exqlite.Error, fn ->
        Repo.query!("INSERT INTO profile (id, base_langs, updated_at) VALUES (2, '[]', 'x')")
      end

      {:ok, _} = Profile.put(%{"base_langs" => ["es"]})
      assert %{bases: ["es"], bases_source: :profile} = Learner.resolve(4242, "en")
    end)

    # A second boot runs nothing.
    {again, _log} =
      with_log(fn -> LegacyDb.with_repo(db, fn -> Migrations.upgrade(Repo, dir) end) end)

    assert again == nil
  end
end
