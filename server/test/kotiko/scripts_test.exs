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
        {"INSTALL_WAIT_SECONDS", "2"},
        # The developer's own XDG folders mustn't leak in; tests that need them set them.
        {"XDG_CONFIG_HOME", nil},
        {"XDG_DATA_HOME", nil},
        {"KOTIKO_DATA_DIR", nil}
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

    test "starts the server with umask 077, so what it writes is private", ctx do
      stub(ctx, "mix", ~s[echo "umask $(umask)" >> "#{ctx.calls}"])
      write_env(ctx, "", 0o600)

      # A loose umask in the shell it's started from doesn't matter.
      {_, 0} =
        System.cmd("bash", ["-c", "umask 022 && exec bash run.sh"],
          cd: ctx.dir,
          env: [{"PATH", "#{ctx.bin}:/usr/bin:/bin"}, {"HOME", ctx.home}, {"MIX_ENV", nil}]
        )

      assert "umask 0077" in calls(ctx)
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
      # Files the service makes are private from the moment they exist.
      assert text =~ "\nUMask=0077\n"

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
      xdg_data = Path.join(ctx.root, "data home %x")
      {_, 0} = run(ctx, "install-service.sh", [], [{"XDG_DATA_HOME", xdg_data}])

      assert File.read!(unit(ctx)) =~
               ~s(\nEnvironment="XDG_DATA_HOME=#{ctx.root}/data home %%x"\n)

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

    test "puts the unit in XDG_CONFIG_HOME, ignoring a relative one", ctx do
      stub(ctx, "curl", ~s(echo '{"ok":true}'))
      write_env(ctx, "", 0o600)
      config = Path.join(ctx.root, "config home")

      {output, 0} = run(ctx, "install-service.sh", [], [{"XDG_CONFIG_HOME", config <> "/"}])

      xdg_unit = Path.join(config, "systemd/user/kotiko.service")
      assert File.exists?(xdg_unit)
      refute File.exists?(unit(ctx))
      assert output =~ "Installed #{xdg_unit}"
      # No XDG_DATA_HOME in this shell: the service gets none either.
      refute File.read!(xdg_unit) =~ "XDG_DATA_HOME"

      {_, 0} = run(ctx, "install-service.sh", [], [{"XDG_CONFIG_HOME", "relative/config"}])
      assert File.exists?(unit(ctx))
    end

    test "a unit already in ~/.config stays there when XDG_CONFIG_HOME is set", ctx do
      stub(ctx, "curl", ~s(echo '{"ok":true}'))
      write_env(ctx, "", 0o600)
      {_, 0} = run(ctx, "install-service.sh")
      config = Path.join(ctx.root, "config home")

      {output, 0} = run(ctx, "install-service.sh", [], [{"XDG_CONFIG_HOME", config}])

      assert output =~ "Installed #{unit(ctx)}"
      refute File.exists?(Path.join(config, "systemd/user/kotiko.service"))
    end

    test "says how systemd can find a unit in XDG_CONFIG_HOME when it can't", ctx do
      stub(ctx, "systemctl", ~s(if [ "$2" = enable ]; then exit 1; fi))
      write_env(ctx, "", 0o600)

      {output, status} =
        run(ctx, "install-service.sh", [], [{"XDG_CONFIG_HOME", Path.join(ctx.root, "cfg")}])

      assert status == 1
      assert output =~ "systemd didn't find"
      refute Enum.any?(calls(ctx), &(&1 =~ "restart kotiko"))
    end

    test "rejects an unknown option and --delete-data without --uninstall", ctx do
      write_env(ctx, "", 0o600)
      assert {output, 64} = run(ctx, "install-service.sh", ["--purge"])
      assert output =~ "Unknown option: --purge"
      assert {output, 64} = run(ctx, "install-service.sh", ["--delete-data"])
      assert output =~ "--delete-data only works with --uninstall"
      assert {output, 0} = run(ctx, "install-service.sh", ["--help"])
      assert output =~ "--uninstall"
      assert calls(ctx) == []
    end
  end

  describe "install-service.sh --uninstall" do
    setup ctx do
      stub(ctx, "mix")
      stub(ctx, "systemctl")
      stub(ctx, "loginctl")
      stub(ctx, "curl", ~s(echo '{"ok":true}'))
      data = Path.join(ctx.root, "words")
      write_env(ctx, "KOTIKO_DATA_DIR=#{data}\n", 0o600)
      {_, 0} = run(ctx, "install-service.sh")
      File.rm!(ctx.calls)

      File.mkdir_p!(Path.join(data, "backups"))
      File.write!(Path.join(data, "kotiko.db"), "words")
      File.write!(Path.join(data, "api-token"), "token")
      File.write!(Path.join(data, "backups/kotiko-pre-1.0.0-20261001T000000Z.db"), "old")
      %{data: data}
    end

    defp unit_file(ctx), do: Path.join(ctx.home, ".config/systemd/user/kotiko.service")

    test "removes the service and keeps the words", ctx do
      {output, status} = run(ctx, "install-service.sh", ["--uninstall"])

      assert status == 0, output
      refute File.exists?(unit_file(ctx))

      assert Enum.filter(calls(ctx), &String.starts_with?(&1, "systemctl")) == [
               "systemctl - --user disable --now kotiko",
               "systemctl - --user daemon-reload",
               "systemctl - --user reset-failed kotiko"
             ]

      assert output =~ "Removed #{unit_file(ctx)}"
      assert output =~ "Kept your words in #{ctx.data}"
      assert output =~ "Kept your settings in #{ctx.dir}/.env"
      assert File.read!(Path.join(ctx.data, "kotiko.db")) == "words"
      assert File.exists?(Path.join(ctx.dir, ".env"))

      # Again: nothing left to remove, and no systemctl calls.
      File.rm!(ctx.calls)
      {output, 0} = run(ctx, "install-service.sh", ["--uninstall"])
      assert output =~ "No kotiko service is installed"
      refute Enum.any?(calls(ctx), &String.starts_with?(&1, "systemctl"))
    end

    test "removes a start-at-boot link left without its unit", ctx do
      wants = Path.join(ctx.home, ".config/systemd/user/default.target.wants")
      File.mkdir_p!(wants)
      File.ln_s!(unit_file(ctx), Path.join(wants, "kotiko.service"))
      File.rm!(unit_file(ctx))

      {output, 0} = run(ctx, "install-service.sh", ["--uninstall"])

      assert output =~ "Removed #{wants}/kotiko.service"
      refute match?({:ok, _}, File.lstat(Path.join(wants, "kotiko.service")))
      assert "systemctl - --user daemon-reload" in calls(ctx)
    end

    test "--delete-data deletes only Kotiko's files", ctx do
      File.write!(Path.join(ctx.data, "notes.txt"), "mine")

      {output, 0} = run(ctx, "install-service.sh", ["--uninstall", "--delete-data"])

      refute File.exists?(Path.join(ctx.data, "kotiko.db"))
      refute File.exists?(Path.join(ctx.data, "api-token"))
      refute File.exists?(Path.join(ctx.data, "backups"))
      assert File.read!(Path.join(ctx.data, "notes.txt")) == "mine"
      assert output =~ "Deleted #{ctx.data}/kotiko.db"
      assert output =~ "Kept the folder #{ctx.data}: it holds files Kotiko didn't make."

      File.rm!(Path.join(ctx.data, "notes.txt"))
      {output, 0} = run(ctx, "install-service.sh", ["--uninstall", "--delete-data"])
      assert output =~ "Deleted the folder #{ctx.data}"
      refute File.exists?(ctx.data)
    end

    test "finds the default data folder as the server does", ctx do
      write_env(ctx, "", 0o600)
      xdg = Path.join(ctx.root, "xdg data")
      old = Path.join(ctx.home, ".local/share/kotiko")

      {output, 0} = run(ctx, "install-service.sh", ["--uninstall"], [{"XDG_DATA_HOME", xdg}])
      assert output =~ "Kept your words in #{xdg}/kotiko"

      # Words from before XDG_DATA_HOME was read stay where they are.
      File.mkdir_p!(old)
      File.write!(Path.join(old, "kotiko.db"), "")
      {output, 0} = run(ctx, "install-service.sh", ["--uninstall"], [{"XDG_DATA_HOME", xdg}])
      assert output =~ "Kept your words in #{old}"
    end

    test "keeps everything when the service can't be stopped", ctx do
      stub(ctx, "systemctl", ~s(if [ "$2" = disable ]; then exit 1; fi))

      {output, status} = run(ctx, "install-service.sh", ["--uninstall", "--delete-data"])

      assert status == 1
      assert output =~ "Nothing was removed"
      assert File.exists?(unit_file(ctx))
      assert File.exists?(Path.join(ctx.data, "kotiko.db"))
    end

    test "works without .env or mix", ctx do
      File.rm!(Path.join(ctx.dir, ".env"))
      File.rm!(Path.join(ctx.bin, "mix"))

      {output, 0} = run(ctx, "install-service.sh", ["--uninstall"])

      refute File.exists?(unit_file(ctx))
      refute output =~ "Kept your settings"
    end
  end
end
