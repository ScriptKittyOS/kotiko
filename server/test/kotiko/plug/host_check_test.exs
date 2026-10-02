# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Plug.HostCheckTest do
  use ExUnit.Case, async: false
  import Plug.Test
  import ExUnit.CaptureLog
  alias Kotiko.Plug.HostCheck

  {:ok, hostname} = :inet.gethostname()
  @hostname to_string(hostname)

  setup do
    old = Application.get_env(:kotiko, :allowed_hosts)

    Application.put_env(:kotiko, :allowed_hosts, ["kotiko.tail1234.ts.net", "kotiko.home.example"])

    on_exit(fn -> Application.put_env(:kotiko, :allowed_hosts, old) end)
  end

  defp check(host, remote_ip \\ {127, 0, 0, 1}) do
    conn(:get, "/health") |> Map.merge(%{host: host, remote_ip: remote_ip}) |> HostCheck.call([])
  end

  @allowed [
    "localhost",
    "LocalHost",
    "localhost.",
    "127.0.0.1",
    "10.0.0.7",
    "100.101.102.103",
    "::1",
    "[::1]",
    "[fd7a:115c:a1e0::1]",
    "kotiko.tail1234.ts.net",
    "KOTIKO.home.example.",
    @hostname,
    @hostname <> ".local"
  ]

  @refused [
    "evil.example",
    "localhost.evil.example",
    "127.0.0.1.nip.io",
    "kotiko.tail1234.ts.net.evil.example",
    # Shorthand IPv4 forms a resolver might accept are names here, not literals.
    "127.1",
    "0x7f.0.0.1",
    "2130706433"
  ]

  for host <- @allowed do
    test "allows #{host}" do
      refute check(unquote(host)).halted
    end
  end

  for host <- @refused do
    test "refuses #{host} with 421" do
      conn = check(unquote(host))
      assert conn.halted
      assert conn.status == 421
      assert Jason.decode!(conn.resp_body)["error"]["message"] =~ "ALLOWED_HOSTS"
    end
  end

  test "no Host header is fine from this machine only" do
    refute check("", {127, 0, 0, 1}).halted
    refute check("", {0, 0, 0, 0, 0, 0, 0, 1}).halted
    assert check("", {192, 168, 1, 20}).status == 421
  end

  test "ALLOWED_HOSTS=* turns the check off" do
    Application.put_env(:kotiko, :allowed_hosts, :any)
    refute check("evil.example").halted
  end

  test "logs a refused name once, without the path" do
    name = "once-#{System.unique_integer([:positive])}.example"
    Logger.put_module_level(HostCheck, :info)
    on_exit(fn -> Logger.delete_module_level(HostCheck) end)

    log =
      capture_log([level: :info], fn ->
        check(name)
        check(name)
      end)

    assert length(String.split(log, name)) == 2
    refute log =~ "/health"
  end
end
