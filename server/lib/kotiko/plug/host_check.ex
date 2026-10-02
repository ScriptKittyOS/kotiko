# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Plug.HostCheck do
  @moduledoc """
  Refuses requests addressed to a host name this server doesn't answer to, so a web page
  can't reach it through DNS rebinding (pointing its own name at 127.0.0.1).

  Allowed: `localhost`, any IP literal, names in ALLOWED_HOSTS, and this machine's
  hostname and `<hostname>.local`. IP literals are safe because rebinding needs a name: a
  page can't make the browser send `Host: 192.168.1.5`. A request with no Host at all
  (HTTP/1.0 tools) is allowed only from this machine. ALLOWED_HOSTS=* turns the check off.
  """
  @behaviour Plug
  import Plug.Conn
  require Logger

  @table __MODULE__
  @log_every_ms :timer.hours(1)
  @max_logged_names 1_000

  @doc "Creates the table that keeps refusals to one log line per name per hour."
  def init_table do
    if :ets.whereis(@table) == :undefined do
      :ets.new(@table, [:named_table, :public, :set])
    end

    :ok
  end

  @impl true
  def init(opts), do: opts

  @impl true
  def call(conn, _opts) do
    if allowed?(conn), do: conn, else: refuse(conn)
  end

  @doc "Lowercases and drops a trailing dot and IPv6 brackets. Bandit already drops the port."
  def normalize(host) do
    host
    |> String.downcase()
    |> String.trim_trailing(".")
    |> String.trim_leading("[")
    |> String.trim_trailing("]")
  end

  defp allowed?(conn) do
    case Application.get_env(:kotiko, :allowed_hosts, []) do
      :any -> true
      names -> allowed_name?(normalize(conn.host), names, conn.remote_ip)
    end
  end

  defp allowed_name?("", _names, remote_ip), do: loopback?(remote_ip)

  defp allowed_name?(host, names, _remote_ip) do
    host == "localhost" or ip_literal?(host) or host in names or host in own_names()
  end

  defp ip_literal?(host), do: match?({:ok, _}, :inet.parse_strict_address(to_charlist(host)))

  defp loopback?({127, _, _, _}), do: true
  defp loopback?({0, 0, 0, 0, 0, 0, 0, 1}), do: true
  defp loopback?(_), do: false

  defp own_names do
    case :persistent_term.get({__MODULE__, :own_names}, nil) do
      nil ->
        names =
          case :inet.gethostname() do
            {:ok, name} -> name |> to_string() |> String.downcase() |> then(&[&1, &1 <> ".local"])
            _ -> []
          end

        :persistent_term.put({__MODULE__, :own_names}, names)
        names

      names ->
        names
    end
  end

  defp refuse(conn) do
    name = conn.host |> normalize() |> String.slice(0, 100)
    log_once(name)

    message =
      if name == "",
        do: "This Kotiko server only answers requests without a Host header from this computer.",
        else: "This Kotiko server doesn't answer to #{name}. Add it to ALLOWED_HOSTS in .env."

    body = %{
      error: %{
        code: "server_address_invalid",
        message: message,
        details: %{reason: "host_not_allowed"}
      }
    }

    conn
    |> put_resp_content_type("application/json")
    |> send_resp(421, Jason.encode!(body))
    |> halt()
  end

  # Names only, never paths; and at most once an hour per name so a scanner can't flood
  # the log.
  defp log_once(name) do
    if first_time_this_hour?(name) do
      Logger.info(
        "Refused a request for host #{inspect(name)}. Add it to ALLOWED_HOSTS if it's yours."
      )
    end
  end

  defp first_time_this_hour?(name) do
    now = System.monotonic_time(:millisecond)

    cond do
      :ets.whereis(@table) == :undefined ->
        true

      recently_logged?(name, now) ->
        false

      true ->
        if :ets.info(@table, :size) >= @max_logged_names, do: :ets.delete_all_objects(@table)
        :ets.insert(@table, {name, now})
        true
    end
  end

  defp recently_logged?(name, now) do
    case :ets.lookup(@table, name) do
      [{_, at}] -> now - at < @log_every_ms
      [] -> false
    end
  end
end
