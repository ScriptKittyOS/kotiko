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
