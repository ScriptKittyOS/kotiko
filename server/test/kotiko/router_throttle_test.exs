# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.RouterThrottleTest do
  # Wrong tokens are throttled per address (slice 54, B-09 and C-09): after 10 in a minute
  # that address gets 429 for the rest of the minute, while the right token from any
  # other address still works. config/test.exs turns the throttle off for the other
  # tests, which send many wrong tokens from 127.0.0.1; these turn it on.
  use Kotiko.ConnCase, async: false
  import ExUnit.CaptureLog

  @wrong [{"authorization", "Bearer wrong-token-0123456789abcdefghijkl"}]

  setup do
    put_app_env(:auth_failures_per_minute, 10)
    Kotiko.AuthThrottle.reset()
    on_exit(&Kotiko.AuthThrottle.reset/0)
    :ok
  end

  defp from(ip, headers, path \\ "/api/v1/words") do
    conn = Plug.Test.conn("GET", "http://localhost" <> path)

    %{conn | remote_ip: ip, req_headers: conn.req_headers ++ headers}
    |> Kotiko.Router.call(Kotiko.Router.init([]))
  end

  test "the 11th wrong token in a minute gets 429; the right token elsewhere still works" do
    attacker = {203, 0, 113, 9}

    log =
      capture_log(fn ->
        for _ <- 1..10, do: assert(from(attacker, @wrong).status == 401)
      end)

    conn = from(attacker, @wrong)
    assert conn.status == 429
    assert [retry] = get_resp_header(conn, "retry-after")
    assert String.to_integer(retry) in 1..60

    assert %{"code" => "rate_limited", "details" => %{"reason" => "auth_failures"}} =
             json_body(conn)["error"]

    # Locked out: even the right token gets 429 from there, so guessing learns nothing.
    assert from(attacker, auth()).status == 429
    # The owner, from another address, is unaffected.
    assert from({198, 51, 100, 7}, auth()).status == 200
    assert from({127, 0, 0, 1}, auth()).status == 200
    # /health stays open to everyone.
    assert from(attacker, [], "/health").status == 200

    assert log =~ "10 wrong API tokens from 203.0.113.9 in a minute"
    refute log =~ "wrong-token"
  end

  # Slice 54, D-02: every local program, and a web page in a browser here, reaches the
  # server from 127.0.0.1, so a lockout there would lock the extension out too.
  test "this computer's addresses are never locked out" do
    log =
      capture_log(fn ->
        for ip <- [{127, 0, 0, 1}, {0, 0, 0, 0, 0, 0, 0, 1}, {0, 0, 0, 0, 0, 0xFFFF, 0x7F00, 1}] do
          for _ <- 1..10, do: assert(from(ip, @wrong).status == 401)
          assert from(ip, @wrong).status == 401
          assert from(ip, auth()).status == 200, inspect(ip)
        end
      end)

    refute log =~ "wrong API tokens from"

    # Another address still is.
    capture_log(fn -> for _ <- 1..10, do: from({198, 51, 100, 99}, @wrong) end)
    assert from({198, 51, 100, 99}, auth()).status == 429
  end

  # A reverse proxy on this computer (Caddy, nginx) hands the server every remote client from
  # 127.0.0.1, with a forwarding header: those are strangers and are limited, all together
  # under one key (the header's claimed address can be forged). The extension sends no such
  # header, so a local program that adds one can only lock the proxied requests out.
  test "loopback requests with a forwarding header are limited together; the extension isn't" do
    proxied = [{"x-forwarded-for", "203.0.113.9"}]

    log =
      capture_log(fn ->
        for _ <- 1..10, do: assert(from({127, 0, 0, 1}, @wrong ++ proxied).status == 401)
      end)

    assert from({127, 0, 0, 1}, @wrong ++ proxied).status == 429
    # The header's address doesn't matter: every proxied request shares the lockout.
    assert from({127, 0, 0, 1}, auth() ++ [{"x-forwarded-for", "198.51.100.1"}]).status == 429

    for header <- ~w(forwarded x-real-ip x-forwarded-host cf-connecting-ip true-client-ip) do
      assert from({127, 0, 0, 1}, auth() ++ [{header, "x"}]).status == 429, header
    end

    assert from({0, 0, 0, 0, 0, 0, 0, 1}, auth() ++ [{"x-forwarded-for", "x"}]).status == 200,
           "another loopback address is another proxy"

    # The extension (no forwarding header) still gets in from 127.0.0.1.
    assert from({127, 0, 0, 1}, auth()).status == 200
    assert log =~ "wrong API tokens from requests forwarded by 127.0.0.1"
  end

  # Security review E-02: a proxy that adds a header outside the list made strangers look
  # like this computer (never limited).
  test "every forwarding header a proxy may add keeps the limit" do
    for header <- ~w(via x-client-ip x-cluster-client-ip fastly-client-ip
                     x-original-forwarded-for x-forwarded forwarded-for) do
      Kotiko.AuthThrottle.reset()
      proxied = [{header, "203.0.113.9"}]

      capture_log(fn ->
        for _ <- 1..10, do: assert(from({127, 0, 0, 1}, @wrong ++ proxied).status == 401)
      end)

      assert from({127, 0, 0, 1}, auth() ++ proxied).status == 429, header
      assert from({127, 0, 0, 1}, auth()).status == 200
    end
  end

  # Security review E-02: with every proxied client in one count, a stranger's ten wrong
  # tokens a minute kept the owner's other devices out. TRUSTED_PROXY_HEADER counts each by
  # the address the proxy puts in that header.
  test "with TRUSTED_PROXY_HEADER, each proxied client is counted on its own" do
    put_app_env(:trusted_proxy_header, "x-forwarded-for")
    stranger = [{"x-forwarded-for", "198.51.100.1, 203.0.113.9"}]
    owner = [{"x-forwarded-for", "203.0.113.9, 198.51.100.7"}]

    log =
      capture_log(fn ->
        for _ <- 1..10, do: assert(from({127, 0, 0, 1}, @wrong ++ stranger).status == 401)
      end)

    assert from({127, 0, 0, 1}, auth() ++ stranger).status == 429
    assert from({127, 0, 0, 1}, auth() ++ owner).status == 200
    assert from({127, 0, 0, 1}, auth()).status == 200
    assert log =~ "wrong API tokens from 203.0.113.9 (through the reverse proxy)"
  end

  test "requests without a token don't count; the lockout line is logged once" do
    ip = {203, 0, 113, 10}
    for _ <- 1..20, do: assert(from(ip, []).status == 401)
    assert from(ip, auth()).status == 200

    log =
      capture_log(fn ->
        for _ <- 1..15, do: from(ip, @wrong)
      end)

    assert length(String.split(log, "wrong API tokens from 203.0.113.10")) == 2
  end

  test "an IPv6 /64 counts as one address; IPv4-mapped addresses as their IPv4" do
    log =
      capture_log(fn ->
        for i <- 1..10, do: from({0x2001, 0xDB8, 1, 2, 0, 0, 0, i}, @wrong)
        for _ <- 1..10, do: from({0, 0, 0, 0, 0, 0xFFFF, 0xCB00, 0x710B}, @wrong)
      end)

    assert from({0x2001, 0xDB8, 1, 2, 9, 9, 9, 9}, auth()).status == 429
    assert from({0x2001, 0xDB8, 1, 3, 0, 0, 0, 1}, auth()).status == 200
    assert from({203, 0, 113, 11}, auth()).status == 429
    assert log =~ "from 2001:db8:1:2::/64 in a minute"
    assert log =~ "from 203.0.113.11 in a minute"
  end

  test "off when auth_failures_per_minute is nil" do
    put_app_env(:auth_failures_per_minute, nil)
    for _ <- 1..30, do: from({203, 0, 113, 12}, @wrong)
    assert from({203, 0, 113, 12}, auth()).status == 200
  end

  test "lockout lines: at most 100 addresses an hour, then one line saying so" do
    log =
      capture_log(fn ->
        for i <- 1..101, _ <- 1..10, do: Kotiko.AuthThrottle.failed({198, 18, 0, i})
      end)

    assert length(String.split(log, "wrong API tokens from 198.18.0.")) == 101
    assert log =~ "100 addresses sent too many wrong API tokens this hour; not logging new ones"
  end
end
