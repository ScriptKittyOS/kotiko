# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Slovo.Migrations do
  @moduledoc """
  Brings the database up to date before anything else opens it. Runs on a single
  connection, so a fresh data folder doesn't log `database is locked` from pool
  connections racing to set up WAL mode while migrations run.
  """

  @doc "Runs pending migrations and returns the number of active words."
  def run!(repo \\ Slovo.Repo) do
    # Ecto.Migrator.with_repo would do, but it can't swap the pool: tests configure the
    # sandbox, which deadlocks the migrator on one connection.
    case repo.start_link(pool_size: 1, pool: DBConnection.ConnectionPool) do
      {:ok, pid} ->
        try do
          migrate(repo)
        after
          Supervisor.stop(pid)
        end

      {:error, reason} ->
        fail!(repo, inspect(reason))
    end
  end

  defp migrate(repo) do
    Ecto.Migrator.run(repo, :up, all: true)
    Slovo.Words.count_active()
  rescue
    e -> fail!(repo, Exception.message(e))
  catch
    :exit, reason -> fail!(repo, Exception.format_exit(reason))
  end

  # Status 1, not 78: a locked or briefly unavailable file can work on the next try.
  defp fail!(repo, reason) do
    Slovo.Config.halt!(
      "The server can't start: couldn't open the database #{repo.config()[:database]} " <>
        "or bring it up to date.\n\n  #{reason}\n\nCheck that the folder is yours and the " <>
        "disk isn't full, then start the server again.\n",
      1
    )
  end
end
