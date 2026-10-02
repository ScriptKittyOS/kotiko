# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Word do
  @moduledoc """
  One word record (slice 07, schema version 2): a target word (`lang`, `native`) with its
  meaning in one base language (`base_lang`, `gloss`, `forms`). A learner who reads two
  languages has two records for the same target word, one per base.

  `id` is the internal row id, used only by the legacy `/api/words` routes and Telegram
  buttons; `uuid` is the public id. Writes go through `Kotiko.Words`.
  """
  use Ecto.Schema

  schema "words" do
    field :uuid, :string
    field :lang, :string
    field :native, :string
    field :native_key, :string
    field :sense, :string, default: ""
    field :base_lang, :string
    field :romanization, :string
    field :native_vocalized, :string
    field :pronunciation, :string
    field :pronunciation_careful, :string
    field :pronunciation_source, :string
    field :gloss, :string
    field :forms, Kotiko.Word.Forms, default: []
    field :note, :string
    field :status, :string, default: "active"
    field :origin, :string, default: "add"
    field :source_text, :string
    # Deprecated: the model's English name for the language. Slice 08 drops it.
    field :language, :string
    field :deleted_at, :utc_datetime_usec
    field :merged_into, :string
    field :seq, :integer
    timestamps(inserted_at: :created_at, type: :utc_datetime_usec)
  end

  @statuses ~w(active paused pending)
  @origins ~w(add manual telegram bulk import migrated)

  def statuses, do: @statuses
  def origins, do: @origins

  # A BCP 47 tag: language plus optional script subtag ("ru", "ar", "zh-Hant").
  @lang_format ~r/^[a-z]{2,3}(-[A-Z][a-z]{3})?$/

  @doc "True for a tag `normalize_lang/1` can produce. Slice 08 replaces this check."
  def lang?(tag) when is_binary(tag), do: Regex.match?(@lang_format, tag)
  def lang?(_), do: false

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

  @doc """
  Normalizes a base language tag: "es", "pt-BR", "zh-Hant" (slice 50 section 2). A stand-in
  for slice 50's `baseTagOf`: keeps a script or region subtag, in canonical case.
  """
  def normalize_base(tag) when is_binary(tag) do
    [primary | rest] = tag |> String.trim() |> String.replace("_", "-") |> String.split("-")

    sub =
      Enum.find_value(rest, fn s ->
        cond do
          String.length(s) == 4 and s =~ ~r/^[A-Za-z]+$/ -> String.capitalize(s)
          String.length(s) == 2 and s =~ ~r/^[A-Za-z]+$/ -> String.upcase(s)
          true -> nil
        end
      end)

    tag = if sub, do: "#{String.downcase(primary)}-#{sub}", else: String.downcase(primary)
    if tag =~ ~r/^[a-z]{2,3}(-([A-Z][a-z]{3}|[A-Z]{2}))?$/, do: tag
  end

  def normalize_base(_), do: nil

  @doc """
  True when a target language and a base language are the same language (slice 50's
  "same base" test, reduced to the primary subtag until slice 08 ships).
  """
  def same_language?(lang, base) when is_binary(lang) and is_binary(base),
    do: primary(lang) == primary(base)

  def same_language?(_, _), do: false

  defp primary(tag), do: tag |> String.split("-") |> hd() |> String.downcase()

  @doc "True once a tombstone's content has been scrubbed (30 days after the delete)."
  def scrubbed?(%__MODULE__{native_key: key, uuid: uuid}), do: key == uuid

  @doc "Every field of section 1, as the `/api/v1` routes return a word."
  def to_api(%__MODULE__{} = w) do
    %{
      id: w.uuid,
      lang: w.lang,
      native: w.native,
      base_lang: w.base_lang,
      sense: w.sense || "",
      romanization: w.romanization,
      native_vocalized: w.native_vocalized,
      gloss: w.gloss,
      forms: w.forms || [],
      pronunciation: w.pronunciation,
      pronunciation_careful: w.pronunciation_careful,
      pronunciation_source: w.pronunciation_source,
      note: w.note,
      status: w.status,
      origin: w.origin,
      source_text: w.source_text,
      created_at: timestamp(w.created_at),
      updated_at: timestamp(w.updated_at),
      deleted_at: timestamp(w.deleted_at),
      merged_into: w.merged_into,
      language: w.language
    }
  end

  @doc """
  The 0.2 shape for the legacy `GET /api/words`: integer id, `english` (the gloss) and the
  enabled forms as strings. The one place on the server that maps a field to English.

  Also carries the base language and the pronunciation fields (slice 07 section 7) for the
  word card (slice 19); 0.2 extensions ignore fields they don't know.
  """
  def to_legacy_json(%__MODULE__{} = w) do
    %{
      id: w.id,
      lang: w.lang,
      language: w.language,
      native: w.native,
      romanization: w.romanization,
      english: w.gloss,
      forms: enabled_forms(w),
      note: w.note,
      base_lang: w.base_lang,
      native_vocalized: w.native_vocalized,
      pronunciation: w.pronunciation,
      pronunciation_careful: w.pronunciation_careful,
      pronunciation_source: w.pronunciation_source
    }
  end

  @doc "The texts of the forms that get swapped on pages."
  def enabled_forms(%__MODULE__{forms: forms}) do
    for %{text: t, enabled: true} <- forms || [], is_binary(t), do: t
  end

  @doc "RFC 3339 UTC with milliseconds: 2026-10-01T21:23:47.123Z."
  def timestamp(nil), do: nil

  def timestamp(%DateTime{} = dt),
    do: dt |> DateTime.truncate(:millisecond) |> DateTime.to_iso8601()
end
