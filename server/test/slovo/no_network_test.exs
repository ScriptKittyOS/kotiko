# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Slovo.NoNetworkTest do
  # test_helper.exs points Req at a plug that refuses, so nothing reaches the internet.
  use ExUnit.Case, async: false

  test "an unstubbed HTTP call fails with a clear message" do
    assert_raise RuntimeError, ~r/Unstubbed HTTP request in a test: GET example.com\/x/, fn ->
      Req.get!("https://example.com/x")
    end
  end

  test "the transcriber, which has no stub, can't reach the network either" do
    Application.put_env(:slovo, :transcribe_url, "https://whisper.example/inference")
    on_exit(fn -> Application.put_env(:slovo, :transcribe_url, nil) end)

    assert_raise RuntimeError, ~r/Unstubbed HTTP request/, fn ->
      Slovo.Transcriber.transcribe("audio")
    end
  end
end
