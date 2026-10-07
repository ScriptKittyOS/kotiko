# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.PrivateTest do
  # Private folders and files (SCR-450). The test process has whatever umask the shell
  # gave it (often 022), so a file that comes out 0600 was made private by the code.
  use ExUnit.Case, async: true
  alias Exqlite.Sqlite3
  alias Kotiko.Private

  setup do
    root = Path.join(System.tmp_dir!(), "kotiko-private-#{System.unique_integer([:positive])}")
    File.mkdir_p!(root)
    on_exit(fn -> File.rm_rf(root) end)
    %{root: root}
  end

  defp mode(path), do: File.lstat!(path).mode |> Bitwise.band(0o777)

  test "shared?/1 is any group or other bit" do
    refute Private.shared?(0o100600)
    refute Private.shared?(0o40700)
    assert Private.shared?(0o100640)
    assert Private.shared?(0o100604)
    assert Private.shared?(0o40701)
  end

  describe "mkdir_p/1" do
    test "a folder it makes is 0700", %{root: root} do
      dir = Path.join(root, "a/b")
      assert :ok = Private.mkdir_p(dir)
      assert mode(dir) == 0o700
    end

    test "a folder already there is left as it is", %{root: root} do
      dir = Path.join(root, "shared")
      File.mkdir_p!(dir)
      File.chmod!(dir, 0o755)
      assert :ok = Private.mkdir_p(dir)
      assert mode(dir) == 0o755
    end

    test "a file in the way is an error", %{root: root} do
      path = Path.join(root, "file")
      File.write!(path, "")
      assert {:error, _} = Private.mkdir_p(path)
    end
  end

  describe "create/1" do
    test "makes an empty 0600 file, and leaves one that's there alone", %{root: root} do
      path = Path.join(root, "kotiko.db")
      assert :ok = Private.create(path)
      assert mode(path) == 0o600
      assert File.read!(path) == ""

      File.write!(path, "words")
      File.chmod!(path, 0o644)
      assert :ok = Private.create(path)
      assert mode(path) == 0o644
      assert File.read!(path) == "words"
    end

    test "returns the error when the folder isn't there", %{root: root} do
      assert {:error, :enoent} = Private.create(Path.join(root, "missing/kotiko.db"))
    end
  end

  test "write/3 saves through a private file and creates a private folder", %{root: root} do
    path = Path.join(root, "new-folder/models-cache.json")
    assert :ok = Private.write(path, "{}", ".tmp")
    assert File.read!(path) == "{}"
    assert mode(path) == 0o600
    assert mode(Path.dirname(path)) == 0o700
    refute File.exists?(path <> ".tmp")

    File.chmod!(path, 0o644)
    assert :ok = Private.write(path, "[]", ".tmp")
    assert File.read!(path) == "[]"
    assert mode(path) == 0o600
  end

  describe "restrict/1" do
    test "tightens a file or folder others can open, and says so", %{root: root} do
      file = Path.join(root, "kotiko.db")
      File.write!(file, "")
      File.chmod!(file, 0o644)
      assert :changed = Private.restrict(file)
      assert mode(file) == 0o600
      assert :ok = Private.restrict(file)

      dir = Path.join(root, "backups")
      File.mkdir_p!(dir)
      File.chmod!(dir, 0o755)
      assert :changed = Private.restrict(dir)
      assert mode(dir) == 0o700
    end

    test "leaves a private file, a missing one and a link alone", %{root: root} do
      file = Path.join(root, "api-token")
      File.write!(file, "")
      File.chmod!(file, 0o400)
      assert :ok = Private.restrict(file)
      assert mode(file) == 0o400

      assert :ok = Private.restrict(Path.join(root, "missing"))

      elsewhere = Path.join(root, "not-kotikos")
      File.write!(elsewhere, "")
      File.chmod!(elsewhere, 0o644)
      link = Path.join(root, "models-cache.json")
      File.ln_s!(elsewhere, link)
      assert :ok = Private.restrict(link)
      assert mode(elsewhere) == 0o644
    end
  end

  # What make_private/1 relies on: SQLite gives the files it makes next to a database
  # that database's mode, and VACUUM INTO an empty file keeps that file's mode.
  describe "SQLite and a database made private before it opens" do
    test "the -wal and -shm files are 0600 too", %{root: root} do
      db = Path.join(root, "kotiko.db")
      :ok = Private.create(db)
      {:ok, conn} = Sqlite3.open(db)

      try do
        :ok = Sqlite3.execute(conn, "PRAGMA journal_mode = WAL")
        :ok = Sqlite3.execute(conn, "CREATE TABLE words (native TEXT)")
        :ok = Sqlite3.execute(conn, "INSERT INTO words VALUES ('кот')")

        assert mode(db) == 0o600
        assert mode(db <> "-wal") == 0o600
        assert mode(db <> "-shm") == 0o600
      after
        Sqlite3.close(conn)
      end
    end

    test "VACUUM INTO an empty private file keeps it private", %{root: root} do
      db = Path.join(root, "kotiko.db")
      copy = Path.join(root, "copy.db")
      {:ok, conn} = Sqlite3.open(db)

      try do
        :ok = Sqlite3.execute(conn, "CREATE TABLE words (native TEXT)")
        :ok = Sqlite3.execute(conn, "INSERT INTO words VALUES ('кот')")
        :ok = Private.create(copy)
        :ok = Sqlite3.execute(conn, "VACUUM INTO '#{copy}'")
      after
        Sqlite3.close(conn)
      end

      assert mode(copy) == 0o600
      assert File.stat!(copy).size > 0
    end
  end

  describe "read_own/3 and uid/0 (slice 54, B-02)" do
    test "uid/0 is the owner of the files this account makes", %{root: root} do
      path = Path.join(root, "mine")
      File.write!(path, "x")
      assert Private.uid() == File.stat!(path).uid
    end

    test "reads a regular file of this account's", %{root: root} do
      path = Path.join(root, "token")
      File.write!(path, "secret\n")
      assert Private.read_own(path) == {:ok, "secret\n"}
      File.write!(path, "")
      assert Private.read_own(path) == {:ok, ""}
    end

    test "refuses a link, a folder, another account's file and a big one", %{root: root} do
      path = Path.join(root, "token")
      File.write!(path, "secret")
      link = Path.join(root, "link")
      File.ln_s!(path, link)

      assert Private.read_own(link) == {:error, :link}
      assert Private.read_own(root) == {:error, :not_regular}
      uid = File.stat!(path).uid
      assert Private.read_own(path, uid + 1) == {:error, {:owner, uid}}
      assert Private.read_own(path, nil) == {:ok, "secret"}
      assert Private.read_own(path, uid, 3) == {:error, :too_big}
      assert Private.read_own(Path.join(root, "missing")) == {:error, :enoent}
    end
  end
end
