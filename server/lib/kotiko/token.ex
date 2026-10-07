# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Token do
  @moduledoc """
  The API token the extension sends. Taken from API_TOKEN if set, else from
  `<data_dir>/api-token`, else made here and saved there (mode 0600), so a fresh server
  has a strong token without anyone running openssl.
  """

  @min_length 24
  @file_name "api-token"
  # weakness/1's thresholds.
  @min_different 10
  @min_bits 64
  @max_repeat_check 256

  def min_length, do: @min_length

  def path(data_dir), do: Path.join(data_dir, @file_name)

  @doc """
  Returns `{:ok, token, source}` with source `:env`, `{:file, path}` or
  `{:generated, path}`, or `{:error, message}` when the token can't be used.
  `env_token` is API_TOKEN as configured: nil when unset or empty.
  """
  def resolve(env_token, data_dir)

  # Sobelow: `api-token` in the configured data folder, never a path from a request.
  # sobelow_skip ["Traversal.FileModule"]
  def resolve(nil, data_dir) do
    path = path(data_dir)

    # Never through a link, and only a file of the server's own account (slice 54, B-02):
    # otherwise someone who could write in the folder would choose the token.
    case Kotiko.Private.read_own(path) do
      {:ok, contents} ->
        case String.trim(contents) do
          "" -> generate(path)
          token -> check(token, "The token in #{path}", {:file, path})
        end

      {:error, :enoent} ->
        generate(path)

      {:error, reason} ->
        {:error, read_error(reason, path)}
    end
  end

  def resolve(env_token, _data_dir) when is_binary(env_token) do
    check(String.trim(env_token), "API_TOKEN", :env)
  end

  defp read_error(:link, path),
    do:
      "#{path} is a link. Kotiko never makes one, so someone else may have put it there " <>
        "to choose your token. Delete it, and the server makes a new token"

  defp read_error({:owner, uid}, path),
    do:
      "#{path} belongs to another account (uid #{uid}), so someone else may have chosen " <>
        "your token. Delete it, and the server makes a new token"

  defp read_error(:not_regular, path), do: "#{path} isn't a regular file"
  defp read_error(:too_big, path), do: "#{path} is too big for a token"

  defp read_error(:changed, path),
    do: "#{path} changed while it was read. Start the server again"

  defp read_error(reason, path),
    do: "Couldn't read #{path}: #{:file.format_error(reason)}"

  defp check(token, what, source) do
    if String.length(token) >= @min_length do
      {:ok, token, source}
    else
      {:error,
       "#{what} is too short (#{String.length(token)} characters). Use at least " <>
         "#{@min_length}, or delete it from .env and Kotiko will make a strong one for you."}
    end
  end

  @doc "Makes a new token and saves it to `path`, replacing any old one."
  def generate(path) do
    token = :crypto.strong_rand_bytes(32) |> Base.url_encode64(padding: false)

    case save(path, token <> "\n") do
      :ok -> {:ok, token, {:generated, path}}
      {:error, reason} -> {:error, "Couldn't save the token to #{path}: #{inspect(reason)}"}
    end
  end

  @doc """
  Writes `contents` to `path` (mode 0600). The file is made private before the token goes
  in, and swapped in with a rename, so the token is never in a file other users can read.
  A data folder this creates is private too (`Kotiko.Private`).
  """
  def save(path, contents), do: Kotiko.Private.write(path, contents, ".new")

  @proof_label "kotiko-proof-v1:"

  @doc """
  Why `token` looks easy to guess, or nil. A simple check, not a guarantee (slice 54,
  B-09): it catches tokens a person typed, not ones made at random.

    * `:few_characters`: fewer than 10 different characters (`aaaa...`, `passwordpassword...`)
    * `:repeated`: one shorter piece repeated (`abcdefghijklabcdefghijkl`)
    * `:little_variety`: under 64 bits by the characters' frequencies (length times the
      Shannon entropy of the character counts), as when most characters are the same

  A token the server makes (32 random bytes, 43 characters) has about 220 such bits, and
  `openssl rand -hex 24` about 190.
  """
  def weakness(token) do
    chars = String.graphemes(token)
    counts = Enum.frequencies(chars)

    cond do
      map_size(counts) < @min_different -> :few_characters
      repeated?(chars) -> :repeated
      bits(counts, length(chars)) < @min_bits -> :little_variety
      true -> nil
    end
  end

  @doc "The words for `weakness/1`'s reason, for a warning."
  def weakness_text(:few_characters),
    do: "it uses fewer than #{@min_different} different characters"

  def weakness_text(:repeated), do: "it repeats a shorter piece"
  def weakness_text(:little_variety), do: "most of its characters are the same"

  # Only short tokens: the check is quadratic, and a long one with 10 or more different
  # characters isn't what a person types.
  defp repeated?(chars) when length(chars) > @max_repeat_check, do: false

  defp repeated?(chars) do
    t = List.to_tuple(chars)
    n = tuple_size(t)

    Enum.any?(1..div(n, 2)//1, fn period ->
      Enum.all?(period..(n - 1)//1, &(elem(t, &1) == elem(t, &1 - period)))
    end)
  end

  defp bits(counts, n) do
    n * -Enum.sum(for {_char, c} <- counts, p = c / n, do: p * :math.log2(p))
  end

  @doc """
  Whether `nonce` is one the extension may send to `POST /api/v1/proof`: 32 to 128
  base64url characters (`A-Z a-z 0-9 - _`, no padding).
  """
  def nonce?(nonce), do: is_binary(nonce) and nonce =~ ~r/\A[A-Za-z0-9_-]{32,128}\z/

  @doc """
  The proof that this server holds `token`, for `nonce`:
  `base64url(HMAC-SHA256(key: token, message: "kotiko-proof-v1:" <> nonce))`, without
  padding. It reveals nothing about the token that helps someone who doesn't have it,
  except a value to test guesses against offline, which only a weak token makes useful.
  """
  def proof(token, nonce) do
    :hmac
    |> :crypto.mac(:sha256, token, @proof_label <> nonce)
    |> Base.url_encode64(padding: false)
  end

  @doc """
  One pasteable value carrying both the server address and the token, for the
  extension's connection screen: `kotiko-pair:1:<base64url of {"url", "token"}>`.
  """
  def pairing_string(url, token) do
    "kotiko-pair:1:" <>
      Base.url_encode64(Jason.encode!(%{url: url, token: token}), padding: false)
  end
end
