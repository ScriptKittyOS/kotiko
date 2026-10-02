# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.DataDir do
  @moduledoc """
  Where the words live, and the one-time move from the old name's folder: Kotiko was
  called Slovo, which kept its words in `~/.local/share/slovo/slovo.db`.

  `Kotiko.Config` picks the folder: KOTIKO_DATA_DIR, else the old SLOVO_DATA_DIR (with a
  warning, and without moving a folder someone chose), else `~/.local/share/kotiko`.
  `resolve_and_migrate!/0` runs next at boot, before the Repo or any migration opens the
  database:

    * `<folder>/kotiko.db` exists: use it. If an old `slovo.db` is also there and was never
      copied, say both paths in a warning; copy nothing.
    * no `kotiko.db`, but an old `slovo.db` in the folder itself or, when no folder was
      chosen, in `~/.local/share/slovo`: copy it (below).
    * neither: a fresh install.

  The copy never moves, deletes or writes to the old database. It holds an exclusive lock
  on it for the whole copy (so an old server still running is caught, and can't write
  halfway through), checks it, writes a compacted copy with `VACUUM INTO` (which reads
  writes that are still only in `slovo.db-wal`), checks the copy and its counts, and
  renames it into place. A run that's interrupted leaves at most `kotiko.db.partial`,
  which the next run deletes before starting over. Then `MOVED-TO-KOTIKO.txt` in the old
  folder says where the words went, and the old API token is copied too, so the extension
  stays connected.
  """
  require Logger
  alias Exqlite.Sqlite3
  alias Kotiko.Token

  @database "kotiko.db"
  @legacy_database "slovo.db"
  @note "MOVED-TO-KOTIKO.txt"
  @partial_suffixes [".partial", ".partial-journal", ".partial-wal", ".partial-shm"]

  @type result :: :existing | :fresh | {:migrated, non_neg_integer()}

  @doc "The default data folder, `~/.local/share/kotiko`."
  def default_dir(home \\ System.user_home!()), do: Path.join(home, ".local/share/kotiko")

  @doc "The old name's default data folder, `~/.local/share/slovo`."
  def legacy_default_dir(home \\ System.user_home!()), do: Path.join(home, ".local/share/slovo")

  @doc "The database file in a data folder."
  def database(dir), do: Path.join(dir, @database)

  @doc """
  Makes sure the configured data folder (`:data_dir`, chosen by `Kotiko.Config`) holds
  `kotiko.db` or is ready for a new one, copying the old database once if there is one.
  Stops the server with status 1 and a message when the copy can't be made safely; the
  old file is unchanged then, and starting again retries.
  """
  def resolve_and_migrate! do
    target = Application.fetch_env!(:kotiko, :data_dir)
    source = Application.get_env(:kotiko, :data_dir_source)

    case migrate(target, legacy_dirs(target, source, System.user_home())) do
      {:ok, _result} -> target
      {:error, message} -> Kotiko.Config.halt!(message, 1)
    end
  end

  @doc """
  Folders to look in for an old `slovo.db`, in order: the data folder itself, then the
  old default folder, but only when nobody chose the data folder (`source` `:default`).
  """
  def legacy_dirs(target, :default, home) when is_binary(home),
    do: Enum.uniq([target, legacy_default_dir(home)])

  def legacy_dirs(target, _source, _home), do: [target]

  @doc """
  The decision and the copy, for a data folder `target` and the folders that may hold an
  old database. Returns `{:ok, result}` or `{:error, message}`.
  """
  @spec migrate(Path.t(), [Path.t()]) :: {:ok, result()} | {:error, String.t()}
  def migrate(target, legacy_dirs) do
    database = database(target)

    if File.exists?(database) do
      warn_untouched(database, legacy_dirs)
      {:ok, :existing}
    else
      remove_partial(database)

      case Enum.find(legacy_dirs, &File.regular?(Path.join(&1, @legacy_database))) do
        nil -> fresh(target)
        dir -> copy(Path.join(dir, @legacy_database), target)
      end
    end
  end

  @doc """
  Copies `api-token` from `from_dir` to `to_dir` (mode 0600) when `to_dir` has none, so
  a token the old server made keeps working. Returns `{:ok, copied_from_path}`,
  `{:ok, nil}` when there was nothing to copy, or `{:error, message}`.
  """
  def copy_legacy_token(from_dir, to_dir) do
    from = Token.path(from_dir)
    to = Token.path(to_dir)

    if Path.expand(from) == Path.expand(to) or File.exists?(to) or not File.regular?(from) do
      {:ok, nil}
    else
      with {:ok, contents} <- File.read(from),
           :ok <- File.mkdir_p(to_dir),
           :ok <- Token.save(to, contents) do
        {:ok, from}
      else
        {:error, reason} ->
          {:error, "Couldn't copy the API token from #{from} to #{to}: #{format(reason)}"}
      end
    end
  end

  # ── the decision ────────────────────────────────────────────────────

  defp warn_untouched(database, legacy_dirs) do
    for dir <- legacy_dirs,
        legacy = Path.join(dir, @legacy_database),
        File.regular?(legacy),
        not File.exists?(Path.join(dir, @note)) do
      Logger.warning("Using #{database}; the old #{legacy} was not touched.")
    end
  end

  defp fresh(target) do
    case File.mkdir_p(target) do
      :ok -> {:ok, :fresh}
      {:error, reason} -> {:error, message({:io, "create the data folder", reason}, nil, target)}
    end
  end

  # ── the copy ────────────────────────────────────────────────────────

  defp copy(legacy, target) do
    database = database(target)

    result =
      with :ok <- File.mkdir_p(target) |> io("create the data folder"),
           {:ok, conn} <- Sqlite3.open(legacy, mode: :readwrite) |> io("open the old database") do
        try do
          copy_locked(conn, legacy, target)
        after
          Sqlite3.close(conn)
        end
      end

    case result do
      {:ok, words} ->
        write_note(legacy, database)

        Logger.info(
          "Moved your words from #{legacy} to #{database} (#{plural(words, "word")}). " <>
            "The old file is kept as a backup."
        )

        {:ok, {:migrated, words}}

      {:error, reason} ->
        remove_partial(database)
        {:error, message(reason, legacy, database)}
    end
  end

  # With the old database locked, so nothing can write to it until the copy is in place.
  defp copy_locked(conn, legacy, target) do
    database = database(target)
    partial = database <> ".partial"

    with :ok <- lock(conn),
         :ok <- integrity(conn, :source_corrupt),
         {:ok, counts} <- counts(conn, :source_unreadable),
         :ok <- Sqlite3.execute(conn, "VACUUM INTO " <> sql_string(partial)) |> io("copy it"),
         :ok <- verify(partial, counts),
         :ok <- fsync(partial) |> io("save the copy to disk"),
         :ok <- File.chmod(partial, 0o600) |> io("make the copy private"),
         :ok <- copy_token(Path.dirname(legacy), target),
         :ok <- File.rename(partial, database) |> io("rename the copy to #{database}") do
      private_dir(target)
      {:ok, counts.words}
    end
  end

  # PRAGMA locking_mode = EXCLUSIVE makes BEGIN IMMEDIATE fail while any other connection
  # has the file open, not only while one is writing, and keeps the lock until close.
  defp lock(conn) do
    with :ok <- Sqlite3.set_busy_timeout(conn, 0),
         :ok <- Sqlite3.execute(conn, "PRAGMA locking_mode = EXCLUSIVE"),
         :ok <- Sqlite3.execute(conn, "BEGIN IMMEDIATE") do
      Sqlite3.execute(conn, "ROLLBACK") |> io("read the old database")
    else
      {:error, reason} ->
        if is_binary(reason) and reason =~ "locked",
          do: {:error, :locked},
          else: {:error, {:io, "read the old database", reason}}
    end
  end

  defp integrity(conn, tag) do
    case all(conn, "PRAGMA integrity_check") do
      {:ok, [["ok"]]} -> :ok
      {:ok, rows} -> {:error, {tag, rows |> Enum.take(5) |> Enum.map_join("\n  ", &hd/1)}}
      {:error, reason} -> {:error, {tag, reason}}
    end
  end

  defp counts(conn, tag) do
    with {:ok, [[words]]} <- all(conn, "SELECT count(*) FROM words"),
         {:ok, [[migrations]]} <- all(conn, "SELECT count(*) FROM schema_migrations") do
      {:ok, %{words: words, migrations: migrations}}
    else
      {:error, reason} -> {:error, {tag, reason}}
    end
  end

  defp verify(partial, expected) do
    case Sqlite3.open(partial, mode: :readonly) do
      {:ok, conn} ->
        try do
          with :ok <- integrity(conn, :copy_corrupt),
               {:ok, ^expected} <- counts(conn, :copy_corrupt) do
            :ok
          else
            {:ok, got} -> {:error, {:mismatch, expected, got}}
            error -> error
          end
        after
          Sqlite3.close(conn)
        end

      {:error, reason} ->
        {:error, {:copy_corrupt, reason}}
    end
  end

  defp copy_token(legacy_dir, target) do
    case copy_legacy_token(legacy_dir, target) do
      {:ok, nil} ->
        :ok

      {:ok, from} ->
        Logger.info(
          "Copied your API token from #{from} to #{Token.path(target)}, so the extension " <>
            "stays connected."
        )

      {:error, message} ->
        {:error, {:token, message}}
    end
  end

  defp write_note(legacy, database) do
    dir = Path.dirname(legacy)
    at = DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601()

    after_check =
      if dir == Path.dirname(database) do
        "You can delete #{Path.basename(legacy)} (and #{Path.basename(legacy)}-wal and " <>
          "-shm, if they're there) once you've checked your words in Kotiko. Keep the " <>
          "folder: Kotiko's own database is in it."
      else
        "You can delete this folder once you've checked your words in Kotiko."
      end

    text =
      "Kotiko copied this database (#{Path.basename(legacy)}) to #{database} on #{at}. " <>
        "This copy is no longer used. #{after_check}\n"

    case File.write(Path.join(dir, @note), text) do
      :ok ->
        :ok

      {:error, reason} ->
        Logger.warning("Couldn't write #{Path.join(dir, @note)}: #{format(reason)}")
    end
  end

  # Best effort: the database is already private, and a shared folder someone chose may
  # not be theirs to change.
  defp private_dir(dir) do
    case File.chmod(dir, 0o700) do
      :ok -> :ok
      {:error, reason} -> Logger.warning("Couldn't make #{dir} private: #{format(reason)}")
    end
  end

  defp remove_partial(database) do
    Enum.each(@partial_suffixes, &File.rm(database <> &1))
  end

  # ── helpers ─────────────────────────────────────────────────────────

  defp all(conn, sql) do
    with {:ok, statement} <- Sqlite3.prepare(conn, sql) do
      try do
        Sqlite3.fetch_all(conn, statement)
      after
        Sqlite3.release(conn, statement)
      end
    end
  end

  defp fsync(path) do
    with {:ok, fd} <- :file.open(path, [:read, :write, :raw, :binary]) do
      result = :file.sync(fd)
      _ = :file.close(fd)
      result
    end
  end

  defp sql_string(text), do: "'" <> String.replace(text, "'", "''") <> "'"

  defp io(:ok, _what), do: :ok
  defp io({:ok, _} = ok, _what), do: ok
  defp io({:error, reason}, what), do: {:error, {:io, what, reason}}

  defp format(reason) when is_atom(reason), do: reason |> :file.format_error() |> to_string()
  defp format(reason) when is_binary(reason), do: reason
  defp format(reason), do: inspect(reason)

  defp plural(1, noun), do: "1 #{noun}"
  defp plural(n, noun), do: "#{n} #{noun}s"

  # ── messages (stderr, then the server stops) ───────────────────────

  defp message(:locked, legacy, _database) do
    "Your old Slovo server is still running and using #{legacy}. Stop it first: " <>
      "systemctl --user stop slovo (or close the terminal running run.sh), then start " <>
      "Kotiko again.\n"
  end

  defp message({:source_corrupt, detail}, legacy, _database) do
    cant_start(
      "the old database #{legacy} failed its integrity check, so it wasn't copied",
      detail,
      "The file was not changed. Restore it from a backup, or move it out of the folder " <>
        "to start with no words, then start the server again."
    )
  end

  defp message({:source_unreadable, detail}, legacy, _database) do
    cant_start(
      "couldn't read the words in the old database #{legacy}",
      detail,
      "The file was not changed. Restore it from a backup, or move it out of the folder " <>
        "to start with no words, then start the server again."
    )
  end

  defp message({:copy_corrupt, detail}, legacy, database) do
    cant_start(
      "the copy of #{legacy} at #{database} didn't pass its check, so it was deleted",
      detail,
      "The old file was not changed. Check that the disk isn't full or failing, then " <>
        "start the server again to retry."
    )
  end

  defp message({:mismatch, expected, got}, legacy, database) do
    cant_start(
      "the copy of #{legacy} at #{database} doesn't match it, so it was deleted",
      "words: #{expected.words} in the old file, #{got.words} in the copy; " <>
        "schema_migrations: #{expected.migrations} in the old file, #{got.migrations} " <>
        "in the copy",
      "The old file was not changed. Something may have written to it during the copy: " <>
        "make sure no old server is running, then start the server again to retry."
    )
  end

  defp message({:token, detail}, legacy, database) do
    cant_start(
      "couldn't move your words from #{legacy} to #{database}",
      detail,
      "The old files were not changed. Fix the problem above and start the server again."
    )
  end

  defp message({:io, what, reason}, nil, target) do
    cant_start(
      "couldn't #{what} #{target}",
      format(reason),
      "Check that the folder is yours and the disk isn't full, then start the server again."
    )
  end

  defp message({:io, what, reason}, legacy, database) do
    cant_start(
      "couldn't move your words from #{legacy} to #{database} (while trying to #{what})",
      format(reason),
      "The old file was not changed. Check that the folders are yours and the disk isn't " <>
        "full, then start the server again to retry."
    )
  end

  defp cant_start(what, detail, advice),
    do: "The server can't start: #{what}.\n\n  #{detail}\n\n#{advice}\n"
end
