# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.RouterPropertyTest do
  # Dynamic analysis (OpenSSF dynamic_analysis): requests with generated bodies and query
  # strings, as a buggy or hostile client could send them, through the whole router
  # (token check, body parsing, /api/v1). The server answers each one; a mistake in the
  # request is a 4xx with slice 25's error shape, never a 500.
  use Kotiko.ConnCase, async: false
  use ExUnitProperties
  import ExUnit.CaptureLog
  alias Kotiko.{Gen, LLMStub}

  # Each run touches the database, so fewer runs than a pure property.
  @runs 60

  setup do
    LLMStub.stub(fn _, conn -> LLMStub.answer(conn, LLMStub.words([LLMStub.word()], "add")) end)
    :ok
  end

  defp send_request(method, path, body) do
    opts = if body == nil, do: [], else: [body: body]
    {conn, _log} = with_log(fn -> request(method, path, auth(), opts) end)
    conn
  end

  defp assert_answered(conn) do
    assert conn.status in 200..499, "#{conn.status}: #{conn.resp_body}"

    if conn.status >= 400 do
      assert %{"error" => %{"code" => code, "message" => message}} = json_body(conn)
      assert is_binary(code) and is_binary(message)
    end
  end

  defp request_id do
    frequency([
      {3, constant(nil)},
      {3, map(constant(nil), fn _ -> Ecto.UUID.generate() end)},
      {1, Gen.scalar()}
    ])
  end

  property "POST /api/v1/words: any word object or body is answered without a 500" do
    check all(
            body <-
              one_of([
                fixed_map(%{"word" => Gen.word(), "client_request_id" => request_id()}),
                Gen.object(
                  ~w(word text base_langs hint_lang preview client_request_id),
                  Gen.json()
                )
              ]),
            max_runs: @runs
          ) do
      assert_answered(send_request("POST", "/api/v1/words", body))
    end
  end

  property "POST /api/v1/words/batch: any list of words is answered per word" do
    check all(
            words <- list_of(frequency([{4, Gen.word()}, {1, Gen.json()}]), max_length: 4),
            max_runs: @runs
          ) do
      conn = send_request("POST", "/api/v1/words/batch", %{"words" => words})
      assert_answered(conn)

      if conn.status == 200 do
        %{"results" => results, "rejected" => rejected} = json_body(conn)
        indexes = Enum.map(results ++ rejected, & &1["index"])
        # Every word is either saved (one result per base) or rejected, by its index.
        assert Enum.uniq(indexes) |> Enum.sort() == Enum.to_list(0..(length(words) - 1)//1)
      end
    end
  end

  property "PATCH /api/v1/words/:id: any patch body is applied or refused with a 4xx" do
    word = word_fixture()

    check all(
            body <-
              Gen.object(
                ~w(lang native sense romanization native_vocalized gloss forms
                             pronunciation pronunciation_careful pronunciation_source note
                             status if_updated_at),
                Gen.json()
              ),
            max_runs: @runs
          ) do
      assert_answered(send_request("PATCH", "/api/v1/words/#{word.uuid}", body))
    end
  end

  property "PUT /api/v1/profile and the job control: any body gets a 200 or a 400" do
    check all(
            body <- Gen.object(~w(base_langs locale action), Gen.json()),
            path <- member_of(["/api/v1/profile", "/api/v1/jobs/pronunciation-refresh"]),
            max_runs: @runs
          ) do
      method = if path == "/api/v1/profile", do: "PUT", else: "POST"
      conn = send_request(method, path, body)
      assert_answered(conn)
      assert conn.status in [200, 400]
    end
  end

  property "GET /api/v1/words: any query string is answered without a 500" do
    key = member_of(~w(lang base status limit include download))
    shape = member_of(["~s=~s", "~s[]=~s", "~s[x]=~s", "~s"])

    check all(
            params <- list_of(tuple({key, shape, Gen.text(max_length: 10)}), max_length: 4),
            max_runs: @runs
          ) do
      query =
        Enum.map_join(params, "&", fn {k, s, v} ->
          :io_lib.format(
            s,
            [k, URI.encode_www_form(v)] |> Enum.take(if s == "~s", do: 1, else: 2)
          )
          |> IO.iodata_to_binary()
        end)

      for path <- ["/api/v1/words?" <> query, "/api/v1/export?" <> query, "/api/words?" <> query] do
        assert_answered(send_request("GET", path, nil))
      end
    end
  end

  describe "regressions the properties found" do
    # lang[]=ru reaches the router as a list; String.split/3 raised and the client got a 500.
    test "a repeated or nested query parameter is a 400 naming it, not a 500" do
      for {query, field} <- [
            {"lang[]=ru", "lang"},
            {"base[x]=en", "base"},
            {"status[]=active", "status"},
            {"limit[]=5", "limit"}
          ] do
        conn = send_request("GET", "/api/v1/words?" <> query, nil)
        assert conn.status == 400, query

        assert %{"error" => %{"code" => "invalid_request", "details" => %{"field" => ^field}}} =
                 json_body(conn)
      end

      conn = send_request("GET", "/api/v1/export?include[]=pending", nil)
      assert conn.status == 400
      assert json_body(conn)["error"]["details"] == %{"field" => "include"}
    end

    # Å is C3 85 in UTF-8; a byte-mode \v matched the 85 (see word_spec_test.exs).
    test "a lookup of a word with Å reaches the model instead of failing with a 500" do
      conn = send_request("POST", "/api/v1/words", %{"text" => "Åland", "base_langs" => ["en"]})
      assert conn.status == 200
      assert [_ | _] = LLMStub.requests()
    end
  end
end
