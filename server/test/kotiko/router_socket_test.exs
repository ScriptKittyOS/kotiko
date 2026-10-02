# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.RouterSocketTest do
  # Raw HTTP/1.1 over a real Bandit listener on a random port, because Plug.Test decodes
  # nothing and Bandit's own handling of encoded paths and Host must be covered too.
  use Kotiko.DataCase, async: false

  setup do
    pid =
      start_supervised!(
        {Bandit, plug: Kotiko.Router, ip: {127, 0, 0, 1}, port: 0, startup_log: false}
      )

    {:ok, {_ip, port}} = ThousandIsland.listener_info(pid)
    %{port: port}
  end

  defp raw(port, request) do
    {:ok, socket} = :gen_tcp.connect({127, 0, 0, 1}, port, [:binary, active: false])
    :ok = :gen_tcp.send(socket, request)
    {:ok, response} = recv_all(socket, "")
    :gen_tcp.close(socket)
    [status_line | _] = String.split(response, "\r\n")
    [_, status | _] = String.split(status_line, " ")
    String.to_integer(status)
  end

  defp recv_all(socket, acc) do
    case :gen_tcp.recv(socket, 0, 5_000) do
      {:ok, data} -> recv_all(socket, acc <> data)
      {:error, :closed} -> {:ok, acc}
    end
  end

  defp get(port, path, headers \\ "") do
    raw(port, "GET #{path} HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n#{headers}\r\n")
  end

  test "encoded and dotted paths need the token", %{port: port} do
    for path <- ~w(/api/words /%61pi/words /ap%69/words /%2561pi/words //api/words
                   /api/../api/words /api/%2e%2e/api/words /api%2Fwords /%68ealth) do
      assert get(port, path) == 401, path
    end

    assert get(port, "/health") == 200
  end

  test "the token opens the API", %{port: port} do
    token = Application.fetch_env!(:kotiko, :api_token)
    assert get(port, "/api/words", "authorization: Bearer #{token}\r\n") == 200
    assert get(port, "/%61pi/words", "authorization: Bearer #{token}\r\n") == 200
  end

  test "an unknown Host gets 421; no Host is fine from this machine", %{port: port} do
    assert raw(
             port,
             "GET /health HTTP/1.1\r\nhost: evil.example:4747\r\nconnection: close\r\n\r\n"
           ) ==
             421

    assert raw(port, "GET /health HTTP/1.1\r\nhost: 127.0.0.1:4747\r\nconnection: close\r\n\r\n") ==
             200

    assert raw(port, "GET /health HTTP/1.1\r\nhost: [::1]:4747\r\nconnection: close\r\n\r\n") ==
             200

    assert raw(port, "GET /health HTTP/1.0\r\n\r\n") == 200

    # An absolute-form target carries the host too.
    assert raw(
             port,
             "GET http://evil.example/health HTTP/1.1\r\nhost: localhost\r\nconnection: close\r\n\r\n"
           ) ==
             421
  end
end
