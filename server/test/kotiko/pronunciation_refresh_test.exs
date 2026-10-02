# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.PronunciationRefreshTest do
  # Slice 07 section 8, with the model stubbed and the clock passed in.
  use Kotiko.DataCase, async: false
  import ExUnit.CaptureLog
  alias Kotiko.{LLMStub, PronunciationRefresh}

  @respellings %{{"ja", "en"} => "ee-noo", {"ja", "es"} => "i-nu"}

  setup do
    Logger.put_process_level(self(), :error)
    :ok
  end

  # Words as the migration leaves them: no pronunciation, origin "migrated".
  defp migrated(attrs, status \\ "active") do
    attrs = attrs |> valid_attrs() |> Map.merge(%{origin: "migrated", status: status})
    {:ok, %{word: w}} = Words.add(attrs)
    w
  end

  defp start_job do
    Repo.query!(
      "UPDATE maintenance_jobs SET state = 'running', done = 0, total = 0, attempts = '{}', " <>
        "retry_at = NULL, finished_at = NULL WHERE name = 'pronunciation_refresh'"
    )
  end

  # Answers every requested (word, base) unless `skip` says otherwise; reports the items.
  defp stub_model(opts \\ []) do
    test = self()

    Req.Test.stub(Kotiko.LLM, fn conn ->
      {:ok, raw, conn} = Plug.Conn.read_body(conn)
      body = Jason.decode!(raw)
      [_, %{"content" => user}] = body["messages"]
      items = Jason.decode!(user)["items"]
      send(test, {:respell, items})
      if fun = opts[:during], do: fun.(items)

      answers =
        for item <- items,
            base <- item["base_langs"],
            not (opts[:skip] || fn _ -> false end).(item["native"]) do
          %{
            lang: item["lang"],
            native: item["native"],
            base_lang: base,
            pronunciation: @respellings[{item["lang"], base}] || "KNEE-ga",
            pronunciation_careful: nil,
            native_vocalized: if(item["lang"] == "ru", do: "кни́ги")
          }
        end

      LLMStub.answer(conn, %{items: answers})
    end)
  end

  defp run_until_done(limit \\ 10) do
    Enum.reduce_while(1..limit, nil, fn _, _ ->
      case PronunciationRefresh.step() do
        :done -> {:halt, :done}
        {:continue, _} -> {:cont, :continue}
        other -> {:halt, other}
      end
    end)
  end

  defp requests do
    receive do
      {:respell, items} -> [items | requests()]
    after
      0 -> []
    end
  end

  test "fills every eligible word in requests of at most 20 words and changes nothing else" do
    words =
      for i <- 1..25,
          do: migrated(%{native: "книга#{i}", gloss: "word#{i}", romanization: "kniga#{i}"})

    es =
      migrated(%{lang: "ja", native: "犬", base_lang: "es", gloss: "perro", romanization: "inu"})

    en = migrated(%{lang: "ja", native: "犬", base_lang: "en", gloss: "dog", romanization: "inu"})
    pending = migrated(%{native: "нет", gloss: "no"}, "pending")
    no_key = migrated(%{native: "кот", base_lang: "de", gloss: "Katze"})
    start_job()
    stub_model()

    assert run_until_done() == :done

    batches = requests()
    assert Enum.map(batches, &length/1) == [20, 6]
    # One item per target word, with every base that needs a pronunciation.
    assert %{"base_langs" => ["es", "en"]} =
             Enum.find(List.flatten(batches), &(&1["native"] == "犬"))

    for w <- words ++ [es, en] do
      after_ = Repo.get(Word, w.id)
      assert after_.pronunciation_source == "model"
      assert after_.pronunciation

      ignore =
        ~w(pronunciation pronunciation_careful pronunciation_source native_vocalized updated_at seq __meta__)a

      assert Map.drop(after_, ignore) == Map.drop(w, ignore)
    end

    assert Repo.get(Word, es.id).pronunciation == "i-nu"
    assert Repo.get(Word, en.id).pronunciation == "ee-noo"

    # native_vocalized only where it was null, and only when it checks out ("книга" != "кни́ги").
    assert Repo.get(Word, hd(words).id).native_vocalized == nil
    assert Repo.get(Word, pending.id).pronunciation == nil
    assert Repo.get(Word, no_key.id).pronunciation == nil

    assert %{state: "done", done: 27, total: 27} = PronunciationRefresh.status()
    # Done stays done: no request after a restart.
    assert PronunciationRefresh.step() == :done
    start_supervised!({PronunciationRefresh, first_run: 0})
    Process.sleep(50)
    assert requests() == []
  end

  test "a word the learner edits during the request is left alone" do
    w = migrated(%{native: "пожалуйста", gloss: "please"})
    start_job()

    stub_model(
      during: fn _items ->
        {:ok, _} = Words.update(w.uuid, %{pronunciation: "pa-ZHAL-sta"})
      end
    )

    assert {:continue, 0} = PronunciationRefresh.step()
    assert %{pronunciation: "pa-ZHAL-sta", pronunciation_source: "user"} = Repo.get(Word, w.id)
    assert PronunciationRefresh.step() == :done
  end

  test "a word with a missing answer twice is skipped" do
    good = migrated(%{native: "книга", gloss: "word"})
    bad = migrated(%{native: "плохо", gloss: "bad"})
    start_job()
    stub_model(skip: &(&1 == "плохо"))

    assert {:continue, 1} = PronunciationRefresh.step()
    assert {:continue, 0} = PronunciationRefresh.step()
    assert PronunciationRefresh.step() == :done
    assert length(requests()) == 2
    assert Repo.get(Word, good.id).pronunciation == "KNEE-ga"
    assert Repo.get(Word, bad.id).pronunciation == nil
  end

  test "waits with 10 lookups left, until the quota resets" do
    migrated(%{native: "книга", gloss: "word"})
    start_job()
    stub_model()
    put_app_env(:llm_url, "https://openrouter.ai/api/v1")
    Kotiko.LLM.Quota.put(%{"free_model_daily_requests" => %{"remaining" => 10}})
    resets = Kotiko.LLM.Quota.next_midnight(DateTime.utc_now())

    assert {:wait, ^resets} = PronunciationRefresh.step()
    assert %{state: "waiting", retry_at: retry_at} = PronunciationRefresh.status()
    assert retry_at == Kotiko.Word.timestamp(resets)
    assert {:wait, again} = PronunciationRefresh.step()
    assert DateTime.compare(again, resets) == :eq
    assert requests() == []

    Kotiko.LLM.Quota.put(%{"free_model_daily_requests" => %{"remaining" => 40}})
    assert {:continue, 1} = PronunciationRefresh.step(now: DateTime.add(resets, 1, :second))
  end

  test "a daily limit waits until midnight UTC; a rate limit a minute; one request each" do
    migrated(%{native: "книга", gloss: "word"})
    start_job()
    now = ~U[2026-10-02 15:00:00.000000Z]

    LLMStub.stub(fn _, conn ->
      LLMStub.status(conn, 429, "Rate limit exceeded: free-models-per-day")
    end)

    midnight = Kotiko.LLM.Quota.next_midnight(DateTime.utc_now())
    assert {:wait, ^midnight} = PronunciationRefresh.step(now: now)
    assert {:wait, _} = PronunciationRefresh.step(now: now)
    # OpenRouter's own limit is shared by every free model: no second model is asked.
    assert length(LLMStub.requests()) == 1

    LLMStub.stub(fn _, conn -> LLMStub.rate_limited(conn) end)
    later = DateTime.add(midnight, 1, :second)
    assert {:wait, at} = PronunciationRefresh.step(now: later)
    assert_in_delta DateTime.diff(at, DateTime.utc_now()), 60, 2
  end

  test "with no provider set up it waits" do
    migrated(%{native: "книга", gloss: "word"})
    start_job()
    put_app_env(:llm_api_key, nil)
    put_app_env(:llm_url, "https://openrouter.ai/api/v1")

    assert {:wait, nil} = PronunciationRefresh.step()
    assert %{state: "waiting", retry_at: nil} = PronunciationRefresh.status()
  end

  test "pause and resume, and a learner's lookup goes first" do
    migrated(%{native: "книга", gloss: "word"})
    start_job()
    stub_model()

    assert %{state: "paused"} = PronunciationRefresh.control(:pause)
    assert PronunciationRefresh.step() == :paused
    assert %{state: "running"} = PronunciationRefresh.control(:resume)

    test = self()

    task =
      Task.async(fn ->
        Kotiko.Lookup.busy(fn ->
          send(test, :busy)

          receive do
            :go -> :ok
          end
        end)
      end)

    assert_receive :busy
    assert PronunciationRefresh.step() == :busy
    send(task.pid, :go)
    Task.await(task)

    assert {:continue, 1} = capture_log_result(fn -> PronunciationRefresh.step() end)
  end

  defp capture_log_result(fun) do
    {result, _} = with_log(fun)
    result
  end
end
