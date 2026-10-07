# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Log.LimiterTest do
  use ExUnit.Case, async: true
  alias Kotiko.Log.Limiter

  setup do
    table = :"limiter_test_#{System.unique_integer([:positive])}"
    :ok = Limiter.init(table)
    %{table: table}
  end

  test "each key once a window; when full, one overflow and then quiet", %{table: t} do
    opts = [max_keys: 2]
    assert Limiter.check(t, :a, opts) == {:log, nil}
    assert Limiter.check(t, :a, opts) == {:quiet, nil}
    assert Limiter.check(t, :b, opts) == {:log, nil}
    assert Limiter.check(t, :c, opts) == {:overflow, nil}
    assert Limiter.check(t, :d, opts) == {:quiet, nil}
    # Keys already logged stay quiet: the table is never cleared mid-window.
    assert Limiter.check(t, :a, opts) == {:quiet, nil}
  end

  test "a new window logs again and reports how many keys went unlogged", %{table: t} do
    opts = [max_keys: 1, window_ms: 30]
    assert {:log, nil} = Limiter.check(t, :a, opts)
    assert {:overflow, nil} = Limiter.check(t, :b, opts)
    assert {:quiet, nil} = Limiter.check(t, :c, opts)

    Process.sleep(40)
    assert Limiter.check(t, :a, opts) == {:log, 2}
    assert Limiter.check(t, :b, opts) == {:overflow, nil}
  end

  test "without its table every call logs, and reset forgets the keys", %{table: t} do
    assert Limiter.check(:no_such_limiter_table, :a) == {:log, nil}
    assert {:log, nil} = Limiter.check(t, :a)
    :ok = Limiter.reset(t)
    assert {:log, nil} = Limiter.check(t, :a)
  end
end
