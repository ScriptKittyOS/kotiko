# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.WriteLock do
  @moduledoc """
  One write transaction at a time within this server, first come first served.

  SQLite allows one writer anyway, and the repo's immediate transactions already make
  read-merge-write safe. But writers that queue inside SQLite poll with growing sleeps,
  so twenty adds at once could take seconds and the last could pass the 5-second busy
  timeout. Queueing here is fair and instant; SQLite's busy timeout is left for other
  programs that open the file.

  Re-entrant: a nested `run/1` in the process holding the lock just runs. When the lock
  process isn't running (a script without the application), `run/1` just runs too.
  """
  use GenServer

  def start_link(_opts), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  @doc "Runs `fun` holding the lock."
  def run(fun) do
    if Process.get(__MODULE__) || is_nil(Process.whereis(__MODULE__)) do
      fun.()
    else
      :ok = GenServer.call(__MODULE__, :acquire, :infinity)
      Process.put(__MODULE__, true)

      try do
        fun.()
      after
        Process.delete(__MODULE__)
        GenServer.cast(__MODULE__, {:release, self()})
      end
    end
  end

  @impl true
  def init(nil), do: {:ok, %{holder: nil, queue: :queue.new()}}

  @impl true
  def handle_call(:acquire, {pid, _} = from, %{holder: nil} = state) do
    GenServer.reply(from, :ok)
    {:noreply, %{state | holder: {pid, Process.monitor(pid)}}}
  end

  def handle_call(:acquire, from, state) do
    {:noreply, %{state | queue: :queue.in(from, state.queue)}}
  end

  @impl true
  def handle_cast({:release, pid}, %{holder: {pid, ref}} = state) do
    Process.demonitor(ref, [:flush])
    {:noreply, next(%{state | holder: nil})}
  end

  def handle_cast({:release, _pid}, state), do: {:noreply, state}

  # The holder died without releasing (its transaction was rolled back by then).
  @impl true
  def handle_info({:DOWN, ref, :process, _pid, _reason}, %{holder: {_, ref}} = state) do
    {:noreply, next(%{state | holder: nil})}
  end

  def handle_info({:DOWN, _ref, :process, _pid, _reason}, state), do: {:noreply, state}

  defp next(state) do
    case :queue.out(state.queue) do
      {:empty, _} ->
        state

      {{:value, {pid, _} = from}, queue} ->
        if Process.alive?(pid) do
          GenServer.reply(from, :ok)
          %{state | holder: {pid, Process.monitor(pid)}, queue: queue}
        else
          next(%{state | queue: queue})
        end
    end
  end
end
