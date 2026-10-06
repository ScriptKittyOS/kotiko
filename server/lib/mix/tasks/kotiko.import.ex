# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Mix.Tasks.Kotiko.Import do
  @shortdoc "Restores the words of a Kotiko JSON backup"
  @moduledoc """
  Restores a Kotiko JSON backup into this server (slice 12), with the checks and the merge
  of the batch route: words new here keep their ids, a word already here gains what it
  lacks (slice 07) and keeps everything you wrote. Nothing is deleted.

      mix kotiko.import kotiko-backup-2026-10-01.json

  Reads the data folder like `run.sh` (`--env-file PATH`, or `--data-dir DIR`).
  """
  use Mix.Task
  alias Kotiko.{Backup, TaskEnv}

  @switches [env_file: :string, data_dir: :string]

  @impl true
  # Sobelow: the operator names the backup file on the command line; there's no request.
  # sobelow_skip ["Traversal.FileModule"]
  def run(args) do
    {opts, files} = OptionParser.parse!(args, strict: @switches)
    file = List.first(files) || Mix.raise("Name the backup file: mix kotiko.import FILE")

    doc =
      case File.read(file) do
        {:ok, text} -> Jason.decode(String.replace_prefix(text, <<0xEF, 0xBB, 0xBF>>, ""))
        {:error, reason} -> Mix.raise("Couldn't read #{file}: #{:file.format_error(reason)}")
      end

    TaskEnv.with_repo(opts, fn _dir ->
      case doc && elem(doc, 0) == :ok && Backup.import(elem(doc, 1)) do
        {:ok, c} ->
          Mix.shell().info(
            "Restored #{file}: #{c.created} new, #{c.updated} merged, #{c.unchanged} already " <>
              "here, #{c.rejected} couldn't be used."
          )

        {:error, {:backup_newer, v}} ->
          Mix.raise(
            "#{file} was made by a newer Kotiko (backup version #{v}). Update Kotiko, then try again."
          )

        _ ->
          Mix.raise("#{file} isn't a Kotiko backup.")
      end
    end)
  end
end
