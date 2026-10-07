# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.RouterSignedTest do
  # Signed requests (slice 54, D-01): the extension never sends the token; it signs each
  # request with it (Kotiko.RequestAuth), and the server signs every answer to a signed
  # request, so a program that took the port while the server was stopped gets nothing it
  # can use, and is found out at its first answer.
  use Kotiko.ConnCase, async: false
  import ExUnit.CaptureLog
  alias Kotiko.RequestAuth

  @root Path.expand("../../..", __DIR__)

  setup do
    RequestAuth.reset()
    Kotiko.AuthThrottle.reset()
    on_exit(fn -> RequestAuth.reset() end)
    :ok
  end

  # The headers of a request signed with `token`, as the extension makes them.
  defp sign(method, target, body, opts \\ []) do
    token = Keyword.get(opts, :token, token())
    ts = Keyword.get(opts, :ts, System.system_time(:second)) |> to_string()

    nonce =
      Keyword.get(opts, :nonce, Base.url_encode64(:crypto.strong_rand_bytes(16), padding: false))

    hash = RequestAuth.body_hash(Keyword.get(opts, :signed_body, body))
    mac = RequestAuth.mac(token, RequestAuth.canonical(method, target, ts, nonce, hash))

    {[{"authorization", "Kotiko-HMAC v1 ts=#{ts}, nonce=#{nonce}, body=#{hash}, mac=#{mac}"}],
     nonce}
  end

  # Sends a signed request; returns the conn and its nonce.
  defp signed(method, target, body \\ nil, opts \\ []) do
    {encoded, req_opts} =
      case body do
        nil -> {"", []}
        b when is_map(b) -> {Jason.encode!(b), [body: Jason.encode!(b)]}
        b -> {b, [body: b]}
      end

    {headers, nonce} = sign(method, target, encoded, opts)

    conn =
      method
      |> build_signed(target, headers ++ Keyword.get(opts, :headers, []), req_opts)
      |> Map.put(:remote_ip, Keyword.get(opts, :ip, {127, 0, 0, 1}))
      |> Kotiko.Router.call(Kotiko.Router.init([]))

    {conn, nonce}
  end

  defp build_signed(method, target, headers, opts) do
    {body, headers} =
      case Keyword.get(opts, :body) do
        nil -> {nil, headers}
        b -> {b, [{"content-type", "application/json"} | headers]}
      end

    conn = Plug.Test.conn(method, "http://localhost" <> target, body)
    %{conn | req_headers: conn.req_headers ++ headers}
  end

  defp server_header(conn, nonce),
    do:
      get_resp_header(conn, "x-kotiko-server") == [
        RequestAuth.response_header(token(), nonce, conn.status)
      ]

  describe "the scheme" do
    # The same vectors are in docs/reference/http-api.md and the extension's tests
    # (test/unit/server-auth.test.mjs).
    test "matches the examples in docs/reference/http-api.md" do
      token = "example-token-0123456789abcdef"
      body = ~s({"base_langs":["es","en"],"ui_lang":null})
      hash = RequestAuth.body_hash(body)
      assert hash == "40921055f301e073c3aa377b5ac7d8827ce72c5443e994014c2087b2895f51ff"

      canonical =
        RequestAuth.canonical(
          "PUT",
          "/api/v1/profile",
          "1791331200",
          "q1aP3n0ZKcB1x5mW0u7S9b",
          hash
        )

      assert canonical ==
               "kotiko-req-v1\nPUT\n/api/v1/profile\n1791331200\nq1aP3n0ZKcB1x5mW0u7S9b\n" <> hash

      assert RequestAuth.mac(token, canonical) == "osa_O2pBaygJz8c64WTOrTLSiY_6vV70NHtPyZ2CZpA"

      assert RequestAuth.response_header(token, "q1aP3n0ZKcB1x5mW0u7S9b", 200) ==
               "v1 mac=CAmhh5A5suXJTIJNSarztt97Q-RO5eA9K0baiuiw1u0"

      empty = RequestAuth.body_hash("")

      get =
        RequestAuth.canonical(
          "GET",
          "/api/v1/words?status=active,paused",
          "1791331200",
          "dE8gH0iL2nO4pQ6rS8tU0v",
          empty
        )

      assert empty == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      assert RequestAuth.mac(token, get) == "uHVRpP6SeDO3nxpRjs_zp8V9NYSCV2XP15w9BtwCdPg"

      doc = File.read!(Path.join(@root, "docs/reference/http-api.md"))

      for value <- [
            "osa_O2pBaygJz8c64WTOrTLSiY_6vV70NHtPyZ2CZpA",
            "CAmhh5A5suXJTIJNSarztt97Q-RO5eA9K0baiuiw1u0",
            "uHVRpP6SeDO3nxpRjs_zp8V9NYSCV2XP15w9BtwCdPg",
            hash
          ],
          do: assert(doc =~ value, value)
    end

    test "a valid signed request is answered, and the answer is signed" do
      word_fixture()
      {conn, nonce} = signed("GET", "/api/v1/words?status=active")

      assert conn.status == 200
      assert [%{"native" => "да"}] = json_body(conn)["words"]
      assert server_header(conn, nonce)
      # The answer's MAC is over the nonce and the status, under the token.
      assert [
               "v1 mac=" <>
                 RequestAuth.mac(token(), "kotiko-resp-v1\n#{nonce}\n200")
             ] == get_resp_header(conn, "x-kotiko-server")
    end

    test "a request with a body: the body is checked against the signed hash" do
      body = %{word: %{lang: "ru", native: "кот", base_lang: "en", gloss: "cat"}}
      {conn, nonce} = signed("POST", "/api/v1/words", body)
      assert conn.status == 200
      assert [%{"result" => "created"}] = json_body(conn)["results"]
      assert server_header(conn, nonce)
    end

    test "a tampered body is refused, and nothing is saved" do
      before = length(Kotiko.Words.list([]))

      signed_body =
        Jason.encode!(%{word: %{lang: "ru", native: "кот", base_lang: "en", gloss: "cat"}})

      sent = %{word: %{lang: "ru", native: "пёс", base_lang: "en", gloss: "dog"}}

      {conn, _nonce} = signed("POST", "/api/v1/words", sent, signed_body: signed_body)

      assert conn.status == 401

      assert get_resp_header(conn, "www-authenticate") == [
               ~s(Bearer, Kotiko-HMAC error="body_mismatch")
             ]

      assert %{"code" => "server_key_rejected", "details" => %{"reason" => "body_mismatch"}} =
               json_body(conn)["error"]

      assert length(Kotiko.Words.list([])) == before
    end

    test "a wrong MAC, another token, another path or method: 401, unsigned" do
      cases = [
        {"another token",
         fn -> signed("GET", "/api/v1/words", nil, token: "another-token-0123456789abcdefgh") end},
        {"a MAC for another path",
         fn ->
           {[{_, value}], _} = sign("GET", "/api/v1/profile", "")
           {request("GET", "/api/v1/words", [{"authorization", value}]), nil}
         end},
        {"a MAC for another method",
         fn ->
           {[{_, value}], _} = sign("GET", "/api/v1/words/" <> Ecto.UUID.generate(), "")

           {request("DELETE", "/api/v1/words/" <> Ecto.UUID.generate(), [{"authorization", value}]),
            nil}
         end},
        {"a MAC for another query",
         fn ->
           {[{_, value}], _} = sign("GET", "/api/v1/words?status=active", "")
           {request("GET", "/api/v1/words?status=paused", [{"authorization", value}]), nil}
         end}
      ]

      for {label, run} <- cases do
        {conn, _} = run.()
        assert conn.status == 401, label

        assert get_resp_header(conn, "www-authenticate") == [
                 ~s(Bearer, Kotiko-HMAC error="bad_mac")
               ],
               label

        assert get_resp_header(conn, "x-kotiko-server") == [], label
      end
    end

    test "a stale or future ts, or one from before the server started, is refused" do
      now = System.system_time(:second)

      for ts <- [now - 121, now + 121, 0] do
        {conn, _} = signed("GET", "/api/v1/words", nil, ts: ts)
        assert conn.status == 401, "ts #{ts}"

        assert get_resp_header(conn, "www-authenticate") == [
                 ~s(Bearer, Kotiko-HMAC error="stale")
               ]
      end

      for ts <- [now - 119, now + 119] do
        assert {%{status: 200}, _} = signed("GET", "/api/v1/words", nil, ts: ts)
      end

      # A request made before this server started (one a squatter kept while the server was
      # stopped) is refused even inside the window: the restarted server forgot its nonces.
      RequestAuth.reset(now)
      assert {%{status: 401}, _} = signed("GET", "/api/v1/words", nil, ts: now - 1)
      assert {%{status: 200}, _} = signed("GET", "/api/v1/words", nil, ts: now)
    end

    test "a nonce is accepted once" do
      nonce = "replayed_nonce-0123456789"
      assert {%{status: 200}, _} = signed("GET", "/api/v1/words", nil, nonce: nonce)
      {conn, _} = signed("GET", "/api/v1/words", nil, nonce: nonce)
      assert conn.status == 401

      assert get_resp_header(conn, "www-authenticate") == [
               ~s(Bearer, Kotiko-HMAC error="replayed")
             ]

      # Even with another method and path: the nonce is spent.
      assert {%{status: 401}, _} = signed("GET", "/api/v1/profile", nil, nonce: nonce)
    end

    test "a failed MAC doesn't spend the nonce, so strangers can't fill the table" do
      nonce = "kept_nonce-0123456789abcd"

      assert {%{status: 401}, _} =
               signed("GET", "/api/v1/words", nil,
                 nonce: nonce,
                 token: "x-token-0123456789abcdefghijk"
               )

      assert {%{status: 200}, _} = signed("GET", "/api/v1/words", nil, nonce: nonce)
    end

    test "when the nonce table is full, new signed requests are refused (signed 429), never forgotten" do
      put_app_env(:max_nonces, 3)
      for _ <- 1..3, do: assert({%{status: 200}, _} = signed("GET", "/api/v1/words"))

      {conn, nonce} = signed("GET", "/api/v1/words")
      assert conn.status == 429

      assert %{"code" => "rate_limited", "details" => %{"reason" => "too_many_requests"}} =
               json_body(conn)["error"]

      assert [retry] = get_resp_header(conn, "retry-after")
      assert String.to_integer(retry) in 1..241
      assert server_header(conn, nonce)
      # Bearer still works.
      assert request("GET", "/api/v1/words", auth()).status == 200
    end

    test "malformed headers are 401 and don't count as guesses" do
      put_app_env(:auth_failures_per_minute, 2)
      {[{_, good}], _} = sign("GET", "/api/v1/words", "")

      for bad <- [
            "Kotiko-HMAC",
            "Kotiko-HMAC v2 " <> String.replace_prefix(good, "Kotiko-HMAC v1 ", ""),
            String.replace(good, ", ", ","),
            String.replace(good, "body=", "hash="),
            good <> ", extra=1",
            String.replace(good, ~r/nonce=[^,]+/, "nonce=short"),
            "kotiko-hmac " <> String.replace_prefix(good, "Kotiko-HMAC ", "")
          ] do
        conn = request("GET", "/api/v1/words", [{"authorization", bad}])
        assert conn.status == 401, bad
      end

      for _ <- 1..5 do
        conn =
          Plug.Test.conn("GET", "http://localhost/api/v1/words")
          |> Map.put(:remote_ip, {203, 0, 113, 50})
          |> put_req_header("authorization", "Kotiko-HMAC v1 nonsense")
          |> Kotiko.Router.call(Kotiko.Router.init([]))

        assert get_resp_header(conn, "www-authenticate") == [
                 ~s(Bearer, Kotiko-HMAC error="malformed")
               ]
      end

      assert {%{status: 200}, _} = signed("GET", "/api/v1/words", nil, ip: {203, 0, 113, 50})
    end

    test "a failed signature counts towards the lockout like a wrong token (not from loopback)" do
      put_app_env(:auth_failures_per_minute, 10)
      ip = {203, 0, 113, 60}

      capture_log(fn ->
        for _ <- 1..10 do
          assert {%{status: 401}, _} =
                   signed("GET", "/api/v1/words", nil,
                     ip: ip,
                     token: "x-token-0123456789abcdefghijk"
                   )
        end
      end)

      assert {%{status: 429}, _} = signed("GET", "/api/v1/words", nil, ip: ip)
      assert {%{status: 200}, _} = signed("GET", "/api/v1/words", nil, ip: {198, 51, 100, 60})
    end

    test "errors after the check are signed too: 404, 413, 415, 400" do
      {conn, nonce} = signed("GET", "/api/v1/nope")
      assert conn.status == 404
      assert server_header(conn, nonce)

      {conn, nonce} = signed("GET", "/api/v1/words/" <> Ecto.UUID.generate())
      assert conn.status == 404
      assert server_header(conn, nonce)

      for {body, headers, status} <- [
            {String.duplicate("x", 70_000), [], 413},
            {"text=hi", [{"content-type", "application/x-www-form-urlencoded"}], 415},
            {"{not json", [], 400}
          ] do
        {[{_, value}], nonce} = sign("POST", "/api/v1/words", body)

        conn =
          Plug.Test.conn("POST", "http://localhost/api/v1/words", body)
          |> then(&%{&1 | req_headers: &1.req_headers ++ headers})
          |> then(fn c ->
            if headers == [], do: put_req_header(c, "content-type", "application/json"), else: c
          end)
          |> put_req_header("authorization", value)

        {Plug.Adapters.Test.Conn, %{ref: ref}} = conn.adapter

        try do
          Kotiko.Router.call(conn, Kotiko.Router.init([]))
        rescue
          _ -> :ok
        end

        assert_received {^ref, {^status, resp_headers, _body}}

        assert {"x-kotiko-server", RequestAuth.response_header(token(), nonce, status)} in resp_headers,
               "#{status}"
      end
    end
  end

  # Every route the server has (read from the router sources, as docs_test does), signed:
  # none answers 401, and every answer carries the server's signature. So a new route can't
  # skip the check, and no route is left that only takes `Bearer`.
  describe "every route" do
    @route ~r/^\s*(get|post|put|patch|delete)\s+"(\/[^"]*)"/m
    @forward ~r/^\s*forward\s+"(\/[^"]*)",\s*to:\s*([\w.]+)/m

    defp routes(file, prefix \\ "") do
      source = File.read!(file)

      own =
        for [_, verb, path] <- Regex.scan(@route, source),
            do: {String.upcase(verb), prefix <> path}

      forwarded =
        for [_, path, "Kotiko." <> name] <- Regex.scan(@forward, source) do
          routes(
            Path.join(@root, "server/lib/kotiko/#{Macro.underscore(name)}.ex"),
            prefix <> path
          )
        end

      own ++ List.flatten(forwarded)
    end

    test "answer a signed request, sign their answer, and refuse it unsigned" do
      w = word_fixture()
      all = routes(Path.join(@root, "server/lib/kotiko/router.ex"))
      assert {"PATCH", "/api/v1/words/:id"} in all
      assert {"DELETE", "/api/words/:id"} in all

      for {method, path} <- all, path not in ["/health", "/api/v1/proof"] do
        target =
          path
          |> String.replace(
            ":id",
            if(String.starts_with?(path, "/api/v1"), do: w.uuid, else: "#{w.id}")
          )

        body = if method in ~w(POST PUT PATCH DELETE), do: body_for(method, path)

        {conn, nonce} = signed(method, target, body)
        refute conn.status == 401, "#{method} #{path} refused a signed request"
        assert server_header(conn, nonce), "#{method} #{path} didn't sign its answer"

        unsigned = request(method, target, [], if(body, do: [body: body], else: []))
        assert unsigned.status == 401, "#{method} #{path} answered without auth"
      end
    end

    defp body_for("PUT", "/api/v1/profile"), do: %{base_langs: ["en"]}
    defp body_for("PATCH", _), do: %{note: "signed"}
    defp body_for("DELETE", "/api/v1/words"), do: %{confirm: "nope"}
    defp body_for("POST", "/api/v1/jobs/pronunciation-refresh"), do: %{action: "pause"}
    defp body_for("POST", "/api/v1/words/batch"), do: %{words: []}

    defp body_for("POST", "/api/v1/words"),
      do: %{word: %{lang: "ru", native: "кот", base_lang: "en", gloss: "cat"}}

    defp body_for("POST", "/api/words"), do: %{}
    defp body_for(_, _), do: %{}
  end
end
