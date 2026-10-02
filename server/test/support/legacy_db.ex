# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.LegacyDb do
  @moduledoc """
  Databases in the 0.2 schema (before slice 07), made by running only the first
  migration, as a 0.2 server did. For the migration and boot tests.
  """

  @v1 20_261_001_000_000

  @doc "Creates a 0.2 database at `path` and runs `sql` (statements separated by `;`) in it."
  def create!(path, sql \\ "") do
    File.mkdir_p!(Path.dirname(path))

    with_repo(path, fn ->
      Ecto.Migrator.run(Kotiko.Repo, :up, to: @v1, log: false)

      for statement <- statements(sql), do: Kotiko.Repo.query!(statement)
    end)

    path
  end

  @doc """
  Runs `fun` with `Kotiko.Repo` pointed at the database file `path` (a real pool, not the
  sandbox). `fun` may take the repo's pid, for other processes to `put_dynamic_repo/1`.
  """
  def with_repo(path, fun, pool_size \\ 1) do
    {:ok, pid} =
      Kotiko.Repo.start_link(
        name: nil,
        database: path,
        pool: DBConnection.ConnectionPool,
        pool_size: pool_size
      )

    previous = Kotiko.Repo.put_dynamic_repo(pid)

    try do
      if is_function(fun, 1), do: fun.(pid), else: fun.()
    after
      Kotiko.Repo.put_dynamic_repo(previous)
      Supervisor.stop(pid)
    end
  end

  # Drops `--` comment lines, then splits on semicolons at the end of a line.
  defp statements(sql) do
    sql
    |> String.split("\n")
    |> Enum.reject(&String.starts_with?(String.trim_leading(&1), "--"))
    |> Enum.join("\n")
    |> String.split(~r/;\s*$/m)
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
  end
end
