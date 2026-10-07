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
