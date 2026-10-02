# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.WordTest do
  use ExUnit.Case, async: true
  use ExUnitProperties
  alias Kotiko.Word

  @lang_format ~r/^[a-z]{2,3}(-[A-Z][a-z]{3})?$/

  test "normalize_lang drops regions and the default Mandarin script" do
    assert Word.normalize_lang("ZH_cn") == "zh"
    assert Word.normalize_lang("zh-hant-TW") == "zh-Hant"
    assert Word.normalize_lang("zh-Hans") == "zh"
    assert Word.normalize_lang("sr-latn") == "sr-Latn"
    assert Word.normalize_lang(nil) == nil
  end

  property "well-formed tags in any case or separator normalize to a valid tag" do
    check all(
            primary <- string(?a..?z, min_length: 2, max_length: 3),
            script <- one_of([constant(nil), string(?a..?z, length: 4)]),
            region <- one_of([constant(nil), string(?A..?Z, length: 2)]),
            sep <- member_of(["-", "_"]),
            upper? <- boolean()
          ) do
      tag = Enum.reject([primary, script, region], &is_nil/1) |> Enum.join(sep)
      tag = if upper?, do: String.upcase(tag), else: tag

      assert Word.normalize_lang(tag) =~ @lang_format
    end
  end

  test "normalize_base keeps a script or region subtag in canonical case" do
    assert Word.normalize_base("ES") == "es"
    assert Word.normalize_base("pt_br") == "pt-BR"
    assert Word.normalize_base("zh-hant") == "zh-Hant"
    assert Word.normalize_base("spanish") == nil
    assert Word.normalize_base(nil) == nil
  end

  test "same_language? compares the primary subtag" do
    assert Word.same_language?("en", "en")
    assert Word.same_language?("zh", "zh-Hant")
    refute Word.same_language?("ja", "es")
  end

  @word %Word{
    id: 7,
    uuid: "01928f6e-7b2c-7def-8abc-0123456789ab",
    lang: "ja",
    native: "犬",
    base_lang: "en",
    sense: "",
    gloss: "dog",
    forms: [
      %{text: "dog", enabled: true, case: "any", ambiguous: false},
      %{text: "dogs", enabled: false, case: "any", ambiguous: false}
    ],
    romanization: "inu",
    status: "active",
    origin: "add",
    language: "Japanese",
    created_at: ~U[2026-10-01 21:23:47.123456Z],
    updated_at: ~U[2026-10-01 21:23:47.123456Z]
  }

  test "to_api returns every section 1 field with millisecond timestamps" do
    api = Word.to_api(@word)

    assert api.id == @word.uuid
    assert api.created_at == "2026-10-01T21:23:47.123Z"
    assert api.deleted_at == nil

    for field <- ~w(native_vocalized pronunciation pronunciation_careful pronunciation_source
                    merged_into note source_text)a do
      assert Map.has_key?(api, field) and is_nil(api[field]), "#{field}"
    end
  end

  test "to_legacy_json is the 0.2 shape: integer id, english, enabled forms as strings" do
    assert Word.to_legacy_json(@word) == %{
             id: 7,
             lang: "ja",
             language: "Japanese",
             native: "犬",
             romanization: "inu",
             english: "dog",
             forms: ["dog"],
             note: nil,
             base_lang: "en",
             native_vocalized: nil,
             pronunciation: nil,
             pronunciation_careful: nil,
             pronunciation_source: nil
           }
  end

  test "to_legacy_json adds the pronunciation fields for the word card (slice 19)" do
    word = %Word{
      @word
      | lang: "ru",
        native: "пожалуйста",
        native_vocalized: "пожа́луйста",
        romanization: "pozhaluysta",
        pronunciation: "pa-ZHAL-sta",
        pronunciation_careful: "pa-ZHA-lu-sta",
        pronunciation_source: "model",
        gloss: "please"
    }

    json = Word.to_legacy_json(word)
    assert json.native_vocalized == "пожа́луйста"
    assert json.pronunciation == "pa-ZHAL-sta"
    assert json.pronunciation_careful == "pa-ZHA-lu-sta"
    assert json.pronunciation_source == "model"
    assert json.base_lang == "en"
    # The 0.2 fields are unchanged.
    assert json.english == "please"
    assert json.native == "пожалуйста"
  end
end
