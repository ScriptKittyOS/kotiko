# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.BootTest do
  # Boots the app in a separate VM, as `mix run` does (permanent, settings in the app
  # env's :env), using this build's compiled code. No config files are loaded there, so
  # nothing from config/test.exs leaks in. Host names resolve from /etc/hosts only. The
  # VM's home folder is a temporary one, so a boot never finds the real data folder.
  use ExUnit.Case, async: true

  @moduletag timeout: 60_000

  setup do
    tmp = Path.join(System.tmp_dir!(), "kotiko-boot-#{System.unique_integer([:positive])}")
    File.mkdir_p!(tmp)
    on_exit(fn -> File.rm_rf(tmp) end)

    inetrc = Path.join(tmp, "inetrc")
    File.write!(inetrc, "{lookup, [file]}.\n")
    home = Path.join(tmp, "home")
    File.mkdir_p!(home)
    %{tmp: tmp, inetrc: inetrc, home: home}
  end

  # Runs `script` after putting `vars` in the app env. Returns {output, exit status}.
  defp boot(vars, script, %{tmp: tmp, inetrc: inetrc, home: home}) do
    paths =
      Mix.Project.build_path()
      |> Path.join("lib/*/ebin")
      |> Path.wildcard()
      |> Enum.flat_map(&["-pa", &1])

    # The script stops at once if the VM's home isn't the temporary one.
    code = """
    if System.user_home() != #{inspect(home)}, do: System.halt(3)
    Application.put_env(:kotiko, :env, #{inspect(vars)})
    #{script}
    """

    {elixir, path} = elixir_without_shims()

    System.cmd(elixir, paths ++ ["-e", code],
      cd: tmp,
      stderr_to_stdout: true,
      env: [
        {"HOME", home},
        {"PATH", path},
        {"ERL_INETRC", inetrc},
        {"ERL_CRASH_DUMP_SECONDS", "0"},
        {"INVOCATION_ID", nil}
      ]
    )
  end

  # This VM's own elixir and erl, first on PATH, so a version manager's shims (which find
  # their installs through HOME) aren't needed with HOME pointing elsewhere.
  defp elixir_without_shims do
    bin = Path.expand("../../bin", Application.app_dir(:elixir))
    erts = Path.join(:code.root_dir(), "bin")
    elixir = Path.join(bin, "elixir")
    elixir = if File.exists?(elixir), do: elixir, else: System.find_executable("elixir")
    {elixir, Enum.join([erts, bin, System.get_env("PATH")], ":")}
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
      "KOTIKO_DATA_DIR" => Path.join(ctx.tmp, "data")
    }

    {output, status} =
      boot(vars, "Application.ensure_all_started(:kotiko, :permanent)\nIO.puts(:started)", ctx)

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
      "KOTIKO_DATA_DIR" => data,
      "LLM_API_KEY" => "sk-or-v1-0123456789abcdef"
    }

    script = """
    {:ok, _} = Application.ensure_all_started(:kotiko, :permanent)
    {:ok, socket} = :gen_tcp.connect({127, 0, 0, 1}, #{port}, [:binary, active: false])
    :ok = :gen_tcp.send(socket, "GET /health HTTP/1.1\\r\\nhost: localhost\\r\\nconnection: close\\r\\n\\r\\n")
    {:ok, response} = :gen_tcp.recv(socket, 0, 5_000)
    IO.puts("HEALTH " <> response)
    :ok = Application.stop(:kotiko)
    """

    {output, status} = boot(vars, script, ctx)

    assert status == 0, output
    assert File.exists?(Path.join(data, "kotiko.db"))
    assert File.exists?(Path.join(data, "api-token"))
    refute output =~ ~r/locked/i
    refute output =~ "failed to connect"
    assert output =~ "== Migrated"
    # Nothing to back up on a new install.
    refute output =~ "Backed up"
    refute File.exists?(Path.join(data, "backups"))
    assert output =~ "Starting the Kotiko server, version #{Application.spec(:kotiko, :vsn)}"
    assert output =~ "Data:      #{data} (kotiko.db, 0 active words)"
    assert output =~ "Listening on this computer only (http://127.0.0.1:#{port})"
    assert output =~ "Telegram:  off"
    assert output =~ "HEALTH HTTP/1.1 200"
    assert output =~ ~s("db":"ok")
    # The key is in the settings, so it's never in the log.
    refute output =~ "sk-or-v1-0123456789abcdef"
  end

  test "the VM exits non-zero when the supervision tree dies", ctx do
    vars = %{"KOTIKO_DATA_DIR" => Path.join(ctx.tmp, "data"), "PORT" => to_string(free_port())}

    script = """
    {:ok, _} = Application.ensure_all_started(:kotiko, :permanent)
    IO.puts("STARTED")
    Process.exit(Process.whereis(Kotiko.Supervisor), :kill)
    Process.sleep(60_000)
    IO.puts("STILL RUNNING")
    """

    {elapsed_us, {output, status}} = :timer.tc(fn -> boot(vars, script, ctx) end)

    assert output =~ "STARTED"
    refute output =~ "STILL RUNNING"
    assert status != 0
    # Far below the 60 s sleep, so the VM exited on its own; the margin covers slow CI
    # runners, where starting the VM alone can take several seconds.
    assert elapsed_us < 60_000_000
    refute File.exists?(Path.join(ctx.tmp, "erl_crash.dump"))
  end

  # ── words from before the rename ──────────────────────────────────
  # legacy-name-ok-start: these tests name the old data folder and server.

  # A 0.2 database (the schema before slice 07) with two words, saved as the old name's
  # file at `path`.
  defp old_database(_ctx, path) do
    Kotiko.LegacyDb.create!(path, """
    INSERT INTO words (lang, native, english, status, inserted_at, updated_at)
      VALUES ('ru', 'да', 'yes', 'active', datetime(), datetime()),
             ('ru', 'дом', 'house', 'active', datetime(), datetime())
    """)
  end

  @start_and_stop """
  {:ok, _} = Application.ensure_all_started(:kotiko, :permanent)
  IO.puts("STARTED")
  :ok = Application.stop(:kotiko)
  """

  test "first start after the rename moves the words from the old default folder", ctx do
    old_dir = Path.join(ctx.home, ".local/share/slovo")
    legacy = old_database(ctx, Path.join(old_dir, "slovo.db"))
    File.write!(Path.join(old_dir, "api-token"), "token-the-old-server-made-0123456789\n")
    new_dir = Path.join(ctx.home, ".local/share/kotiko")
    database = Path.join(new_dir, "kotiko.db")
    vars = %{"PORT" => to_string(free_port())}

    {output, status} = boot(vars, @start_and_stop, ctx)

    assert status == 0, output
    assert output =~ "STARTED"
    assert output =~ "Moved your words from #{legacy} to #{database} (2 words)."
    assert output =~ "Copied your API token from #{old_dir}/api-token"
    assert output =~ "Data:      #{new_dir} (kotiko.db, 2 active words)"
    assert output =~ "API token: saved in #{new_dir}/api-token"
    # The copy is a 0.2 database: it is backed up, then upgraded to the v2 word model.
    assert output =~ "Backed up the database to #{new_dir}/backups/kotiko-pre-"
    assert output =~ "== Migrated 20261015000000"
    assert output =~ "Upgraded your words to the new word model: 2 words"
    assert [_backup] = Path.wildcard(Path.join(new_dir, "backups/kotiko-pre-*.db"))
    assert File.exists?(Path.join(old_dir, "MOVED-TO-KOTIKO.txt"))
    assert File.read!(Path.join(new_dir, "api-token")) =~ "token-the-old-server-made"

    # The second start: nothing to move, migrate or back up.
    {output, 0} = boot(vars, @start_and_stop, ctx)
    refute output =~ "Moved your words"
    refute output =~ "Copied your API token"
    refute output =~ "not touched"
    refute output =~ "== Migrated"
    refute output =~ "Backed up"
    assert output =~ "Data:      #{new_dir} (kotiko.db, 2 active words)"
    assert [_backup] = Path.wildcard(Path.join(new_dir, "backups/kotiko-pre-*.db"))
  end

  test "the old data folder variable still works, with a warning, and is migrated in place",
       ctx do
    dir = Path.join(ctx.tmp, "srv/words")
    legacy = old_database(ctx, Path.join(dir, "slovo.db"))
    vars = %{"SLOVO_DATA_DIR" => dir, "PORT" => to_string(free_port())}

    {output, status} = boot(vars, @start_and_stop, ctx)

    assert status == 0, output
    assert output =~ "SLOVO_DATA_DIR is now KOTIKO_DATA_DIR. Rename it in .env"
    assert output =~ "Moved your words from #{legacy} to #{dir}/kotiko.db (2 words)."
    assert output =~ "Data:      #{dir} (kotiko.db, 2 active words)"
    assert File.exists?(legacy)
  end

  test "an old server still using the database stops the start with status 1", ctx do
    legacy = old_database(ctx, Path.join(ctx.home, ".local/share/slovo/slovo.db"))
    {:ok, old_server} = Exqlite.Sqlite3.open(legacy)
    :ok = Exqlite.Sqlite3.execute(old_server, "BEGIN IMMEDIATE")
    on_exit(fn -> Exqlite.Sqlite3.close(old_server) end)
    vars = %{"PORT" => to_string(free_port())}

    {output, status} = boot(vars, @start_and_stop, ctx)

    assert status == 1
    assert output =~ "Your old Slovo server is still running and using #{legacy}."
    refute output =~ "STARTED"
    refute File.exists?(Path.join(ctx.home, ".local/share/kotiko/kotiko.db"))
  end

  # legacy-name-ok-end
end
