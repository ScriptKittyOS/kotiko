# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.VoiceTest do
  # Telegram voice notes: the file download (Kotiko.Telegram), speech to text
  # (Kotiko.Transcriber) and the bot turning what was heard into a lookup. Telegram, the
  # transcriber and the model are Req.Test stubs.
  use Kotiko.DataCase, async: false
  import ExUnit.CaptureLog
  alias Kotiko.{Bot, LLMStub, Telegram, Transcriber}

  @user 4242

  setup do
    put_app_env(:allowed_ids, [@user])
    put_app_env(:transcribe_url, "http://whisper.test/inference")
    put_app_env(:transcribe_req_options, plug: {Req.Test, Kotiko.Transcriber})
    :ok
  end

  # Telegram: getFile answers with a path, the file URL with the audio; other methods ok.
  defp stub_telegram(file_status \\ 200) do
    test = self()

    Req.Test.stub(Kotiko.Telegram, fn
      %{method: "GET", request_path: path} = conn ->
        send(test, {:download, path})
        Plug.Conn.send_resp(conn, file_status, "OggS-audio")

      conn ->
        method = List.last(conn.path_info)
        {:ok, raw, conn} = Plug.Conn.read_body(conn)
        send(test, {:telegram, method, Jason.decode!(raw)})
        result = if method == "getFile", do: %{file_path: "voice/file_1.oga"}, else: true
        Req.Test.json(conn, %{ok: true, result: result})
    end)
  end

  defp stub_transcriber(fun) do
    test = self()

    Req.Test.stub(Kotiko.Transcriber, fn conn ->
      {:ok, body, conn} = Plug.Conn.read_body(conn)
      send(test, {:transcribe, Plug.Conn.get_req_header(conn, "authorization"), body})
      fun.(conn)
    end)
  end

  defp texts do
    receive do
      {:telegram, m, %{"text" => text}} when m in ["sendMessage", "editMessageText"] ->
        [text | texts()]

      {:telegram, _, _} ->
        texts()
    after
      0 -> []
    end
  end

  defp voice_update(kind \\ "voice") do
    %{
      "update_id" => 5,
      "message" => %{
        "message_id" => 10,
        "from" => %{"id" => @user, "language_code" => "en"},
        "chat" => %{"id" => @user},
        kind => %{"file_id" => "f1"}
      }
    }
  end

  describe "Transcriber.transcribe/1" do
    test "uploads the audio with the model and the key, and trims the text" do
      put_app_env(:transcribe_api_key, "whisper-key-123")
      stub_transcriber(&Req.Test.json(&1, %{text: "  shukran \n"}))

      assert Transcriber.transcribe("OggS") == {:ok, "shukran"}
      assert_received {:transcribe, ["Bearer whisper-key-123"], body}
      assert body =~ ~s(name="file"; filename="voice.ogg")
      assert body =~ "whisper-1"
    end

    test "sends no authorization without a key" do
      put_app_env(:transcribe_api_key, nil)
      stub_transcriber(&Req.Test.json(&1, %{text: "da"}))

      assert Transcriber.transcribe("OggS") == {:ok, "da"}
      assert_received {:transcribe, [], _}
    end

    test "reads JSON sent as text, and plain text" do
      stub_transcriber(&Plug.Conn.send_resp(&1, 200, ~s({"text": " gracias "})))
      assert Transcriber.transcribe("OggS") == {:ok, "gracias"}

      stub_transcriber(&Plug.Conn.send_resp(&1, 200, " merci \n"))
      assert Transcriber.transcribe("OggS") == {:ok, "merci"}
    end

    test "an error status or no connection is an error with the reason" do
      stub_transcriber(&Plug.Conn.send_resp(&1, 413, "too big"))
      assert {:error, "transcriber returned 413: \"too big\""} = Transcriber.transcribe("OggS")

      stub_transcriber(&Req.Test.transport_error(&1, :econnrefused))
      assert {:error, message} = Transcriber.transcribe("OggS")
      assert message == "connection refused"
    end
  end

  describe "Telegram" do
    test "download_file/1 asks for the path, then fetches the file" do
      stub_telegram()

      assert Telegram.download_file("f1") == {:ok, "OggS-audio"}
      assert_received {:telegram, "getFile", %{"file_id" => "f1"}}
      assert_received {:download, path}
      assert String.ends_with?(path, "/voice/file_1.oga")
    end

    test "download_file/1 reports a missing file" do
      stub_telegram(404)
      assert Telegram.download_file("f1") == {:error, "file download returned 404"}
    end

    test "an answer without ok: true, or no connection, is an error with the reason" do
      Req.Test.stub(Kotiko.Telegram, &Req.Test.json(Plug.Conn.put_status(&1, 401), %{ok: false}))
      assert {:error, "telegram 401: " <> _} = Telegram.call("getMe", %{})
      assert {:error, "telegram 401: " <> _} = Telegram.download_file("f1")

      Req.Test.stub(Kotiko.Telegram, &Req.Test.transport_error(&1, :timeout))
      assert {:error, message} = Telegram.call("getMe", %{})
      assert message =~ "timeout"
    end
  end

  describe "voice notes in the bot" do
    test "a voice note is transcribed, echoed, and looked up like typed text" do
      stub_telegram()
      stub_transcriber(&Req.Test.json(&1, %{text: "da"}))
      LLMStub.stub(fn _, conn -> LLMStub.answer(conn, LLMStub.words([LLMStub.word()])) end)

      capture_log(fn -> Bot.handle_update(voice_update()) end)

      assert [heard, card] = texts()
      assert heard =~ "da"
      assert card =~ "да"
      assert [%Word{status: "pending", native: "да"}] = Repo.all(Word)
    end

    test "an audio file is handled like a voice note" do
      stub_telegram()
      stub_transcriber(&Req.Test.json(&1, %{text: "da"}))
      LLMStub.stub(fn _, conn -> LLMStub.answer(conn, LLMStub.words([LLMStub.word()])) end)

      capture_log(fn -> Bot.handle_update(voice_update("audio")) end)
      assert_received {:transcribe, _, _}
    end

    test "without TRANSCRIBE_URL the bot says voice notes are off" do
      put_app_env(:transcribe_url, nil)
      stub_telegram()

      capture_log(fn -> Bot.handle_update(voice_update()) end)

      assert [off] = texts()
      assert off == Kotiko.I18n.t("en", "bot_voice_off")
      refute_received {:download, _}
    end
  end
end
