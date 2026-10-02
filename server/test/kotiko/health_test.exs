# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.HealthTest do
  use Kotiko.ConnCase, async: false

  defmodule DownRepo do
    @moduledoc "A repo that is never started: what /health sees when the Repo is down."
    use Ecto.Repo, otp_app: :kotiko, adapter: Ecto.Adapters.SQLite3
  end

  defp database, do: Application.fetch_env!(:kotiko, Kotiko.Repo)[:database]

  test "GET /health reports the server, its version, API versions and the database" do
    conn = request("GET", "/health")

    assert conn.status == 200
    assert get_resp_header(conn, "cache-control") == ["no-store"]
    assert ["application/json" <> _] = get_resp_header(conn, "content-type")

    assert json_body(conn) == %{
             "ok" => true,
             "name" => "kotiko",
             "version" => to_string(Application.spec(:kotiko, :vsn)),
             "api" => [],
             "db" => "ok"
           }
  end

  test "HEAD /health is the status alone" do
    conn = request("HEAD", "/health")
    assert conn.status == 200
    assert conn.resp_body == ""
  end

  test "no token is needed, and nothing else is told" do
    body = json_body(request("GET", "/health"))
    assert Map.keys(body) |> Enum.sort() == ~w(api db name ok version)
  end

  describe "when the database fails" do
    test "an unreadable database file is 503 and db error" do
      File.chmod!(database(), 0o000)
      on_exit(fn -> File.chmod(database(), 0o644) end)

      conn = request("GET", "/health")
      assert conn.status == 503
      assert %{"ok" => false, "db" => "error"} = json_body(conn)
      assert request("HEAD", "/health").status == 503
    end

    test "a missing database file is an error" do
      put_app_env(DownRepo, database: Path.join(System.tmp_dir!(), "no-such-kotiko.db"))
      assert Kotiko.Health.db_status(DownRepo) == "error"
    end

    test "a Repo that isn't running is an error" do
      put_app_env(DownRepo, database: database())
      assert Kotiko.Health.db_status(DownRepo) == "error"
      assert {503, %{ok: false, db: "error"}} = Kotiko.Health.report(DownRepo)
    end
  end
end
