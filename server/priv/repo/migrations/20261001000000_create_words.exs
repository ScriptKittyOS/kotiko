# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Repo.Migrations.CreateWords do
  use Ecto.Migration

  def change do
    create table(:words) do
      # BCP 47 code ("ru", "zh", "ar", "zh-Hant"); any language is allowed
      add :lang, :string, null: false
      # English name of the language, shown on bot cards and in the extension
      add :language, :string
      add :native, :string, null: false
      add :romanization, :string
      add :english, :string, null: false
      # newline-separated English surface forms to replace ("house\nhouses")
      add :english_forms, :text, null: false, default: ""
      add :note, :text
      add :status, :string, null: false, default: "pending"
      add :source_text, :text
      timestamps()
    end

    create unique_index(:words, [:lang, :native])
    create index(:words, [:status])
  end
end
