# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.LLM.QuotaTest do
  # Slice 10 section 3: the free lookups left today, from a stubbed GET /key.
  use Kotiko.DataCase, async: false
  alias Kotiko.LLMStub
  alias Kotiko.LLM.{Quota, Slots}

  @moduletag :capture_log

  setup do
    put_app_env(:llm_url, "https://openrouter.ai/api/v1")

    LLMStub.stub(fn _, _ -> raise "no model call expected" end,
      key: %{used: 12, limit: 50, remaining: 38}
    )

    :ok
  end

  test "reads used, limit and remaining from /key, with the next UTC midnight as the reset" do
    assert %{used: 12, limit: 50, remaining: 38, estimated: false, resets_at: at} =
             Quota.refresh()

    assert at == Quota.next_midnight(DateTime.utc_now())
    assert at.hour == 0 and DateTime.compare(at, DateTime.utc_now()) == :gt
  end

  test "counts down an estimate between reads" do
    Quota.refresh()
    Quota.counted()
    Quota.counted()
    assert %{remaining: 36, used: 14, estimated: true} = Quota.snapshot()
  end

  test "the gate closes at 0 and opens after the reset" do
    Quota.put(%{"free_model_daily_requests" => %{"remaining" => 1}})
    assert Quota.check() == :ok
    Quota.counted()
    assert {:exhausted, %DateTime{}} = Quota.check()

    # Numbers read yesterday don't count today.
    Quota.put(
      %{"free_model_daily_requests" => %{"remaining" => 0}},
      DateTime.add(DateTime.utc_now(), -1, :day)
    )

    assert Quota.snapshot() == nil
    assert Quota.check() == :ok
  end

  test "low?/1 keeps the last 10 for the learner" do
    Quota.put(%{"free_model_daily_requests" => %{"remaining" => 11}})
    assert Quota.low?() == nil
    Quota.counted()
    assert %DateTime{} = Quota.low?()
  end

  test "unknown without a key, on another provider, or when /key doesn't say" do
    Quota.put(%{"label" => "x"})
    assert Quota.snapshot() == nil
    assert Quota.low?() == nil

    Quota.refresh()
    put_app_env(:llm_api_key, nil)
    assert Quota.snapshot() == nil
    put_app_env(:llm_api_key, "k")
    put_app_env(:llm_url, "http://localhost:11434/v1")
    assert Quota.snapshot() == nil
    assert Quota.refresh() == nil
  end

  test "maybe_refresh reads /key at most once every 5 minutes" do
    Quota.maybe_refresh()
    Quota.maybe_refresh()
    assert LLMStub.gets() == ["/api/v1/key"]
  end

  describe "Slots" do
    test "a waiter gives up at its deadline, and a dead holder frees its slot" do
      test = self()

      holders =
        for _ <- 1..2 do
          spawn(fn ->
            Slots.run(1_000, fn ->
              send(test, :holding)
              Process.sleep(:infinity)
            end)
          end)
        end

      assert_receive :holding
      assert_receive :holding
      assert Slots.run(30, fn -> :ran end) == {:error, :no_slot}
      Enum.each(holders, &Process.exit(&1, :kill))
      assert Slots.run(500, fn -> :ran end) == :ran
    end
  end
end
