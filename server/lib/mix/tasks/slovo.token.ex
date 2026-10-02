# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Mix.Tasks.Slovo.Token do
  @shortdoc "Prints the API token and a pairing string; --rotate makes a new token"
  @moduledoc """
  Prints the server's API token and a pairing string (server address and token in one
  value) to paste into the extension.

      mix slovo.token            print them
      mix slovo.token --rotate   replace the saved token with a new one

  Reads settings like `run.sh` does: the environment, then `.env` in the current folder
  (`--env-file PATH` to use another file). `--rotate` refuses when API_TOKEN is set,
  because the token then lives in `.env`.
  """
  use Mix.Task
  alias Slovo.{Exposure, Token}

  @impl true
  def run(args) do
    {opts, _} = OptionParser.parse!(args, strict: [rotate: :boolean, env_file: :string])
    env = read_env(Keyword.get(opts, :env_file, ".env"))
    data_dir = env["SLOVO_DATA_DIR"] || Path.expand("~/.local/share/slovo")

    if opts[:rotate], do: rotate(env, data_dir), else: show(env, data_dir)
  end

  defp show(env, data_dir) do
    case Token.resolve(env["API_TOKEN"], data_dir) do
      {:ok, token, source} ->
        where = if source == :env, do: "from .env", else: "saved in #{Token.path(data_dir)}"
        Mix.shell().info("API token (#{where}):\n#{token}\n")
        Mix.shell().info("Pairing string:\n#{Token.pairing_string(server_url(env), token)}")

      {:error, message} ->
        Mix.raise(message)
    end
  end

  defp rotate(%{"API_TOKEN" => _}, _data_dir) do
    Mix.raise(
      "API_TOKEN is set in .env, so the server uses that one. To change it, edit .env " <>
        "(or delete the line and Slovo will make and save a strong token), then restart."
    )
  end

  defp rotate(env, data_dir) do
    case Token.generate(Token.path(data_dir)) do
      {:ok, token, {:generated, path}} ->
        Mix.shell().info("New API token saved in #{path}:\n#{token}\n")
        Mix.shell().info("Pairing string:\n#{Token.pairing_string(server_url(env), token)}\n")

        Mix.shell().info(
          "Restart the server (systemctl --user restart slovo, or ./run.sh), then paste " <>
            "the new token or pairing string into the extension's Connection settings."
        )

      {:error, message} ->
        Mix.raise(message)
    end
  end

  defp server_url(env) do
    bind = env["BIND"] || "127.0.0.1"
    port = env["PORT"] || "4747"

    case Slovo.Config.parse_bind(bind) do
      {:ok, ip} -> Exposure.server_url(env["PUBLIC_URL"], ip, port)
      {:error, _} -> Mix.raise("Couldn't find an address for BIND=#{bind}.")
    end
  end

  # The environment, overridden by the .env file as run.sh does. Blank values are unset.
  defp read_env(file) do
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
end
