# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.AuthThrottle do
  @moduledoc """
  Slows down guessing the API token (slice 54, B-09 and C-09). After
  `auth_failures_per_minute` wrong tokens (default 10) from one address within a minute,
  that address gets `429` with `Retry-After` on every route that needs the token, the
  right token included, until the minute is over: a guesser can't tell a right guess
  from a wrong one while it waits. Other addresses are never affected.

  Only a wrong `Bearer` token counts; a request with no token or another scheme can't be
  a guess. Addresses are counted as `Kotiko.RateLimit.client/1` says (an IPv6 /64 is one).
  Each lockout is logged once an hour per address, for at most 100 addresses an hour
  (`Kotiko.Log.Limiter`). `auth_failures_per_minute: nil` turns the throttle off (tests).

  Behind a reverse proxy on the same machine every request comes from the proxy's
  address, so a lockout applies to everyone behind it for the rest of that minute.
  """
  require Logger
  alias Kotiko.Log.Limiter
  alias Kotiko.RateLimit

  @kind :auth_failures
  @window_ms :timer.minutes(1)
  @log_table Kotiko.AuthThrottle.Log
  @max_logged 100

  @doc "Creates the tables (at boot)."
  def init do
    RateLimit.init()
    Limiter.init(@log_table)
  end

  @doc "Forgets every count and logged lockout (for tests)."
  def reset do
    RateLimit.reset()
    Limiter.reset(@log_table)
  end

  @doc "`:ok`, or `{:locked, seconds_left}` when `remote_ip` sent too many wrong tokens."
  def check(remote_ip) do
    with limit when is_integer(limit) <- limit(),
         {count, seconds} when count >= limit <-
           RateLimit.peek(@kind, RateLimit.client(remote_ip)) do
      {:locked, seconds}
    else
      _ -> :ok
    end
  end

  @doc "Counts a wrong token from `remote_ip`; logs the lockout when it starts."
  def failed(remote_ip) do
    with limit when is_integer(limit) <- limit() do
      client = RateLimit.client(remote_ip)
      {count, _seconds} = RateLimit.hit(@kind, client, @window_ms)
      if count == limit, do: log_lockout(client, limit)
    end

    :ok
  end

  defp limit, do: Application.get_env(:kotiko, :auth_failures_per_minute, 10)

  defp log_lockout(client, limit) do
    {decision, unlogged} = Limiter.check(@log_table, client, max_keys: @max_logged)

    if unlogged do
      Logger.warning(
        "Didn't log #{unlogged} more addresses that sent too many wrong API tokens in the " <>
          "last hour (too many)."
      )
    end

    case decision do
      :log ->
        Logger.warning(
          "#{limit} wrong API tokens from #{format(client)} in a minute: refusing its " <>
            "requests until the minute is over. If that's you, check the token in the " <>
            "extension's Connection settings."
        )

      :overflow ->
        Logger.warning(
          "#{@max_logged} addresses sent too many wrong API tokens this hour; not logging " <>
            "new ones until the hour is over."
        )

      :quiet ->
        :ok
    end
  end

  defp format({a, b, c, d, :"/64"}),
    do: Enum.map_join([a, b, c, d], ":", &String.downcase(Integer.to_string(&1, 16))) <> "::/64"

  defp format(ip) when is_tuple(ip), do: to_string(:inet.ntoa(ip))
  defp format(other), do: inspect(other)
end
