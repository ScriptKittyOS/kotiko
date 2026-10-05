# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Mix.Tasks.Kotiko.Reset do
  @shortdoc "Deletes every word on this server, after a backup copy of the database"
  @moduledoc """
  Deletes every word, pending Telegram lookup and deleted word on this server, the same
  as the extension's "Delete everything" with "Also delete all words on my Kotiko server"
  ticked (slice 12). Settings, the API token and the Telegram pairing stay.

      mix kotiko.reset               ask first, copy the database to backups/, then delete
      mix kotiko.reset --yes         don't ask
      mix kotiko.reset --no-backup   don't copy the database first

  Reads the data folder like `run.sh` (`--env-file PATH`, or `--data-dir DIR`). It can
  run while the server runs; SQLite lets one of them write at a time.
  """
  use Mix.Task
  import Ecto.Query
  alias Kotiko.{Backup, Repo, TaskEnv, Word}

  @switches [yes: :boolean, backup: :boolean, env_file: :string, data_dir: :string]

  @impl true
  def run(args) do
    {opts, _} = OptionParser.parse!(args, strict: @switches)

    TaskEnv.with_repo(opts, fn dir ->
      n =
        Repo.aggregate(
          from(w in Word, where: is_nil(w.deleted_at) and w.status != "pending"),
          :count
        )

      Mix.shell().info("This server has #{n} #{if n == 1, do: "word", else: "words"}.")

      if opts[:yes] || Mix.shell().yes?("Delete all #{n} words?", default: :no) do
        if Keyword.get(opts, :backup, true) do
          path = Kotiko.Migrations.backup!(Repo, dir)
          Mix.shell().info("Copied the database to #{path} first.")
        end

        {:ok, %{deleted: deleted, reset_epoch: epoch}} = Backup.delete_all()

        Mix.shell().info(
          "Deleted #{deleted} #{if deleted == 1, do: "word", else: "words"} (reset #{epoch})."
        )
      else
        Mix.shell().info("Nothing was deleted.")
      end
    end)
  end
end
