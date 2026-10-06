# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Migrations do
  @moduledoc """
  Brings the database up to date before anything else opens it. Runs on a single
  connection, so a fresh data folder doesn't log `database is locked` from pool
  connections racing to set up WAL mode while migrations run.

  Before any migration runs on a database that already has words, the database is copied
  with `VACUUM INTO` to `<data folder>/backups/kotiko-pre-<version>-<UTC time>.db`; the
  newest five backups are kept. If the copy fails, nothing is migrated.
  """
  require Logger

  @keep_backups 5

  @doc "Runs pending migrations and returns the number of active words."
  def run!(repo \\ Kotiko.Repo) do
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
    upgrade(repo, Application.fetch_env!(:kotiko, :data_dir))
    Kotiko.Words.count_active()
  rescue
    e -> fail!(repo, Exception.message(e))
  catch
    :exit, reason -> fail!(repo, Exception.format_exit(reason))
  end

  @doc """
  Backs up the database if a migration is pending and it has words, then migrates.
  `repo` must be started (or set as the dynamic repo). Returns the backup's path or nil.
  """
  def upgrade(repo, data_dir) do
    pending = for {:down, version, _name} <- Ecto.Migrator.migrations(repo), do: version
    backup = if pending != [] and has_words?(repo), do: backup!(repo, data_dir)
    Ecto.Migrator.run(repo, :up, all: true)
    backup
  end

  defp has_words?(repo) do
    %{rows: [[n]]} =
      repo.query!("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'words'")

    n == 1
  end

  @doc "Copies the database into `<data_dir>/backups` and prunes old copies. Returns the path."
  # Sobelow: backups go under the configured data folder, never a path from a request.
  # sobelow_skip ["Traversal.FileModule"]
  def backup!(repo, data_dir) do
    dir = Path.join(data_dir, "backups")
    File.mkdir_p!(dir)
    _ = File.chmod(dir, 0o700)
    stamp = Calendar.strftime(DateTime.utc_now(), "%Y%m%dT%H%M%SZ")
    path = Path.join(dir, "kotiko-pre-#{Kotiko.Health.version()}-#{stamp}.db")
    path = if File.exists?(path), do: String.replace_suffix(path, ".db", "-2.db"), else: path

    repo.query!("VACUUM INTO " <> sql_string(path))
    File.chmod!(path, 0o600)

    Logger.info(
      "Backed up the database to #{path} before upgrading it. To go back, stop the " <>
        "server, delete #{Path.basename(repo.config()[:database])}-wal and -shm if they're " <>
        "there, and copy that file over #{repo.config()[:database]}."
    )

    prune(dir)
    path
  end

  # Newest first by the UTC time in the name; keeps @keep_backups.
  # Sobelow: only names matching the backup pattern, inside the configured backups folder.
  # sobelow_skip ["Traversal.FileModule"]
  defp prune(dir) do
    dir
    |> File.ls!()
    |> Enum.flat_map(fn name ->
      case Regex.run(~r/\Akotiko-pre-.+-(\d{8}T\d{6}Z(?:-2)?)\.db\z/, name,
             capture: :all_but_first
           ) do
        [stamp] -> [{stamp, name}]
        nil -> []
      end
    end)
    |> Enum.sort(:desc)
    |> Enum.map(&elem(&1, 1))
    |> Enum.drop(@keep_backups)
    |> Enum.each(fn name ->
      File.rm(Path.join(dir, name))
      Logger.info("Removed the old backup #{Path.join(dir, name)} (keeping the newest five).")
    end)
  end

  defp sql_string(text), do: "'" <> String.replace(text, "'", "''") <> "'"

  # Status 1, not 78: a locked or briefly unavailable file can work on the next try.
  defp fail!(repo, reason) do
    Kotiko.Config.halt!(
      "The server can't start: couldn't open the database #{repo.config()[:database]} " <>
        "or bring it up to date.\n\n  #{reason}\n\nCheck that the folder is yours and the " <>
        "disk isn't full, then start the server again. Your words are unchanged: the " <>
        "upgrade only keeps its changes when it finishes.\n",
      1
    )
  end
end
