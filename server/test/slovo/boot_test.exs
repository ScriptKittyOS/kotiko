# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Slovo.BootTest do
  # Boots the app in a separate VM, as `mix run` does (permanent, settings in the app
  # env's :env), using this build's compiled code. No config files are loaded there, so
  # nothing from config/test.exs leaks in. Host names resolve from /etc/hosts only.
  use ExUnit.Case, async: true

  @moduletag timeout: 60_000

  setup do
    tmp = Path.join(System.tmp_dir!(), "slovo-boot-#{System.unique_integer([:positive])}")
    File.mkdir_p!(tmp)
    on_exit(fn -> File.rm_rf(tmp) end)

    inetrc = Path.join(tmp, "inetrc")
    File.write!(inetrc, "{lookup, [file]}.\n")
    %{tmp: tmp, inetrc: inetrc}
  end

  # Runs `script` after putting `vars` in the app env. Returns {output, exit status}.
  defp boot(vars, script, %{tmp: tmp, inetrc: inetrc}) do
    paths =
      Mix.Project.build_path()
      |> Path.join("lib/*/ebin")
      |> Path.wildcard()
      |> Enum.flat_map(&["-pa", &1])

    code = """
    Application.put_env(:slovo, :env, #{inspect(vars)})
    #{script}
    """

    System.cmd(System.find_executable("elixir"), paths ++ ["-e", code],
      cd: tmp,
      stderr_to_stdout: true,
      env: [{"ERL_INETRC", inetrc}, {"ERL_CRASH_DUMP_SECONDS", "0"}, {"INVOCATION_ID", nil}]
    )
  end

  defp free_port do
    {:ok, socket} = :gen_tcp.listen(0, ip: {127, 0, 0, 1})
    {:ok, port} = :inet.port(socket)
    :gen_tcp.close(socket)
    port
  end

  test "settings mistakes print every problem and exit 78, without a stack trace", ctx do
    vars = %{
      "BIND" => "nonexistent.invalid",
      "PORT" => "abc",
      "ALLOWED_TELEGRAM_IDS" => "1,x",
      "SLOVO_DATA_DIR" => Path.join(ctx.tmp, "data")
    }

    {output, status} =
      boot(vars, "Application.ensure_all_started(:slovo, :permanent)\nIO.puts(:started)", ctx)

    assert status == 78
    assert output =~ "The server can't start: 3 problems in your settings\n"
    assert output =~ "  PORT=abc\n"
    assert output =~ "  BIND=nonexistent.invalid\n"
    assert output =~ ~s(  ALLOWED_TELEGRAM_IDS=1,x\n    "x" isn't a Telegram ID.)
    assert output =~ "Fix these and start the server again.\n"
    refute output =~ "started"
    refute output =~ "** ("
    refute output =~ "Stacktrace"
  end

  test "first boot on an empty data folder: quiet, migrated, listening, healthy", ctx do
    data = Path.join(ctx.tmp, "fresh/data")
    port = free_port()

    vars = %{
      "BIND" => "localhost",
      "PORT" => to_string(port),
      "SLOVO_DATA_DIR" => data,
      "LLM_API_KEY" => "sk-or-v1-0123456789abcdef"
    }

    script = """
    {:ok, _} = Application.ensure_all_started(:slovo, :permanent)
    {:ok, socket} = :gen_tcp.connect({127, 0, 0, 1}, #{port}, [:binary, active: false])
    :ok = :gen_tcp.send(socket, "GET /health HTTP/1.1\\r\\nhost: localhost\\r\\nconnection: close\\r\\n\\r\\n")
    {:ok, response} = :gen_tcp.recv(socket, 0, 5_000)
    IO.puts("HEALTH " <> response)
    :ok = Application.stop(:slovo)
    """

    {output, status} = boot(vars, script, ctx)

    assert status == 0, output
    assert File.exists?(Path.join(data, "slovo.db"))
    assert File.exists?(Path.join(data, "api-token"))
    refute output =~ ~r/locked/i
    refute output =~ "failed to connect"
    assert output =~ "== Migrated"
    assert output =~ "Starting the server, version #{Application.spec(:slovo, :vsn)}"
    assert output =~ "Data:      #{data} (slovo.db, 0 active words)"
    assert output =~ "Listening on this computer only (http://127.0.0.1:#{port})"
    assert output =~ "Telegram:  off"
    assert output =~ "HEALTH HTTP/1.1 200"
    assert output =~ ~s("db":"ok")
    # The key is in the settings, so it's never in the log.
    refute output =~ "sk-or-v1-0123456789abcdef"
  end

  test "the VM exits non-zero when the supervision tree dies", ctx do
    vars = %{"SLOVO_DATA_DIR" => Path.join(ctx.tmp, "data"), "PORT" => to_string(free_port())}

    script = """
    {:ok, _} = Application.ensure_all_started(:slovo, :permanent)
    IO.puts("STARTED")
    Process.exit(Process.whereis(Slovo.Supervisor), :kill)
    Process.sleep(5_000)
    IO.puts("STILL RUNNING")
    """

    {elapsed_us, {output, status}} = :timer.tc(fn -> boot(vars, script, ctx) end)

    assert output =~ "STARTED"
    refute output =~ "STILL RUNNING"
    assert status != 0
    assert elapsed_us < 5_000_000
    refute File.exists?(Path.join(ctx.tmp, "erl_crash.dump"))
  end
end
