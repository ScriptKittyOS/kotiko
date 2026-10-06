# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.BotCommandsTest do
  # The bot's commands, buttons and refusals that bot_test.exs doesn't cover, and the
  # poller. Updates go straight to Bot.handle_update/1; Telegram and the model are stubs.
  use Kotiko.DataCase, async: false
  import ExUnit.CaptureLog
  alias Kotiko.{Bot, I18n, LLMStub, TelegramStub}

  @user 4242

  setup do
    put_app_env(:allowed_ids, [@user])
    TelegramStub.stub()
    :ok
  end

  defp t(key, vars \\ %{}), do: I18n.t("en", key, vars)

  defp text_update(text) do
    %{
      "update_id" => 1,
      "message" => %{
        "message_id" => 10,
        "from" => %{"id" => @user, "language_code" => "en"},
        "chat" => %{"id" => @user},
        "text" => text
      }
    }
  end

  defp callback_update(fields) do
    %{
      "update_id" => 2,
      "callback_query" =>
        Map.merge(
          %{
            "id" => "cb1",
            "from" => %{"id" => @user, "language_code" => "en"},
            "message" => %{"message_id" => 11, "chat" => %{"id" => @user}}
          },
          fields
        )
    }
  end

  defp handle(update) do
    capture_log(fn -> Bot.handle_update(update) end)
    TelegramStub.calls()
  end

  defp replies(text), do: text |> text_update() |> handle() |> TelegramStub.texts()

  describe "commands" do
    test "/languages lists each language with its count, or says there are none" do
      assert replies("/languages") == [t("bot_languages_none")]

      word_fixture()
      word_fixture(%{native: "нет", gloss: "no", forms: ["no"]})
      word_fixture(%{lang: "ja", native: "犬", romanization: "inu", gloss: "dog", forms: ["dog"]})

      assert [text] = replies("/languages")
      lines = String.split(text, "\n")
      assert t("bot_languages_line", %{language: "Russian", count: 2}) in lines
      assert t("bot_languages_line", %{language: "Japanese", count: 1}) in lines
    end

    test "/list says when there are no words, or none in the language asked for" do
      assert replies("/list") == [t("bot_list_none")]
      assert replies("/list klingonish") == [t("bot_list_none_in", %{term: "klingonish"})]
    end

    test "/remove asks which word, and says when nothing matches" do
      assert replies("/remove") == [t("bot_remove_which")]
      assert replies("/remove nichts") == [t("bot_remove_none", %{term: "nichts"})]
    end

    test "/add <text> saves the word at once; /add alone and unknown commands show the help" do
      LLMStub.stub(fn _, conn -> LLMStub.answer(conn, LLMStub.words([LLMStub.word()])) end)

      assert [added] = replies("/add da")
      assert added =~ t("bot_card_added")
      assert [%Word{status: "active"}] = Repo.all(Word)

      assert replies("/add") == [t("bot_help")]
      assert replies("/frobnicate") == [t("bot_help")]
      assert replies("/help@KotikoBot") == [t("bot_help")]
    end
  end

  describe "refusals" do
    # The model's word fails a check: the learner reads why, per word.
    for {reason, attrs} <- [
          {"script_mismatch", %{"lang" => "ru", "native" => "dog"}},
          {"invalid_lang", %{"lang" => "1"}},
          {"sign_language_unsupported", %{"lang" => "ase", "native" => "HELLO"}}
        ] do
      @attrs attrs
      @reason reason
      test "a word refused for #{reason} is explained" do
        LLMStub.stub(fn _, conn ->
          LLMStub.answer(conn, LLMStub.words([LLMStub.word(@attrs)]))
        end)

        assert [text] = replies("what's da")

        reason = t("bot_rejected_#{@reason}")
        word = @attrs["native"] || "да"

        assert text ==
                 t("bot_rejected_intro") <>
                   "\n" <> t("bot_rejected_line", %{word: word, reason: reason})

        assert Repo.all(Word) == []
      end
    end
  end

  describe "buttons" do
    test "Remove deletes every record of the word and edits the card" do
      word = word_fixture()

      calls = handle(callback_update(%{"data" => "del:#{word.uuid}"}))

      assert Repo.get(Word, word.id).deleted_at
      assert {"editMessageText", %{"text" => text}} = List.keyfind(calls, "editMessageText", 0)
      assert text =~ t("bot_card_removed")

      removed = t("bot_toast_removed")
      assert Enum.any?(calls, &match?({"answerCallbackQuery", %{"text" => ^removed}}, &1))
    end

    test "an unknown action or a button without data is only acknowledged" do
      word = word_fixture()

      assert [{"answerCallbackQuery", %{"callback_query_id" => "cb1"}}] =
               handle(callback_update(%{"data" => "zap:#{word.uuid}"}))

      assert [{"answerCallbackQuery", %{"callback_query_id" => "cb1"}}] =
               handle(callback_update(%{}))

      assert Repo.get(Word, word.id).deleted_at == nil
    end

    test "a button for a word that is gone says so" do
      word = word_fixture()
      Words.delete(word)

      calls = handle(callback_update(%{"data" => "add:#{word.uuid}"}))
      gone = t("bot_toast_gone")
      assert Enum.any?(calls, &match?({"answerCallbackQuery", %{"text" => ^gone}}, &1))
      assert [{_, _}] = handle(callback_update(%{"data" => "add:not-an-id"}))
    end
  end

  describe "the poller" do
    test "asks for updates after the last one it saw, and polls again" do
      TelegramStub.stub(%{"getUpdates" => []})

      assert {:noreply, 7} = Bot.handle_info(:poll, 7)
      assert [{"getUpdates", %{"offset" => 7, "timeout" => 30}}] = TelegramStub.calls()
      assert_received :poll
    end

    test "moves the offset past the updates it hands to tasks" do
      # Updates from someone not allowed are ignored, so the tasks touch nothing.
      update = %{"update_id" => 41, "message" => %{"from" => %{"id" => 1}, "text" => "hi"}}
      TelegramStub.stub(%{"getUpdates" => [update, %{update | "update_id" => 42}]})

      assert {:noreply, 43} = Bot.handle_info(:poll, 7)
      assert_received :poll
    end

    test "sets the command menu when it starts" do
      assert {:noreply, 3} = Bot.handle_info(:commands, 3)
      assert [{"setMyCommands", _} | _] = TelegramStub.calls()
    end

    test "a failed setMyCommands is logged, not raised" do
      Req.Test.stub(Kotiko.Telegram, &Req.Test.json(Plug.Conn.put_status(&1, 500), %{ok: false}))
      log = capture_log(fn -> assert Bot.set_commands(["en"]) == :ok end)
      assert log =~ "setMyCommands failed"
    end
  end
end
