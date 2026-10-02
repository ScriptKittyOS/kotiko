# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Repo.Migrations.LookupCache do
  @moduledoc """
  Slice 10: the lookup cache (`Kotiko.LLM.Cache`), a new empty table. Nothing existing
  changes. Rows are checked lookup results (never the model's raw answer), keyed by a
  SHA-256 of everything that shapes the answer, kept 30 days.
  """
  use Ecto.Migration

  def up do
    execute("""
    CREATE TABLE lookup_cache (
      key TEXT PRIMARY KEY,
      result TEXT NOT NULL,
      model TEXT,
      inserted_at TEXT NOT NULL,
      last_hit_at TEXT NOT NULL,
      hits INTEGER NOT NULL DEFAULT 0
    )
    """)

    execute("CREATE INDEX lookup_cache_last_hit_at ON lookup_cache (last_hit_at)")
  end

  def down, do: execute("DROP TABLE lookup_cache")
end
