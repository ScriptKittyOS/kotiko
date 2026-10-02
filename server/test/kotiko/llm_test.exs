# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.LLMTest do
  # Today's try_models: models in config/test.exs are m1, m2, m3, tried in order.
  # Not async: one test changes the configured key.
  use ExUnit.Case, async: false
  import ExUnit.CaptureLog
  alias Kotiko.{LLM, LLMStub}

  @da LLMStub.words([LLMStub.word()])

  defp interpret(text \\ "what's da", opts \\ []) do
    {result, _log} = with_log(fn -> LLM.interpret(text, [], opts) end)
    result
  end

  test "a 200 answer from the first model is used" do
    LLMStub.stub(fn "m1", conn -> LLMStub.answer(conn, @da) end)

    assert {:ok, %{intent: "lookup", words: [word]}} = interpret()
    # Today's "english" and "english_forms" are read as slice 07's gloss and forms.
    assert %{lang: "ru", native: "да", gloss: "yes", forms: ["yes"], base_lang: "en"} = word
    assert LLMStub.requests() == ["m1"]
  end

  test "sends the system prompt, the text and the key" do
    LLMStub.stub(fn _, conn -> LLMStub.answer(conn, @da) end)
    interpret("what's da", add: true)

    assert_received {:llm_request, "m1", body, headers}

    assert [
             %{"role" => "system", "content" => system},
             %{"role" => "user", "content" => "what's da"}
           ] =
             body["messages"]

    assert system =~ "\"add a word\" box"
    assert {"authorization", "Bearer test-llm-key"} in headers
    assert {"x-title", "Kotiko"} in headers
    version = Application.spec(:kotiko, :vsn)

    assert {"user-agent", "Kotiko/#{version} (+https://github.com/ScriptKittyOS/kotiko)"} in headers
  end

  test "a 429 moves on to the next model" do
    LLMStub.stub(fn
      "m1", conn -> LLMStub.rate_limited(conn)
      _, conn -> LLMStub.answer(conn, @da)
    end)

    assert {:ok, %{words: [%{native: "да"}]}} = interpret()
    assert LLMStub.requests() == ["m1", "m2"]
  end

  test "every model rate limited says they're busy" do
    LLMStub.stub(fn _, conn -> LLMStub.rate_limited(conn) end)

    assert {:error, "all the free models are busy right now; try again in a minute"} = interpret()
    assert LLMStub.requests() == ["m1", "m2", "m3"]
  end

  test "a timeout or transport error moves on to the next model" do
    LLMStub.stub(fn
      "m1", conn -> LLMStub.stall(conn)
      "m2", conn -> Req.Test.transport_error(conn, :closed)
      "m3", conn -> LLMStub.answer(conn, @da)
    end)

    assert {:ok, %{words: [_]}} = interpret()
    assert LLMStub.requests() == ["m1", "m2", "m3"]
  end

  test "a 5xx is reported per model when nothing answers" do
    LLMStub.stub(fn
      "m1", conn -> LLMStub.status(conn, 503, "overloaded")
      _, conn -> LLMStub.stall(conn)
    end)

    assert {:error, reason} = interpret()
    assert reason =~ "m1: returned 503: overloaded"
    assert reason =~ "m2: timeout"
    assert LLMStub.requests() == ["m1", "m2", "m3"]
  end

  test "JSON wrapped in prose or a think block is still read" do
    LLMStub.stub(fn
      "m1", conn ->
        LLMStub.answer(
          conn,
          "Sure! Here it is:\n```json\n#{Jason.encode!(@da)}\n```\nHope that helps."
        )
    end)

    assert {:ok, %{words: [%{native: "да"}]}} = interpret()

    LLMStub.stub(fn "m1", conn ->
      LLMStub.answer(conn, "<think>{maybe}</think>#{Jason.encode!(@da)}")
    end)

    assert {:ok, %{words: [%{native: "да"}]}} = interpret()
  end

  test "an answer that isn't JSON moves on" do
    LLMStub.stub(fn
      "m1", conn -> LLMStub.answer(conn, "I don't know that word.")
      _, conn -> LLMStub.answer(conn, @da)
    end)

    assert {:ok, %{words: [_]}} = interpret()
    assert LLMStub.requests() == ["m1", "m2"]
  end

  describe "no word found" do
    @nothing %{intent: "chat", words: [], reply: "Hello!"}

    test "is the answer for a normal lookup" do
      LLMStub.stub(fn _, conn -> LLMStub.answer(conn, @nothing) end)

      assert {:ok, %{intent: "chat", words: [], reply: "Hello!"}} = interpret("hi")
      assert LLMStub.requests() == ["m1"]
    end

    test "with add: true moves on to the next model" do
      LLMStub.stub(fn
        "m1", conn -> LLMStub.answer(conn, @nothing)
        _, conn -> LLMStub.answer(conn, LLMStub.words([LLMStub.word()], "add"))
      end)

      assert {:ok, %{intent: "add", words: [_]}} = interpret("shukran", add: true)
      assert LLMStub.requests() == ["m1", "m2"]
    end

    test "with add: true from every model returns the last empty answer" do
      LLMStub.stub(fn _, conn -> LLMStub.answer(conn, @nothing) end)

      assert {:ok, %{words: []}} = interpret("hmm", add: true)
      assert LLMStub.requests() == ["m1", "m2", "m3"]
    end
  end

  describe "a rejected key" do
    test "stops at the first 401" do
      LLMStub.stub(fn _, conn -> LLMStub.status(conn, 401, "No auth credentials found") end)

      assert {:error, "the API key was rejected." <> _} = interpret()
      assert LLMStub.requests() == ["m1"]
    end

    test "says LLM_API_KEY is missing when there is none" do
      key = Application.get_env(:kotiko, :llm_api_key)
      Application.put_env(:kotiko, :llm_api_key, nil)
      on_exit(fn -> Application.put_env(:kotiko, :llm_api_key, key) end)
      LLMStub.stub(fn _, conn -> LLMStub.status(conn, 401) end)

      assert {:error, "LLM_API_KEY isn't set." <> _} = interpret()
      assert LLMStub.requests() == ["m1"]
    end
  end

  test "drops words missing lang, native or gloss and normalizes the rest" do
    LLMStub.stub(fn _, conn ->
      LLMStub.answer(
        conn,
        LLMStub.words([
          LLMStub.word(
            lang: "ZH_cn",
            native: " 狗 ",
            english: "dog",
            english_forms: ["dog", " dogs", ""]
          ),
          LLMStub.word(native: nil)
        ])
      )
    end)

    assert {:ok, %{words: [%{lang: "zh", native: "狗", gloss: "dog", forms: ["dog", "dogs"]}]}} =
             interpret()
  end

  describe "slice 07 fields (placeholder prompt until slice 09)" do
    test "asks for pronunciation and the English respelling key" do
      LLMStub.stub(fn _, conn -> LLMStub.answer(conn, @da) end)
      interpret()

      assert_received {:llm_request, "m1", body, _headers}
      [%{"content" => system} | _] = body["messages"]
      assert system =~ "pronunciation"
      assert system =~ "Key for English readers"
      refute system =~ "Key for Spanish readers"
      refute system =~ "The learner reads"
    end

    test "with several bases, asks for one entry per base and reads them" do
      answer =
        LLMStub.words([
          %{
            lang: "ja",
            native: "犬",
            romanization: "inu",
            base_lang: "es",
            gloss: "perro",
            forms: ["perro", "perros"],
            pronunciation: "i-nu"
          },
          %{
            lang: "ja",
            native: "犬",
            romanization: "inu",
            base_lang: "en",
            gloss: "dog",
            forms: "dog, dogs",
            pronunciation: "ee-noo"
          },
          # No base_lang with several bases: Kotiko can't tell which pages it is for.
          %{lang: "ja", native: "猫", english: "cat", english_forms: ["cat"]}
        ])

      LLMStub.stub(fn _, conn -> LLMStub.answer(conn, answer) end)

      {result, _log} =
        with_log(fn -> LLM.interpret("犬", [], base_langs: ["es", "en"], hint_lang: "ja") end)

      assert {:ok, %{words: [es, en]}} = result

      assert %{base_lang: "es", gloss: "perro", forms: ["perro", "perros"], pronunciation: "i-nu"} =
               es

      assert %{base_lang: "en", gloss: "dog", forms: ["dog", "dogs"], pronunciation: "ee-noo"} =
               en

      assert_received {:llm_request, "m1", body, _headers}
      [%{"content" => system} | _] = body["messages"]
      assert system =~ "The learner reads: es, en"
      assert system =~ "Key for Spanish readers"
      assert system =~ "selected on a page in ja"
    end

    test "a base with no respelling key is told to leave pronunciation null" do
      LLMStub.stub(fn _, conn -> LLMStub.answer(conn, @da) end)
      interpret("da", base_langs: ["de"])

      assert_received {:llm_request, "m1", body, _headers}
      [%{"content" => system} | _] = body["messages"]
      assert system =~ "For entries whose base is de, pronunciation is null."
    end
  end

  describe "respell/1 (the one-time pronunciation refresh)" do
    @items [%{lang: "ru", native: "спасибо", sense: "", base_langs: ["en"]}]

    test "sends the items as JSON and returns the answer's items" do
      LLMStub.stub(fn _, conn ->
        LLMStub.answer(conn, %{
          items: [%{lang: "ru", native: "спасибо", base_lang: "en", pronunciation: "spa-SEE-ba"}]
        })
      end)

      assert {:ok, [%{"pronunciation" => "spa-SEE-ba"}]} = LLM.respell(@items)
      assert_received {:llm_request, "m1", body, _headers}
      assert [%{"content" => system}, %{"content" => user}] = body["messages"]
      assert system =~ "You write pronunciations"

      assert Jason.decode!(user) == %{
               "items" => [
                 %{"lang" => "ru", "native" => "спасибо", "sense" => "", "base_langs" => ["en"]}
               ]
             }
    end

    test "tries at most two models and tells rate limits from the daily limit" do
      LLMStub.stub(fn _, conn -> LLMStub.rate_limited(conn) end)
      assert {{:error, :rate_limited}, _} = with_log(fn -> LLM.respell(@items) end)
      assert LLMStub.requests() == ["m1", "m2"]

      LLMStub.stub(fn _, conn ->
        LLMStub.status(conn, 429, "Rate limit exceeded: free-models-per-day")
      end)

      assert {{:error, :quota_exhausted}, _} = with_log(fn -> LLM.respell(@items) end)
    end
  end
end
