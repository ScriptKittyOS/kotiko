# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.RequestAuth do
  @moduledoc """
  Signed requests (slice 54, D-01): the extension never sends the API token. It signs each
  request with it instead, and the server signs its answer, so a program that took the
  port while the server was stopped gets neither the token nor a usable request.

  A signed request carries one header:

      Authorization: Kotiko-HMAC v2 ts=<unix seconds>, nonce=<base64url>, boot=<base64url>, body=<hex>, mac=<base64url>

    * `ts`: the client's time, in whole seconds since 1970 (1 to 12 digits).
    * `nonce`: 22 to 128 base64url characters (16 or more random bytes), new for every request.
    * `boot`: this server's boot id (`boot/0`), 22 to 64 base64url characters, as the
      proof (`POST /api/v1/proof`) gave it.
    * `body`: the SHA-256 of the request body's bytes, 64 lowercase hex digits (of the empty
      string when there is no body).
    * `mac`: base64url, without padding, of HMAC-SHA256 with the token's UTF-8 bytes as the
      key over the canonical request:

          "kotiko-req-v2\\n" <> METHOD <> "\\n" <> path <> "\\n" <> ts <> "\\n" <> nonce <> "\\n" <> boot <> "\\n" <> body

      METHOD is the method in capitals; `path` is the request target as the server receives
      it, raw (not percent-decoded), with `?` and the query string when there is one; `ts`,
      `nonce`, `boot` and `body` are the header's values exactly as sent.

  It is accepted when the MAC matches (compared in constant time), `boot` is this server's
  boot id, `ts` is within 120 seconds of the server's clock either way, the nonce wasn't
  seen before, and the body's hash is the one signed. Every answer to an accepted request
  carries

      X-Kotiko-Server: v1 mac=<base64url HMAC-SHA256(token, "kotiko-resp-v1\\n" <> nonce <> "\\n" <> status)>

  so the client knows the answer came from a server that holds the token.

  Nonces are remembered for the window in one ETS table, only once the MAC matched, so
  strangers can't fill it. It holds at most 50,000 (`:max_nonces`); when full after dropping the
  expired ones, new signed requests are refused (`:full`, 429) rather than forgetting a live
  nonce, which would let that request be replayed. Only a token holder can fill it, and
  only by sending that many requests within four minutes.

  **The boot id** (security review E-01). The nonces live in memory, so a restarted server
  has forgotten them. Each start makes a new random boot id (128 bits), which the proof
  answer carries, authenticated with the token (`boot_mac/3`), and every signed request
  signs. A request signed before a restart carries the old id and is refused
  (`:stale_boot`, 401 `error="stale_boot"`); the extension then asks for a new proof and
  sends the request again, once. So a request a squatter caught while the server was
  stopped can't be played to the server once it is back, however far ahead the client's
  clock was. (Before, only a `ts` from before the start was refused, which let a request
  stamped up to 120 s ahead through after a restart.)
  """
  import Plug.Conn

  @window 120
  @max_nonces 50_000
  @purge_every 1_000
  @table Kotiko.RequestAuth.Nonces
  @boot {__MODULE__, :boot}
  @request_label "kotiko-req-v2"
  @response_label "kotiko-resp-v1"
  @boot_label "kotiko-boot-v1"
  @scheme "Kotiko-HMAC "
  @params ~r/\Av2 ts=(\d{1,12}), nonce=([A-Za-z0-9_-]{22,128}), boot=([A-Za-z0-9_-]{22,64}), body=([0-9a-f]{64}), mac=([A-Za-z0-9_-]{43})\z/

  @doc "The window, in seconds, either side of the server's clock."
  def window, do: @window

  @doc "Creates the nonce table and this boot's id (at boot)."
  def init do
    if :ets.whereis(@table) == :undefined do
      :ets.new(@table, [:named_table, :public, :set, write_concurrency: true])
    end

    :persistent_term.put(@boot, new_boot())
    :ok
  end

  @doc "Forgets every nonce (for tests); `boot` sets the boot id (a new one by default)."
  def reset(boot \\ nil) do
    if :ets.whereis(@table) != :undefined, do: :ets.delete_all_objects(@table)
    :persistent_term.put(@boot, boot || new_boot())
    :ok
  end

  @doc "This boot's id: 16 random bytes made at start, as 22 base64url characters."
  def boot, do: :persistent_term.get(@boot)

  defp new_boot, do: :crypto.strong_rand_bytes(16) |> Base.url_encode64(padding: false)

  @doc """
  The proof answer's `boot_mac`: base64url(HMAC-SHA256(token, "kotiko-boot-v1\\n" <> nonce <>
  "\\n" <> boot)), for the proof's `nonce`, so the client knows the boot id is this
  server's, for its own request.
  """
  def boot_mac(token, nonce, boot), do: mac(token, Enum.join([@boot_label, nonce, boot], "\n"))

  @doc "Whether an `Authorization` value uses this scheme."
  def signed?(value), do: String.starts_with?(value, @scheme)

  @doc """
  The header's fields, or `:error` when it isn't exactly the form above (one space after
  the scheme and each comma, the fields in this order, nothing else).
  """
  def parse(@scheme <> params) do
    case Regex.run(@params, params) do
      [_, ts, nonce, boot, body, mac] ->
        {:ok,
         %{ts: String.to_integer(ts), ts_text: ts, nonce: nonce, boot: boot, body: body, mac: mac}}

      nil ->
        :error
    end
  end

  def parse(_), do: :error

  @doc "The canonical request the MAC is made over."
  def canonical(method, path, ts_text, nonce, boot, body_hash),
    do: Enum.join([@request_label, method, path, ts_text, nonce, boot, body_hash], "\n")

  @doc "The request target as the server got it: the raw path, then `?query` if any."
  def target(%Plug.Conn{request_path: path, query_string: ""}), do: path
  def target(%Plug.Conn{request_path: path, query_string: q}), do: path <> "?" <> q

  @doc "base64url(HMAC-SHA256(token, message)), without padding."
  def mac(token, message),
    do: :hmac |> :crypto.mac(:sha256, token, message) |> Base.url_encode64(padding: false)

  @doc "The SHA-256 of `body`, as 64 lowercase hex digits."
  def body_hash(body), do: :sha256 |> :crypto.hash(body) |> Base.encode16(case: :lower)

  @doc "The `X-Kotiko-Server` value for an answer with `status` to the request `nonce`."
  def response_header(token, nonce, status),
    do: "v1 mac=" <> mac(token, Enum.join([@response_label, nonce, to_string(status)], "\n"))

  @doc """
  Checks a parsed header against `conn` and `token`. `:ok`, or `{:error, reason}`:
  `:bad_mac`, `:stale_boot` (signed for another boot of the server: before a restart),
  `:stale` (more than 120 s before or after the server's clock), `:replayed`, or `:full`
  (the nonce table is full; the request was genuine).
  """
  def verify(conn, token, %{} = h) do
    expected =
      mac(token, canonical(conn.method, target(conn), h.ts_text, h.nonce, h.boot, h.body))

    now = System.system_time(:second)

    cond do
      not Plug.Crypto.secure_compare(expected, h.mac) -> {:error, :bad_mac}
      not Plug.Crypto.secure_compare(h.boot, boot()) -> {:error, :stale_boot}
      h.ts > now + @window or h.ts < now - @window -> {:error, :stale}
      true -> remember(h.nonce, h.ts + @window + 1, now)
    end
  end

  # insert_new is atomic: of two requests with one nonce, exactly one gets in.
  defp remember(nonce, expires, now) do
    cond do
      :ets.whereis(@table) == :undefined -> {:error, :full}
      not room?(now) -> {:error, :full}
      :ets.insert_new(@table, {nonce, expires}) -> :ok
      true -> {:error, :replayed}
    end
  end

  defp room?(now) do
    max = max_nonces()
    size = :ets.info(@table, :size)
    if size >= max or (size > 0 and rem(size, @purge_every) == 0), do: purge(now)
    :ets.info(@table, :size) < max
  end

  defp max_nonces, do: Application.get_env(:kotiko, :max_nonces, @max_nonces)

  defp purge(now),
    do: :ets.select_delete(@table, [{{:_, :"$1"}, [{:<, :"$1", now}], [true]}])

  @doc "Seconds until the oldest nonce expires (for `Retry-After` when the table is full)."
  def retry_after do
    now = System.system_time(:second)

    case :ets.select(@table, [{{:_, :"$1"}, [], [:"$1"]}]) do
      [] -> 1
      ends -> max(1, Enum.min(ends) - now)
    end
  rescue
    ArgumentError -> 1
  end

  @doc """
  Marks `conn` as signed: every answer gets `X-Kotiko-Server`, and the body is checked
  against the signed hash when it is read (`check_body/2`).
  """
  def accept(conn, token, %{} = h) do
    conn
    |> put_private(:kotiko_signed, h.body)
    |> register_before_send(fn conn ->
      put_resp_header(conn, "x-kotiko-server", response_header(token, h.nonce, conn.status))
    end)
  end

  @doc """
  For a signed request, reads the whole body (at most `length` bytes) and checks its hash.
  Returns `{:ok, conn}` with the body kept for `read_body/2`, or `{:error, reason}`:
  `:too_large`, `:body_mismatch` or `:unreadable`. Any other request is returned as it is.
  """
  def check_body(%Plug.Conn{private: %{kotiko_signed: hash}} = conn, length) do
    # One read of at most `length` bytes, as Plug.Parsers reads: more is too large.
    case Plug.Conn.read_body(conn, length: length) do
      {:ok, body, conn} ->
        if Plug.Crypto.secure_compare(body_hash(body), hash),
          do: {:ok, put_private(conn, :kotiko_raw_body, body)},
          else: {:error, :body_mismatch}

      {:more, _partial, _conn} ->
        {:error, :too_large}

      {:error, _reason} ->
        {:error, :unreadable}
    end
  end

  def check_body(conn, _length), do: {:ok, conn}

  @doc """
  `Plug.Parsers`' body reader: the body `check_body/2` already read and checked, or the
  connection's own.
  """
  def read_body(%Plug.Conn{private: %{kotiko_raw_body: nil}} = conn, _opts), do: {:ok, "", conn}

  def read_body(%Plug.Conn{private: %{kotiko_raw_body: body}} = conn, _opts),
    do: {:ok, body, put_private(conn, :kotiko_raw_body, nil)}

  def read_body(conn, opts), do: Plug.Conn.read_body(conn, opts)
end
