# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.ListenerTest do
  # Which addresses the server listens on for BIND (slice 54, B-01), on real sockets. The
  # boot with the default settings is in boot_test.exs.
  use ExUnit.Case, async: true
  import ExUnit.CaptureLog
  alias Kotiko.Listener

  @v4 {127, 0, 0, 1}
  @v6 {0, 0, 0, 0, 0, 0, 0, 1}

  test "a loopback BIND holds the other loopback address too; others listen where told" do
    assert Listener.addresses(@v4) == [{@v4, :required}, {@v6, :optional}]
    assert Listener.addresses(@v6) == [{@v6, :required}, {@v4, :optional}]
    assert Listener.addresses({0, 0, 0, 0}) == [{{0, 0, 0, 0}, :required}, {@v6, :optional}]
    assert Listener.addresses({100, 101, 102, 103}) == [{{100, 101, 102, 103}, :required}]
    assert Listener.addresses({0, 0, 0, 0, 0, 0, 0, 0}) == [{{0, 0, 0, 0, 0, 0, 0, 0}, :required}]
  end

  test "BIND=localhost is 127.0.0.1, whatever the hosts file says" do
    no_lookup = fn _ -> flunk("localhost isn't looked up") end
    assert Kotiko.Config.parse_bind("localhost", no_lookup) == {:ok, @v4}
    assert Kotiko.Config.parse_bind("LocalHost.", no_lookup) == {:ok, @v4}
    assert Kotiko.Config.parse_bind("::1", no_lookup) == {:ok, @v6}
  end

  # Bandit links to the caller and exits when its listener can't start, as a supervisor
  # sees it; the test process traps that exit like the supervisor does.
  test "an optional address the machine doesn't have is skipped, with a line" do
    Process.flag(:trap_exit, true)
    Logger.put_module_level(Listener, :info)
    on_exit(fn -> Logger.delete_module_level(Listener) end)
    # 192.0.2.0/24 is for documentation: no machine has it.
    log =
      capture_log([level: :info], fn ->
        assert Listener.start_link(
                 plug: Plug.Head,
                 ip: {192, 0, 2, 1},
                 port: 0,
                 need: :optional,
                 startup_log: false
               ) == :ignore
      end)

    assert log =~ "Not listening on 192.0.2.1:0 too: this computer doesn't have that address"

    capture_log(fn ->
      assert {:error, _} =
               Listener.start_link(
                 plug: Plug.Head,
                 ip: {192, 0, 2, 1},
                 port: 0,
                 need: :required,
                 startup_log: false
               )
    end)
  end

  test "an address someone else holds stops the start, saying who to look for" do
    Process.flag(:trap_exit, true)
    {:ok, other} = :gen_tcp.listen(0, ip: @v4)
    {:ok, port} = :inet.port(other)
    on_exit(fn -> :gen_tcp.close(other) end)
    test = self()

    capture_log(fn ->
      assert {:error, _} =
               Listener.start_link(
                 plug: Plug.Head,
                 ip: @v4,
                 port: port,
                 need: :optional,
                 startup_log: false,
                 on_conflict: fn message, status -> send(test, {:halt, message, status}) end
               )
    end)

    assert_received {:halt, message, 1}
    assert message =~ "another program is already listening on 127.0.0.1:#{port}."
    assert message =~ "choose another PORT"
  end

  @tag :ipv6
  test "BIND=:: answers on IPv4 too" do
    pid =
      start_supervised!(
        {Listener,
         plug: Plug.Head,
         ip: {0, 0, 0, 0, 0, 0, 0, 0},
         port: 0,
         need: :required,
         startup_log: false}
      )

    {:ok, {_ip, port}} = ThousandIsland.listener_info(pid)
    assert {:ok, socket} = :gen_tcp.connect(@v4, port, [:binary, active: false])
    :gen_tcp.close(socket)
  end
end
