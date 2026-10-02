# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Repo.Migrations.LanguageTags do
  @moduledoc """
  Slice 08: canonical language tags (merging words that now share a key), a log of words
  whose script doesn't fit their language, and no more `language` column. The work is in
  `Kotiko.Migrations.LanguageTags`.

  There is no `down`: `Kotiko.Migrations` backs the database up before running this, and
  that backup is the way back.
  """
  use Ecto.Migration

  def up, do: Kotiko.Migrations.LanguageTags.up(repo())
end
