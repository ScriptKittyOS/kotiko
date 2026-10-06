# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.LLM.CacheTest do
  # Slice 10's lookup cache: what it keeps, and the single flight that makes concurrent
  # lookups of the same text share one model call. llm_test.exs covers the cache through
  # whole lookups; these tests drive Cache.run/3 directly, with each caller in its own
  # process and every wait a condition, not a sleep.
  use Kotiko.DataCase, async: false
  alias Kotiko.LLM.Cache

  defp key, do: "test-#{System.unique_integer([:positive])}"

  # A leader that runs until told to go on, then returns or raises.
  defp start_leader(key) do
    test = self()

    pid =
      spawn(fn ->
        result =
          try do
            Cache.run(key, 5_000, fn ->
              send(test, {:leading, self()})

              receive do
                :return -> :leader_result
                :raise -> raise "model call failed"
              end
            end)
          rescue
            e -> {:raised, Exception.message(e)}
          end

        send(test, {:leader_done, result})
      end)

    assert_receive {:leading, ^pid}
    pid
  end

  defp waiter(key, wait_ms, fun \\ fn -> :waiter_ran_it end),
    do: Task.async(fn -> Cache.run(key, wait_ms, fun) end)

  # Waits until `n` callers wait on `key`.
  defp await_waiters(key, n) do
    case :sys.get_state(Cache).flights do
      %{^key => %{waiters: w}} when length(w) == n -> :ok
      _ -> await_waiters(key, n)
    end
  end

  test "callers that join a running lookup share the leader's result" do
    key = key()
    leader = start_leader(key)
    a = waiter(key, 5_000)
    b = waiter(key, 5_000)
    await_waiters(key, 2)

    send(leader, :return)

    assert Task.await(a) == {:shared, :leader_result}
    assert Task.await(b) == {:shared, :leader_result}
    assert_receive {:leader_done, :leader_result}
    refute Map.has_key?(:sys.get_state(Cache).flights, key)
  end

  test "when the leader's call raises, the leader sees the error and a waiter runs it itself" do
    key = key()
    leader = start_leader(key)
    task = waiter(key, 5_000)
    await_waiters(key, 1)

    send(leader, :raise)

    assert_receive {:leader_done, {:raised, "model call failed"}}
    assert Task.await(task) == :waiter_ran_it
  end

  test "when the leader dies, a waiter runs the lookup itself" do
    key = key()
    leader = start_leader(key)
    task = waiter(key, 5_000)
    await_waiters(key, 1)

    Process.exit(leader, :kill)

    assert Task.await(task) == :waiter_ran_it
    refute Map.has_key?(:sys.get_state(Cache).flights, key)
  end

  test "a waiter that waits too long gives up and leaves the flight" do
    key = key()
    leader = start_leader(key)

    assert Task.await(waiter(key, 20)) == {:error, :wait_timeout}
    await_waiters(key, 0)

    send(leader, :return)
    assert_receive {:leader_done, :leader_result}
  end

  test "an unknown process going down, or leaving a finished flight, changes nothing" do
    state = :sys.get_state(Cache)
    send(Cache, {:DOWN, make_ref(), :process, self(), :normal})
    GenServer.cast(Cache, {:leave, key(), make_ref()})
    assert :sys.get_state(Cache) == state
  end

  describe "the kept lookups" do
    test "a result without words isn't kept" do
      key = key()
      assert Cache.put(key, %{words: []}, "m1") == :ok
      assert Cache.get(key) == :miss
    end

    test "a row that can't be read is a miss, not an error" do
      key = key()
      at = Word.timestamp(Words.now())

      Repo.insert_all("lookup_cache", [
        %{key: key, result: "not base64!", model: "m1", inserted_at: at, last_hit_at: at, hits: 0}
      ])

      assert Cache.get(key) == :miss
    end

    test "clear/0 removes every entry, prune/0 keeps the recent ones" do
      assert Cache.put(key(), %{words: [%{native: "да"}]}, "m1") == :ok
      assert Cache.put(key(), %{words: [%{native: "нет"}]}, "m1") == :ok
      assert Cache.prune() == 0
      assert Cache.count() == 2

      assert Cache.clear() == 2
      assert Cache.count() == 0
    end
  end
end
