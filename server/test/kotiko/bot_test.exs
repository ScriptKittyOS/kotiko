# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.BotTest do
  # Updates go straight to Bot.handle_update/1, as the poller's tasks do, with Telegram
  # and the model stubbed.
  use Kotiko.DataCase, async: false
  import ExUnit.CaptureLog
  import Ecto.Query
  alias Kotiko.{Bot, Bot.Learner, Bot.Prefs, I18n, LLMStub, Profile, TelegramStub}

  @user 4242
  @uuid ~r/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  @golden Path.expand("../fixtures/bot/cards.json", __DIR__)
  @external_resource @golden
  @cases @golden |> File.read!() |> Jason.decode!() |> Map.fetch!("cases")

  setup do
    put_app_env(:allowed_ids, [@user | Enum.map(@cases, & &1["user"])])
    TelegramStub.stub()
    :ok
  end

  defp text_update(text, from \\ @user, language_code \\ nil) do
    %{
      "update_id" => 1,
      "message" => %{
        "message_id" => 10,
        "from" => %{"id" => from, "language_code" => language_code},
        "chat" => %{"id" => from},
        "text" => text
      }
    }
  end

  defp callback_update(data, from \\ @user, language_code \\ nil) do
    %{
      "update_id" => 2,
      "callback_query" => %{
        "id" => "cb1",
        "from" => %{"id" => from, "language_code" => language_code},
        "data" => data,
        "message" => %{"message_id" => 11, "chat" => %{"id" => from}}
      }
    }
  end

  defp handle(update) do
    capture_log(fn -> Bot.handle_update(update) end)
    TelegramStub.calls()
  end

  defp sent(calls), do: for({"sendMessage", params} <- calls, do: params)

  # The base languages the lookups asked the model for (spec/prompt.md: "Write one entry
  # per word for each of: es, en."). Empties the mailbox of requests.
  defp asked_bases do
    receive do
      {:llm_request, _model, body, _headers} ->
        [%{"content" => system} | _] = body["messages"]
        [_, bases] = Regex.run(~r/for each of: ([^\n]+?)\.\n/, system)
        [bases | asked_bases()]
    after
      0 -> []
    end
  end

  defp answer(content), do: LLMStub.stub(fn _, conn -> LLMStub.answer(conn, content) end)

  test "a lookup saves a pending word and sends a card with Add and Skip" do
    LLMStub.stub(fn _, conn -> LLMStub.answer(conn, LLMStub.words([LLMStub.word()])) end)

    calls = handle(text_update("what's da"))

    assert [%Word{status: "pending", uuid: uuid}] = Repo.all(Word)
    assert {"sendChatAction", %{"chat_id" => @user, "action" => "typing"}} in calls

    assert [%{"chat_id" => @user, "text" => text, "reply_markup" => markup}] = sent(calls)
    assert text =~ "да · Russian\nda\n= yes"

    assert %{"inline_keyboard" => [[%{"callback_data" => add}, %{"callback_data" => skip}]]} =
             markup

    # The public id, never the internal row id (slice 41 section 3).
    assert {add, skip} == {"add:#{uuid}", "skip:#{uuid}"}
    assert byte_size(skip) <= 64
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

    calls = handle(callback_update("add:#{word.uuid}"))

    assert Repo.get(Word, word.id).status == "active"

    assert {"editMessageText", %{"chat_id" => @user, "message_id" => 11, "text" => text}} =
             List.keyfind(calls, "editMessageText", 0)

    assert text =~ "Added"
    assert {"answerCallbackQuery", %{"callback_query_id" => "cb1", "text" => "Added"}} in calls
  end

  test "a button from a card sent before UUIDs (the row id) still works" do
    word = word_fixture(%{}, "pending")
    handle(callback_update("add:#{word.id}"))
    assert Repo.get(Word, word.id).status == "active"
  end

  test "the Skip button deletes a pending word (a tombstone)" do
    word = word_fixture(%{}, "pending")
    handle(callback_update("skip:#{word.uuid}"))
    assert Words.get_row(word.id) == nil
    assert %Word{deleted_at: %DateTime{}} = Repo.get(Word, word.id)
  end

  test "a word already in the list says so, with a Remove button" do
    word = word_fixture()
    LLMStub.stub(fn _, conn -> LLMStub.answer(conn, LLMStub.words([LLMStub.word()], "add")) end)

    calls = handle(text_update("add da"))

    assert [%{"text" => text, "reply_markup" => markup}] = sent(calls)
    assert text =~ "Already in your list"
    assert %{"inline_keyboard" => [[%{"callback_data" => "del:" <> id}]]} = markup
    assert id == word.uuid
    assert Repo.aggregate(Word, :count) == 1
  end

  test "a lookup of a word saved by the extension keeps it as it is" do
    word = word_fixture(%{note: "Mine."}, "active")
    {:ok, paused} = Words.update(word.uuid, %{status: "paused"})

    LLMStub.stub(fn _, conn ->
      LLMStub.answer(conn, LLMStub.words([LLMStub.word(note: "Model.")]))
    end)

    handle(text_update("what's da"))

    assert %Word{status: "paused", note: "Mine."} = Repo.get(Word, paused.id)
  end

  test "/remove tombstones the matching words" do
    word = word_fixture()
    calls = handle(text_update("/remove да"))

    assert Enum.any?(TelegramStub.texts(calls), &(&1 =~ "Removed да (yes)"))
    assert Words.get_row(word.id) == nil
    assert Words.get(word.uuid).deleted_at
  end

  test "/list shows the meanings" do
    word_fixture()
    calls = handle(text_update("/list"))
    assert Enum.any?(TelegramStub.texts(calls), &(&1 =~ "да  =  yes  · Russian"))
  end

  test "a button for a word that's gone says so" do
    for data <- ["add:999999", "add:#{Kotiko.UUID7.generate()}", "add:nonsense"] do
      calls = handle(callback_update(data))
      assert {"answerCallbackQuery", %{"text" => "That word is already gone."}} = List.last(calls)
    end
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

    assert Enum.any?(
             TelegramStub.texts(calls),
             &(&1 == "Word lookup is busy. Try again in a minute.")
           )
  end

  describe "language tags (slice 08)" do
    test "/list finds a language by its name in any shipped locale, endonym or code" do
      word_fixture(%{lang: "yue", native: "多謝", gloss: "thanks", romanization: "do1 ze6"})
      word_fixture(%{lang: "ja", native: "犬", gloss: "dog", romanization: "inu"})

      for term <- ["cantonese", "cantonés", "粵語", "yue"] do
        [text] = handle(text_update("/list " <> term)) |> TelegramStub.texts()
        assert text =~ "多謝", term
        refute text =~ "犬", term
        # The name comes from the tag, never from the model.
        assert text =~ "Cantonese", term
      end
    end

    test "never crashes on any tag in lang-tags.json (F17)" do
      tags =
        Path.expand("../../../spec/fixtures/lang-tags.json", __DIR__)
        |> File.read!()
        |> Jason.decode!()
        |> Map.fetch!("cases")
        |> Enum.map(& &1["input"])

      for tag <- tags do
        LLMStub.stub(fn _, conn ->
          LLMStub.answer(conn, LLMStub.words([LLMStub.word(lang: tag)], "add"))
        end)

        calls = handle(text_update("add da"))
        texts = TelegramStub.texts(calls)
        refute Enum.any?(texts, &(&1 =~ "Error:" or &1 =~ "Something went wrong")), inspect(tag)
        assert texts != [], inspect(tag)
      end
    end

    test "a word the checks refuse gets a one-line reason" do
      LLMStub.stub(fn _, conn ->
        LLMStub.answer(conn, LLMStub.words([LLMStub.word(native: "spasibo")], "add"))
      end)

      [text] = handle(text_update("add spasibo")) |> TelegramStub.texts()
      assert text =~ "spasibo: that isn't written in the language's own script"
      assert Repo.all(Word) == []
    end
  end

  # ── slice 41 section 9: the bot speaks the learner's language ──────────

  describe "golden cards (test/fixtures/bot/cards.json)" do
    for c <- @cases do
      @case c
      test c["name"] do
        c = @case
        if c["profile"], do: {:ok, _} = Profile.put(%{"base_langs" => c["profile"]})
        answer(c["answer"])

        calls = handle(text_update(c["text"], c["user"], c["language_code"]))

        assert asked_bases() == [c["asked_bases"]]

        assert [%{"text" => text, "reply_markup" => %{"inline_keyboard" => [buttons]}}] =
                 sent(calls)

        assert text == c["card"]
        assert Enum.map(buttons, & &1["text"]) == c["buttons"]

        for %{"callback_data" => data} <- buttons do
          assert [_, id] = String.split(data, ":")
          assert id =~ @uuid
          assert byte_size(data) <= 64
        end

        # Add saves every base record of the card, primary first.
        [%{"callback_data" => "add:" <> _ = add} | _] = buttons
        handle(callback_update(add, c["user"], c["language_code"]))

        saved =
          Repo.all(from w in Word, where: is_nil(w.deleted_at), order_by: w.id)
          |> Enum.map(&Map.from_struct/1)

        assert length(saved) == length(c["saved"])

        for {want, got} <- Enum.zip(c["saved"], saved), {field, value} <- want do
          assert Map.fetch!(got, String.to_existing_atom(field)) == value, field
        end
      end
    end
  end

  describe "the learner's base languages" do
    test "lookups ask in the profile's bases, in order" do
      {:ok, _} = Profile.put(%{"base_langs" => ["es-PR", "en-US"]})
      answer(LLMStub.words([]))

      handle(text_update("perro", @user, "fr"))

      assert Enum.uniq(asked_bases()) == ["es, en"]
    end

    test "without a profile, the Telegram app's language, never an assumed English" do
      word_fixture()
      answer(LLMStub.words([]))

      handle(text_update("perro", @user, "es-419"))

      assert Enum.uniq(asked_bases()) == ["es"]
    end

    test "without a profile or an app language, an existing install keeps its words' bases" do
      word_fixture(%{base_lang: "de", gloss: "ja", forms: ["ja"]})
      word_fixture(%{native: "нет", romanization: "net", gloss: "no", forms: ["no"]})

      word_fixture(%{
        native: "дом",
        romanization: "dom",
        gloss: "Haus",
        forms: ["Haus"],
        base_lang: "de"
      })

      answer(LLMStub.words([]))

      handle(text_update("perro"))

      assert Enum.uniq(asked_bases()) == ["de, en"]
    end

    test "a guess is named once, on the first card" do
      word =
        LLMStub.word(
          lang: "ja",
          native: "犬",
          romanization: "inu",
          english: "perro",
          english_forms: ["perro"]
        )

      answer(LLMStub.words([word]))

      [first] = handle(text_update("perro en japonés", @user, "es")) |> sent()
      assert first["text"] =~ "\n\nMeanings in español. Change with /bases."

      Repo.delete_all(Word)
      [second] = handle(text_update("perro en japonés", @user, "es")) |> sent()
      refute second["text"] =~ "Meanings in"

      # Set by the learner: nothing to say.
      {:ok, _} = Profile.put(%{"base_langs" => ["es"]})
      Prefs.noted(@user, "bases", nil)
      Repo.delete_all(Word)
      [third] = handle(text_update("perro en japonés", @user, "es")) |> sent()
      refute third["text"] =~ "Meanings in"
    end

    test "/bases sets the profile from Telegram, by code or by name; /bases alone shows it" do
      [set] = handle(text_update("/bases es-MX English", @user, "es")) |> TelegramStub.texts()
      assert set =~ "Meanings are now in español, English."
      assert %{base_langs: ["es", "en"], ui_lang: nil} = Profile.get()

      [shown] = handle(text_update("/bases")) |> TelegramStub.texts()
      assert shown =~ "Meanings are in español, English."

      [bad] = handle(text_update("/bases es klingonish")) |> TelegramStub.texts()
      assert bad =~ "I couldn't read those as languages"
      assert Profile.get().base_langs == ["es", "en"]

      [too_many] = handle(text_update("/bases es en fr de it")) |> TelegramStub.texts()
      assert too_many =~ "up to 4"
    end
  end

  describe "the bot's language" do
    test "the locale: /language, then the extension's choice, then the app, then the primary base" do
      available = ["en", "es"]
      resolve = fn code -> Learner.resolve(@user, code, available) end

      # Nothing known: the source locale.
      assert %{locale: "en", wanted: "en", bases: ["en"]} = resolve.(nil)
      # The app's language, by its primary subtag.
      assert %{locale: "es", wanted: "es"} = resolve.("es-419")
      assert %{locale: "en", wanted: "fr"} = resolve.("fr")
      # The primary base, when the app says nothing.
      {:ok, _} = Profile.put(%{"base_langs" => ["es", "en"]})
      assert %{locale: "es", bases: ["es", "en"]} = resolve.(nil)
      assert %{locale: "en", wanted: "en"} = resolve.("en-GB")
      # The extension's choice beats the app.
      {:ok, _} = Profile.put(%{"base_langs" => ["es", "en"], "ui_lang" => "en"})
      assert %{locale: "en", wanted: "en"} = resolve.("es")
      # /language beats everything.
      Prefs.put_locale(@user, "es")
      assert %{locale: "es", wanted: "es"} = resolve.("en")
      # A choice with no catalog falls through to the next that has one.
      Prefs.put_locale(@user, "fr")
      assert %{locale: "en", wanted: "fr"} = resolve.("es")
    end

    test "the pronunciation shown is the learner's language's when they read it, else the primary base's" do
      {:ok, _} = Profile.put(%{"base_langs" => ["es", "en"]})
      assert %{pron_base: "es"} = Learner.resolve(@user, "es-PR", ["en"])
      assert %{pron_base: "en"} = Learner.resolve(@user, "en", ["en"])
      assert %{pron_base: "es"} = Learner.resolve(@user, "ja", ["en"])
    end

    test "says once that Kotiko isn't translated into the learner's language yet" do
      [first] = handle(text_update("/help", @user, "es")) |> TelegramStub.texts()
      assert String.starts_with?(first, "Kotiko isn't translated into español yet.\n\nKotiko:")

      [second] = handle(text_update("/help", @user, "es")) |> TelegramStub.texts()
      assert String.starts_with?(second, "Kotiko:")

      # An English app has nothing to note.
      [english] = handle(text_update("/help", 5004, "en")) |> TelegramStub.texts()
      refute english =~ "translated"
    end

    test "/language chooses, /language auto follows the app again" do
      [es] = handle(text_update("/language español")) |> TelegramStub.texts()
      assert es == "Kotiko isn't translated into español yet."
      assert Prefs.get(@user).locale == "es"

      [en] = handle(text_update("/language en")) |> TelegramStub.texts()
      assert en == "I'll write in English from now on."
      assert Prefs.get(@user).locale == "en"

      [auto] = handle(text_update("/language auto")) |> TelegramStub.texts()
      assert auto =~ "follow your Telegram app"
      assert Prefs.get(@user).locale == nil

      [bad] = handle(text_update("/language qqq-nope")) |> TelegramStub.texts()
      assert bad =~ "I don't know that language code"

      [shown] = handle(text_update("/language", @user, "en")) |> TelegramStub.texts()
      assert shown =~ "I write in English."
    end

    test "the command menu is set once per shipped locale, with its descriptions" do
      capture_log(fn -> Bot.set_commands() end)

      assert [{"setMyCommands", params}] = TelegramStub.calls()
      refute Map.has_key?(params, "language_code")
      assert %{"command" => "list", "description" => "your newest words"} in params["commands"]

      assert Enum.map(params["commands"], & &1["command"]) ==
               ~w(list languages remove bases language help)

      capture_log(fn -> Bot.set_commands(["es", "en"]) end)
      assert [{"setMyCommands", default}, {"setMyCommands", es}] = TelegramStub.calls()
      refute Map.has_key?(default, "language_code")
      assert es["language_code"] == "es"
    end
  end

  describe "errors in the chat" do
    test "a crash answers with a reference, never the exception's text" do
      put_app_env(:allowed_ids, :not_a_list)

      log = capture_log(fn -> Bot.handle_update(text_update("what's da", @user, "en")) end)

      assert [{"sendMessage", %{"text" => text}}] = TelegramStub.calls()
      assert [_, ref] = Regex.run(~r/for ref ([0-9a-f]{8})\.$/, text)
      assert text == I18n.t("en", "error_internal_ref", %{ref: ref})
      refute text =~ "not_a_list" or text =~ "Enumerable"
      assert log =~ "ref #{ref}"
      assert log =~ "Enumerable"
    end

    test "a voice note that can't be transcribed says so, without the reason" do
      put_app_env(:transcribe_url, "http://127.0.0.1:9/transcribe")

      update = %{
        "update_id" => 3,
        "message" => %{
          "message_id" => 10,
          "from" => %{"id" => @user},
          "chat" => %{"id" => @user},
          "voice" => %{"file_id" => "f1"}
        }
      }

      texts = handle(update) |> TelegramStub.texts()
      assert texts == ["I couldn't make out that voice note. Try again, or type it."]
    end
  end

  describe "every text comes from the catalog (slice 50's literal check, server variant)" do
    @bot Path.expand("../../lib/kotiko/bot.ex", __DIR__)

    # Literals that are never text a person reads: catalog keys, commands, callback
    # actions, Telegram's field and method names, and strings with no letters at all
    # (separators, "= ", "\n"). Names that aren't translated are listed by hand.
    @technical ~r/^[a-z\/][A-Za-z0-9_:\/@.\-]*$/
    @names ["Wiktionary"]

    defp literals(ast) do
      {_, acc} =
        Macro.prewalk(ast, [], fn
          # Log lines are for the server's owner, not the chat; docs aren't sent.
          {{:., _, [{:__aliases__, _, [:Logger]}, _]}, _, _}, acc -> {nil, acc}
          {:@, _, [{doc, _, _}]}, acc when doc in [:moduledoc, :doc] -> {nil, acc}
          # Regular expressions match text; they never send any.
          {:sigil_r, _, _}, acc -> {nil, acc}
          s, acc when is_binary(s) -> {s, [s | acc]}
          node, acc -> {node, acc}
        end)

      acc
    end

    test "no string literal in bot.ex could reach the chat outside Kotiko.I18n.t/3" do
      offending =
        @bot
        |> File.read!()
        |> Code.string_to_quoted!()
        |> literals()
        |> Enum.reject(&(&1 =~ @technical or not (&1 =~ ~r/\p{L}/u) or &1 in @names))

      assert offending == []
    end

    test "every bot_ key it uses has an English message" do
      keys = Regex.scan(~r/"(bot_[a-z_]+)"/, File.read!(@bot)) |> Enum.map(&List.last/1)
      assert length(keys) > 30
      for key <- keys, do: assert(I18n.has?(key), key)
    end
  end
end
