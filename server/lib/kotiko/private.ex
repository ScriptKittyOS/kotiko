# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Private do
  @moduledoc """
  Folders and files only the server's own account can open: folders 0700, files 0600.

  The BEAM can't set the umask or give a mode when it creates a file, so a new file
  starts with the process's umask (usually `022`: everyone can read it). These helpers
  create a file empty, make it private, and only then put anything in it. `run.sh` and
  the systemd unit also start the server with umask `077`, so with them nothing is ever
  readable by others, not even for the moment between creating a file and its `chmod`.

  SQLite gives the `-wal`, `-shm` and `-journal` files it makes the same mode as their
  database (and `VACUUM INTO` an empty file keeps that file's mode), so creating
  `kotiko.db` or a backup empty and 0600 before SQLite opens it keeps those private too.

  These are POSIX permissions (Linux, macOS, WSL). On a file system that ignores them,
  like a Windows drive mounted in WSL, `restrict/1` returns `{:error, :ignored}`.
  """
  import Bitwise

  @doc "Whether `mode` lets anyone but the owner in (any group or other bit is set)."
  def shared?(mode), do: band(mode, 0o077) != 0

  @doc """
  Creates the folder `dir`, and any missing parents. When this creates `dir` itself, it
  is made 0700 before anything is put in it. A folder that already exists is left as it
  is: `Kotiko.DataDir.make_private/1` decides about those.
  """
  # Sobelow: callers pass the data folder (or one inside it) from the server's settings or
  # an operator's command line, never a path from a request.
  # sobelow_skip ["Traversal.FileModule"]
  def mkdir_p(dir) do
    if File.dir?(dir) do
      :ok
    else
      with :ok <- File.mkdir_p(dir), do: File.chmod(dir, 0o700)
    end
  end

  @doc """
  Creates `path` as an empty file only the owner can read, for SQLite to fill. Does
  nothing when `path` already exists.
  """
  # Sobelow: the database or backup path under the configured data folder, never a request's.
  # sobelow_skip ["Traversal.FileModule"]
  def create(path) do
    case File.open(path, [:write, :exclusive]) do
      {:ok, io} ->
        :ok = File.close(io)
        File.chmod(path, 0o600)

      {:error, :eexist} ->
        :ok

      {:error, _reason} = error ->
        error
    end
  end

  @doc """
  Writes `contents` to `path` (mode 0600) through `path <> suffix`: the new file is made
  private before anything goes in, then renamed over the old one, so readers never see a
  half-written file and the contents are never in a file other users can read.
  """
  # Sobelow: a fixed file name in the configured data folder, never a path from a request.
  # sobelow_skip ["Traversal.FileModule"]
  def write(path, contents, suffix \\ ".new") do
    tmp = path <> suffix
    _ = File.rm(tmp)

    with :ok <- mkdir_p(Path.dirname(path)),
         :ok <- create(tmp),
         :ok <- File.write(tmp, contents) do
      File.rename(tmp, path)
    end
  end

  @doc """
  Makes the file (0600) or folder (0700) at `path` private when others can open it.
  Returns `:ok` when it is already private or isn't there, `:changed`, or
  `{:error, reason}`: a file error, or `:ignored` when the file system kept its own modes.
  A symbolic link is left alone: what it points to may not be Kotiko's.
  """
  # Sobelow: paths of Kotiko's own files in the configured data folder, never a request's.
  # sobelow_skip ["Traversal.FileModule"]
  def restrict(path) do
    case File.lstat(path) do
      {:ok, %File.Stat{type: type, mode: current}} when type in [:regular, :directory] ->
        if shared?(current), do: tighten(path, private_mode(type)), else: :ok

      {:ok, %File.Stat{}} ->
        :ok

      {:error, :enoent} ->
        :ok

      {:error, _reason} = error ->
        error
    end
  end

  @doc """
  The user ID the server runs as, or nil when it can't be found. Read from the owner of
  `/proc/self` (Linux), else of a file this makes in the temporary folder (macOS). No
  external command runs.
  """
  def uid do
    case :persistent_term.get({__MODULE__, :uid}, :unknown) do
      :unknown ->
        uid = find_uid()
        :persistent_term.put({__MODULE__, :uid}, uid)
        uid

      uid ->
        uid
    end
  end

  # Sobelow: /proc/self, or a file this names itself in the temporary folder.
  # sobelow_skip ["Traversal.FileModule"]
  defp find_uid do
    case File.stat("/proc/self") do
      {:ok, %File.Stat{uid: uid}} ->
        uid

      {:error, _} ->
        probe = Path.join(System.tmp_dir!(), "kotiko-uid-#{System.unique_integer([:positive])}")

        try do
          with :ok <- create(probe), {:ok, %File.Stat{uid: uid}} <- File.lstat(probe) do
            uid
          else
            _ -> nil
          end
        after
          File.rm(probe)
        end
    end
  end

  @doc """
  Reads a small file of the server's own (the API token), without following a link: the
  path must be a regular file that belongs to `uid` (when known), and the file opened is
  checked to be that same file (device and inode), so a link put in its place between
  the check and the open isn't followed. The BEAM has no `O_NOFOLLOW`; this is the
  `lstat`, open, `fstat` and compare check that stands in for it.

  Returns `{:ok, contents}`, or `{:error, reason}`: a file error, `:link`, `:not_regular`,
  `{:owner, uid}`, `:changed` or `:too_big` (over `max_bytes`).
  """
  # Sobelow: `api-token` in the configured data folder, never a path from a request.
  # sobelow_skip ["Traversal.FileModule"]
  def read_own(path, uid \\ uid(), max_bytes \\ 64 * 1024) do
    with {:ok, %File.Stat{} = stat} <- File.lstat(path),
         :ok <- own_regular(stat, uid),
         :ok <- if(stat.size > max_bytes, do: {:error, :too_big}, else: :ok),
         {:ok, fd} <- :file.open(path, [:read, :raw, :binary]) do
      try do
        with {:ok, info} <- :file.read_file_info(fd),
             true <- same_file?(info, stat) || {:error, :changed} do
          read_all(fd, max_bytes)
        end
      after
        :file.close(fd)
      end
    end
  end

  defp own_regular(%File.Stat{type: :symlink}, _uid), do: {:error, :link}
  defp own_regular(%File.Stat{type: type}, _uid) when type != :regular, do: {:error, :not_regular}

  defp own_regular(%File.Stat{uid: owner}, uid) when is_integer(uid) and owner != uid,
    do: {:error, {:owner, owner}}

  defp own_regular(%File.Stat{}, _uid), do: :ok

  # :file_info records: {file_info, size, type, access, atime, mtime, ctime, mode, links,
  # major_device, minor_device, inode, uid, gid}.
  defp same_file?(info, %File.Stat{major_device: major, inode: inode}),
    do: elem(info, 9) == major and elem(info, 11) == inode and elem(info, 2) == :regular

  defp read_all(fd, max_bytes) do
    case :file.read(fd, max_bytes + 1) do
      {:ok, data} when byte_size(data) > max_bytes -> {:error, :too_big}
      {:ok, data} -> {:ok, data}
      :eof -> {:ok, ""}
      {:error, _} = error -> error
    end
  end

  @doc "The private mode for a `:regular` file (0600) or a `:directory` (0700)."
  def private_mode(:directory), do: 0o700
  def private_mode(_regular), do: 0o600

  # Checks again afterwards: some file systems accept chmod and keep their own modes.
  # Sobelow: as restrict/1.
  # sobelow_skip ["Traversal.FileModule"]
  defp tighten(path, mode) do
    with :ok <- File.chmod(path, mode),
         {:ok, %File.Stat{mode: now}} <- File.lstat(path) do
      if shared?(now), do: {:error, :ignored}, else: :changed
    end
  end
end
