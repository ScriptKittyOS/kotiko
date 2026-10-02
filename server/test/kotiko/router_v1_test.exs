# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.RouterV1Test do
  # Slice 07's /api/v1 routes and the legacy /api/words routes a 0.2 extension uses.
  use Kotiko.ConnCase, async: false
  import ExUnit.CaptureLog
  alias Kotiko.{LLMStub, UUID7, Word, Words}

  @inu_es %{
    "lang" => "ja",
    "native" => "犬",
    "romanization" => "inu",
    "base_lang" => "es",
    "gloss" => "perro",
    "forms" => ["perro", "perros"],
    "pronunciation" => "i-nu"
  }
  @inu_en %{
    "lang" => "ja",
    "native" => "犬",
    "romanization" => "inu",
    "base_lang" => "en",
    "gloss" => "dog",
    "forms" => ["dog", "dogs"],
    "pronunciation" => "ee-noo"
  }

  defp call(method, path, body \\ nil, headers \\ []) do
    opts = if body, do: [body: body], else: []
    conn = request(method, path, auth() ++ headers, opts)
    {conn.status, if(conn.resp_body in [nil, ""], do: nil, else: json_body(conn))}
  end

  defp quiet(fun) do
    {result, _log} = with_log(fun)
    result
  end

  defp stub_answer(words, intent \\ "add") do
    LLMStub.stub(fn _, conn -> LLMStub.answer(conn, LLMStub.words(words, intent)) end)
  end

  defp add_text(text, bases, extra \\ %{}) do
    quiet(fn ->
      call("POST", "/api/v1/words", Map.merge(%{text: text, base_langs: bases}, extra))
    end)
  end

  defp error_code({_status, %{"error" => %{"code" => code}}}), do: code

  describe "GET /api/v1/words" do
    test "lists live active and paused words with every field and a cursor" do
      w = word_fixture()
      word_fixture(%{native: "нет", gloss: "no"}, "pending")

      assert {200, %{"words" => [word], "cursor" => cursor}} = call("GET", "/api/v1/words")
      assert cursor == to_string(Words.last_seq())
      assert word["id"] == w.uuid

      for field <- ~w(id lang native base_lang sense romanization native_vocalized gloss forms
                      pronunciation pronunciation_careful pronunciation_source note status
                      origin source_text created_at updated_at deleted_at merged_into language) do
        assert Map.has_key?(word, field), field
      end

      assert [%{"text" => "yes", "enabled" => true, "case" => "any", "ambiguous" => false}] =
               word["forms"]

      assert word["created_at"] =~ ~r/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/
    end

    test "filters by lang, base, status and limit; rejects bad values" do
      word_fixture()
      word_fixture(Map.new(@inu_es, fn {k, v} -> {String.to_atom(k), v} end))

      assert {200, %{"words" => [%{"native" => "犬"}]}} = call("GET", "/api/v1/words?base=es")
      assert {200, %{"words" => [%{"native" => "да"}]}} = call("GET", "/api/v1/words?lang=ru")
      assert {200, %{"words" => [_]}} = call("GET", "/api/v1/words?limit=1")
      assert {200, %{"words" => []}} = call("GET", "/api/v1/words?status=pending")

      for q <- ["limit=0", "limit=20001", "limit=x", "status=gone", "base=spanish!"] do
        assert {400, %{"error" => %{"code" => "invalid_request"}}} =
                 call("GET", "/api/v1/words?" <> q),
               q
      end
    end
  end

  describe "GET /api/v1/words/:id" do
    test "returns a word, or a tombstone" do
      w = word_fixture()

      assert {200, %{"word" => %{"id" => id, "deleted_at" => nil}}} =
               call("GET", "/api/v1/words/#{w.uuid}")

      assert id == w.uuid

      {:ok, _} = Words.delete(w)
      assert {200, %{"word" => %{"deleted_at" => at}}} = call("GET", "/api/v1/words/#{w.uuid}")
      assert is_binary(at)
    end

    test "a malformed or unknown id is 404 word_gone, never 500" do
      for id <- [
            "abc",
            "1",
            "99999999999999999999999",
            String.upcase(UUID7.generate()),
            UUID7.generate()
          ] do
        assert {404, %{"error" => %{"code" => "word_gone", "message" => _, "details" => %{}}}} =
                 call("GET", "/api/v1/words/#{id}"),
               id
      end
    end
  end

  describe "POST /api/v1/words with text" do
    test "犬 for es and en creates two words, each in its own base" do
      stub_answer([@inu_es, @inu_en])

      assert {200, %{"results" => [es, en], "rejected" => [], "dropped_fields" => []}} =
               add_text("犬", ["es", "en"])

      assert %{"result" => "created", "word" => %{"gloss" => "perro", "base_lang" => "es"}} = es
      assert %{"result" => "created", "word" => %{"gloss" => "dog", "base_lang" => "en"}} = en
      assert Enum.map(es["word"]["forms"], & &1["text"]) == ["perro", "perros"]
      assert es["word"]["pronunciation"] == "i-nu"
      assert en["word"]["pronunciation"] == "ee-noo"
      assert es["word"]["pronunciation_source"] == "model"

      # A later add for es only: unchanged, and the English record is left alone.
      stub_answer([@inu_es])
      assert {200, %{"results" => [%{"result" => "unchanged"}]}} = add_text("犬", ["es"])
      assert length(Words.list(bases: ["en"])) == 1
    end

    test "\"dog\" for es and en keeps only the es record: a word is never its own base" do
      stub_answer([
        %{
          "lang" => "en",
          "native" => "dog",
          "base_lang" => "es",
          "gloss" => "perro",
          "forms" => ["perro"]
        },
        %{
          "lang" => "en",
          "native" => "dog",
          "base_lang" => "en",
          "gloss" => "dog",
          "forms" => ["dog"]
        }
      ])

      assert {200,
              %{
                "results" => [%{"word" => %{"lang" => "en", "base_lang" => "es"}}],
                "rejected" => [rejected]
              }} =
               add_text("dog", ["es", "en"])

      assert rejected["reason"] == "target_is_base"
      assert Enum.all?(Repo.all(Word), &(&1.lang != &1.base_lang))
    end

    test "re-adding returns updated with previous, or unchanged; notes are kept" do
      stub_answer([Map.put(@inu_en, "note", "Model note.")])
      {200, %{"results" => [%{"word" => w}]}} = add_text("犬", ["en"])
      {:ok, _} = Words.update(w["id"], %{note: "My mnemonic"})

      stub_answer([
        Map.merge(@inu_en, %{"note" => nil, "romanization" => nil, "forms" => ["dog", "doggy"]})
      ])

      assert {200,
              %{"results" => [%{"result" => "updated", "word" => word, "previous" => previous}]}} =
               add_text("犬", ["en"])

      assert word["note"] == "My mnemonic"
      assert word["romanization"] == "inu"
      assert Enum.map(word["forms"], & &1["text"]) == ["dog", "dogs", "doggy"]
      assert Enum.map(previous["forms"], & &1["text"]) == ["dog", "dogs"]

      assert {200, %{"results" => [%{"result" => "unchanged"} = r]}} = add_text("犬", ["en"])
      refute Map.has_key?(r, "previous")
    end

    test "an invalid pronunciation from the model is dropped and listed; the word is saved" do
      stub_answer([
        %{
          "lang" => "ru",
          "native" => "пожалуйста",
          "base_lang" => "en",
          "gloss" => "please",
          "forms" => ["please"],
          "pronunciation" => "PA-ZHAL-STA"
        }
      ])

      assert {200, %{"results" => [%{"word" => w}], "dropped_fields" => [dropped]}} =
               add_text("pozhaluysta", ["en"])

      assert w["pronunciation"] == nil

      assert %{
               "field" => "pronunciation",
               "reason" => "bad_pronunciation",
               "native" => "пожалуйста"
             } = dropped
    end

    test "a chat answer saves nothing and passes the reply on" do
      LLMStub.stub(fn _, conn ->
        LLMStub.answer(conn, %{intent: "chat", words: [], reply: "Hi!"})
      end)

      assert {200, %{"results" => [], "reply" => "Hi!"}} = add_text("hello", ["en"])
    end

    test "checks the input before any model call" do
      LLMStub.stub(fn _, _ -> raise "no model call expected" end)

      assert {400, %{"error" => %{"code" => "empty_input"}}} = add_text("  ", ["en"])

      assert {400, %{"error" => %{"code" => "input_too_long"}}} =
               add_text(String.duplicate("a", 201), ["en"])

      for bases <- [nil, [], ["es", "en", "pt", "fr", "de"], ["spanish!"]] do
        assert {400,
                %{
                  "error" => %{
                    "code" => "invalid_request",
                    "details" => %{"field" => "base_langs"}
                  }
                }} =
                 add_text("perro", bases)
      end

      assert {400, _} = add_text("perro", ["es"], %{client_request_id: "nope"})
      assert {400, _} = quiet(fn -> call("POST", "/api/v1/words", %{}) end)
      assert LLMStub.requests() == []
    end

    test "a model failure has a code" do
      LLMStub.stub(fn _, conn -> LLMStub.rate_limited(conn) end)
      assert error_code(add_text("perro", ["es"])) == "rate_limited"

      LLMStub.stub(fn _, conn -> LLMStub.status(conn, 503, "down") end)
      assert {502, %{"error" => %{"code" => "model_unavailable"}}} = add_text("perro", ["es"])
    end
  end

  describe "preview" do
    test "interprets and checks but saves nothing" do
      stub_answer([@inu_es, @inu_en])
      seq = Words.last_seq()

      assert {200, %{"candidates" => [es, en], "rejected" => []}} =
               add_text("犬", ["es", "en"], %{preview: true})

      refute Map.has_key?(es, "id")
      assert {es["base_lang"], en["base_lang"]} == {"es", "en"}

      assert es["forms"] == [
               %{"text" => "perro", "enabled" => true, "case" => "any", "ambiguous" => false},
               %{"text" => "perros", "enabled" => true, "case" => "any", "ambiguous" => false}
             ]

      assert Repo.aggregate(Word, :count) == 0
      assert Words.last_seq() == seq

      # The client saves the chosen candidate through the structured form.
      assert {200, %{"results" => [%{"result" => "created", "word" => %{"gloss" => "perro"}}]}} =
               call("POST", "/api/v1/words", %{word: es})
    end
  end

  describe "client_request_id" do
    test "a repeat returns the identical body with no model call and no write" do
      stub_answer([@inu_en])
      id = UUID7.generate()
      body = %{text: "犬", base_langs: ["en"], client_request_id: id}

      first = quiet(fn -> request("POST", "/api/v1/words", auth(), body: body) end)
      assert first.status == 200
      assert LLMStub.requests() == ["m1"]
      seq = Words.last_seq()

      again = quiet(fn -> request("POST", "/api/v1/words", auth(), body: body) end)
      assert again.status == 200
      assert again.resp_body == first.resp_body
      assert LLMStub.requests() == []
      assert Words.last_seq() == seq
    end

    test "six concurrent posts with the same text answer 200; one id means one model call" do
      stub_answer([@inu_en])
      id = UUID7.generate()

      responses =
        1..6
        |> Task.async_stream(fn _ ->
          quiet(fn ->
            request("POST", "/api/v1/words", auth(),
              body: %{text: "犬", base_langs: ["en"], client_request_id: id}
            )
          end)
        end)
        |> Enum.map(fn {:ok, conn} -> {conn.status, conn.resp_body} end)

      assert Enum.all?(responses, &(elem(&1, 0) == 200))
      assert responses |> Enum.map(&elem(&1, 1)) |> Enum.uniq() |> length() == 1
      assert LLMStub.requests() == ["m1"]

      # Without an id, six at once still all succeed and make one live word.
      statuses =
        1..6
        |> Task.async_stream(fn _ ->
          quiet(fn ->
            request("POST", "/api/v1/words", auth(), body: %{text: "犬", base_langs: ["en"]})
          end).status
        end)
        |> Enum.map(fn {:ok, s} -> s end)

      assert statuses == List.duplicate(200, 6)
      assert length(Words.list()) == 1
    end

    test "a failed lookup is not kept, so a retry can succeed" do
      id = UUID7.generate()
      LLMStub.stub(fn _, conn -> LLMStub.status(conn, 503) end)
      assert {502, _} = add_text("犬", ["en"], %{client_request_id: id})

      stub_answer([@inu_en])
      assert {200, %{"results" => [_]}} = add_text("犬", ["en"], %{client_request_id: id})
    end
  end

  describe "structured adds" do
    test "a word without the model; an invalid pronunciation is dropped and listed" do
      LLMStub.stub(fn _, _ -> raise "no model call expected" end)

      word = %{
        lang: "ru",
        native: "пожалуйста",
        base_lang: "en",
        gloss: "please",
        forms: ["please"],
        pronunciation: "PA-ZHAL-STA",
        romanization: "pozhaluysta"
      }

      assert {200,
              %{"results" => [%{"result" => "created", "word" => w}], "dropped_fields" => [d]}} =
               call("POST", "/api/v1/words", %{word: word})

      assert w["pronunciation"] == nil
      assert w["origin"] == "manual"
      assert d["reason"] == "bad_pronunciation"
    end

    test "a typed pronunciation is the learner's" do
      word = %{
        lang: "ru",
        native: "пожалуйста",
        base_lang: "en",
        gloss: "please",
        pronunciation: "pa-ZHAL-sta"
      }

      assert {200, %{"results" => [%{"word" => w}]}} =
               call("POST", "/api/v1/words", %{word: word})

      assert {w["pronunciation"], w["pronunciation_source"]} == {"pa-ZHAL-sta", "user"}
    end

    test "a word that can't be saved is rejected with its reason" do
      assert {200, %{"results" => [], "rejected" => [%{"reason" => "missing_field"}]}} =
               call("POST", "/api/v1/words", %{word: %{lang: "ru", native: "да"}})
    end
  end

  describe "POST /api/v1/words/batch" do
    test "saves many in one call, in input order, with rejections by index" do
      words = [
        %{lang: "ru", native: "да", base_lang: "en", gloss: "yes"},
        %{lang: "ru", native: "нет"},
        %{lang: "ru", native: "да", base_lang: "en", gloss: "yes", forms: ["yeah"]},
        %{lang: "ru", native: "дом", base_lang: "es", gloss: "casa"}
      ]

      assert {200, %{"results" => results, "rejected" => [rejected]}} =
               call("POST", "/api/v1/words/batch", %{words: words})

      assert Enum.map(results, &{&1["index"], &1["result"]}) == [
               {0, "created"},
               {2, "updated"},
               {3, "created"}
             ]

      assert hd(results)["word"]["origin"] == "bulk"
      assert rejected["index"] == 1
    end

    test "takes at most 500 words, and bodies up to 1 MB" do
      many =
        for i <- 1..500,
            do: %{
              lang: "ru",
              native: "книга#{i}",
              base_lang: "en",
              gloss: "word#{i}",
              note: String.duplicate("n", 150)
            }

      body = Jason.encode!(%{words: many})
      assert byte_size(body) > 64_000

      conn = request("POST", "/api/v1/words/batch", auth(), body: body)
      assert conn.status == 200
      assert length(json_body(conn)["results"]) == 500

      assert {400, %{"error" => %{"details" => %{"max" => 500}}}} =
               call("POST", "/api/v1/words/batch", %{words: many ++ Enum.take(many, 1)})

      # Other routes keep the 64 KB limit.
      assert {413, _, body} = request_raising("POST", "/api/v1/words", auth(), body: body)
      assert %{"error" => %{"code" => "request_too_large"}} = Jason.decode!(body)
    end
  end

  describe "PATCH /api/v1/words/:id" do
    test "changes only the fields given" do
      w = word_fixture(%{note: "Mine."})

      assert {200, %{"word" => word}} =
               call("PATCH", "/api/v1/words/#{w.uuid}", %{romanization: "dah", unknown: 1})

      assert {word["romanization"], word["note"], word["gloss"]} == {"dah", "Mine.", "yes"}
    end

    test "an old if_updated_at (body or If-Match) is 409 stale with the current word" do
      w = word_fixture()
      old = Word.timestamp(w.updated_at)

      {200, %{"word" => current}} =
        call("PATCH", "/api/v1/words/#{w.uuid}", %{note: "1", if_updated_at: old})

      assert {409,
              %{
                "error" => %{
                  "code" => "word_conflict",
                  "details" => %{"reason" => "stale", "word" => ^current}
                }
              }} =
               call("PATCH", "/api/v1/words/#{w.uuid}", %{note: "2", if_updated_at: old})

      assert {409, _} =
               call("PATCH", "/api/v1/words/#{w.uuid}", %{note: "2"}, [{"if-match", ~s("#{old}")}])

      assert {200, _} =
               call("PATCH", "/api/v1/words/#{w.uuid}", %{note: "2"}, [
                 {"if-match", ~s("#{current["updated_at"]}")}
               ])

      assert {400, _} =
               call("PATCH", "/api/v1/words/#{w.uuid}", %{note: "3", if_updated_at: "yesterday"})
    end

    test "a natural-key clash is 409 duplicate with the other id" do
      ru = word_fixture()
      sr = word_fixture(%{lang: "sr", language: "Serbian"})

      assert {409,
              %{
                "error" => %{
                  "code" => "word_conflict",
                  "details" => %{"reason" => "duplicate", "other_id" => other}
                }
              }} =
               call("PATCH", "/api/v1/words/#{sr.uuid}", %{lang: "ru"})

      assert other == ru.uuid
    end

    test "setting pronunciation makes it the learner's; an invalid one is refused" do
      w = word_fixture(%{native: "пожалуйста", gloss: "please"})

      assert {200,
              %{"word" => %{"pronunciation" => "pa-ZHAL-sta", "pronunciation_source" => "user"}}} =
               call("PATCH", "/api/v1/words/#{w.uuid}", %{pronunciation: "pa-ZHAL-sta"})

      assert {400,
              %{
                "error" => %{
                  "code" => "invalid_word",
                  "details" => %{"reason" => "bad_pronunciation"}
                }
              }} =
               call("PATCH", "/api/v1/words/#{w.uuid}", %{pronunciation: "PA-ZHAL-STA"})
    end

    test "invalid values and unknown ids" do
      w = word_fixture()
      assert {400, _} = call("PATCH", "/api/v1/words/#{w.uuid}", %{forms: []})
      assert {400, _} = call("PATCH", "/api/v1/words/#{w.uuid}", %{status: "pending"})
      # A word in English for English pages: target_is_base.
      assert {400, _} = call("PATCH", "/api/v1/words/#{w.uuid}", %{lang: "en"})
      assert {404, _} = call("PATCH", "/api/v1/words/#{UUID7.generate()}", %{note: "x"})
      assert {404, _} = call("PATCH", "/api/v1/words/1", %{note: "x"})
    end
  end

  describe "DELETE and restore" do
    test "delete returns the tombstone; restore gives back the same id and content" do
      w = word_fixture(%{note: "Mine."})

      assert {200, %{"word" => %{"deleted_at" => at} = d}} =
               call("DELETE", "/api/v1/words/#{w.uuid}")

      assert is_binary(at)
      assert {200, %{"word" => ^d}} = call("DELETE", "/api/v1/words/#{w.uuid}")

      assert {200, %{"word" => r}} = call("POST", "/api/v1/words/#{w.uuid}/restore")
      assert r["deleted_at"] == nil

      assert Map.take(r, ~w(id native gloss forms note)) ==
               Map.take(d, ~w(id native gloss forms note))
    end

    test "restore is 409 when the key was taken and 410 after scrubbing" do
      w = word_fixture()
      {:ok, _} = Words.delete(w)
      again = word_fixture()

      assert {409,
              %{
                "error" => %{
                  "code" => "word_conflict",
                  "details" => %{"reason" => "duplicate", "other_id" => other}
                }
              }} =
               call("POST", "/api/v1/words/#{w.uuid}/restore")

      assert other == again.uuid

      {:ok, _} = Words.delete(again)
      Kotiko.Janitor.run(DateTime.add(Words.now(), 31, :day))

      assert {410, %{"error" => %{"code" => "word_gone"}}} =
               call("POST", "/api/v1/words/#{again.uuid}/restore")
    end

    test "pending words and malformed ids are 404" do
      p = word_fixture(%{}, "pending")
      assert {404, _} = call("DELETE", "/api/v1/words/#{p.uuid}")
      assert Words.get_row(p.id)
      assert {404, _} = call("DELETE", "/api/v1/words/abc")
      assert {404, _} = call("POST", "/api/v1/words/abc/restore")
    end
  end

  describe "the pronunciation refresh job" do
    test "GET reports and POST pauses and resumes it" do
      Repo.query!(
        "UPDATE maintenance_jobs SET state = 'running', total = 5 WHERE name = 'pronunciation_refresh'"
      )

      assert {200, %{"state" => "running", "done" => 0, "total" => 5}} =
               call("GET", "/api/v1/jobs/pronunciation-refresh")

      assert {200, %{"state" => "paused"}} =
               call("POST", "/api/v1/jobs/pronunciation-refresh", %{action: "pause"})

      assert {200, %{"state" => "running"}} =
               call("POST", "/api/v1/jobs/pronunciation-refresh", %{action: "resume"})

      assert {400, _} = call("POST", "/api/v1/jobs/pronunciation-refresh", %{action: "stop"})
    end
  end

  describe "errors" do
    test "unknown v1 routes use the v1 error shape" do
      assert {404, %{"error" => %{"code" => "not_found"}}} = call("GET", "/api/v1/nope")
    end

    test "an exception in a v1 route is a 500 in the v1 shape" do
      LLMStub.stub(fn _model, _conn -> raise "boom" end)

      capture_log(fn ->
        send(
          self(),
          request_raising("POST", "/api/v1/words", auth(), body: %{text: "x", base_langs: ["en"]})
        )
      end)

      assert_received {500, _headers, body}

      assert %{"error" => %{"code" => "internal", "details" => %{"ref" => _}}} =
               Jason.decode!(body)
    end
  end

  # ── legacy routes, as a 0.2 extension uses them ───────────────────────

  describe "legacy GET /api/words" do
    test "returns only active records for English pages, in the 0.2 shape" do
      en = word_fixture(%{gloss: "yes", forms: ["yes", "yeah"]})
      word_fixture(Map.new(@inu_es, fn {k, v} -> {String.to_atom(k), v} end))
      word_fixture(%{native: "нет", gloss: "no"}, "pending")
      [first, second] = en.forms
      {:ok, _} = Words.update(en.uuid, %{forms: [first, %{second | enabled: false}]})

      assert {200, %{"words" => [word]}} = call("GET", "/api/words")

      assert word == %{
               "id" => en.id,
               "lang" => "ru",
               "language" => "Russian",
               "native" => "да",
               "romanization" => "da",
               "english" => "yes",
               "forms" => ["yes"],
               "note" => "The everyday yes."
             }
    end
  end

  describe "legacy POST /api/words" do
    test "a new word is in words; a repeat add says it's already there, with no Undo" do
      stub_answer([
        LLMStub.word(
          native: "спасибо",
          english: "thanks",
          english_forms: ["thanks"],
          note: "Mine"
        )
      ])

      assert {200, %{"words" => [w]} = body} =
               quiet(fn -> call("POST", "/api/words", %{text: "spasibo"}) end)

      refute Map.has_key?(body, "reply")
      assert %{"native" => "спасибо", "english" => "thanks", "forms" => ["thanks"]} = w
      assert is_integer(w["id"])

      stub_answer([
        LLMStub.word(
          native: "спасибо",
          english: "thank you",
          english_forms: ["thank you"],
          note: nil
        )
      ])

      assert {200, %{"words" => [], "reply" => "Already in your list: спасибо"}} =
               quiet(fn -> call("POST", "/api/words", %{text: "spasibo"}) end)

      [saved] = Words.legacy_active()
      assert saved.note == "Mine"
      assert Word.enabled_forms(saved) == ["thanks", "thank you"]
    end

    test "honours client_request_id" do
      stub_answer([LLMStub.word()])
      id = UUID7.generate()

      first =
        quiet(fn ->
          request("POST", "/api/words", auth(), body: %{text: "da", client_request_id: id})
        end)

      again =
        quiet(fn ->
          request("POST", "/api/words", auth(), body: %{text: "da", client_request_id: id})
        end)

      assert first.resp_body == again.resp_body
      assert LLMStub.requests() == ["m1"]
    end

    test "Undo (legacy DELETE) tombstones the word; the id isn't reused" do
      w = word_fixture()
      assert {200, %{"ok" => true}} = call("DELETE", "/api/words/#{w.id}")
      assert {404, %{"error" => _}} = call("DELETE", "/api/words/#{w.id}")
      assert {200, %{"words" => []}} = call("GET", "/api/words")
      assert Words.get(w.uuid).deleted_at
    end
  end
end
