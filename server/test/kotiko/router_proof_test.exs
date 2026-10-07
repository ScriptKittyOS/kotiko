# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.RouterProofTest do
  # POST /api/v1/proof (slice 54, B-01): before it sends the token to an address, the
  # extension can ask the server to prove it holds the token, without either side sending
  # it. Another program listening at that address can't answer.
  use Kotiko.ConnCase, async: false

  @nonce "n0nce_from-the-extension_0123456789abcdef"

  setup do
    Kotiko.RateLimit.reset()
    on_exit(&Kotiko.RateLimit.reset/0)
  end

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

  # Slice 54, D-02: a web page can send POSTs with no Content-Type or a text one (no CORS
  # needed), and every local program shares 127.0.0.1, so neither may use up the proofs.
  test "a proof needs Content-Type: application/json (415), checked before counting" do
    conn =
      Plug.Test.conn("POST", "http://localhost/api/v1/proof", Jason.encode!(%{nonce: @nonce}))
      |> Kotiko.Router.call(Kotiko.Router.init([]))

    assert conn.status == 415

    assert %{"code" => "invalid_request", "details" => %{"reason" => "content_type"}} =
             json_body(conn)["error"]
  end

  test "31 malformed proofs from one address, then a JSON proof: 200 (only good nonces count)" do
    put_app_env(:proof_requests_per_minute, 30)
    ip = {10, 79, 0, 1}

    for i <- 1..31 do
      malformed =
        case rem(i, 3) do
          # What a page's no-cors fetch with a Blob sends: no Content-Type at all.
          0 ->
            Plug.Test.conn("POST", "http://localhost/api/v1/proof", "x")

          # A bad nonce, as JSON.
          1 ->
            build_conn(%{nonce: "short"}, ip: ip)

          # A nonce that isn't a string.
          2 ->
            build_conn(%{nonce: 42}, ip: ip)

            build_conn(%{}, ip: ip)
            |> Map.put(:body_params, %Plug.Conn.Unfetched{aspect: :body_params})
        end

      conn = Kotiko.Router.call(%{malformed | remote_ip: ip}, Kotiko.Router.init([]))
      assert conn.status in [400, 415]
    end

    assert prove(%{nonce: @nonce}, ip: ip).status == 200
  end

  test "this computer's addresses aren't limited; others are" do
    put_app_env(:proof_requests_per_minute, 3)

    for ip <- [
          {127, 0, 0, 1},
          {127, 8, 0, 2},
          {0, 0, 0, 0, 0, 0, 0, 1},
          {0, 0, 0, 0, 0, 0xFFFF, 0x7F00, 1}
        ] do
      for _ <- 1..10, do: assert(prove(%{nonce: @nonce}, ip: ip).status == 200, inspect(ip))
    end

    ip = {192, 168, 7, 7}
    for _ <- 1..3, do: assert(prove(%{nonce: @nonce}, ip: ip).status == 200)
    assert prove(%{nonce: @nonce}, ip: ip).status == 429
  end

  test "proofs through a reverse proxy on this computer are limited together; the extension's aren't" do
    put_app_env(:proof_requests_per_minute, 3)

    via_proxy = fn forwarded_for ->
      build_conn(%{nonce: @nonce}, ip: {127, 0, 0, 1})
      |> Plug.Conn.put_req_header("x-forwarded-for", forwarded_for)
      |> Kotiko.Router.call(Kotiko.Router.init([]))
    end

    for i <- 1..3, do: assert(via_proxy.("203.0.113.#{i}").status == 200)
    assert via_proxy.("203.0.113.99").status == 429
    # The extension, on the same address without a forwarding header, isn't limited.
    for _ <- 1..10, do: assert(prove(%{nonce: @nonce}, ip: {127, 0, 0, 1}).status == 200)
  end

  test "with TRUSTED_PROXY_HEADER, proofs through the proxy are limited per client (E-02)" do
    put_app_env(:proof_requests_per_minute, 3)
    put_app_env(:trusted_proxy_header, "x-real-ip")

    via_proxy = fn client ->
      build_conn(%{nonce: @nonce}, ip: {127, 0, 0, 1})
      |> Plug.Conn.put_req_header("x-real-ip", client)
      |> Kotiko.Router.call(Kotiko.Router.init([]))
    end

    for _ <- 1..3, do: assert(via_proxy.("203.0.113.9").status == 200)
    assert via_proxy.("203.0.113.9").status == 429
    assert via_proxy.("198.51.100.7").status == 200
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
