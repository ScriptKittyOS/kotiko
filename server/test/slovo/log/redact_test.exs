# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Slovo.Log.RedactTest do
  # Changes the global Logger level and the redacted secrets, so not async.
  use ExUnit.Case, async: false
  import ExUnit.CaptureLog
  require Logger
  alias Slovo.Log.Redact

  @bot_token "123456789:AAH4xkPq0123456789abcdefghijklmnopqrs"
  @api_token "my-own-api-token-0123456789"

  setup do
    level = Logger.level()
    Logger.configure(level: :debug)

    on_exit(fn ->
      Logger.configure(level: level)
      Redact.put_secrets(Redact.configured_secrets())
    end)
  end

  @cases [
    {"Authorization: Bearer abc.DEF_123-xyz~+/=", "Authorization: Bearer [redacted]"},
    {~s([{"authorization", "Bearer sk-or-v1-0123"}]),
     ~s([{"authorization", "Bearer [redacted]"}])},
    {"key sk-or-v1-0a1b2c3d4e5f6a7b8c9d0e1f end", "key [redacted-key] end"},
    {"key sk-proj-ABCDEFGHIJ0123456789xyz end", "key [redacted-key] end"},
    {"GET https://api.telegram.org/bot#{@bot_token}/getUpdates failed",
     "GET https://api.telegram.org/bot[redacted]/getUpdates failed"},
    {"https://api.telegram.org/file/bot#{@bot_token}/voice/file_1.oga",
     "https://api.telegram.org/file/bot[redacted]/voice/file_1.oga"},
    {"nothing secret here: sk-short, bots, Bearer", "nothing secret here: sk-short, bots, Bearer"}
  ]

  test "patterns" do
    for {input, expected} <- @cases do
      assert Redact.redact(input) == expected, input
    end
  end

  test "the configured secrets are redacted wherever they appear" do
    Redact.put_secrets([@api_token, "custom-llm-key-42", nil, "short"])

    assert Redact.redact("token=#{@api_token}&k=custom-llm-key-42") ==
             "token=[redacted]&k=[redacted]"

    # Too short to redact safely: it would hit ordinary words.
    assert Redact.redact("a short reply") == "a short reply"
  end

  test "the boot sets the secrets from the app env" do
    token = Application.fetch_env!(:slovo, :api_token)
    assert Redact.redact("x #{token} y") == "x [redacted] y"
  end

  describe "the logger filter" do
    test "a debug line with an API key, a bot token URL and a Bearer header" do
      Redact.put_secrets([@api_token])

      log =
        capture_log([level: :debug], fn ->
          Logger.debug(
            "POST https://api.telegram.org/bot#{@bot_token}/sendMessage " <>
              "headers=[authorization: Bearer #{@api_token}] key=sk-or-v1-abcdef0123456789 " <>
              "token=#{@api_token}"
          )
        end)

      assert log =~ "bot[redacted]/sendMessage"
      assert log =~ "Bearer [redacted]"
      assert log =~ "key=[redacted-key]"
      assert log =~ "token=[redacted]"
      refute log =~ @bot_token
      refute log =~ @api_token
      refute log =~ "sk-or-v1-abcdef"
    end

    test "format strings, reports and Erlang logger calls" do
      log =
        capture_log([level: :debug], fn ->
          :logger.error(~c"failed: ~s", ["Bearer abcdef"])
          Logger.error(%{url: "https://api.telegram.org/bot#{@bot_token}/getMe"})
          Logger.warning(url: "https://api.telegram.org/bot#{@bot_token}/getFile")
        end)

      assert log =~ "failed: Bearer [redacted]"
      assert log =~ "bot[redacted]/getMe"
      assert log =~ "bot[redacted]/getFile"
      refute log =~ @bot_token
    end

    test "a crash carrying a Telegram request is redacted in the crash report" do
      url = "https://api.telegram.org/bot#{@bot_token}/getUpdates"

      log =
        capture_log(fn ->
          {:ok, pid} =
            Task.start(fn ->
              exit({:telegram_failed, Req.new(url: url, headers: [authorization: "Bearer x1"])})
            end)

          ref = Process.monitor(pid)
          assert_receive {:DOWN, ^ref, :process, ^pid, _}
          # The crash report is logged by the dying process; give it a moment.
          Process.sleep(100)
        end)

      assert log =~ "telegram_failed"
      assert log =~ "bot[redacted]"
      refute log =~ @bot_token
    end

    test "events without secrets pass through unchanged" do
      event = %{level: :info, msg: {:report, %{a: 1}}, meta: %{}}
      assert Redact.filter(event, []) == event
      event = %{level: :info, msg: {:string, ~c"plain"}, meta: %{}}
      assert Redact.filter(event, []) == event
    end

    test "an event it can't read is dropped rather than logged unchecked" do
      event = %{level: :info, msg: {:report, %{a: 1}}, meta: %{report_cb: fn _ -> raise "no" end}}

      assert %{msg: {:string, "[a log message was dropped" <> _}} = Redact.filter(event, [])
    end

    test "the filter is installed" do
      assert {:slovo_redact, _} =
               List.keyfind(:logger.get_primary_config().filters, :slovo_redact, 0)
    end
  end
end
