# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.ConnCase do
  @moduledoc """
  Router tests through `Plug.Test`. `request/4` keeps the path raw, as Bandit delivers
  it, so percent-encoded spellings reach the plugs undecoded.
  """
  use ExUnit.CaseTemplate

  using do
    quote do
      import Plug.Conn
      import Plug.Test
      import Kotiko.ConnCase
      import Kotiko.DataCase, only: [word_fixture: 1, word_fixture: 2, put_app_env: 2]
      alias Kotiko.Router
    end
  end

  setup tags do
    Kotiko.DataCase.setup_sandbox(tags)
    :ok
  end

  def token, do: Application.fetch_env!(:kotiko, :api_token)

  def auth(token \\ token()), do: [{"authorization", "Bearer " <> token}]

  @doc """
  Runs one request through the router. `headers` replace nothing: pass two authorization
  headers to send two. `opts`: `:host` (default "localhost"), `:body` (a map is sent as JSON).
  """
  def request(method, raw_path, headers \\ [], opts \\ []) do
    method |> build(raw_path, headers, opts) |> Kotiko.Router.call(Kotiko.Router.init([]))
  end

  @doc """
  Like `request/4` for a request that raises after Plug.ErrorHandler has sent its
  response (as Bandit would). Returns `{status, headers, body}` of that response.
  """
  def request_raising(method, raw_path, headers \\ [], opts \\ []) do
    conn = build(method, raw_path, headers, opts)
    {Plug.Adapters.Test.Conn, %{ref: ref}} = conn.adapter

    try do
      Kotiko.Router.call(conn, Kotiko.Router.init([]))
      raise ExUnit.AssertionError, "expected #{method} #{raw_path} to raise"
    rescue
      e in ExUnit.AssertionError -> reraise e, __STACKTRACE__
      _ -> :ok
    end

    receive do
      {^ref, response} -> response
    after
      0 -> raise ExUnit.AssertionError, "#{method} #{raw_path} raised without sending a response"
    end
  end

  defp build(method, raw_path, headers, opts) do
    host = Keyword.get(opts, :host, "localhost")

    {body, headers} =
      case Keyword.get(opts, :body) do
        nil -> {nil, headers}
        b when is_map(b) -> {Jason.encode!(b), [{"content-type", "application/json"} | headers]}
        b -> {b, [{"content-type", "application/json"} | headers]}
      end

    conn = Plug.Test.conn(method, "http://#{host}" <> raw_path, body)
    %{conn | req_headers: conn.req_headers ++ headers}
  end

  def json_body(conn), do: Jason.decode!(conn.resp_body)
end
