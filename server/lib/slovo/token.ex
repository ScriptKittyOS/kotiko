# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Slovo.Token do
  @moduledoc """
  The API token the extension sends. Taken from API_TOKEN if set, else from
  `<data_dir>/api-token`, else made here and saved there (mode 0600), so a fresh server
  has a strong token without anyone running openssl.
  """

  @min_length 24
  @file_name "api-token"

  def min_length, do: @min_length

  def path(data_dir), do: Path.join(data_dir, @file_name)

  @doc """
  Returns `{:ok, token, source}` with source `:env`, `{:file, path}` or
  `{:generated, path}`, or `{:error, message}` when the token can't be used.
  `env_token` is API_TOKEN as configured: nil when unset or empty.
  """
  def resolve(env_token, data_dir)

  def resolve(nil, data_dir) do
    path = path(data_dir)

    case File.read(path) do
      {:ok, contents} ->
        case String.trim(contents) do
          "" -> generate(path)
          token -> check(token, "The token in #{path}", {:file, path})
        end

      {:error, :enoent} ->
        generate(path)

      {:error, reason} ->
        {:error, "Couldn't read #{path}: #{:file.format_error(reason)}"}
    end
  end

  def resolve(env_token, _data_dir) when is_binary(env_token) do
    check(String.trim(env_token), "API_TOKEN", :env)
  end

  defp check(token, what, source) do
    if String.length(token) >= @min_length do
      {:ok, token, source}
    else
      {:error,
       "#{what} is too short (#{String.length(token)} characters). Use at least " <>
         "#{@min_length}, or delete it from .env and Slovo will make a strong one for you."}
    end
  end

  @doc "Makes a new token and saves it to `path`, replacing any old one."
  def generate(path) do
    token = :crypto.strong_rand_bytes(32) |> Base.url_encode64(padding: false)

    case write(path, token) do
      :ok -> {:ok, token, {:generated, path}}
      {:error, reason} -> {:error, "Couldn't save the token to #{path}: #{inspect(reason)}"}
    end
  end

  # The file is made private before the token goes in, and swapped in with a rename,
  # so the token is never in a file other users can read.
  defp write(path, token) do
    tmp = path <> ".new"
    _ = File.rm(tmp)

    with :ok <- File.mkdir_p(Path.dirname(path)),
         :ok <- File.touch(tmp),
         :ok <- File.chmod(tmp, 0o600),
         :ok <- File.write(tmp, token <> "\n") do
      File.rename(tmp, path)
    end
  end

  @doc """
  One pasteable value carrying both the server address and the token, for the
  extension's connection screen: `mira-pair:1:<base64url of {"url", "token"}>`.
  """
  def pairing_string(url, token) do
    "mira-pair:1:" <>
      Base.url_encode64(Jason.encode!(%{url: url, token: token}), padding: false)
  end
end
