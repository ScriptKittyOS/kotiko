defmodule Slovo.Repo.Migrations.CreateWords do
  use Ecto.Migration

  def change do
    create table(:words) do
      add :lang, :string, null: false
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
