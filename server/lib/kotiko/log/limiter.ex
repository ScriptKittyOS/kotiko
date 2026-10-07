# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Log.Limiter do
  @moduledoc """
  Keeps log lines about strangers' requests (a refused `Host` name, wrong API tokens) to
  at most one per key in each window (an hour by default), so nobody can flood the log
  by sending requests.

  The table holds at most `max_keys` keys per window. When it is full, new keys aren't
  logged until the window ends: the caller logs one line saying so (`:overflow`), and
  at the start of the next window one more with how many keys went unlogged. Clearing
  the table instead would let the same keys log again, without limit (slice 54, B-04).

  The checks aren't one atomic step: two requests at the same moment can each log a
  line. That only adds a line or two; it never removes the limit.
  """

  @window_row :__window__

  @doc "Creates the named table `table` if it isn't there yet."
  def init(table) do
    if :ets.whereis(table) == :undefined do
      :ets.new(table, [:named_table, :public, :set, write_concurrency: true])
    end

    :ok
  end

  @doc "Forgets every key and the current window (for tests)."
  def reset(table) do
    if :ets.whereis(table) != :undefined, do: :ets.delete_all_objects(table)
    :ok
  end

  @doc """
  Whether to log a line for `key` now: `:log` the first time in this window, `:overflow`
  for the first key that didn't fit (log one line saying new keys aren't logged until the
  window ends), else `:quiet`. The second element is the number of keys that went unlogged
  in the window that just ended, or nil: log it once.

  Options: `:window_ms` (default one hour) and `:max_keys` (default 1,000). Without the
  table (it is made at boot), every call is `:log`.
  """
  @spec check(atom(), term(), keyword()) :: {:log | :overflow | :quiet, nil | pos_integer()}
  def check(table, key, opts \\ []) do
    if :ets.whereis(table) == :undefined do
      {:log, nil}
    else
      now = System.monotonic_time(:millisecond)
      rolled = roll(table, now, Keyword.get(opts, :window_ms, :timer.hours(1)))
      {decide(table, key, now, Keyword.get(opts, :max_keys, 1_000)), rolled}
    end
  end

  # Starts a new window when the current one is over; returns the old one's unlogged count.
  defp roll(table, now, window_ms) do
    case :ets.lookup(table, @window_row) do
      [{_, started, _unlogged}] when now - started < window_ms ->
        nil

      [{_, _started, unlogged}] ->
        :ets.delete_all_objects(table)
        :ets.insert(table, {@window_row, now, 0})
        if unlogged > 0, do: unlogged

      [] ->
        :ets.insert_new(table, {@window_row, now, 0})
        nil
    end
  end

  defp decide(table, key, now, max_keys) do
    cond do
      :ets.member(table, {:key, key}) ->
        :quiet

      # One row is the window's own.
      :ets.info(table, :size) - 1 < max_keys ->
        if :ets.insert_new(table, {{:key, key}}), do: :log, else: :quiet

      true ->
        case :ets.update_counter(table, @window_row, {3, 1}, {@window_row, now, 0}) do
          1 -> :overflow
          _ -> :quiet
        end
    end
  end
end
