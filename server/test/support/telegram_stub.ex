# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.TelegramStub do
  @moduledoc """
  Req.Test stand-in for the Telegram Bot API. Each call is reported to the test process
  as `{:telegram, method, params}` and answered with `ok: true`.
  """

  def stub(results \\ %{}) do
    test = self()

    Req.Test.stub(Kotiko.Telegram, fn conn ->
      method = List.last(conn.path_info)
      {:ok, raw, conn} = Plug.Conn.read_body(conn)
      send(test, {:telegram, method, Jason.decode!(raw)})
      Req.Test.json(conn, %{ok: true, result: Map.get(results, method, true)})
    end)
  end

  @doc "Calls made so far as `{method, params}`, oldest first. Empties the mailbox of them."
  def calls do
    receive do
      {:telegram, method, params} -> [{method, params} | calls()]
    after
      0 -> []
    end
  end

  @doc "Texts of the messages sent or edited so far."
  def texts(calls) do
    for {m, %{"text" => text}} <- calls, m in ["sendMessage", "editMessageText"], do: text
  end
end
