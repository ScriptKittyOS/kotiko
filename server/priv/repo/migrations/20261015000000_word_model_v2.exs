# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Repo.Migrations.WordModelV2 do
  @moduledoc """
  Slice 07: the word model v2 (UUIDs, timestamps, tombstones, base languages, Form
  objects, change sequence). The work is in `Kotiko.Migrations.WordModelV2`.

  There is no `down`: `Kotiko.Migrations` backs the database up before running this, and
  that backup is the way back.
  """
  use Ecto.Migration

  def up, do: Kotiko.Migrations.WordModelV2.up(repo())
end
