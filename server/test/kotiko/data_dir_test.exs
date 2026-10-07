# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.DataDirTest do
  # The move from the old name's folder (~/.local/share/slovo/slovo.db). Every test has
  # its own temporary home, passed in as an argument, so the real home is never read.
  use ExUnit.Case, async: true
  import ExUnit.CaptureLog
  alias Exqlite.Sqlite3
  alias Kotiko.DataDir

  setup do
    root = Path.join(System.tmp_dir!(), "kotiko-datadir-#{System.unique_integer([:positive])}")
    home = Path.join(root, "home")
    File.mkdir_p!(home)
    on_exit(fn -> File.rm_rf(root) end)

    Logger.put_module_level(DataDir, :info)
    on_exit(fn -> Logger.delete_module_level(DataDir) end)

    %{
      root: root,
      home: home,
      target: DataDir.default_dir(home, nil),
      legacy_dir: DataDir.legacy_default_dir(home)
    }
  end

  # ── helpers ─────────────────────────────────────────────────────────

  defp sql!(conn, sql), do: :ok = Sqlite3.execute(conn, sql)

  defp rows(path, sql) do
    {:ok, conn} = Sqlite3.open(path, mode: :readonly)

    try do
      {:ok, statement} = Sqlite3.prepare(conn, sql)
      {:ok, rows} = Sqlite3.fetch_all(conn, statement)
      :ok = Sqlite3.release(conn, statement)
      rows
    after
      Sqlite3.close(conn)
    end
  end

  defp count(path), do: path |> rows("SELECT count(*) FROM words") |> hd() |> hd()

  defp dump(path) do
    {rows(path, "SELECT * FROM words ORDER BY id"),
     rows(path, "SELECT * FROM schema_migrations ORDER BY version")}
  end

  # An old database like the 0.2 server's: WAL mode, a migrations table and some words.
  defp create_tables(conn) do
    sql!(conn, "PRAGMA journal_mode = WAL")
    sql!(conn, "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, inserted_at TEXT)")
    sql!(conn, "INSERT INTO schema_migrations VALUES (20261001000000, '2026-10-01T00:00:00')")

    sql!(conn, """
    CREATE TABLE words (id INTEGER PRIMARY KEY, lang TEXT, native TEXT NOT NULL,
      english TEXT, status TEXT DEFAULT 'active')
    """)

    sql!(conn, "CREATE INDEX words_native ON words (native)")
  end

  defp insert(conn, from, to) do
    for i <- from..to do
      sql!(
        conn,
        "INSERT INTO words (lang, native, english) VALUES ('ru', 'слово#{i}', 'word#{i}')"
      )
    end
  end

  defp legacy_db(dir, words) do
    File.mkdir_p!(dir)
    path = Path.join(dir, "slovo.db")
    {:ok, conn} = Sqlite3.open(path)
    create_tables(conn)
    insert(conn, 1, words)
    :ok = Sqlite3.close(conn)
    path
  end

  defp mode(path), do: File.stat!(path).mode |> Bitwise.band(0o777)

  defp partials(dir) do
    dir |> File.ls!() |> Enum.filter(&String.contains?(&1, ".partial"))
  end

  defp migrate(ctx, source \\ :default),
    do: DataDir.migrate(ctx.target, DataDir.legacy_dirs(ctx.target, source, ctx.home))

  # ── tests ───────────────────────────────────────────────────────────

  test "defaults live in the home folder", %{home: home} do
    assert DataDir.default_dir(home, nil) == Path.join(home, ".local/share/kotiko")
    assert DataDir.database(DataDir.default_dir(home, nil)) =~ ~r"/kotiko/kotiko\.db$"
  end

  describe "XDG_DATA_HOME" do
    test "an absolute path moves the default folder", %{root: root, home: home} do
      xdg = Path.join(root, "xdg-data")
      assert DataDir.default_dir(home, xdg) == Path.join(xdg, "kotiko")
    end

    test "empty or relative is ignored, as the XDG spec says", %{home: home} do
      for value <- ["", "relative/data", "~/data"] do
        assert DataDir.default_dir(home, value) == Path.join(home, ".local/share/kotiko")
      end
    end

    test "words already in ~/.local/share/kotiko stay there", %{root: root, home: home} do
      xdg = Path.join(root, "xdg-data")
      old = Path.join(home, ".local/share/kotiko")
      File.mkdir_p!(old)
      File.write!(DataDir.database(old), "")

      assert DataDir.default_dir(home, xdg) == old

      # Once the new folder has a database of its own, it wins.
      File.mkdir_p!(Path.join(xdg, "kotiko"))
      File.write!(DataDir.database(Path.join(xdg, "kotiko")), "")
      assert DataDir.default_dir(home, xdg) == Path.join(xdg, "kotiko")
    end

    test "XDG_DATA_HOME set to the usual place is the same folder", %{home: home} do
      usual = Path.join(home, ".local/share/")
      assert DataDir.default_dir(home, usual) == Path.join(home, ".local/share/kotiko")
    end
  end

  test "fresh install: creates the folder and nothing else", ctx do
    log = capture_log(fn -> assert {:ok, :fresh} = migrate(ctx) end)

    assert File.dir?(ctx.target)
    assert File.ls!(ctx.target) == []
    assert mode(ctx.target) == 0o700
    refute File.exists?(ctx.legacy_dir)
    assert log == ""
  end

  test "copies the old database once, keeping the old one as it was", ctx do
    legacy = legacy_db(ctx.legacy_dir, 412)
    File.write!(Path.join(ctx.legacy_dir, "api-token"), "old-generated-token-0123456789\n")
    before = dump(legacy)

    log = capture_log(fn -> assert {:ok, {:migrated, 412}} = migrate(ctx) end)

    database = Path.join(ctx.target, "kotiko.db")
    assert dump(database) == before
    assert dump(legacy) == before
    assert mode(database) == 0o600
    assert mode(ctx.target) == 0o700
    assert partials(ctx.target) == []

    assert log =~
             "Moved your words from #{legacy} to #{database} (412 words). The old file is " <>
               "kept as a backup."

    note = File.read!(Path.join(ctx.legacy_dir, "MOVED-TO-KOTIKO.txt"))
    assert note =~ "Kotiko copied this database (slovo.db) to #{database} on 20"
    assert note =~ "You can delete this folder once you've checked your words in Kotiko."

    # The token the old server generated still works, so the extension stays connected.
    token = Path.join(ctx.target, "api-token")
    assert File.read!(token) == "old-generated-token-0123456789\n"
    assert mode(token) == 0o600
    assert log =~ "Copied your API token from #{Path.join(ctx.legacy_dir, "api-token")}"

    # The second start finds kotiko.db and says nothing.
    assert capture_log(fn -> assert {:ok, :existing} = migrate(ctx) end) == ""
    assert dump(database) == before
  end

  # B-03 (slice 54): a 0.2 install made slovo.db with umask 022, and the copy left it, and
  # the old token (now the live one), as they were.
  test "after the copy, the old database and token are private", ctx do
    legacy = legacy_db(ctx.legacy_dir, 3)
    File.chmod!(legacy, 0o644)
    token = Path.join(ctx.legacy_dir, "api-token")
    File.write!(token, "token-the-old-server-made-0123456789\n")
    File.chmod!(token, 0o644)

    log = capture_log(fn -> assert {:ok, {:migrated, 3}} = migrate(ctx) end)

    assert mode(legacy) == 0o600
    assert mode(token) == 0o600
    assert log =~ "Made the old files in #{ctx.legacy_dir} private"
  end

  test "an install moved before this check gets its old files made private at start", ctx do
    legacy = legacy_db(ctx.legacy_dir, 1)
    File.write!(Path.join(ctx.legacy_dir, "MOVED-TO-KOTIKO.txt"), "moved")
    File.chmod!(legacy, 0o644)
    # Not moved yet: an old folder without the note is left alone.
    other = Path.join(ctx.root, "other")
    other_db = legacy_db(other, 1)
    File.chmod!(other_db, 0o644)

    capture_log(fn -> DataDir.make_legacy_private([ctx.legacy_dir, other]) end)

    assert mode(legacy) == 0o600
    assert mode(other_db) == 0o644
  end

  test "words that are only in the WAL (a server that was killed) are copied", ctx do
    # A writer that never checkpoints, like a server that is killed: its last writes are
    # only in slovo.db-wal. The three files are copied while it still has them open.
    live = Path.join(ctx.root, "live")
    File.mkdir_p!(live)
    {:ok, writer} = Sqlite3.open(Path.join(live, "slovo.db"))
    sql!(writer, "PRAGMA wal_autocheckpoint = 0")
    create_tables(writer)
    insert(writer, 1, 10)
    sql!(writer, "PRAGMA wal_checkpoint(TRUNCATE)")
    insert(writer, 11, 30)

    File.mkdir_p!(ctx.legacy_dir)

    for suffix <- ["", "-wal", "-shm"] do
      File.cp!(
        Path.join(live, "slovo.db" <> suffix),
        Path.join(ctx.legacy_dir, "slovo.db" <> suffix)
      )
    end

    :ok = Sqlite3.close(writer)

    # Without its WAL, the main file has only the first ten.
    main_only = Path.join(ctx.root, "main-only.db")
    File.cp!(Path.join(ctx.legacy_dir, "slovo.db"), main_only)
    assert count(main_only) == 10

    capture_log(fn -> assert {:ok, {:migrated, 30}} = migrate(ctx) end)
    assert count(Path.join(ctx.target, "kotiko.db")) == 30
    assert count(Path.join(ctx.legacy_dir, "slovo.db")) == 30
  end

  test "with both files, kotiko.db is used and the old one named in a warning", ctx do
    legacy = legacy_db(ctx.legacy_dir, 3)
    database = Path.join(ctx.target, "kotiko.db")
    File.mkdir_p!(ctx.target)
    ctx.root |> Path.join("other") |> legacy_db(5) |> File.rename!(database)

    log = capture_log(fn -> assert {:ok, :existing} = migrate(ctx) end)

    assert log =~ "Using #{database}; the old #{legacy} was not touched."
    assert count(database) == 5
    refute File.exists?(Path.join(ctx.legacy_dir, "MOVED-TO-KOTIKO.txt"))

    # Once the old folder has the note (it was copied before), there's nothing to say.
    File.write!(Path.join(ctx.legacy_dir, "MOVED-TO-KOTIKO.txt"), "copied")
    assert capture_log(fn -> assert {:ok, :existing} = migrate(ctx) end) == ""
  end

  test "an old server still writing stops the start, and nothing is copied", ctx do
    legacy = legacy_db(ctx.legacy_dir, 3)
    {:ok, other} = Sqlite3.open(legacy)
    sql!(other, "BEGIN IMMEDIATE")

    assert {:error, message} = migrate(ctx)

    assert message ==
             "Your old Slovo server is still running and using #{legacy}. Stop it first: " <>
               "systemctl --user stop slovo (or close the terminal running run.sh), then " <>
               "start Kotiko again.\n"

    refute File.exists?(Path.join(ctx.target, "kotiko.db"))
    assert partials(ctx.target) == []
    sql!(other, "ROLLBACK")
    :ok = Sqlite3.close(other)
  end

  test "an old server that is only running (not writing) is caught too", ctx do
    legacy = legacy_db(ctx.legacy_dir, 3)
    {:ok, other} = Sqlite3.open(legacy)
    {:ok, statement} = Sqlite3.prepare(other, "SELECT count(*) FROM words")
    assert {:row, [3]} = Sqlite3.step(other, statement)
    :ok = Sqlite3.release(other, statement)

    assert {:error, message} = migrate(ctx)
    assert message =~ "still running"
    refute File.exists?(Path.join(ctx.target, "kotiko.db"))
    :ok = Sqlite3.close(other)

    capture_log(fn -> assert {:ok, {:migrated, 3}} = migrate(ctx) end)
  end

  test "an interrupted copy is cleaned up and done again", ctx do
    legacy_db(ctx.legacy_dir, 7)
    File.mkdir_p!(ctx.target)
    database = Path.join(ctx.target, "kotiko.db")
    File.write!(database <> ".partial", "half a database")
    File.write!(database <> ".partial-journal", "a stale journal")

    capture_log(fn -> assert {:ok, {:migrated, 7}} = migrate(ctx) end)

    assert count(database) == 7
    assert partials(ctx.target) == []
  end

  test "a folder chosen with the old variable is migrated in place", ctx do
    # SLOVO_DATA_DIR=/srv/words: Kotiko.Config makes that folder the data folder.
    words = Path.join(ctx.root, "srv/words")
    legacy = legacy_db(words, 4)
    # The old default folder is not consulted for a folder someone chose.
    legacy_db(ctx.legacy_dir, 9)
    ctx = %{ctx | target: words}
    assert DataDir.legacy_dirs(words, :env, ctx.home) == [words]

    log = capture_log(fn -> assert {:ok, {:migrated, 4}} = migrate(ctx, :env) end)

    database = Path.join(words, "kotiko.db")
    assert count(database) == 4
    assert count(legacy) == 4
    assert log =~ "Moved your words from #{legacy} to #{database} (4 words)."

    note = File.read!(Path.join(words, "MOVED-TO-KOTIKO.txt"))
    assert note =~ "You can delete slovo.db"
    assert note =~ "Keep the folder: Kotiko's own database is in it."
    refute File.exists?(Path.join(ctx.legacy_dir, "MOVED-TO-KOTIKO.txt"))

    # And nothing more on the next start.
    assert capture_log(fn -> assert {:ok, :existing} = migrate(ctx, :env) end) == ""
  end

  test "a corrupted old database stops the start and isn't copied", ctx do
    legacy = legacy_db(ctx.legacy_dir, 2000)
    # Overwrite the middle of the file: b-tree pages of the words table and its index.
    size = File.stat!(legacy).size
    {:ok, fd} = :file.open(legacy, [:read, :write, :raw, :binary])
    :ok = :file.pwrite(fd, div(size, 2), :binary.copy(<<0xFF>>, 8192))
    :ok = :file.close(fd)
    bytes = File.read!(legacy)

    assert {:error, message} = migrate(ctx)

    assert message =~
             "The server can't start: the old database #{legacy} failed its integrity check, " <>
               "so it wasn't copied."

    assert message =~ "The file was not changed."
    refute File.exists?(Path.join(ctx.target, "kotiko.db"))
    assert partials(ctx.target) == []
    assert File.read!(legacy) == bytes
  end

  describe "copy_legacy_token/2" do
    test "copies the token, private, only when the new folder has none", ctx do
      File.mkdir_p!(ctx.legacy_dir)
      old = Path.join(ctx.legacy_dir, "api-token")
      File.write!(old, "the-old-token\n")
      File.chmod!(old, 0o644)

      assert {:ok, ^old} = DataDir.copy_legacy_token(ctx.legacy_dir, ctx.target)
      new = Path.join(ctx.target, "api-token")
      assert File.read!(new) == "the-old-token\n"
      assert mode(new) == 0o600
      assert mode(ctx.target) == 0o700

      File.write!(new, "a-newer-token\n")
      assert {:ok, nil} = DataDir.copy_legacy_token(ctx.legacy_dir, ctx.target)
      assert File.read!(new) == "a-newer-token\n"
    end

    test "nothing to do without an old token, or in the same folder", ctx do
      assert {:ok, nil} = DataDir.copy_legacy_token(ctx.legacy_dir, ctx.target)
      refute File.exists?(ctx.target)

      File.mkdir_p!(ctx.legacy_dir)
      File.write!(Path.join(ctx.legacy_dir, "api-token"), "t\n")
      assert {:ok, nil} = DataDir.copy_legacy_token(ctx.legacy_dir, ctx.legacy_dir)
    end
  end

  # ── make_private/1 (SCR-450) ────────────────────────────────────────
  # The test process keeps the shell's umask (often 022), so what ends up 0600 or 0700
  # was made private by the server.

  describe "make_private/1" do
    defp file!(path, mode, contents \\ "") do
      File.mkdir_p!(Path.dirname(path))
      File.write!(path, contents)
      File.chmod!(path, mode)
      path
    end

    test "a new folder: kotiko.db is made empty and 0600, so -wal and -shm are too", ctx do
      {:ok, :fresh} = migrate(ctx)
      log = capture_log(fn -> assert :ok = DataDir.make_private(ctx.target) end)
      assert log == ""

      database = DataDir.database(ctx.target)
      assert mode(database) == 0o600
      assert mode(ctx.target) == 0o700

      {:ok, conn} = Sqlite3.open(database)

      try do
        create_tables(conn)
        insert(conn, 1, 3)
        assert mode(database <> "-wal") == 0o600
        assert mode(database <> "-shm") == 0o600
      after
        Sqlite3.close(conn)
      end
    end

    test "an install from before: Kotiko's files are made private, with one warning", ctx do
      dir = ctx.target
      File.mkdir_p!(dir)
      File.chmod!(dir, 0o755)
      database = file!(DataDir.database(dir), 0o644, "words")
      wal = file!(database <> "-wal", 0o644)
      shm = file!(database <> "-shm", 0o664)
      token = file!(Path.join(dir, "api-token"), 0o600, "token")
      cache = file!(Path.join(dir, "models-cache.json"), 0o644, "{}")
      # A folder moved in place keeps the old name's database next to the new one.
      legacy = file!(Path.join(dir, "slovo.db"), 0o644, "words")
      note = file!(Path.join(dir, "MOVED-TO-KOTIKO.txt"), 0o644, "moved")
      backup = file!(Path.join(dir, "backups/kotiko-pre-0.4.0-20261001T000000Z.db"), 0o644)
      File.chmod!(Path.join(dir, "backups"), 0o755)

      log = capture_log(fn -> assert :ok = DataDir.make_private(dir) end)

      assert log =~
               "Other users of this computer could open Kotiko's files in #{dir} " <>
                 "(kotiko.db, kotiko.db-wal, kotiko.db-shm, models-cache.json, slovo.db, " <>
                 "backups/kotiko-pre-0.4.0-20261001T000000Z.db, backups, the folder " <>
                 "itself). Made them private: only your account can open them now."

      for path <- [database, wal, shm, token, cache, legacy, backup],
          do: assert(mode(path) == 0o600, path)

      assert mode(Path.join(dir, "backups")) == 0o700
      assert mode(dir) == 0o700
      # The note says where the words went; nothing in it is private.
      assert mode(note) == 0o644
      assert File.read!(database) == "words"

      # Once private, nothing more to say.
      assert capture_log(fn -> DataDir.make_private(dir) end) == ""
    end

    test "a folder holding other files too is left as it is, with how to fix it", ctx do
      dir = Path.join(ctx.root, "shared")
      File.mkdir_p!(dir)
      File.chmod!(dir, 0o755)
      database = file!(DataDir.database(dir), 0o644)
      theirs = file!(Path.join(dir, "notes.txt"), 0o644)

      log = capture_log(fn -> DataDir.make_private(dir) end)

      assert mode(database) == 0o600
      assert mode(dir) == 0o755
      assert mode(theirs) == 0o644
      assert log =~ "could open Kotiko's files in #{dir} (kotiko.db)."

      assert log =~
               "Other users of this computer can open the data folder #{dir}. Kotiko's own " <>
                 "files in it are private, but the folder holds other files too (or is a " <>
                 "link), so Kotiko leaves it as it is. To make it private: chmod 700 #{dir}"
    end

    test "a data folder that is a link is left as it is, with a warning", ctx do
      real = Path.join(ctx.root, "real")
      File.mkdir_p!(real)
      File.chmod!(real, 0o755)
      link = Path.join(ctx.root, "link")
      File.ln_s!(real, link)

      log = capture_log(fn -> DataDir.make_private(link) end)

      assert mode(DataDir.database(real)) == 0o600
      assert mode(real) == 0o755
      assert log =~ "can open the data folder #{link}."
    end

    test "a private folder that isn't only Kotiko's is fine as it is", ctx do
      dir = Path.join(ctx.root, "mine")
      File.mkdir_p!(dir)
      File.chmod!(dir, 0o700)
      file!(Path.join(dir, "notes.txt"), 0o644)

      assert capture_log(fn -> DataDir.make_private(dir) end) == ""
      assert mode(DataDir.database(dir)) == 0o600
    end

    test "a file it can't change gets a warning with the command that fixes it", ctx do
      # A folder without the x bit: its files can't be reached until it's fixed.
      dir = Path.join(ctx.root, "odd")
      file!(DataDir.database(dir), 0o644)
      File.chmod!(dir, 0o644)
      on_exit(fn -> File.chmod(dir, 0o700) end)

      log = capture_log(fn -> DataDir.make_private(dir) end)

      assert log =~
               "Couldn't make #{dir}/kotiko.db private (permission denied), so other " <>
                 "users of this computer may be able to read it. To fix it: chmod 600 " <>
                 "#{dir}/kotiko.db"

      # The folder holds only Kotiko's files, so it was fixed.
      assert mode(dir) == 0o700
    end
  end

  # B-02 (slice 54): someone who could write in the data folder chose the API token (the
  # server used any api-token it found), and a kotiko.db link sent every word to a file
  # of their choosing, readable by anyone, without a word in the log.
  describe "check_safe/2" do
    setup ctx do
      dir = Path.join(ctx.root, "data")
      File.mkdir_p!(dir)
      File.chmod!(dir, 0o700)
      %{dir: dir, uid: File.stat!(dir).uid}
    end

    defp plant!(path, contents \\ "x") do
      File.mkdir_p!(Path.dirname(path))
      File.write!(path, contents)
      File.chmod!(path, 0o600)
      path
    end

    test "a private folder of your own files is fine, and so is a missing one", ctx do
      plant!(Path.join(ctx.dir, "kotiko.db"))
      plant!(Path.join(ctx.dir, "api-token"), "token")
      plant!(Path.join(ctx.dir, "backups/kotiko-pre-1.0.0-20261001T000000Z.db"))
      assert capture_log(fn -> assert DataDir.check_safe(ctx.dir, ctx.uid) == :ok end) == ""
      assert DataDir.check_safe(Path.join(ctx.root, "missing"), ctx.uid) == :ok
    end

    test "a link in place of the database, the token or a backup stops the start", ctx do
      elsewhere = plant!(Path.join(ctx.root, "elsewhere/loot.db"), "")
      File.chmod!(elsewhere, 0o666)
      File.ln_s!(elsewhere, Path.join(ctx.dir, "kotiko.db"))

      File.ln_s!(
        plant!(Path.join(ctx.root, "elsewhere/t"), "token"),
        Path.join(ctx.dir, "api-token")
      )

      File.mkdir_p!(Path.join(ctx.dir, "backups"))
      File.ln_s!(elsewhere, Path.join(ctx.dir, "backups/kotiko-pre-1.0.0-20261001T000000Z.db"))

      assert {:error, message} = DataDir.check_safe(ctx.dir, ctx.uid)
      assert message =~ "The server can't start: someone else may have put files in #{ctx.dir}"
      assert message =~ "#{ctx.dir}/kotiko.db is a link"
      assert message =~ "#{ctx.dir}/api-token is a link"
      assert message =~ "backups/kotiko-pre-1.0.0-20261001T000000Z.db is a link"
      assert message =~ "Kotiko never makes links"
      assert File.read!(elsewhere) == ""
    end

    test "files or a folder that belong to another account stop the start", ctx do
      plant!(Path.join(ctx.dir, "api-token"), "token")

      assert {:error, message} = DataDir.check_safe(ctx.dir, ctx.uid + 1)
      assert message =~ "the folder #{ctx.dir} belongs to another account (uid #{ctx.uid})"
      assert message =~ "#{ctx.dir}/api-token belongs to another account (uid #{ctx.uid})"
    end

    test "a folder others can write in, that holds other files too, stops the start", ctx do
      plant!(Path.join(ctx.dir, "notes.txt"))
      File.chmod!(ctx.dir, 0o777)

      assert {:error, message} = DataDir.check_safe(ctx.dir, ctx.uid)
      assert message =~ "other users of this computer can write in the folder #{ctx.dir}"
      assert message =~ "chmod 700 #{ctx.dir}"
    end

    test "a folder others can write in that holds only Kotiko's files is made private", ctx do
      plant!(Path.join(ctx.dir, "kotiko.db"))
      File.chmod!(ctx.dir, 0o775)

      log = capture_log(fn -> assert DataDir.check_safe(ctx.dir, ctx.uid) == :ok end)
      assert mode(ctx.dir) == 0o700
      assert log =~ "Other users of this computer could write in the data folder #{ctx.dir}"
    end

    test "a data folder that is a link to your own folder is fine", ctx do
      link = Path.join(ctx.root, "link")
      File.ln_s!(ctx.dir, link)
      assert DataDir.check_safe(link, ctx.uid) == :ok
    end
  end
end
