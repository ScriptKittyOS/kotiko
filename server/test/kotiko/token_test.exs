# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.TokenTest do
  use ExUnit.Case, async: true
  alias Kotiko.Token

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

  test "API_TOKEN wins over the token file", %{tmp_dir: dir} do
    File.write!(Token.path(dir), String.duplicate("f", 43))
    env = String.duplicate("e", 48)
    assert {:ok, ^env, :env} = Token.resolve("  #{env}\n", dir)
  end

  test "first boot makes a 43-character token in a 0600 file; the next boot reuses it",
       %{tmp_dir: dir} do
    assert {:ok, token, {:generated, path}} = Token.resolve(nil, dir)
    assert path == Path.join(dir, "api-token")
    assert String.length(token) == 43
    assert token =~ ~r/\A[A-Za-z0-9_-]{43}\z/
    assert File.read!(path) == token <> "\n"
    assert File.stat!(path).access == :read_write
    assert Bitwise.band(File.stat!(path).mode, 0o777) == 0o600

    assert {:ok, ^token, {:file, ^path}} = Token.resolve(nil, dir)
  end

  test "a blank token file is replaced with a new token", %{tmp_dir: dir} do
    File.write!(Token.path(dir), "\n")
    assert {:ok, token, {:generated, _}} = Token.resolve(nil, dir)
    assert String.length(token) == 43
  end

  test "short or whitespace-only tokens are refused", %{tmp_dir: dir} do
    assert {:error, "API_TOKEN is too short (5 characters). Use at least 24" <> _} =
             Token.resolve("short", dir)

    # runtime.exs trims, so API_TOKEN="   " arrives as "".
    assert {:error, "API_TOKEN is too short (0 characters)" <> _} = Token.resolve("", dir)
    assert {:error, "API_TOKEN is too short (0 characters)" <> _} = Token.resolve("   ", dir)
    assert {:error, _} = Token.resolve(String.duplicate("x", 23), dir)
    assert {:ok, _, :env} = Token.resolve(String.duplicate("x", 24), dir)

    File.write!(Token.path(dir), "tooshort\n")
    assert {:error, "The token in " <> _} = Token.resolve(nil, dir)
  end

  test "a data folder it has to make is private too", %{tmp_dir: dir} do
    data = Path.join(dir, "new-data")
    assert {:ok, _token, {:generated, _}} = Token.resolve(nil, data)
    assert Bitwise.band(File.stat!(data).mode, 0o777) == 0o700
    assert Bitwise.band(File.stat!(Token.path(data)).mode, 0o777) == 0o600
  end

  test "generate replaces the saved token", %{tmp_dir: dir} do
    {:ok, old, _} = Token.resolve(nil, dir)
    assert {:ok, new, {:generated, _}} = Token.generate(Token.path(dir))
    assert new != old
    assert {:ok, ^new, {:file, _}} = Token.resolve(nil, dir)
    assert Bitwise.band(File.stat!(Token.path(dir)).mode, 0o777) == 0o600
  end

  test "the pairing string decodes to the URL and token" do
    "kotiko-pair:1:" <> encoded = Token.pairing_string("http://100.101.102.103:4747", "tok")

    assert %{"url" => "http://100.101.102.103:4747", "token" => "tok"} =
             encoded |> Base.url_decode64!(padding: false) |> Jason.decode!()
  end
end
