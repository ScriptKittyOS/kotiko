defmodule Slovo.Word do
  use Ecto.Schema
  import Ecto.Changeset

  schema "words" do
    field :lang, :string
    field :language, :string
    field :native, :string
    field :romanization, :string
    field :english, :string
    field :english_forms, :string, default: ""
    field :note, :string
    field :status, :string, default: "pending"
    field :source_text, :string
    timestamps()
  end

  @fields ~w(lang language native romanization english english_forms note status source_text)a

  # A BCP 47 tag: language plus optional script subtag ("ru", "ar", "zh-Hant").
  @lang_format ~r/^[a-z]{2,3}(-[A-Z][a-z]{3})?$/

  def changeset(word, attrs) do
    word
    |> cast(attrs, @fields, empty_values: [nil])
    |> validate_required([:lang, :native, :english])
    |> validate_format(:lang, @lang_format)
    |> validate_inclusion(:status, ~w(pending active))
  end

  @doc "All English strings this word should replace on a page."
  def forms(%__MODULE__{english_forms: f, english: e}) do
    (String.split(f || "", "\n") ++ [e])
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.uniq_by(&String.downcase/1)
  end

  @doc ~S"""
  Normalizes a language tag from the model: "ZH_cn" -> "zh", "zh-hant-TW" -> "zh-Hant".
  Region subtags are dropped so one language doesn't split into several groups.
  """
  def normalize_lang(tag) when is_binary(tag) do
    [primary | rest] = tag |> String.trim() |> String.replace("_", "-") |> String.split("-")
    script = Enum.find(rest, &(String.length(&1) == 4 and &1 =~ ~r/^[A-Za-z]+$/))
    primary = String.downcase(primary)

    case script && String.capitalize(script) do
      nil -> primary
      "Hans" when primary == "zh" -> primary
      s -> "#{primary}-#{s}"
    end
  end

  def normalize_lang(_), do: nil

  def to_json(%__MODULE__{} = w) do
    %{
      id: w.id,
      lang: w.lang,
      language: w.language,
      native: w.native,
      romanization: w.romanization,
      english: w.english,
      forms: forms(w),
      note: w.note
    }
  end
end
