# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Mix.Tasks.Kotiko.Token do
  @shortdoc "Prints the API token and a pairing string; --rotate makes a new token"
  @moduledoc """
  Prints the server's API token and a pairing string (server address and token in one
  value) to paste into the extension.

      mix kotiko.token            print them
      mix kotiko.token --rotate   replace the saved token with a new one

  Reads settings like `run.sh` does: the environment, then `.env` in the current folder
  (`--env-file PATH` to use another file). `--rotate` refuses when API_TOKEN or
  API_TOKEN_FILE is set, because the token then lives in `.env` or in that file.
  """
  use Mix.Task
  alias Kotiko.{DataDir, Exposure, Token}

  @impl true
  def run(args) do
    {opts, _} = OptionParser.parse!(args, strict: [rotate: :boolean, env_file: :string])
    raw_env = Kotiko.TaskEnv.read_env(Keyword.get(opts, :env_file, ".env"))
    env = read_token_file(raw_env)
    data_dir = data_dir(env)

    if opts[:rotate], do: rotate(raw_env, data_dir), else: show(env, data_dir)
  end

  # API_TOKEN_FILE, read and checked as the server does.
  defp read_token_file(env) do
    case Kotiko.Config.read_secret_files(env, ["API_TOKEN"]) do
      {env, [], _warnings} ->
        env

      {_env, problems, _warnings} ->
        Mix.raise(Kotiko.Config.format_problems(problems, nil, false))
    end
  end

  defp show(env, data_dir) do
    case Token.resolve(env["API_TOKEN"], data_dir) do
      {:ok, token, source} ->
        where =
          cond do
            source != :env -> "saved in #{Token.path(data_dir)}"
            env["API_TOKEN_FILE"] -> "from API_TOKEN_FILE, #{env["API_TOKEN_FILE"]}"
            true -> "from .env"
          end

        Mix.shell().info("API token (#{where}):\n#{token}\n")
        Mix.shell().info("Pairing string:\n#{Token.pairing_string(server_url(env), token)}")

      {:error, message} ->
        Mix.raise(message)
    end
  end

  defp rotate(%{"API_TOKEN_FILE" => path}, _data_dir) do
    Mix.raise(
      "API_TOKEN_FILE is set, so the server uses the token in #{path}. To change it, " <>
        "replace that file's contents, then restart."
    )
  end

  defp rotate(%{"API_TOKEN" => _}, _data_dir) do
    Mix.raise(
      "API_TOKEN is set in .env, so the server uses that one. To change it, edit .env " <>
        "(or delete the line and Kotiko will make and save a strong token), then restart."
    )
  end

  defp rotate(env, data_dir) do
    case Token.generate(Token.path(data_dir)) do
      {:ok, token, {:generated, path}} ->
        Mix.shell().info("New API token saved in #{path}:\n#{token}\n")
        Mix.shell().info("Pairing string:\n#{Token.pairing_string(server_url(env), token)}\n")

        Mix.shell().info(
          "Restart the server (systemctl --user restart kotiko, or ./run.sh), then paste " <>
            "the new token or pairing string into the extension's Connection settings."
        )

      {:error, message} ->
        Mix.raise(message)
    end
  end

  # Like Kotiko.Config: KOTIKO_DATA_DIR, else its old name, else the default folder. In the
  # default folder, a token saved before the rename is copied over first, as the server's
  # first start would do, so this doesn't make a new one the extension doesn't know.
  defp data_dir(env) do
    # legacy-name-ok
    case env["KOTIKO_DATA_DIR"] || env["SLOVO_DATA_DIR"] do
      nil ->
        dir = DataDir.default_dir()
        unless File.exists?(DataDir.database(dir)), do: adopt_token(dir)
        dir

      dir ->
        Path.expand(dir)
    end
  end

  defp adopt_token(dir) do
    case DataDir.copy_legacy_token(DataDir.legacy_default_dir(), dir) do
      {:ok, nil} -> :ok
      {:ok, from} -> Mix.shell().info("Copied the API token saved before the rename (#{from}).\n")
      {:error, message} -> Mix.raise(message)
    end
  end

  defp server_url(env) do
    bind = env["BIND"] || "127.0.0.1"
    port = env["PORT"] || "4747"

    case Kotiko.Config.parse_bind(bind) do
      {:ok, ip} -> Exposure.server_url(env["PUBLIC_URL"], ip, port)
      {:error, _} -> Mix.raise("Couldn't find an address for BIND=#{bind}.")
    end
  end
end
