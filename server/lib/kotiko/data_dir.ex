# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.DataDir do
  @moduledoc """
  Where the words live, and the one-time move from the old name's folder: Kotiko was
  called Slovo, which kept its words in `~/.local/share/slovo/slovo.db`.

  `Kotiko.Config` picks the folder: KOTIKO_DATA_DIR, else the old SLOVO_DATA_DIR (with a
  warning, and without moving a folder someone chose), else `default_dir/0`
  (`$XDG_DATA_HOME/kotiko` or `~/.local/share/kotiko`).
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

  Then, at every start, `make_private/1` keeps other users of the computer out: a folder
  it creates is 0700, and every file Kotiko keeps in it 0600 (an old `slovo.db` in the
  data folder too: its permissions, never its contents).
  """
  require Logger
  alias Exqlite.Sqlite3
  alias Kotiko.{Private, Token}

  @database "kotiko.db"
  @legacy_database "slovo.db"
  @note "MOVED-TO-KOTIKO.txt"
  @partial_suffixes [".partial", ".partial-journal", ".partial-wal", ".partial-shm"]
  @backups "backups"

  # Every file Kotiko keeps in the data folder (install-service.sh --delete-data deletes
  # the same list), made 0600 at each start.
  @private_files ~w(kotiko.db kotiko.db-wal kotiko.db-shm kotiko.db-journal api-token
                    api-token.new models-cache.json models-cache.json.tmp) ++
                   Enum.map(@partial_suffixes, &(@database <> &1))

  # The old name's database, still there in a folder that was moved in place.
  @legacy_files Enum.map(["", "-wal", "-shm", "-journal"], &(@legacy_database <> &1))

  # A data folder holding only these is Kotiko's, so make_private/1 makes it 0700.
  @own_names @private_files ++ @legacy_files ++ [@backups, @note]

  @type result :: :existing | :fresh | {:migrated, non_neg_integer()}

  @doc """
  The default data folder: `$XDG_DATA_HOME/kotiko`, or `~/.local/share/kotiko` when
  XDG_DATA_HOME is unset, empty or not an absolute path (the XDG Base Directory rules).

  An install from before Kotiko read XDG_DATA_HOME keeps its words in
  `~/.local/share/kotiko`. While `$XDG_DATA_HOME/kotiko` has no database and that folder
  has one, that folder stays the default, so setting XDG_DATA_HOME never hides your words.
  """
  def default_dir(home \\ System.user_home!(), xdg_data_home \\ System.get_env("XDG_DATA_HOME")) do
    old = Path.join(home, ".local/share/kotiko")

    case xdg_data_home do
      "/" <> _ ->
        new = Path.join(xdg_data_home, "kotiko")

        if File.exists?(database(new)) or not File.exists?(database(old)),
          do: new,
          else: old

      _ ->
        old
    end
  end

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

    # Before anything in the folder is read or written (slice 54, B-02). Status 78: like a
    # settings mistake, starting again won't help until someone looks.
    with {:error, message} <- check_safe(target, Private.uid()),
         do: Kotiko.Config.halt!(message, 78)

    case migrate(target, legacy_dirs(target, source, System.user_home())) do
      {:ok, _result} ->
        make_private(target)
        target

      {:error, message} ->
        Kotiko.Config.halt!(message, 1)
    end
  end

  @doc """
  Checks that nobody else could have put files in the data folder `dir` that Kotiko would
  trust, before any of them is used: the API token found there opens the server, and the
  words are written to `kotiko.db` (slice 54, B-02). `uid` is the account the server runs
  as (nil: unknown, so owners aren't compared). Returns `:ok` or `{:error, message}`.

  A problem, each named in the message:

    * the folder, or any of Kotiko's files in it, belongs to another account;
    * one of Kotiko's files (`kotiko.db` and the files SQLite keeps next to it,
      `api-token`, the model list cache, an old `slovo.db`, `backups` and the backups in
      it) is a symbolic link. Kotiko never makes links, and following one would read a
      token or write the words wherever it points; telling a harmless link from a
      planted one would mean trusting where it points, so none is accepted. To keep the
      words on another disk, point KOTIKO_DATA_DIR there (the folder itself may be a link);
    * other users can write in the folder, and it holds files that aren't Kotiko's (then it
      is shared on purpose, and Kotiko won't change its permissions).

  A folder others can write in that holds only Kotiko's files, and is this account's, is
  made 0700 first, with a warning, before its files are checked: then nobody else can add
  or swap a file while the server runs.
  """
  # Sobelow: the data folder comes from the server's settings, never from a request.
  # sobelow_skip ["Traversal.FileModule"]
  def check_safe(dir, uid) do
    case File.stat(dir) do
      {:ok, %File.Stat{type: :directory} = stat} ->
        problems = folder_problems(dir, stat, uid) ++ file_problems(dir, uid)
        if problems == [], do: :ok, else: {:error, unsafe_message(dir, problems)}

      _ ->
        :ok
    end
  end

  defp folder_problems(dir, %File.Stat{uid: owner, mode: mode}, uid) do
    cond do
      is_integer(uid) and owner != uid ->
        ["the folder #{dir} belongs to another account (uid #{owner})"]

      Bitwise.band(mode, 0o022) == 0 ->
        []

      own_folder?(dir) ->
        case Private.restrict(dir) do
          :changed ->
            Logger.warning(
              "Other users of this computer could write in the data folder #{dir}. Made " <>
                "it private: only your account can open it now."
            )

            []

          {:error, :ignored} ->
            [
              "other users of this computer can write in the folder #{dir}, and its disk " <>
                "doesn't keep permissions (a Windows drive in WSL, say), so Kotiko can't " <>
                "change that: keep the data folder on a disk that does"
            ]

          _ ->
            ["other users of this computer can write in the folder #{dir}"]
        end

      true ->
        ["other users of this computer can write in the folder #{dir}"]
    end
  end

  defp file_problems(dir, uid) do
    backups = Path.join(dir, @backups)

    backup_files =
      case File.lstat(backups) do
        {:ok, %File.Stat{type: :directory}} -> Enum.map(ls(backups), &Path.join(backups, &1))
        _ -> []
      end

    for path <-
          Enum.map(@private_files ++ @legacy_files ++ [@backups], &Path.join(dir, &1)) ++
            backup_files,
        problem = file_problem(path, uid),
        do: problem
  end

  # Sobelow: as check_safe/2.
  # sobelow_skip ["Traversal.FileModule"]
  defp file_problem(path, uid) do
    case File.lstat(path) do
      {:ok, %File.Stat{type: :symlink}} ->
        "#{path} is a link (to #{link_target(path)})"

      {:ok, %File.Stat{uid: owner}} when is_integer(uid) and owner != uid ->
        "#{path} belongs to another account (uid #{owner})"

      _ ->
        nil
    end
  end

  # Sobelow: as check_safe/2.
  # sobelow_skip ["Traversal.FileModule"]
  defp link_target(path) do
    case File.read_link(path) do
      {:ok, target} -> target
      {:error, _} -> "somewhere"
    end
  end

  # Sobelow: as check_safe/2.
  # sobelow_skip ["Traversal.FileModule"]
  defp own_folder?(dir) do
    match?({:ok, %File.Stat{type: :directory}}, File.lstat(dir)) and
      Enum.all?(ls(dir), &(&1 in @own_names))
  end

  defp unsafe_message(dir, problems) do
    "The server can't start: someone else may have put files in #{dir}, the data " <>
      "folder.\n\n" <>
      Enum.map_join(problems, "", &"  - #{&1}\n") <>
      "\nKotiko trusts the files in its data folder: the API token there opens the server, " <>
      "and your words are written to kotiko.db. Kotiko never makes links, and its files " <>
      "are always your account's. Check each file above: if it's yours, put the real file " <>
      "in the folder in place of the link and make it yours (chown, chmod 600); if not, " <>
      "delete it. Make the folder writable only by you (chmod 700 #{dir}), or give Kotiko " <>
      "a folder of its own with KOTIKO_DATA_DIR. Then start the server again.\n"
  end

  @doc """
  Makes sure other users of the computer can't read the words, at every start, before
  the database opens:

    * `kotiko.db` is created empty and 0600 if it isn't there yet, so the `-wal` and
      `-shm` files SQLite makes next to it are 0600 too.
    * Kotiko's own files that others can open (an install from before this check, or a
      file copied in) are made 0600, and the `backups` folder and its copies 0700 and
      0600.
    * The folder is made 0700 when it holds nothing but Kotiko's files: then it is
      Kotiko's folder, whoever chose it. A folder with anything else in it may be shared
      on purpose (`KOTIKO_DATA_DIR=~`, say), so it is left as it is, with a warning that
      says how to make it private.

  What was changed is logged as one warning (others could read it until now), and
  anything that couldn't be changed as a warning with the command that fixes it. Never
  stops the start. Returns `:ok`.
  """
  def make_private(dir) do
    database = database(dir)
    # If it can't be made, opening the database fails next, with its own message.
    _ = Private.create(database)
    backups = Path.join(dir, @backups)

    files =
      Enum.map(@private_files ++ @legacy_files, &Path.join(dir, &1)) ++
        for name <- ls(backups),
            String.starts_with?(name, "kotiko-"),
            do: Path.join(backups, name)

    results = Enum.map(files ++ [backups], &{&1, Private.restrict(&1)}) ++ folder(dir)

    case for({path, :changed} <- results, do: path) do
      [] ->
        :ok

      changed ->
        Logger.warning(
          "Other users of this computer could open Kotiko's files in #{dir} " <>
            "(#{Enum.map_join(changed, ", ", &relative(&1, dir))}). Made them private: " <>
            "only your account can open them now."
        )
    end

    {ignored, failed} =
      results
      |> Enum.filter(&match?({_path, {:error, _why}}, &1))
      |> Enum.split_with(&match?({_path, {:error, :ignored}}, &1))

    # A disk that keeps no permissions ignores them for every file: say so once.
    if ignored != [], do: Logger.warning(not_private(dir, :ignored))
    Enum.each(failed, fn {path, {:error, why}} -> Logger.warning(not_private(path, why)) end)
  end

  # The folder itself: made private when it holds nothing but Kotiko's files.
  # Sobelow: the data folder comes from the server's settings, never from a request.
  # sobelow_skip ["Traversal.FileModule"]
  defp folder(dir) do
    own? =
      match?({:ok, %File.Stat{type: :directory}}, File.lstat(dir)) and
        Enum.all?(ls(dir), &(&1 in @own_names))

    case File.stat(dir) do
      {:ok, %File.Stat{mode: mode}} ->
        cond do
          not Private.shared?(mode) -> []
          own? -> [{dir, Private.restrict(dir)}]
          true -> [{dir, {:error, :not_only_kotiko}}]
        end

      {:error, _} ->
        []
    end
  end

  defp not_private(dir, :not_only_kotiko) do
    "Other users of this computer can open the data folder #{dir}. Kotiko's own files in " <>
      "it are private, but the folder holds other files too (or is a link), so Kotiko " <>
      "leaves it as it is. To make it private: chmod 700 #{dir}, or give Kotiko a folder " <>
      "of its own with KOTIKO_DATA_DIR."
  end

  defp not_private(dir, :ignored) do
    "Couldn't make Kotiko's files in #{dir} private: this disk doesn't keep file " <>
      "permissions (a Windows drive in WSL, say), so other users of this computer may be " <>
      "able to read your words. Keep the data folder on a disk that does (set " <>
      "KOTIKO_DATA_DIR)."
  end

  # Sobelow: as make_private/1.
  # sobelow_skip ["Traversal.FileModule"]
  defp not_private(path, reason) do
    mode = if File.dir?(path), do: "700", else: "600"

    "Couldn't make #{path} private (#{format(reason)}), so other users of this computer " <>
      "may be able to read it. To fix it: chmod #{mode} #{path}"
  end

  defp relative(dir, dir), do: "the folder itself"
  defp relative(path, dir), do: Path.relative_to(path, dir)

  # Sobelow: folders under the configured data folder, never from a request.
  # sobelow_skip ["Traversal.FileModule"]
  defp ls(dir) do
    case File.ls(dir) do
      {:ok, names} -> names
      {:error, _} -> []
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
  # Sobelow: both folders come from the server's own settings at startup, never a request.
  # sobelow_skip ["Traversal.FileModule"]
  def copy_legacy_token(from_dir, to_dir) do
    from = Token.path(from_dir)
    to = Token.path(to_dir)

    if Path.expand(from) == Path.expand(to) or File.exists?(to) or not File.regular?(from) do
      {:ok, nil}
    else
      with {:ok, contents} <- File.read(from),
           :ok <- Private.mkdir_p(to_dir),
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

  # Sobelow: the data folder comes from the server's settings, never from a request.
  # sobelow_skip ["Traversal.FileModule"]
  defp fresh(target) do
    case Private.mkdir_p(target) do
      :ok -> {:ok, :fresh}
      {:error, reason} -> {:error, message({:io, "create the data folder", reason}, nil, target)}
    end
  end

  # ── the copy ────────────────────────────────────────────────────────

  # Sobelow: the data folder comes from the server's settings, never from a request.
  # sobelow_skip ["Traversal.FileModule"]
  defp copy(legacy, target) do
    database = database(target)

    result =
      with :ok <- Private.mkdir_p(target) |> io("create the data folder"),
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
  # Sobelow: the data folder comes from the server's settings, never from a request.
  # sobelow_skip ["Traversal.FileModule"]
  defp copy_locked(conn, legacy, target) do
    database = database(target)
    partial = database <> ".partial"

    with :ok <- lock(conn),
         :ok <- integrity(conn, :source_corrupt),
         {:ok, counts} <- counts(conn, :source_unreadable),
         # Empty and 0600 before the words go in: VACUUM INTO keeps an empty file's mode.
         :ok <- Private.create(partial) |> io("create the copy"),
         :ok <- Sqlite3.execute(conn, "VACUUM INTO " <> sql_string(partial)) |> io("copy it"),
         :ok <- verify(partial, counts),
         :ok <- fsync(partial) |> io("save the copy to disk"),
         :ok <- File.chmod(partial, 0o600) |> io("make the copy private"),
         :ok <- copy_token(Path.dirname(legacy), target),
         :ok <- File.rename(partial, database) |> io("rename the copy to #{database}") do
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

  # Sobelow: the old database's folder comes from the server's settings, not a request.
  # sobelow_skip ["Traversal.FileModule"]
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

  # Sobelow: the database path comes from the server's settings, never from a request.
  # sobelow_skip ["Traversal.FileModule"]
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
