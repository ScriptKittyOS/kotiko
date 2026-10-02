# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.ScriptsTest do
  # run.sh and install-service.sh, copied into a folder whose name has a space and a %,
  # with mix, systemctl, curl and friends replaced by stubs that record their arguments.
  use ExUnit.Case, async: true

  @server Path.expand("../..", __DIR__)

  setup do
    root = Path.join(System.tmp_dir!(), "kotiko-scripts-#{System.unique_integer([:positive])}")
    dir = Path.join(root, "My %Projects/server")
    bin = Path.join(root, "bin")
    home = Path.join(root, "home")
    calls = Path.join(root, "calls.log")
    Enum.each([dir, bin, home], &File.mkdir_p!/1)
    on_exit(fn -> File.rm_rf(root) end)

    for script <- ["run.sh", "install-service.sh"] do
      File.cp!(Path.join(@server, script), Path.join(dir, script))
      File.chmod!(Path.join(dir, script), 0o755)
    end

    %{root: root, dir: dir, bin: bin, home: home, calls: calls}
  end

  # A stub that logs "name MIX_ENV args" and runs `body` (default: succeed).
  defp stub(%{bin: bin, calls: calls}, name, body \\ "exit 0") do
    path = Path.join(bin, name)

    File.write!(path, """
    #!/usr/bin/env bash
    echo "#{name} ${MIX_ENV:--} $*" >> "#{calls}"
    #{body}
    """)

    File.chmod!(path, 0o755)
  end

  defp run(ctx, script, args \\ [], env \\ []) do
    env =
      [
        {"PATH", "#{ctx.bin}:/usr/bin:/bin"},
        {"HOME", ctx.home},
        {"MIX_ENV", nil},
        {"INSTALL_WAIT_SECONDS", "2"}
      ] ++ env

    System.cmd("bash", [Path.join(ctx.dir, script) | args], env: env, stderr_to_stdout: true)
  end

  defp calls(%{calls: calls}) do
    case File.read(calls) do
      {:ok, text} -> String.split(text, "\n", trim: true)
      {:error, :enoent} -> []
    end
  end

  defp write_env(%{dir: dir}, contents, mode) do
    path = Path.join(dir, ".env")
    File.write!(path, contents)
    File.chmod!(path, mode)
    path
  end

  defp mode(path), do: File.stat!(path).mode |> Bitwise.band(0o777)

  describe "run.sh" do
    test "without .env it explains what to do and exits 78", ctx do
      stub(ctx, "mix")
      {output, status} = run(ctx, "run.sh")
      assert status == 78
      assert output =~ "cp .env.example .env && chmod 600 .env"
      assert calls(ctx) == []
    end

    test "makes .env private, runs in prod, and skips deps.get when nothing changed", ctx do
      stub(ctx, "mix")
      env = write_env(ctx, "PORT=5000\n", 0o644)

      {output, 0} = run(ctx, "run.sh")

      assert output =~ "Making .env private"
      assert mode(env) == 0o600
      assert calls(ctx) == ["mix prod deps.loadpaths --no-compile", "mix prod run --no-halt"]
    end

    test "fetches dependencies when they are missing or out of date", ctx do
      stub(ctx, "mix", ~s(if [ "$1" = deps.loadpaths ]; then exit 1; fi))
      write_env(ctx, "", 0o600)

      {output, 0} = run(ctx, "run.sh")

      refute output =~ "Making .env private"

      assert calls(ctx) == [
               "mix prod deps.loadpaths --no-compile",
               "mix prod deps.get --only prod",
               "mix prod run --no-halt"
             ]
    end

    test "carries on with what's installed when deps.get fails (offline)", ctx do
      stub(ctx, "mix", ~s(case "$1" in deps.*\) exit 1 ;; esac))
      write_env(ctx, "", 0o600)

      {output, 0} = run(ctx, "run.sh")

      assert output =~ "Couldn't fetch dependencies (offline?)"
      assert List.last(calls(ctx)) == "mix prod run --no-halt"
    end

    test "MIX_ENV from the shell or .env wins; --compile stops before running", ctx do
      stub(ctx, "mix")
      write_env(ctx, "", 0o600)
      {_, 0} = run(ctx, "run.sh", [], [{"MIX_ENV", "dev"}])
      assert List.last(calls(ctx)) == "mix dev run --no-halt"

      write_env(ctx, "MIX_ENV=test\n", 0o600)
      {_, 0} = run(ctx, "run.sh", ["--compile"])
      assert List.last(calls(ctx)) == "mix test compile"
    end
  end

  describe "install-service.sh" do
    setup ctx do
      stub(ctx, "mix")
      stub(ctx, "systemctl")
      stub(ctx, "loginctl")
      stub(ctx, "journalctl", ~s(echo "journal line"))
      :ok
    end

    defp unit(ctx), do: Path.join(ctx.home, ".config/systemd/user/kotiko.service")

    # The service's name before the rename. legacy-name-ok
    @old "slovo"

    test "writes a unit that works from a folder with a space and a %", ctx do
      stub(ctx, "curl", ~s(echo '{"ok":true}'))
      env = write_env(ctx, "PORT=5001\nBIND=0.0.0.0\n", 0o644)
      odd_path = "#{ctx.bin}:/usr/bin:/bin:#{ctx.root}/odd %dir \"q\""

      {output, status} = run(ctx, "install-service.sh", [], [{"PATH", odd_path}])

      assert status == 0, output
      assert mode(env) == 0o600
      assert mode(unit(ctx)) == 0o600
      text = File.read!(unit(ctx))
      escaped = String.replace(ctx.dir, "%", "%%")

      assert text =~ "\nWorkingDirectory=#{escaped}\n"
      assert text =~ ~s(\nExecStart="#{escaped}/run.sh"\n)

      assert text =~
               ~s(\nEnvironment="PATH=#{String.replace(odd_path, "%", "%%") |> String.replace(~s("), ~s(\\"))}"\n)

      assert text =~ "\nRestartPreventExitStatus=78\n"
      assert text =~ "\nStartLimitBurst=5\n"

      calls = calls(ctx)
      assert "mix prod compile" in calls
      assert "systemctl - --user daemon-reload" in calls
      assert "systemctl - --user enable kotiko" in calls
      assert "systemctl - --user restart kotiko" in calls
      assert "curl - -fsS --max-time 2 http://127.0.0.1:5001/health" in calls
      assert output =~ ~s(Running: {"ok":true})
      assert text =~ "\nDescription=Kotiko vocabulary server and Telegram bot\n"
      refute Enum.any?(calls, &(&1 =~ @old))
      refute output =~ @old
    end

    test "replaces the service from before the rename, keeping its unit file", ctx do
      stub(ctx, "curl", ~s(echo '{"ok":true}'))
      write_env(ctx, "", 0o600)
      old_unit = Path.join(ctx.home, ".config/systemd/user/#{@old}.service")
      File.mkdir_p!(Path.dirname(old_unit))
      File.write!(old_unit, "[Service]\n# customised\n")

      {output, status} = run(ctx, "install-service.sh")

      assert status == 0, output
      refute File.exists?(old_unit)
      assert File.read!(old_unit <> ".bak") == "[Service]\n# customised\n"
      assert File.exists?(unit(ctx))

      systemctl = ctx |> calls() |> Enum.filter(&String.starts_with?(&1, "systemctl"))

      assert Enum.take(systemctl, 5) == [
               "systemctl - --user disable --now #{@old}",
               "systemctl - --user daemon-reload",
               "systemctl - --user daemon-reload",
               "systemctl - --user enable kotiko",
               "systemctl - --user restart kotiko"
             ]

      assert output =~
               "Stopped and disabled #{@old}.service; its unit file is kept as #{old_unit}.bak"

      # Running it again: nothing old left to replace.
      File.rm!(ctx.calls)
      {output, 0} = run(ctx, "install-service.sh")
      refute Enum.any?(calls(ctx), &(&1 =~ "disable"))
      refute output =~ "Stopped and disabled"
      assert File.read!(old_unit <> ".bak") == "[Service]\n# customised\n"
    end

    test "stops if the old service can't be stopped, before installing anything", ctx do
      stub(ctx, "systemctl", ~s(if [ "$2" = disable ]; then exit 1; fi))
      write_env(ctx, "", 0o600)
      old_unit = Path.join(ctx.home, ".config/systemd/user/#{@old}.service")
      File.mkdir_p!(Path.dirname(old_unit))
      File.write!(old_unit, "[Service]\n")

      {output, status} = run(ctx, "install-service.sh")

      assert status == 1, output
      assert File.exists?(old_unit)
      refute File.exists?(unit(ctx))
      refute Enum.any?(calls(ctx), &(&1 =~ "enable kotiko"))
    end

    test "systemd-analyze accepts the unit", ctx do
      analyze = System.find_executable("systemd-analyze")
      stub(ctx, "curl", ~s(echo '{"ok":true}'))
      write_env(ctx, "", 0o600)
      {_, 0} = run(ctx, "install-service.sh")

      if analyze do
        {output, status} =
          System.cmd(analyze, ["--user", "verify", unit(ctx)],
            stderr_to_stdout: true,
            env: [{"HOME", ctx.home}]
          )

        assert status == 0, output
      end
    end

    test "when the server doesn't come up it shows the journal and fails", ctx do
      stub(ctx, "curl", "exit 7")
      write_env(ctx, "", 0o600)

      {output, status} = run(ctx, "install-service.sh")

      assert status == 1
      assert output =~ "didn't answer http://127.0.0.1:4747/health within 2 s"
      assert output =~ "journal line"
      assert "journalctl - --user -u kotiko -n 20 --no-pager" in calls(ctx)
    end
  end
end
