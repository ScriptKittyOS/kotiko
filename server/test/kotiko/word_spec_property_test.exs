# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.WordSpecPropertyTest do
  # Dynamic analysis (OpenSSF dynamic_analysis): Kotiko.WordSpec checks everything a
  # client or the model sends before it reaches the database. Whatever arrives, it answers
  # with a result or a reason, never an exception, and what it accepts keeps the rules.
  use ExUnit.Case, async: true
  use ExUnitProperties
  alias Kotiko.{Gen, Lang, Spec, Text, Word, WordSpec}

  @fields ~w(lang native sense romanization native_vocalized gloss forms pronunciation
             pronunciation_careful pronunciation_source note status)

  defp fold(s), do: WordSpec.fold(s)

  property "validate_word/2 answers every object with a valid word or a reason" do
    check all(word <- Gen.word(), base_langs <- member_of([nil, [], ["en"], ["es", "en"]])) do
      case WordSpec.validate_word(word, base_langs: base_langs) do
        {:ok, attrs, dropped} ->
          assert Lang.canonical(attrs.lang) == {:ok, attrs.lang}
          assert attrs.base_lang == Lang.base_tag(attrs.base_lang)
          refute Lang.same_base?(attrs.lang, attrs.base_lang)
          if base_langs not in [nil, []], do: assert(attrs.base_lang in base_langs)

          assert attrs.native == Text.clean(attrs.native)
          assert attrs.gloss == Text.clean(attrs.gloss)
          assert Text.length(attrs.native) <= Spec.rule(:max_native_chars)
          assert Text.length(attrs.gloss) <= Spec.rule(:max_gloss_chars)
          assert attrs.note == nil or Text.length(attrs.note) <= Spec.rule(:max_note_chars)
          assert Text.length(attrs.sense) <= Spec.rule(:max_sense_chars)
          assert attrs.sense == String.downcase(attrs.sense)

          assert attrs.forms != [] and length(attrs.forms) <= Spec.rule(:max_forms)
          assert Enum.any?(attrs.forms, & &1.enabled)
          assert Enum.uniq_by(attrs.forms, &fold(&1.text)) == attrs.forms

          for f <- attrs.forms do
            assert is_binary(f.text) and Text.length(f.text) <= Spec.rule(:max_form_chars)
          end

          assert attrs.status in ~w(active paused)
          assert attrs.origin in Word.origins()
          # No pronunciation, no source.
          if attrs.pronunciation,
            do: assert(attrs.pronunciation_source in ~w(model user wiktionary)),
            else: assert(attrs.pronunciation_source == nil)

          assert attrs.id == nil or Kotiko.UUID7.valid?(attrs.id)
          assert is_list(dropped)

        {:error, reason, summary} ->
          assert is_atom(reason)
          assert Map.keys(summary) |> Enum.sort() == [:base_lang, :gloss, :native]
      end
    end
  end

  property "a word validate_word/2 accepted is accepted again unchanged" do
    check all(word <- Gen.word()) do
      with {:ok, attrs, _} <- WordSpec.validate_word(word) do
        assert {:ok, again, _} = WordSpec.validate_word(attrs)
        assert again == attrs
      end
    end
  end

  property "patch/1 returns only the fields the body has, or names the one it refused" do
    # Values each field could take, so a patch often gets past its first field.
    plausible =
      member_of([nil, "active", "paused", "user", "wiktionary", "ru", "Haus", "da", ["dog"]])

    check all(
            body <-
              Gen.object(@fields ++ ["id", "other"], frequency([{2, plausible}, {1, Gen.json()}]))
          ) do
      case WordSpec.patch(body) do
        {:ok, patch} ->
          assert patch |> Map.keys() |> Enum.map(&to_string/1) |> Enum.all?(&(&1 in @fields))
          for {k, _} <- patch, do: assert(Map.has_key?(body, to_string(k)))
          if Map.has_key?(patch, :status), do: assert(patch.status in ~w(active paused))
          if is_binary(patch[:native]), do: assert(patch.native == Text.clean(patch.native))

        {:error, %{field: field, reason: reason}} ->
          assert field in @fields and Map.has_key?(body, field)
          assert is_binary(reason)
      end
    end
  end

  property "prepare_input/1 gives trimmed NFC text without control characters, or a reason" do
    check all(input <- one_of([Gen.text(max_length: 250), Gen.json()])) do
      case WordSpec.prepare_input(input) do
        {:ok, text} ->
          assert text == String.trim(text) and text != ""
          assert text == :unicode.characters_to_nfc_binary(text)
          refute text =~ ~r/\p{Cc}/u
          assert Text.length(text) <= Spec.rule(:max_input_chars)
          assert WordSpec.prepare_input(text) == {:ok, text}

        {:error, reason} ->
          assert reason in [:empty_input, :input_too_long]
      end
    end
  end

  property "extract/2 finds the JSON object in any model answer, or nothing" do
    check all(
            obj <- map_of(Gen.text(max_length: 8), Gen.json(), max_length: 3),
            before <- Gen.text(),
            after_text <- Gen.text(),
            fence? <- boolean()
          ) do
      object = Map.put(obj, "words", [])
      json = Jason.encode!(object)
      json = if fence?, do: "```json\n" <> json <> "\n```", else: json
      content = "<think>" <> before <> "</think>" <> json

      assert WordSpec.extract(content) == object
      # Text around it never makes it raise.
      result = WordSpec.extract(before <> json <> after_text)
      assert result == nil or is_map(result)
    end
  end
end
