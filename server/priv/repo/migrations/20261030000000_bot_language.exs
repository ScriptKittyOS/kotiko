# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Repo.Migrations.BotLanguage do
  @moduledoc """
  Slice 41 section 9: two new, empty tables. Nothing existing changes.

  - `profile`: one row (`id = 1`) with the learner's base languages (a JSON array of base
    tags, primary first, at most 4) and the interface language they chose in the
    extension (`NULL`: none chosen). Written by the extension (`PUT /api/v1/profile`) or
    the bot's `/bases`. Starts empty: the bot then uses the Telegram app's language.
  - `telegram_prefs`: per Telegram user, the language they chose with `/language`
    (`NULL`: follow the Telegram app) and which one-time notes the bot already showed.
  """
  use Ecto.Migration

  def up do
    execute("""
    CREATE TABLE profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      base_langs TEXT NOT NULL,
      ui_lang TEXT,
      updated_at TEXT NOT NULL
    )
    """)

    execute("""
    CREATE TABLE telegram_prefs (
      telegram_id INTEGER PRIMARY KEY,
      locale TEXT,
      noted TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    )
    """)
  end

  def down do
    execute("DROP TABLE telegram_prefs")
    execute("DROP TABLE profile")
  end
end
