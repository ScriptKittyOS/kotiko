# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Slovo.Health do
  @moduledoc """
  What `GET /health` reports: which server and version this is, the API versions it
  speaks, and whether the database works. The route has no token, so this says nothing
  else (no word counts, no settings).
  """

  # Versions of the /api/v<n> routes. Empty until /api/v1 exists (slice 07); the
  # unversioned /api/words routes are implied while they exist.
  @api_versions []
  @db_timeout 1_000

  @doc "The health report and its HTTP status (200, or 503 when the database fails)."
  def report(repo \\ Slovo.Repo) do
    db = db_status(repo)

    body = %{
      ok: db == "ok",
      name: to_string(Application.get_application(__MODULE__)),
      version: version(),
      api: @api_versions,
      db: db
    }

    {if(db == "ok", do: 200, else: 503), body}
  end

  def version, do: :slovo |> Application.spec(:vsn) |> to_string()

  @doc """
  "ok" when the database file is there and writable and `SELECT 1` answers within a
  second, else "error". An open SQLite connection keeps answering after its file is
  deleted or made unreadable, hence the file check.
  """
  def db_status(repo) do
    if file_ok?(repo) and query_ok?(repo), do: "ok", else: "error"
  end

  defp file_ok?(repo) do
    case repo.config()[:database] do
      ":memory:" -> true
      path when is_binary(path) -> match?({:ok, %File.Stat{access: :read_write}}, File.stat(path))
      _ -> false
    end
  end

  defp query_ok?(repo) do
    task =
      Task.async(fn ->
        try do
          match?({:ok, _}, Ecto.Adapters.SQL.query(repo, "SELECT 1", [], timeout: @db_timeout))
        rescue
          _ -> false
        catch
          :exit, _ -> false
        end
      end)

    case Task.yield(task, @db_timeout) || Task.shutdown(task, :brutal_kill) do
      {:ok, ok?} -> ok?
      _ -> false
    end
  end
end
