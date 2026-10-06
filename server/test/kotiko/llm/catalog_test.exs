# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.LLM.CatalogTest do
  # Slice 10 section 1: which models, in what order. The /models answer is
  # test/fixtures/openrouter/models-2026-10-01.json (17 free models, 6 with JSON mode).
  use Kotiko.DataCase, async: false
  alias Kotiko.LLM.Catalog
  alias Kotiko.LLMStub

  @moduletag :capture_log
  @models Path.expand("../../../../test/fixtures/openrouter/models-2026-10-01.json", __DIR__)
          |> File.read!()
          |> Jason.decode!()
          |> Map.fetch!("data")
  @now ~U[2026-10-01 12:00:00Z]

  setup do
    put_app_env(:llm_url, "https://openrouter.ai/api/v1")
    put_app_env(:llm_model_source, :default)
    put_app_env(:llm_models, Kotiko.Config.default_models())
    File.rm(cache_file())
    on_exit(fn -> File.rm(cache_file()) end)
    :ok
  end

  defp cache_file, do: Path.join(Application.fetch_env!(:kotiko, :data_dir), "models-cache.json")
  defp ids(kind \\ :lookup), do: Enum.map(Catalog.chain(kind), & &1.id)

  defp restart do
    :ok = Supervisor.terminate_child(Kotiko.Supervisor, Catalog)
    {:ok, _} = Supervisor.restart_child(Kotiko.Supervisor, Catalog)
  end

  describe "filter/2" do
    test "keeps free models with JSON mode, without mandatory reasoning or a deny match" do
      {entries, caps} = Catalog.filter(@models, @now)

      assert Enum.map(entries, & &1.id) |> Enum.sort() == [
               "apodex/apodex-1.1-mini:free",
               "dots-studio/dots-3-note-preview:free",
               "google/gemma-4-31b-it:free",
               "nvidia/nemotron-3-super-120b-a12b:free"
             ]

      # Every model's capabilities are known, for an explicit LLM_MODEL.
      assert caps["qwen/qwen3.8-27b:free"] == %{
               json_mode: false,
               reasoning_toggle: true,
               max_tokens: true,
               free: true
             }

      assert caps["anthropic/claude-sonnet-5"].free == false
      assert caps["openrouter/free"].free == true
    end

    test "each rule on its own" do
      ok = %{
        "id" => "x/ok:free",
        "created" => 1,
        "context_length" => 32_000,
        "architecture" => %{"output_modalities" => ["text"]},
        "supported_parameters" => ["response_format", "max_tokens"],
        "pricing" => %{"prompt" => "0", "completion" => "0"},
        "expiration_date" => nil
      }

      kept? = fn m -> match?({[_], _}, Catalog.filter([m], @now)) end
      assert kept?.(ok)
      assert kept?.(%{ok | "id" => "x/zero-priced"})

      refute kept?.(%{
               ok
               | "id" => "x/paid",
                 "pricing" => %{"prompt" => "0.1", "completion" => "0"}
             })

      refute kept?.(put_in(ok, ["architecture", "output_modalities"], ["image"]))
      refute kept?.(%{ok | "supported_parameters" => ["max_tokens"]})
      assert kept?.(%{ok | "supported_parameters" => ["structured_outputs"]})
      refute kept?.(%{ok | "expiration_date" => "2026-10-02"})
      assert kept?.(%{ok | "expiration_date" => "2026-10-05"})
      refute kept?.(Map.put(ok, "reasoning", %{"mandatory" => true}))
      assert kept?.(Map.put(ok, "reasoning", %{"mandatory" => false}))
      refute kept?.(%{ok | "context_length" => 4096})
      refute kept?.(%{ok | "id" => "x/qwen-coder:free"})
      refute kept?.(%{ok | "id" => "meta/llama-guard-4:free"})
      refute kept?.(%{ok | "id" => "openrouter/free"})
    end
  end

  describe "the chain" do
    test "the live list: the evaluated order first, then the newest" do
      LLMStub.stub(fn _, conn -> LLMStub.answer(conn, %{}) end, models: @models)
      assert :ok = Catalog.refresh()

      assert ids() == [
               "nvidia/nemotron-3-super-120b-a12b:free",
               "dots-studio/dots-3-note-preview:free",
               "apodex/apodex-1.1-mini:free",
               "google/gemma-4-31b-it:free"
             ]

      assert ids(:respell) == [
               "dots-studio/dots-3-note-preview:free",
               "apodex/apodex-1.1-mini:free",
               "nvidia/nemotron-3-super-120b-a12b:free",
               "google/gemma-4-31b-it:free"
             ]

      refute "liquid/lfm-2.5-2.6b:free" in ids()
      assert %{source: "live", fetched_at: %DateTime{}} = Catalog.status()
    end

    test "with the network down and no cache: the shipped fallback list" do
      LLMStub.stub(fn _, conn -> LLMStub.answer(conn, %{}) end,
        models: fn conn -> Req.Test.transport_error(conn, :econnrefused) end
      )

      assert {:error, _} = Catalog.refresh()
      assert ids() == Kotiko.Spec.models()["fallback"]
      assert hd(ids()) == "nvidia/nemotron-3-super-120b-a12b:free"
      assert %{source: "fallback"} = Catalog.status()
    end

    test "a fetched list is saved, and used after a restart until the next fetch" do
      LLMStub.stub(fn _, conn -> LLMStub.answer(conn, %{}) end, models: @models)
      :ok = Catalog.refresh()
      assert File.exists?(cache_file())

      restart()
      assert %{source: "cache"} = Catalog.status()
      assert length(ids()) == 4
      assert hd(Catalog.chain()).caps.json_mode
    end

    test "a cache older than 7 days is ignored" do
      LLMStub.stub(fn _, conn -> LLMStub.answer(conn, %{}) end, models: @models)
      :ok = Catalog.refresh()

      old = DateTime.add(DateTime.utc_now(), -8, :day) |> DateTime.to_iso8601()
      json = cache_file() |> File.read!() |> Jason.decode!() |> Map.put("fetched_at", old)
      File.write!(cache_file(), Jason.encode!(json))

      restart()
      assert %{source: "fallback"} = Catalog.status()
    end

    test "LLM_MODEL is used verbatim, even ids the catalog doesn't know" do
      put_app_env(:llm_model_source, :env)
      put_app_env(:llm_models, ["a/not-listed", "qwen/qwen3.8-27b:free"])
      LLMStub.stub(fn _, conn -> LLMStub.answer(conn, %{}) end, models: @models)
      :ok = Catalog.refresh()

      assert [%{id: "a/not-listed", caps: unknown}, %{id: "qwen/qwen3.8-27b:free", caps: qwen}] =
               Catalog.chain()

      assert unknown.json_mode and not unknown.max_tokens
      # Known: no JSON mode, so no response_format is sent.
      refute qwen.json_mode
      assert %{source: "env"} = Catalog.status()
    end

    test "only on OpenRouter" do
      put_app_env(:llm_url, "http://localhost:11434/v1")
      LLMStub.stub(fn _, _ -> raise "no request expected" end)
      assert :ok = Catalog.refresh()
      assert LLMStub.gets() == []
    end
  end

  describe "health" do
    setup do
      LLMStub.stub(fn _, conn -> LLMStub.answer(conn, %{}) end, models: @models)
      :ok = Catalog.refresh()
      :ok
    end

    test "a success moves a model to the front of its chain for an hour" do
      Catalog.report("apodex/apodex-1.1-mini:free", :lookup, :success)
      assert hd(ids()) == "apodex/apodex-1.1-mini:free"
      # Respellings keep their own order.
      assert hd(ids(:respell)) == "dots-studio/dots-3-note-preview:free"
      # A failure takes the promotion away.
      Catalog.report("apodex/apodex-1.1-mini:free", :lookup, :failure)
      assert hd(ids()) == "nvidia/nemotron-3-super-120b-a12b:free"
    end

    test "three failures skip a model for 10 minutes; not found for an hour" do
      nemotron = "nvidia/nemotron-3-super-120b-a12b:free"
      for _ <- 1..2, do: Catalog.report(nemotron, :lookup, :failure)
      assert hd(ids()) == nemotron
      Catalog.report(nemotron, :lookup, :failure)
      refute nemotron in ids()
      assert [%{id: ^nemotron}] = Catalog.status().skipped

      Catalog.report("dots-studio/dots-3-note-preview:free", :lookup, :skip_long)
      refute "dots-studio/dots-3-note-preview:free" in ids()
    end

    test "with every model skipped, none is" do
      for id <- ids(), _ <- 1..3, do: Catalog.report(id, :lookup, :failure)
      assert length(ids()) == 4
    end
  end
end
