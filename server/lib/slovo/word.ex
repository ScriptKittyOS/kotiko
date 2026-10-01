defmodule Slovo.Word do
  use Ecto.Schema
  import Ecto.Changeset

  schema "words" do
    field :lang, :string
    field :native, :string
    field :romanization, :string
    field :english, :string
    field :english_forms, :string, default: ""
    field :note, :string
    field :status, :string, default: "pending"
    field :source_text, :string
    timestamps()
  end

  @fields ~w(lang native romanization english english_forms note status source_text)a

  def changeset(word, attrs) do
    word
    |> cast(attrs, @fields, empty_values: [nil])
    |> validate_required([:lang, :native, :english])
    |> validate_inclusion(:lang, ~w(ru zh))
    |> validate_inclusion(:status, ~w(pending active))
  end

  @doc "All English strings this word should replace on a page."
  def forms(%__MODULE__{english_forms: f, english: e}) do
    (String.split(f || "", "\n") ++ [e])
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.uniq_by(&String.downcase/1)
  end

  def to_json(%__MODULE__{} = w) do
    %{
      id: w.id,
      lang: w.lang,
      native: w.native,
      romanization: w.romanization,
      english: w.english,
      forms: forms(w),
      note: w.note
    }
  end
end
