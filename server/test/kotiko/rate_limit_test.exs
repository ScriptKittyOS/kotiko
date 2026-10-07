# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.RateLimitTest do
  use ExUnit.Case, async: false
  alias Kotiko.RateLimit

  setup do
    RateLimit.init()
    RateLimit.reset()
    on_exit(&RateLimit.reset/0)
  end

  test "counts per kind and client in a fixed window" do
    assert RateLimit.hit(:a, {1, 2, 3, 4}, 60_000) == {1, 60}
    assert {2, _} = RateLimit.hit(:a, {1, 2, 3, 4}, 60_000)
    assert {1, _} = RateLimit.hit(:b, {1, 2, 3, 4}, 60_000)
    assert {2, s} = RateLimit.peek(:a, {1, 2, 3, 4})
    assert s in 1..60
    assert RateLimit.peek(:a, {9, 9, 9, 9}) == {0, 0}

    assert {1, 1} = RateLimit.hit(:short, :c, 20)
    Process.sleep(30)
    assert RateLimit.peek(:short, :c) == {0, 0}
    assert {1, _} = RateLimit.hit(:short, :c, 20)
  end

  test "clients: IPv4, IPv4-mapped IPv6 as IPv4, IPv6 by its /64" do
    assert RateLimit.client({192, 0, 2, 1}) == {192, 0, 2, 1}
    assert RateLimit.client({0, 0, 0, 0, 0, 0xFFFF, 0xC000, 0x0201}) == {192, 0, 2, 1}
    assert RateLimit.client({0x2001, 0xDB8, 0, 1, 2, 3, 4, 5}) == {0x2001, 0xDB8, 0, 1, :"/64"}
  end

  defp conn(ip, headers) do
    conn = Plug.Test.conn("GET", "/api/v1/words")
    %{conn | remote_ip: ip, req_headers: conn.req_headers ++ headers}
  end

  # Security review E-02: a proxy that adds a header outside the list made its clients look
  # like this computer's own (never limited).
  test "every header a reverse proxy may add marks a loopback request as forwarded" do
    for name <- ~w(forwarded forwarded-for x-forwarded x-forwarded-for x-forwarded-host
                   x-forwarded-proto x-forwarded-port x-original-forwarded-for x-real-ip
                   x-client-ip x-cluster-client-ip cf-connecting-ip true-client-ip
                   fastly-client-ip via tailscale-user-login),
        spelled <- [name, String.upcase(name)] do
      assert RateLimit.peer(conn({127, 0, 0, 1}, [{spelled, "203.0.113.9"}])) ==
               {:proxied, {127, 0, 0, 1}},
             spelled
    end

    assert RateLimit.peer(conn({127, 0, 0, 1}, [{"user-agent", "x"}])) == :local
    assert RateLimit.peer(conn({203, 0, 113, 5}, [{"via", "1.1 x"}])) == {203, 0, 113, 5}
  end

  describe "TRUSTED_PROXY_HEADER (E-02)" do
    setup do
      previous = Application.get_env(:kotiko, :trusted_proxy_header)
      on_exit(fn -> Application.put_env(:kotiko, :trusted_proxy_header, previous) end)
    end

    defp trusting(header, headers, ip \\ {127, 0, 0, 1}) do
      Application.put_env(:kotiko, :trusted_proxy_header, header)
      RateLimit.peer(conn(ip, headers))
    end

    test "x-forwarded-for: the rightmost address, the one the proxy added" do
      assert trusting("x-forwarded-for", [{"x-forwarded-for", "198.51.100.1, 203.0.113.9"}]) ==
               {:forwarded, {203, 0, 113, 9}}

      # Two header lines read as one list.
      assert trusting("x-forwarded-for", [
               {"x-forwarded-for", "198.51.100.1"},
               {"x-forwarded-for", "203.0.113.9:4711"}
             ]) == {:forwarded, {203, 0, 113, 9}}

      # Normalised like a peer: an IPv6 /64, an IPv4-mapped address as IPv4.
      assert trusting("x-forwarded-for", [{"x-forwarded-for", "2001:db8:0:1:2:3:4:5"}]) ==
               {:forwarded, {0x2001, 0xDB8, 0, 1, :"/64"}}

      assert trusting("x-forwarded-for", [{"x-forwarded-for", "[::ffff:192.0.2.1]:80"}]) ==
               {:forwarded, {192, 0, 2, 1}}
    end

    test "forwarded: the last element's for=" do
      header = ~s(for=198.51.100.1;proto=https, For="[2001:db8::17]:4711";by=_proxy)

      assert trusting("forwarded", [{"forwarded", header}]) ==
               {:forwarded, {0x2001, 0xDB8, 0, 0, :"/64"}}

      assert trusting("forwarded", [{"forwarded", "for=203.0.113.9"}]) ==
               {:forwarded, {203, 0, 113, 9}}
    end

    test "x-real-ip and cf-connecting-ip: their one address" do
      assert trusting("x-real-ip", [{"x-real-ip", " 203.0.113.9 "}]) ==
               {:forwarded, {203, 0, 113, 9}}

      assert trusting("cf-connecting-ip", [{"cf-connecting-ip", "2001:db8::1"}]) ==
               {:forwarded, {0x2001, 0xDB8, 0, 0, :"/64"}}
    end

    test "without a usable address in that header, the proxy's shared count" do
      shared = {:proxied, {127, 0, 0, 1}}
      assert trusting("x-real-ip", [{"x-forwarded-for", "203.0.113.9"}]) == shared
      assert trusting("x-real-ip", [{"x-real-ip", "unknown"}]) == shared
      assert trusting("x-real-ip", [{"x-real-ip", "1.2.3.4"}, {"x-real-ip", "5.6.7.8"}]) == shared
      assert trusting("forwarded", [{"forwarded", "for=_hidden"}]) == shared
      assert trusting("x-forwarded-for", [{"x-forwarded-for", "203.0.113.9, "}]) == shared
      assert trusting("x-forwarded-for", [{"x-forwarded-for", "999.1.1.1"}]) == shared
    end

    test "only for a loopback peer, and only with a forwarding header" do
      assert trusting("x-forwarded-for", []) == :local

      assert trusting("x-forwarded-for", [{"x-forwarded-for", "203.0.113.9"}], {198, 51, 100, 7}) ==
               {198, 51, 100, 7}
    end
  end

  test "at most 10,000 counters: when full, expired ones go, else new clients aren't counted" do
    for i <- 1..9_999, do: RateLimit.hit(:fill, i, 60_000)
    RateLimit.hit(:fill, :expiring, 20)
    assert RateLimit.hit(:fill, :new, 60_000) == {0, 0}
    # Clients already counted keep being counted.
    assert {2, _} = RateLimit.hit(:fill, 1, 60_000)

    Process.sleep(30)
    assert {1, _} = RateLimit.hit(:fill, :new, 60_000)
  end
end
