# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Exposure do
  @moduledoc """
  Who can reach the server, judged from the address it listens on (BIND), so startup can
  say plainly whether the token crosses a network in cleartext.
  """
  import Bitwise

  @advice "Use Tailscale or HTTPS: see \"Browse on another machine\" in the README."

  @doc """
  Returns `{level, class, message}`: level `:info` or `:warning`, class one of
  `:loopback`, `:tailscale`, `:lan`, `:all` or `:public`.
  """
  def classify(ip, url) do
    case class(ip) do
      :loopback ->
        {:info, :loopback, "Listening on this computer only (#{url})."}

      :tailscale ->
        {:info, :tailscale,
         "Listening on your Tailscale network (#{url}). Traffic is encrypted by Tailscale."}

      :lan ->
        {:warning, :lan,
         "Listening on your local network over plain HTTP (#{url}). Anyone on this " <>
           "network can see your token in transit. #{@advice}"}

      :all ->
        {:warning, :all,
         "Listening on every network interface over plain HTTP (#{url}). Anyone who can " <>
           "reach this computer can see your token in transit. #{@advice}"}

      :public ->
        {:warning, :public,
         "This address is reachable from the internet over plain HTTP (#{url}). Anyone " <>
           "along the way can see your token. #{@advice}"}
    end
  end

  @doc """
  Who can see traffic to `host` (an IP tuple, or a host name from a URL): `:loopback` for
  this machine (`localhost`, `*.localhost`, 127.0.0.0/8, ::1), `:tailscale` for Tailscale
  (100.64.0.0/10, fd7a:115c:a1e0::/48, `*.ts.net`), else `:lan`, `:all` or `:public` as
  for `classify/2`. A name that is neither is `:public`: Kotiko can't tell where it goes.
  """
  def network(host) when is_binary(host) do
    name = host |> String.downcase() |> String.trim_trailing(".")

    case :inet.parse_strict_address(to_charlist(String.trim(name, "[]"))) do
      {:ok, ip} ->
        class(ip)

      {:error, _} ->
        cond do
          name == "localhost" or String.ends_with?(name, ".localhost") -> :loopback
          String.ends_with?(name, ".ts.net") -> :tailscale
          true -> :public
        end
    end
  end

  def network(ip) when is_tuple(ip), do: class(ip)

  defp class({127, _, _, _}), do: :loopback
  defp class({0, 0, 0, 0, 0, 0, 0, 1}), do: :loopback
  defp class({0, 0, 0, 0}), do: :all
  defp class({0, 0, 0, 0, 0, 0, 0, 0}), do: :all
  # 100.64.0.0/10 and fd7a:115c:a1e0::/48
  defp class({100, b, _, _}) when b in 64..127, do: :tailscale
  defp class({0xFD7A, 0x115C, 0xA1E0, _, _, _, _, _}), do: :tailscale
  defp class({10, _, _, _}), do: :lan
  defp class({172, b, _, _}) when b in 16..31, do: :lan
  defp class({192, 168, _, _}), do: :lan
  defp class({169, 254, _, _}), do: :lan
  # fc00::/7 (unique local) and fe80::/10 (link-local)
  defp class({a, _, _, _, _, _, _, _}) when (a &&& 0xFE00) == 0xFC00, do: :lan
  defp class({a, _, _, _, _, _, _, _}) when (a &&& 0xFFC0) == 0xFE80, do: :lan
  defp class(_), do: :public

  @doc """
  The address the extension should use: PUBLIC_URL if set, else built from BIND and PORT.
  For 0.0.0.0 or :: that is this machine's first non-loopback IPv4 address.
  """
  def server_url(public_url, ip, port)

  def server_url(url, _ip, _port) when is_binary(url), do: String.trim_trailing(url, "/")

  def server_url(nil, ip, port) when ip in [{0, 0, 0, 0}, {0, 0, 0, 0, 0, 0, 0, 0}],
    do: "http://#{:inet.ntoa(first_lan_ipv4())}:#{port}"

  def server_url(nil, {_, _, _, _} = ip, port), do: "http://#{:inet.ntoa(ip)}:#{port}"
  def server_url(nil, ip, port), do: "http://[#{:inet.ntoa(ip)}]:#{port}"

  defp first_lan_ipv4 do
    with {:ok, ifs} <- :inet.getifaddrs(),
         ip when ip != nil <-
           Enum.find_value(ifs, fn {_name, opts} ->
             Enum.find(Keyword.get_values(opts, :addr), &match?({a, _, _, _} when a != 127, &1))
           end) do
      ip
    else
      _ -> {127, 0, 0, 1}
    end
  end
end
