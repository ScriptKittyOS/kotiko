# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Slovo.LLMStub do
  @moduledoc """
  Req.Test stand-in for the OpenAI-compatible model API. Every request is reported to
  the test process as `{:llm_request, model, body, headers}`, so tests can count calls
  per model.

      LLMStub.stub(fn
        "m1", conn -> LLMStub.rate_limited(conn)
        _model, conn -> LLMStub.answer(conn, LLMStub.words([LLMStub.word()]))
      end)
  """
  alias Plug.Conn

  def stub(fun) do
    test = self()

    Req.Test.stub(Slovo.LLM, fn conn ->
      {:ok, raw, conn} = Conn.read_body(conn)
      body = Jason.decode!(raw)
      send(test, {:llm_request, body["model"], body, conn.req_headers})
      fun.(body["model"], conn)
    end)
  end

  @doc "Models asked so far, oldest first. Empties the mailbox of requests."
  def requests do
    receive do
      {:llm_request, model, _body, _headers} -> [model | requests()]
    after
      0 -> []
    end
  end

  @doc "A 200 answer whose message content is `content` (a map is encoded as JSON)."
  def answer(conn, content) when is_map(content), do: answer(conn, Jason.encode!(content))

  def answer(conn, content) when is_binary(content) do
    Req.Test.json(conn, %{choices: [%{message: %{role: "assistant", content: content}}]})
  end

  def rate_limited(conn) do
    conn
    |> Conn.put_status(429)
    |> Req.Test.json(%{error: %{message: "Rate limit exceeded: free-models-per-min"}})
  end

  def status(conn, status, message \\ "error") do
    conn |> Conn.put_status(status) |> Req.Test.json(%{error: %{message: message}})
  end

  @doc "The model stops answering: Req sees a receive timeout."
  def stall(conn), do: Req.Test.transport_error(conn, :timeout)

  def words(words, intent \\ "lookup"), do: %{intent: intent, words: words}

  def word(attrs \\ %{}) do
    Map.merge(
      %{
        "lang" => "ru",
        "language" => "Russian",
        "native" => "да",
        "romanization" => "da",
        "english" => "yes",
        "english_forms" => ["yes"],
        "note" => "The everyday yes."
      },
      Map.new(attrs, fn {k, v} -> {to_string(k), v} end)
    )
  end
end
