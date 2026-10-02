# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.BotTest do
  # Updates go straight to Bot.handle_update/1, as the poller's tasks do, with Telegram
  # and the model stubbed.
  use Kotiko.DataCase, async: false
  import ExUnit.CaptureLog
  alias Kotiko.{Bot, LLMStub, TelegramStub}

  @user 4242

  setup do
    put_app_env(:allowed_ids, [@user])
    TelegramStub.stub()
    :ok
  end

  defp text_update(text, from \\ @user) do
    %{
      "update_id" => 1,
      "message" => %{
        "message_id" => 10,
        "from" => %{"id" => from},
        "chat" => %{"id" => from},
        "text" => text
      }
    }
  end

  defp callback_update(data) do
    %{
      "update_id" => 2,
      "callback_query" => %{
        "id" => "cb1",
        "from" => %{"id" => @user},
        "data" => data,
        "message" => %{"message_id" => 11, "chat" => %{"id" => @user}}
      }
    }
  end

  defp handle(update) do
    capture_log(fn -> Bot.handle_update(update) end)
    TelegramStub.calls()
  end

  test "a lookup saves a pending word and sends a card with Add and Skip" do
    LLMStub.stub(fn _, conn -> LLMStub.answer(conn, LLMStub.words([LLMStub.word()])) end)

    calls = handle(text_update("what's da"))

    assert [%Word{status: "pending", id: id}] = Repo.all(Word)
    assert {"sendChatAction", %{"chat_id" => @user, "action" => "typing"}} in calls

    assert [{"sendMessage", %{"chat_id" => @user, "text" => text, "reply_markup" => markup}}] =
             Enum.filter(calls, &match?({"sendMessage", _}, &1))

    assert text =~ "да  (da)"
    assert text =~ "= yes"

    assert %{"inline_keyboard" => [[%{"callback_data" => add}, %{"callback_data" => skip}]]} =
             markup

    assert {add, skip} == {"add:#{id}", "skip:#{id}"}
    assert LLMStub.requests() == ["m1"]
  end

  test "\"add ...\" saves the word as active straight away" do
    LLMStub.stub(fn _, conn -> LLMStub.answer(conn, LLMStub.words([LLMStub.word()], "add")) end)

    calls = handle(text_update("add da"))

    assert [%Word{status: "active"}] = Repo.all(Word)
    assert Enum.any?(TelegramStub.texts(calls), &(&1 =~ "Added"))
  end

  test "the Add button activates the word and edits the card" do
    word = word_fixture(%{}, "pending")

    calls = handle(callback_update("add:#{word.id}"))

    assert Words.get(word.id).status == "active"

    assert {"editMessageText", %{"chat_id" => @user, "message_id" => 11, "text" => text}} =
             List.keyfind(calls, "editMessageText", 0)

    assert text =~ "Added"
    assert {"answerCallbackQuery", %{"callback_query_id" => "cb1", "text" => "Added"}} in calls
  end

  test "the Skip button deletes a pending word" do
    word = word_fixture(%{}, "pending")
    handle(callback_update("skip:#{word.id}"))
    assert Words.get(word.id) == nil
  end

  test "a button for a word that's gone says so" do
    calls = handle(callback_update("add:999999"))
    assert {"answerCallbackQuery", %{"text" => "That word is already gone."}} = List.last(calls)
  end

  test "messages from people not in ALLOWED_TELEGRAM_IDS are ignored" do
    assert handle(text_update("what's da", 777)) == []
    assert LLMStub.requests() == []
  end

  test "before ALLOWED_TELEGRAM_IDS is set, the bot replies with the sender's ID" do
    put_app_env(:allowed_ids, [])

    assert [{"sendMessage", %{"text" => text}}] = handle(text_update("hi", 777))
    assert text =~ "ALLOWED_TELEGRAM_IDS=777"
  end

  test "a model failure is reported in the chat" do
    LLMStub.stub(fn _, conn -> LLMStub.rate_limited(conn) end)

    calls = handle(text_update("what's da"))
    assert Enum.any?(TelegramStub.texts(calls), &(&1 =~ "all the free models are busy"))
  end
end
