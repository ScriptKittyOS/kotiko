# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.LLMStub do
  @moduledoc """
  Req.Test stand-in for the OpenAI-compatible model API. Every chat request is reported
  to the test process as `{:llm_request, model, body, headers}`, so tests can count calls
  per model; `GET /key` and `GET /models` (OpenRouter) as `{:llm_get, path}`.

      LLMStub.stub(fn
        "m1", conn -> LLMStub.rate_limited(conn)
        _model, conn -> LLMStub.answer(conn, LLMStub.words([LLMStub.word()]))
      end)

  Each `stub/2` also starts the lookup client fresh: no model health, no known quota.
  Options: `key:` the `/key` answer's `free_model_daily_requests` (a map) or a function
  of the conn; `models:` the `/models` answer's `data` (a list) or a function of the conn.
  """
  alias Plug.Conn

  def stub(fun, opts \\ []) do
    test = self()
    Kotiko.LLM.Catalog.reset(entries: true)
    Kotiko.LLM.Quota.reset()

    Req.Test.stub(Kotiko.LLM, fn
      %{method: "GET", request_path: path} = conn ->
        send(test, {:llm_get, path})
        get(conn, path, opts)

      conn ->
        {:ok, raw, conn} = Conn.read_body(conn)
        body = Jason.decode!(raw)
        send(test, {:llm_request, body["model"], body, conn.req_headers})
        fun.(body["model"], conn)
    end)
  end

  defp get(conn, path, opts) do
    cond do
      String.ends_with?(path, "/key") ->
        case opts[:key] do
          f when is_function(f, 1) -> f.(conn)
          nil -> Req.Test.json(conn, %{data: %{label: "test"}})
          daily -> Req.Test.json(conn, %{data: %{free_model_daily_requests: daily}})
        end

      String.ends_with?(path, "/models") ->
        case opts[:models] do
          f when is_function(f, 1) -> f.(conn)
          list -> Req.Test.json(conn, %{data: list || []})
        end

      true ->
        status(conn, 404, "not found")
    end
  end

  @doc "GET requests (`/key`, `/models`) so far, oldest first. Empties them from the mailbox."
  def gets do
    receive do
      {:llm_get, path} -> [path | gets()]
    after
      0 -> []
    end
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

  @doc "OpenRouter's own per-minute limit, as the body says it (no rate-limit headers)."
  def rate_limited(conn) do
    conn
    |> Conn.put_status(429)
    |> Req.Test.json(%{error: %{message: "Rate limit exceeded: free-models-per-min"}})
  end

  @doc "OpenRouter's own limit with its headers; `reset_in_ms` from now."
  def platform_429(conn, remaining, reset_in_ms, retry_after \\ nil) do
    reset = System.system_time(:millisecond) + reset_in_ms

    conn
    |> Conn.put_resp_header("x-ratelimit-limit", "20")
    |> Conn.put_resp_header("x-ratelimit-remaining", to_string(remaining))
    |> Conn.put_resp_header("x-ratelimit-reset", to_string(reset))
    |> then(
      &if(retry_after,
        do: Conn.put_resp_header(&1, "retry-after", to_string(retry_after)),
        else: &1
      )
    )
    |> Conn.put_status(429)
    |> Req.Test.json(%{error: %{message: "Rate limit exceeded: free-models-per-min", code: 429}})
  end

  @doc "A provider behind OpenRouter is busy (no rate-limit headers; metadata names it)."
  def upstream_429(conn) do
    conn
    |> Conn.put_status(429)
    |> Req.Test.json(%{
      error: %{
        message: "This model is temporarily rate-limited upstream. Please retry shortly.",
        code: 429,
        metadata: %{provider_name: "Some Provider", raw: "busy"}
      }
    })
  end

  def status(conn, status, message \\ "error") do
    conn |> Conn.put_status(status) |> Req.Test.json(%{error: %{message: message}})
  end

  @doc "The model stops answering: Req sees a receive timeout."
  def stall(conn), do: Req.Test.transport_error(conn, :timeout)

  @doc "The model takes `ms` (real time) before answering `content`."
  def slow(conn, ms, content) do
    Process.sleep(ms)
    answer(conn, content)
  end

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
