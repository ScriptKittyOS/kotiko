# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Mix.Tasks.Kotiko.BackupTasksTest do
  # Slice 12's commands: mix kotiko.reset, kotiko.export and kotiko.import.
  use Kotiko.DataCase, async: false
  alias Kotiko.{LegacyDb, Migrations}
  alias Mix.Tasks.Kotiko.{Export, Import, Reset}

  setup do
    Mix.shell(Mix.Shell.Process)
    on_exit(fn -> Mix.shell(Mix.Shell.IO) end)

    dir =
      Path.join(
        System.tmp_dir!(),
        "kotiko-backup-task-#{System.pid()}-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf!(dir) end)
    %{dir: dir}
  end

  defp output do
    receive do
      {:mix_shell, :info, [msg]} -> msg <> "\n" <> output()
    after
      0 -> ""
    end
  end

  defp count, do: Repo.aggregate(Word, :count)

  test "reset asks first; no keeps every word" do
    word_fixture()
    send(self(), {:mix_shell_input, :yes?, false})
    Reset.run(["--no-backup"])
    assert_received {:mix_shell, :yes?, ["Delete all 1 words?" <> _]}
    assert output() =~ "Nothing was deleted."
    assert count() == 1
  end

  test "reset --yes --no-backup deletes every word and bumps reset_epoch" do
    word_fixture(%{native: "да"})
    word_fixture(%{native: "нет", gloss: "no"})
    before = Words.sync_state().reset_epoch
    Reset.run(["--yes", "--no-backup"])
    assert output() =~ "Deleted 2 words (reset #{before + 1})."
    assert count() == 0
  end

  test "reset copies the database to backups/ first, in a data folder of its own", %{dir: dir} do
    path = Path.join(dir, "kotiko.db")

    LegacyDb.with_repo(path, fn ->
      Migrations.upgrade(Repo, dir)
      {:ok, _} = Words.add(valid_attrs(%{native: "кот", gloss: "cat", forms: ["cat"]}))
      Reset.run(["--yes", "--data-dir", dir])
      assert Repo.aggregate(Word, :count) == 0
    end)

    assert [backup] = Path.wildcard(Path.join(dir, "backups/kotiko-pre-*.db"))
    assert output() =~ "Copied the database to #{backup} first."

    LegacyDb.with_repo(backup, fn ->
      assert [%{native: "кот"}] = Repo.all(Word)
    end)
  end

  test "export --output writes the backup; import brings it back with its ids", %{dir: dir} do
    a = word_fixture(%{native: "да"})
    b = word_fixture(%{native: "нет", gloss: "no", forms: ["no"]})
    file = Path.join(dir, "backup.json")
    Export.run(["--output", file])
    assert output() =~ "Wrote 2 words to #{file}."
    doc = file |> File.read!() |> Jason.decode!()
    assert Enum.map(doc["words"], & &1["id"]) == [a.uuid, b.uuid]

    {:ok, _} = Kotiko.Backup.delete_all()
    Import.run([file])
    assert output() =~ "2 new, 0 merged, 0 already here, 0 couldn't be used."
    assert Repo.all(Word) |> Enum.map(& &1.uuid) |> Enum.sort() == Enum.sort([a.uuid, b.uuid])
  end

  test "import refuses a file that isn't a backup, or one from a newer Kotiko", %{dir: dir} do
    file = Path.join(dir, "x.json")
    File.write!(file, ~s({"format": "kotiko.words", "schemaVersion": 3, "words": []}))
    assert_raise Mix.Error, ~r/newer Kotiko/, fn -> Import.run([file]) end
    File.write!(file, "[1, 2]")
    assert_raise Mix.Error, ~r/isn't a Kotiko backup/, fn -> Import.run([file]) end
  end
end
