# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Slovo.RouterAuthTest do
  # Slice 01's matrix against today's routes. The matrix is built from the lists below, so
  # a new route is added in one place. Paths stay raw (percent-encoded), as Bandit gives them.
  use Slovo.ConnCase, async: false
  import ExUnit.CaptureLog
  alias Slovo.LLMStub

  @methods ~w(GET POST DELETE PATCH)

  # Route paths after the "/api" prefix; the prefix is spelled every way in @spellings.
  @api_paths ["/words", "/words/1", "/v1/words", "/v1/words/1", "/v1/llm/status"]

  @spellings [
    "/api",
    "/%61pi",
    "/ap%69",
    "/API",
    "//api",
    "/api/../api",
    "/api/%2e%2e/api",
    "/%2561pi"
  ]

  @paths for(s <- @spellings, p <- @api_paths, do: s <> p) ++
           ["/nope", "/", "/health/x", "/%68ealth", "/he%61lth", "/HEALTH"]

  @bad_auth [
    {"no header", []},
    {"wrong token", [{"authorization", "Bearer wrong-token-0123456789abcdefghijkl"}]},
    {"lowercase bearer",
     [{"authorization", "bearer " <> Application.compile_env!(:slovo, :api_token)}]},
    {"two headers",
     [
       {"authorization", "Bearer " <> Application.compile_env!(:slovo, :api_token)},
       {"authorization", "Bearer " <> Application.compile_env!(:slovo, :api_token)}
     ]},
    {"token without scheme", [{"authorization", Application.compile_env!(:slovo, :api_token)}]},
    {"token prefix only",
     [
       {"authorization",
        "Bearer " <> String.slice(Application.compile_env!(:slovo, :api_token), 0..9)}
     ]}
  ]

  describe "without the right token" do
    for {label, headers} <- @bad_auth do
      @headers headers
      test "every method and path spelling is 401 (#{label})" do
        for method <- @methods, path <- @paths do
          conn = request(method, path, @headers)

          assert conn.status == 401,
                 "#{method} #{path} answered #{conn.status} without the right token"

          assert get_resp_header(conn, "www-authenticate") == ["Bearer"]
          assert %{"error" => %{"code" => "server_key_rejected"}} = json_body(conn)
          assert get_resp_header(conn, "access-control-allow-origin") == []
        end
      end
    end

    test "only GET and HEAD /health are open" do
      assert %{status: 200} = conn = request("GET", "/health")
      assert %{"ok" => true} = json_body(conn)
      assert %{status: 200, resp_body: ""} = request("HEAD", "/health")

      for method <- ~w(POST PUT DELETE PATCH OPTIONS) do
        assert request(method, "/health").status == 401, "#{method} /health"
      end
    end

    test "a CORS preflight gets no CORS headers" do
      conn =
        request("OPTIONS", "/api/words", [
          {"origin", "https://evil.example"},
          {"access-control-request-method", "GET"},
          {"access-control-request-headers", "authorization"}
        ])

      assert conn.status == 401
      assert get_resp_header(conn, "access-control-allow-origin") == []
    end
  end

  describe "with the right token" do
    test "no path spelling is refused or crashes" do
      for method <- @methods, path <- @paths do
        conn = request(method, path, auth())
        assert conn.status in [200, 400, 404], "#{method} #{path} answered #{conn.status}"
        assert get_resp_header(conn, "access-control-allow-origin") == []
      end
    end

    test "today's routes answer" do
      word = word_fixture(%{})

      assert %{"words" => [%{"native" => "да"}]} = json_body(request("GET", "/api/words", auth()))
      assert request("GET", "//api/words", auth()).status == 200
      assert request("GET", "/%61pi/words", auth()).status == 200
      assert request("POST", "/api/words", auth(), body: %{}).status == 400
      assert request("DELETE", "/api/words/#{word.id}", auth()).status == 200
      assert request("DELETE", "/api/words/#{word.id}", auth()).status == 404
    end

    test "malformed ids are 404, never 500" do
      for id <- ["99999999999999999999999", "1234567890123456789", "-1", "1.5", "abc", "1%0A"] do
        conn = request("DELETE", "/api/words/#{id}", auth())
        assert conn.status == 404, "DELETE /api/words/#{id} answered #{conn.status}"
      end
    end

    test "an exception in a route is a 500 with a JSON error, not an empty body" do
      LLMStub.stub(fn _model, _conn -> raise "boom" end)

      log =
        capture_log(fn ->
          send(self(), request_raising("POST", "/api/words", auth(), body: %{text: "shukran"}))
        end)

      assert_received {status, _headers, body}
      assert log =~ "boom"

      assert status == 500

      assert %{"error" => "Something went wrong in Slovo. Check the server log for ref " <> _} =
               Jason.decode!(body)
    end
  end

  describe "request bodies" do
    @big Jason.encode!(%{text: String.duplicate("a", 70_000)})

    test "are parsed only after auth" do
      assert request("POST", "/api/words", [], body: @big).status == 401
      assert request("POST", "/api/words", [], body: "{not json").status == 401
      assert request("POST", "/%61pi/words", [], body: "{not json").status == 401
    end

    test "over 64 KB are refused with 413" do
      assert {413, _, body} = request_raising("POST", "/api/words", auth(), body: @big)

      assert %{"error" => "That request is too large."} = Jason.decode!(body)
    end

    test "malformed JSON from an authenticated client is a 400" do
      assert {400, _, _} = request_raising("POST", "/api/words", auth(), body: "{not json")
    end
  end

  describe "Host header" do
    test "an unknown name gets 421 with or without a token, on every route" do
      for path <- ["/health", "/api/words"], headers <- [[], auth()] do
        conn = request("GET", path, headers, host: "evil.example")
        assert conn.status == 421

        assert %{
                 "error" => %{
                   "code" => "server_address_invalid",
                   "details" => %{"reason" => "host_not_allowed"}
                 }
               } = json_body(conn)
      end
    end

    test "localhost and IP literals pass" do
      for host <- [
            "localhost",
            "127.0.0.1",
            "[::1]",
            "LOCALHOST.",
            "192.168.1.5",
            "100.101.102.103"
          ] do
        assert request("GET", "/health", [], host: host).status == 200, host
      end
    end
  end
end
