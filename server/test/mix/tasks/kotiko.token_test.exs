# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Mix.Tasks.Kotiko.TokenTest do
  use ExUnit.Case, async: false
  alias Kotiko.Token
  alias Mix.Tasks.Kotiko.Token, as: Task

  # A fresh folder under the system temp dir per test, removed afterwards.
  setup do
    dir =
      Path.join(
        System.tmp_dir!(),
        "kotiko-token-test-#{System.pid()}-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf!(dir) end)
    %{tmp_dir: dir}
  end

  setup do
    Mix.shell(Mix.Shell.Process)
    on_exit(fn -> Mix.shell(Mix.Shell.IO) end)
  end

  # Every setting the task reads, so the developer's own environment can't leak in.
  defp env_file(dir, extra) do
    path = Path.join(dir, ".env")

    File.write!(path, """
    # comment
    API_TOKEN=
    PUBLIC_URL=
    BIND=127.0.0.1
    PORT=4747
    KOTIKO_DATA_DIR=#{Path.join(dir, "data")}
    #{extra}
    """)

    path
  end

  defp output do
    receive do
      {:mix_shell, :info, [msg]} -> msg <> "\n" <> output()
    after
      0 -> ""
    end
  end

  test "prints the saved token and a pairing string", %{tmp_dir: dir} do
    Task.run(["--env-file", env_file(dir, "")])
    out = output()

    token = File.read!(Token.path(Path.join(dir, "data"))) |> String.trim()
    assert out =~ token
    assert [_, encoded] = Regex.run(~r/kotiko-pair:1:([A-Za-z0-9_-]+)/, out)

    assert %{"url" => "http://127.0.0.1:4747", "token" => ^token} =
             encoded |> Base.url_decode64!(padding: false) |> Jason.decode!()
  end

  test "uses API_TOKEN and PUBLIC_URL from .env", %{tmp_dir: dir} do
    token = String.duplicate("a", 48)

    Task.run([
      "--env-file",
      env_file(dir, ~s(API_TOKEN="#{token}"\nPUBLIC_URL=https://kotiko.example/))
    ])

    out = output()

    assert out =~ "API token (from .env)"
    [_, encoded] = Regex.run(~r/kotiko-pair:1:([A-Za-z0-9_-]+)/, out)

    assert %{"url" => "https://kotiko.example", "token" => ^token} =
             encoded |> Base.url_decode64!(padding: false) |> Jason.decode!()
  end

  test "--rotate replaces the saved token", %{tmp_dir: dir} do
    file = env_file(dir, "")
    Task.run(["--env-file", file])
    data = Path.join(dir, "data")
    old = File.read!(Token.path(data))
    output()

    Task.run(["--env-file", file, "--rotate"])
    new = File.read!(Token.path(data))

    assert new != old
    assert output() =~ "Restart the server"
    assert Bitwise.band(File.stat!(Token.path(data)).mode, 0o777) == 0o600
  end

  test "--rotate refuses when API_TOKEN is set in .env", %{tmp_dir: dir} do
    file = env_file(dir, "API_TOKEN=" <> String.duplicate("a", 48))

    assert_raise Mix.Error, ~r/API_TOKEN is set in .env/, fn ->
      Task.run(["--env-file", file, "--rotate"])
    end
  end

  test "a short API_TOKEN is refused", %{tmp_dir: dir} do
    assert_raise Mix.Error, ~r/too short \(5 characters\)/, fn ->
      Task.run(["--env-file", env_file(dir, "API_TOKEN=short")])
    end
  end
end
