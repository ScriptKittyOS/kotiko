# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Listener do
  @moduledoc """
  The HTTP listeners for the address in BIND.

  Browsers look up `localhost` themselves and try the IPv6 loopback address `::1` first.
  A server listening only on `127.0.0.1` leaves `[::1]` at the same port free, so another
  account on the computer could listen there and receive the token the extension sends to
  `http://localhost:4747` (slice 54, B-01). So a loopback BIND (the default `127.0.0.1`,
  `localhost` or `::1`) also listens on the other loopback address, and `0.0.0.0` (every
  IPv4 address) also on `::1`; `::` is made dual-stack, so it covers IPv4 too.

  The extra address is optional: on a machine without IPv6 the server starts on
  `127.0.0.1` alone and logs a line. Someone else already listening on either address
  stops the start (status 1), with a message saying so.
  """
  require Logger

  @ipv4_loopback {127, 0, 0, 1}
  @ipv6_loopback {0, 0, 0, 0, 0, 0, 0, 1}
  @ipv4_any {0, 0, 0, 0}
  @ipv6_any {0, 0, 0, 0, 0, 0, 0, 0}
  # The machine has no such address (IPv6 turned off, or no ::1 configured).
  @unavailable [:eaddrnotavail, :eafnosupport, :eprotonosupport]

  @doc """
  The addresses to listen on for BIND's address, each `:required` or `:optional`.
  """
  def addresses(@ipv4_loopback), do: [{@ipv4_loopback, :required}, {@ipv6_loopback, :optional}]
  def addresses(@ipv6_loopback), do: [{@ipv6_loopback, :required}, {@ipv4_loopback, :optional}]
  def addresses(@ipv4_any), do: [{@ipv4_any, :required}, {@ipv6_loopback, :optional}]
  def addresses(ip), do: [{ip, :required}]

  @doc "One child spec per address in `addresses/1`, for `plug` on `port`."
  def child_specs(ip, port, plug \\ Kotiko.Router) do
    for {address, need} <- addresses(ip),
        do: child_spec(plug: plug, ip: address, port: port, need: need)
  end

  @doc "The child spec for `start_link/1`."
  def child_spec(opts) do
    %{id: {__MODULE__, opts[:ip]}, start: {__MODULE__, :start_link, [opts]}, type: :supervisor}
  end

  @doc """
  Starts Bandit on one address. An optional address the machine doesn't have is skipped
  (`:ignore`); an address someone else is listening on halts the VM with a message.
  """
  def start_link(opts) do
    {need, opts} = Keyword.pop(opts, :need, :required)
    {on_conflict, opts} = Keyword.pop(opts, :on_conflict, &Kotiko.Config.halt!/2)

    case Bandit.start_link(bandit_options(opts)) do
      {:ok, pid} ->
        {:ok, pid}

      {:error, reason} = error ->
        case {need, cause(reason)} do
          {:optional, cause} when cause in @unavailable ->
            Logger.info(
              "Not listening on #{address(opts)} too: this computer doesn't have that " <>
                "address (#{cause})."
            )

            :ignore

          {_need, :eaddrinuse} ->
            on_conflict.(in_use(opts), 1)
            error

          _ ->
            error
        end
    end
  end

  # `::` alone would follow the system's net.ipv6.bindv6only; dual-stack covers IPv4 too.
  defp bandit_options(opts) do
    if opts[:ip] == @ipv6_any,
      do: opts ++ [thousand_island_options: [transport_options: [ipv6_v6only: false]]],
      else: opts
  end

  defp cause({:shutdown, {:failed_to_start_child, _child, reason}}), do: cause(reason)
  defp cause(reason) when is_atom(reason), do: reason
  defp cause(_reason), do: :other

  defp address(opts) do
    case opts[:ip] do
      {_, _, _, _} = ip -> "#{:inet.ntoa(ip)}:#{opts[:port]}"
      ip -> "[#{:inet.ntoa(ip)}]:#{opts[:port]}"
    end
  end

  defp in_use(opts) do
    "The server can't start: another program is already listening on #{address(opts)}.\n\n" <>
      "If it isn't an older Kotiko server still running, it could receive the API token " <>
      "the extension sends. " <>
      "Find it (ss -ltnp, or lsof -i :#{opts[:port]}) and stop it, or choose another PORT " <>
      "in .env and in the extension, then start the server again.\n"
  end
end
