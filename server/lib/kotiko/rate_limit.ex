# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.RateLimit do
  @moduledoc """
  Counts requests per client address in fixed windows, in one ETS table: wrong API tokens
  (`Kotiko.Router`, slice 54 B-09) and token proofs (`POST /api/v1/proof`).

  A client is its IPv4 address, or the /64 network of its IPv6 address (one machine
  usually has a whole /64, so counting single IPv6 addresses would let it pick a new one
  for every request). An IPv4-mapped IPv6 address counts as the IPv4 one.

  The table holds at most 10,000 counters, so spreading requests over many addresses
  can't grow memory without bound. When it is full, counters whose window is over are
  dropped; if it is still full, a new client isn't counted until there is room. Sharing
  one counter between all new clients instead would let someone with many addresses
  lock the owner out, which this throttle must never do.

  Without the table (it is made at boot), nothing is counted.
  """

  import Bitwise

  @table __MODULE__
  @max_entries 10_000

  @doc "Creates the table if it isn't there yet."
  def init do
    if :ets.whereis(@table) == :undefined do
      :ets.new(@table, [:named_table, :public, :set, write_concurrency: true])
    end

    :ok
  end

  @doc "Forgets every count (for tests)."
  def reset do
    if :ets.whereis(@table) != :undefined, do: :ets.delete_all_objects(@table)
    :ok
  end

  # Headers a reverse proxy adds for the client it forwards (any value, any case).
  @forwarding ~w(forwarded x-forwarded-for x-real-ip x-forwarded-host cf-connecting-ip true-client-ip)

  @doc """
  Who a request counts as for the proof limit and the wrong-token lockout (slice 54, D-02):

    * `:local`: a loopback peer with no forwarding header. Every program on this computer,
      and any web page in a browser here, shares it, so a limit there would let any of
      them lock the extension out: it is never limited.
    * `{:proxied, peer}`: a loopback peer with a forwarding header, as a reverse proxy on
      this computer (Caddy, nginx) sends every remote client. Limited, all of them
      together: the header's claimed client address can be forged, so it isn't used.
      A local program that adds such a header can only lock out this bucket, never the
      extension, which sends none.
    * otherwise the peer's address as `client/1` counts it.
  """
  def peer(%Plug.Conn{remote_ip: ip, req_headers: headers}) do
    cond do
      not loopback?(ip) ->
        client(ip)

      Enum.any?(headers, fn {name, _} -> String.downcase(name) in @forwarding end) ->
        {:proxied, client(ip)}

      true ->
        :local
    end
  end

  @doc "Whether `remote_ip` is this computer: 127.0.0.0/8, `::1`, or an IPv4-mapped 127.x."
  def loopback?({127, _, _, _}), do: true
  def loopback?({0, 0, 0, 0, 0, 0, 0, 1}), do: true
  def loopback?({0, 0, 0, 0, 0, 0xFFFF, ab, _}), do: ab >>> 8 == 127
  def loopback?(_), do: false

  @doc "The key `remote_ip` is counted under."
  def client({_, _, _, _} = ip), do: ip
  def client({0, 0, 0, 0, 0, 0xFFFF, ab, cd}), do: {ab >>> 8, ab &&& 0xFF, cd >>> 8, cd &&& 0xFF}
  def client({a, b, c, d, _, _, _, _}), do: {a, b, c, d, :"/64"}
  def client(other), do: other

  @doc """
  Counts one more `kind` of request from `client` in a window of `window_ms`. Returns
  `{count, seconds_left}`: the count in the current window, this one included, and the
  whole seconds until it ends (at least 1).
  """
  def hit(kind, client, window_ms) do
    now = System.monotonic_time(:millisecond)
    key = {kind, client}

    with true <- :ets.whereis(@table) != :undefined,
         true <- room_for?(key, now) do
      case :ets.lookup(@table, key) do
        [{_, ends, _count}] when ends > now ->
          {:ets.update_counter(@table, key, {3, 1}), seconds(ends - now)}

        _ ->
          :ets.insert(@table, {key, now + window_ms, 1})
          {1, seconds(window_ms)}
      end
    else
      false -> {0, 0}
    end
  end

  @doc "Like `hit/3`, without counting: `{count, seconds_left}`, `{0, 0}` when none."
  def peek(kind, client) do
    now = System.monotonic_time(:millisecond)

    with true <- :ets.whereis(@table) != :undefined,
         [{_, ends, count}] when ends > now <- :ets.lookup(@table, {kind, client}) do
      {count, seconds(ends - now)}
    else
      _ -> {0, 0}
    end
  end

  defp room_for?(key, now) do
    :ets.member(@table, key) or :ets.info(@table, :size) < @max_entries or
      (drop_expired(now) > 0 and :ets.info(@table, :size) < @max_entries)
  end

  defp drop_expired(now),
    do: :ets.select_delete(@table, [{{:_, :"$1", :_}, [{:"=<", :"$1", now}], [true]}])

  defp seconds(ms), do: max(1, div(ms + 999, 1000))
end
