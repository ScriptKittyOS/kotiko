# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.RouterProofTest do
  # POST /api/v1/proof (slice 54, B-01): before it sends the token to an address, the
  # extension can ask the server to prove it holds the token, without either side sending
  # it. Another program listening at that address can't answer.
  use Kotiko.ConnCase, async: false

  @nonce "n0nce_from-the-extension_0123456789abcdef"

  defp expected(token, nonce) do
    :crypto.mac(:hmac, :sha256, token, "kotiko-proof-v1:" <> nonce)
    |> Base.url_encode64(padding: false)
  end

  defp prove(body, opts \\ []) do
    conn = build_conn(body, opts)
    Kotiko.Router.call(conn, Kotiko.Router.init([]))
  end

  defp build_conn(body, opts) do
    conn =
      Plug.Test.conn("POST", "http://localhost/api/v1/proof", Jason.encode!(body))
      |> Plug.Conn.put_req_header("content-type", "application/json")

    %{conn | remote_ip: Keyword.get(opts, :ip, {127, 0, 0, 1})}
  end

  test "answers HMAC-SHA256(token, \"kotiko-proof-v1:\" <> nonce), without a token" do
    conn = prove(%{nonce: @nonce})

    assert conn.status == 200
    assert json_body(conn) == %{"proof" => expected(token(), @nonce)}
    refute conn.resp_body =~ token()
    assert get_resp_header(conn, "cache-control") == ["no-store"]
  end

  test "matches the example in docs/reference/http-api.md" do
    assert Kotiko.Token.proof(
             "example-token-0123456789abcdef",
             "q1aP3n0ZKcB1x5mW0u7S9bJ2rV4yT6dE8gH0iL2nO4p"
           ) == "E5CHaF60VqTTPPduGD1yAlfWMF5xf9_hmV2qCufV-ek"
  end

  test "the proof depends on the token: another token gives another proof" do
    other = "another-token-0123456789abcdefghijklmn"
    refute json_body(prove(%{nonce: @nonce}))["proof"] == expected(other, @nonce)
    put_app_env(:api_token, other)
    assert json_body(prove(%{nonce: @nonce}))["proof"] == expected(other, @nonce)
  end

  test "the nonce must be 32 to 128 base64url characters" do
    for nonce <- [
          String.duplicate("a", 31),
          String.duplicate("a", 129),
          String.duplicate("a", 40) <> "=",
          String.duplicate("a", 40) <> "+/",
          String.duplicate("é", 40),
          42,
          nil
        ] do
      conn = prove(%{nonce: nonce})
      assert conn.status == 400, inspect(nonce)

      assert %{"code" => "invalid_request", "details" => %{"field" => "nonce"}} =
               json_body(conn)["error"]
    end

    assert prove(%{}).status == 400
    assert prove(%{nonce: String.duplicate("A", 32)}).status == 200
    assert prove(%{nonce: String.duplicate("-", 128)}).status == 200
  end

  test "only POST, only this exact path, and a small body" do
    # Another method, or a percent-encoded spelling, still needs the token.
    assert request("GET", "/api/v1/proof").status == 401
    assert request("POST", "/%61pi/v1/proof", [], body: %{nonce: @nonce}).status == 401
    assert request("POST", "/api/v1/pro%6Ff", [], body: %{nonce: @nonce}).status == 401

    {status, _headers, _body} =
      request_raising("POST", "/api/v1/proof", [],
        body: %{nonce: @nonce, pad: String.duplicate("x", 2_000)}
      )

    assert status == 413
  end

  test "an unknown Host is refused before the proof" do
    conn = request("POST", "/api/v1/proof", [], body: %{nonce: @nonce}, host: "evil.example")
    assert conn.status == 421
  end

  test "at most proof_requests_per_minute from one address, then 429 with Retry-After" do
    put_app_env(:proof_requests_per_minute, 3)
    ip = {10, 77, 0, System.unique_integer([:positive]) |> rem(250)}

    for _ <- 1..3, do: assert(prove(%{nonce: @nonce}, ip: ip).status == 200)
    conn = prove(%{nonce: @nonce}, ip: ip)

    assert conn.status == 429

    assert %{"code" => "rate_limited", "details" => %{"reason" => "too_many_proofs"}} =
             json_body(conn)["error"]

    assert [retry] = get_resp_header(conn, "retry-after")
    assert String.to_integer(retry) in 1..60
    # Another address is unaffected.
    assert prove(%{nonce: @nonce}, ip: {10, 78, 0, 1}).status == 200
  end
end
