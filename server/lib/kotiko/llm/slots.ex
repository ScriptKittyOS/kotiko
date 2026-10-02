# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.LLM.Slots do
  @moduledoc """
  At most `spec/models.json`'s `concurrency` (2) model calls in flight per server (slice 10
  section 5), so a burst of Telegram messages and popup adds doesn't trip OpenRouter's 20
  requests a minute. Callers queue first come first served; a waiter gives up when its
  own deadline passes. A slot held by a process that dies is freed.
  """
  use GenServer

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @doc """
  Runs `fun` in a slot, waiting at most `wait_ms` for one. Returns `fun`'s result, or
  `{:error, :no_slot}` when none was free in time.
  """
  def run(wait_ms, fun) do
    ref = make_ref()

    case GenServer.call(__MODULE__, {:acquire, ref}) do
      :ok ->
        held(ref, fun)

      :queued ->
        receive do
          {:slot, ^ref} -> held(ref, fun)
        after
          max(wait_ms, 0) ->
            # The slot may have been granted just now: give it back either way.
            GenServer.call(__MODULE__, {:cancel, ref})

            receive do
              {:slot, ^ref} -> GenServer.cast(__MODULE__, {:release, ref})
            after
              0 -> :ok
            end

            {:error, :no_slot}
        end
    end
  end

  defp held(ref, fun) do
    fun.()
  after
    GenServer.cast(__MODULE__, {:release, ref})
  end

  @impl true
  def init(opts) do
    max = Keyword.get(opts, :max, Kotiko.Spec.llm_policy(:concurrency))
    {:ok, %{max: max, held: %{}, queue: :queue.new()}}
  end

  @impl true
  def handle_call({:acquire, ref}, {pid, _}, state) do
    if map_size(state.held) < state.max do
      {:reply, :ok, grant(state, ref, pid)}
    else
      {:reply, :queued, %{state | queue: :queue.in({ref, pid}, state.queue)}}
    end
  end

  def handle_call({:cancel, ref}, _from, state) do
    {:reply, :ok, %{state | queue: :queue.filter(fn {r, _} -> r != ref end, state.queue)}}
  end

  @impl true
  def handle_cast({:release, ref}, state), do: {:noreply, release(state, ref)}

  @impl true
  def handle_info({:DOWN, _mon, :process, pid, _}, state) do
    refs = for {ref, {p, _mon}} <- state.held, p == pid, do: ref
    state = Enum.reduce(refs, state, &release(&2, &1))
    {:noreply, %{state | queue: :queue.filter(fn {_, p} -> p != pid end, state.queue)}}
  end

  defp grant(state, ref, pid) do
    mon = Process.monitor(pid)
    %{state | held: Map.put(state.held, ref, {pid, mon})}
  end

  defp release(state, ref) do
    case Map.pop(state.held, ref) do
      {nil, _} ->
        state

      {{_pid, mon}, held} ->
        Process.demonitor(mon, [:flush])
        next(%{state | held: held})
    end
  end

  defp next(state) do
    case :queue.out(state.queue) do
      {{:value, {ref, pid}}, queue} ->
        send(pid, {:slot, ref})
        grant(%{state | queue: queue}, ref, pid)

      {:empty, _} ->
        state
    end
  end
end
