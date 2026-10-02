# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.PronunciationTest do
  # Slice 07 section 7's validation table (the stand-in until slice 09's validator).
  use ExUnit.Case, async: true
  alias Kotiko.Pronunciation

  defp check(attrs) do
    Map.merge(
      %{
        lang: "ru",
        native: "пожалуйста",
        base_lang: "en",
        pronunciation: nil,
        pronunciation_careful: nil,
        native_vocalized: nil
      },
      Map.new(attrs)
    )
    |> Pronunciation.check()
  end

  defp reasons({_word, dropped}), do: Enum.map(dropped, &{&1.field, &1.reason})

  @valid [
    {"ru", "пожалуйста", "en", "pa-ZHAL-sta"},
    {"ru", "здравствуйте", "en", "ZDRAST-vuy-tyeh"},
    {"ru", "до свидания", "en", "da svi-DA-nya"},
    {"ru", "да", "en", "da"},
    {"ru", "хорошо", "es", "ja-ra-SHO"},
    {"ru", "нет", "es", "ñet"},
    {"ja", "ありがとう", "es", "a-ri-ga-too"},
    {"ja", "好き", "en", "skee"},
    {"zh", "谢谢", "en", "shyeh4-shyeh"},
    {"zh", "你好", "en", "nee2-how3"},
    {"zh", "谢谢", "es", "shie4-shie"},
    {"yue", "多謝", "en", "daw1 jeh6"},
    {"es", "gracias", "en", "GRA-syas"},
    {"en", "house", "es", "jaus"},
    {"tlh", "Qapla'", "en", "QAP-la'"}
  ]

  @invalid [
    {"two capital syllables", "ru", "пожалуйста", "en", "PA-ZHAL-STA"},
    {"no stressed syllable", "ru", "пожалуйста", "en", "pa-zhal-sta"},
    {"a capital one-syllable word", "ru", "да", "en", "DA"},
    {"mixed-case syllable", "ru", "пожалуйста", "en", "pa-Zhal-sta"},
    {"capitals for a target without stress", "ja", "ありがとう", "en", "a-ri-GA-too"},
    {"IPA", "ru", "пожалуйста", "en", "pɐˈʐaləstə"},
    {"an accent mark for stress", "es", "gracias", "en", "grá-syas"},
    {"ñ outside the Spanish key", "ru", "нет", "en", "ñet"},
    {"empty syllable", "ru", "пожалуйста", "en", "pa--ZHAL-sta"},
    {"trailing hyphen", "ru", "пожалуйста", "en", "pa-ZHAL-sta-"},
    {"digits for a toneless target", "ru", "пожалуйста", "en", "pa2-ZHAL-sta"},
    {"tone out of range", "zh", "谢谢", "en", "shyeh5-shyeh"},
    {"a digit mid-syllable", "zh", "谢谢", "en", "sh4yeh-shyeh"},
    {"Mandarin word with no tone", "zh", "谢谢", "en", "shyeh-shyeh"},
    {"Cantonese syllable with no tone", "yue", "多謝", "en", "daw1 jeh"},
    {"too long", "ru", "пожалуйста", "en", "pa-ZHAL-" <> String.duplicate("sta", 40)}
  ]

  for {lang, native, base, p} <- @valid do
    @case {lang, native, base, p}
    test "valid: #{p} (#{lang} for #{base})" do
      {lang, native, base, p} = @case
      {word, dropped} = check(lang: lang, native: native, base_lang: base, pronunciation: p)
      assert dropped == []
      assert {word.pronunciation, word.pronunciation_source} == {p, "model"}
    end
  end

  for {label, lang, native, base, p} <- @invalid do
    @case {lang, native, base, p}
    test "bad_pronunciation: #{label}" do
      {lang, native, base, p} = @case

      result =
        check(
          lang: lang,
          native: native,
          base_lang: base,
          pronunciation: p,
          pronunciation_careful: "x-Y"
        )

      assert reasons(result) == [{"pronunciation", "bad_pronunciation"}]
      {word, _} = result

      assert {word.pronunciation, word.pronunciation_careful, word.pronunciation_source} ==
               {nil, nil, nil}
    end
  end

  test "a base without a respelling key gets no pronunciation, silently" do
    assert {%{pronunciation: nil}, []} = check(base_lang: "de", pronunciation: "pa-ZHAL-sta")
  end

  test "careful: kept when valid and different; null when equal or without an everyday form" do
    assert {%{pronunciation_careful: "pa-ZHA-lu-sta"}, []} =
             check(pronunciation: "pa-ZHAL-sta", pronunciation_careful: "pa-ZHA-lu-sta")

    assert {%{pronunciation_careful: nil}, []} =
             check(pronunciation: "pa-ZHAL-sta", pronunciation_careful: "pa-ZHAL-sta")

    assert {%{pronunciation_careful: nil}, []} = check(pronunciation_careful: "pa-ZHA-lu-sta")

    assert reasons(check(pronunciation: "pa-ZHAL-sta", pronunciation_careful: "PA-ZHA-lu-sta")) ==
             [{"pronunciation_careful", "bad_pronunciation"}]
  end

  test "a learner's source is kept" do
    assert {%{pronunciation_source: "user"}, []} =
             check(pronunciation: "pa-ZHAL-sta", pronunciation_source: "user")
  end

  describe "native_vocalized" do
    test "the stress mark on the right vowel is kept" do
      assert {%{native_vocalized: "пожа́луйста"}, []} =
               check(
                 native_vocalized: "пожа́луйста",
                 pronunciation: "pa-ZHAL-sta",
                 pronunciation_careful: "pa-ZHA-lu-sta"
               )
    end

    test "different letters, two marks or a mark on ё are bad_vocalized" do
      for v <- ["пожалуйста́́", "пожа́лу́йста", "пажа́луйста"] do
        assert reasons(check(native_vocalized: v)) == [{"native_vocalized", "bad_vocalized"}], v
      end

      assert reasons(check(native: "ёлка", native_vocalized: "ё́лка")) ==
               [{"native_vocalized", "bad_vocalized"}]
    end

    test "a mark that disagrees with the capital syllable is a stress_mismatch" do
      {word, dropped} =
        check(
          native_vocalized: "по́жалуйста",
          pronunciation: "pa-ZHAL-sta",
          pronunciation_careful: "pa-ZHA-lu-sta"
        )

      assert word.native_vocalized == nil
      assert word.pronunciation == "pa-ZHAL-sta"
      assert Enum.map(dropped, & &1.reason) == ["stress_mismatch"]
    end

    test "Arabic harakat are allowed; a target with no marks gets null" do
      assert {%{native_vocalized: "شُكْرًا"}, []} =
               check(lang: "ar", native: "شكرا", native_vocalized: "شُكْرًا")

      assert {%{native_vocalized: nil}, []} =
               check(lang: "ja", native: "犬", native_vocalized: "犬")
    end
  end
end
