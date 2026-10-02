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
  alias Kotiko.Lang

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
    field :deleted_at, :utc_datetime_usec
    field :merged_into, :string
    field :seq, :integer
    timestamps(inserted_at: :created_at, type: :utc_datetime_usec)
  end

  @statuses ~w(active paused pending)
  @origins ~w(add manual telegram bulk import migrated)

  def statuses, do: @statuses
  def origins, do: @origins

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
      # The endonym, derived from the tag (slice 08 section 4): a neutral label for clients
      # that can't name languages themselves.
      language: Lang.endonym(w.lang)
    }
  end

  @doc """
  The 0.2 shape for the legacy `GET /api/words`: integer id, `english` (the gloss), the
  enabled forms as strings and `language` as the English name derived from the tag (what
  a 0.2 extension shows). The one place on the server that maps a field to English.

  Also carries the base language and the pronunciation fields (slice 07 section 7) for the
  word card (slice 19); 0.2 extensions ignore fields they don't know.
  """
  def to_legacy_json(%__MODULE__{} = w) do
    %{
      id: w.id,
      lang: w.lang,
      language: Lang.name(w.lang, "en"),
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
