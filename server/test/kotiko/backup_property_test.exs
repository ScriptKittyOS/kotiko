# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.BackupPropertyTest do
  # Dynamic analysis (OpenSSF dynamic_analysis): restoring generated backup files. A
  # backup is a file the learner picks, so it can hold anything: the import counts every
  # word it was given as created, updated, unchanged or rejected, and never crashes.
  use Kotiko.DataCase, async: false
  use ExUnitProperties
  import ExUnit.CaptureLog
  alias Kotiko.{Backup, Gen}

  property "any backup document is imported word by word or refused as a whole" do
    check all(
            doc <-
              one_of([
                fixed_map(%{
                  "schemaVersion" => one_of([integer(0..3), Gen.scalar()]),
                  "words" => list_of(frequency([{4, Gen.word()}, {1, Gen.json()}]), max_length: 5)
                }),
                Gen.json()
              ]),
            max_runs: 60
          ) do
      {result, _log} = with_log(fn -> Backup.import(doc) end)

      case result do
        {:ok, counts} ->
          live = Enum.reject(doc["words"], &(is_map(&1) and &1["deleted_at"] not in [nil, ""]))

          assert counts.created + counts.updated + counts.unchanged + counts.rejected ==
                   length(live)

        {:error, reason} ->
          assert reason == :not_backup or match?({:backup_newer, _}, reason)
      end
    end
  end

  property "an exported backup imports back with every word unchanged" do
    check all(words <- list_of(Gen.word(), max_length: 4), max_runs: 30) do
      {:ok, _} = Backup.import(%{"schemaVersion" => Backup.schema_version(), "words" => words})
      before = Repo.aggregate(Word, :count)

      doc = Jason.decode!(Backup.export_binary())
      assert {:ok, counts} = Backup.import(doc)
      assert counts.created == 0 and counts.rejected == 0
      assert Repo.aggregate(Word, :count) == before
    end
  end
end
