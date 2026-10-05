# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.TaskEnv do
  @moduledoc """
  What the `mix kotiko.*` tasks share: the settings as `run.sh` reads them (the
  environment, then a `.env` file), the data folder, and the database opened on its own,
  without the HTTP server or the bot.
  """

  @doc "The environment, overridden by the .env file as run.sh does. Blank values are unset."
  def read_env(file) do
    dotenv =
      case File.read(file) do
        {:ok, contents} -> parse_env(contents)
        {:error, _} -> %{}
      end

    System.get_env()
    |> Map.merge(dotenv)
    |> Map.new(fn {k, v} -> {k, String.trim(v)} end)
    |> Map.reject(fn {_k, v} -> v == "" end)
  end

  defp parse_env(contents) do
    for line <- String.split(contents, "\n"),
        line = line |> String.trim() |> String.replace_prefix("export ", ""),
        line != "" and not String.starts_with?(line, "#"),
        [key, value] <- [String.split(line, "=", parts: 2)],
        into: %{} do
      {String.trim(key), value |> String.trim() |> unquote_value()}
    end
  end

  defp unquote_value(<<q, rest::binary>> = value) when q in [?", ?'] do
    if String.ends_with?(rest, <<q>>), do: String.slice(rest, 0..-2//1), else: value
  end

  defp unquote_value(value), do: value

  @doc "KOTIKO_DATA_DIR, else its old name, else the default folder (like Kotiko.Config)."
  def data_dir(env) do
    # legacy-name-ok
    case env["KOTIKO_DATA_DIR"] || env["SLOVO_DATA_DIR"] do
      nil -> Kotiko.DataDir.default_dir()
      dir -> Path.expand(dir)
    end
  end

  @doc """
  Runs `fun.(data_dir)` with `Kotiko.Repo` open on the server's database. When the repo
  already runs (in tests, or inside `iex -S mix`), that one is used and `data_dir` is the
  `--data-dir` option or the configured folder.
  """
  def with_repo(opts, fun) do
    if Process.whereis(Kotiko.Repo) || Kotiko.Repo.get_dynamic_repo() != Kotiko.Repo do
      fun.(opts[:data_dir] || Application.get_env(:kotiko, :data_dir))
    else
      Mix.Task.run("app.config")
      env = read_env(opts[:env_file] || ".env")
      dir = if opts[:data_dir], do: Path.expand(opts[:data_dir]), else: data_dir(env)
      db = Kotiko.DataDir.database(dir)
      unless File.exists?(db), do: Mix.raise("There's no Kotiko database in #{dir}.")
      {:ok, _} = Application.ensure_all_started(:ecto_sqlite3)
      Application.put_env(:kotiko, :data_dir, dir)

      {:ok, repo} =
        Kotiko.Repo.start_link(database: db, pool: DBConnection.ConnectionPool, pool_size: 1)

      try do
        fun.(dir)
      after
        Supervisor.stop(repo)
      end
    end
  end
end
