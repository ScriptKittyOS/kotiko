# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Pronunciation do
  @moduledoc """
  The target-side and pronunciation fields of a word (slice 09 section 4, D2; slice 07
  section 7): `romanization`, `pronunciation`, `pronunciation_careful` and
  `native_vocalized`. A failing field never rejects the word: it is set to nil and listed
  in `dropped_fields`.

  The facts per target are `spec/pronunciation.json`; the respelling keys are
  `spec/lang/<base>/respelling.json` (only bases with a reviewed key get a
  pronunciation). `extension/lib/wordspec.js` implements the same rules.
  """
  alias Kotiko.{Lang, Spec, Text, WordSpec}

  @pron Spec.pronunciation()
  @targets @pron["targets"]
  @langs Spec.languages()["languages"]
  @acute "́"

  @doc "Base folders that have a respelling key, so their records get a `pronunciation`."
  def bases_with_key do
    for {folder, files} <- Spec.lang_folders(), Map.has_key?(files, "respelling"), do: folder
  end

  @doc "True when records for `base` get a pronunciation."
  def key?(base), do: not is_nil(WordSpec.lang_data(base).respelling)

  @doc """
  Checks the fields of `word` (a map with `lang`, `native`, `base_lang` and the fields)
  and the stress agreement of `native_vocalized`. Returns `{word, dropped}`: the word with
  failing fields set to nil and the list of `%{field, reason}` that were dropped.
  `pronunciation_source` follows `pronunciation`: kept when it survives ("model" unless it
  says "user"), else nil.
  """
  def check(word) do
    facts = facts(word[:lang])
    {word, dropped} = check_fields(word, facts)

    if stress_agrees?(word, facts) do
      {word, dropped}
    else
      {Map.put(word, :native_vocalized, nil),
       dropped ++ [%{field: "native_vocalized", reason: "stress_mismatch"}]}
    end
  end

  @doc """
  The facts for a target (slice 09 section 1): by the full tag, then by its language when
  the tag names no script; a target with no entry gets no romanization scheme when its
  script is Latin and "unspecified" otherwise, and "unknown" stress.
  """
  def facts(tag) do
    {lang, script} =
      case Lang.parse(tag || "") do
        %{lang: l, script: s} -> {l, s}
        _ -> {nil, nil}
      end

    entry = @targets[tag] || if(is_nil(script) and lang, do: @targets[lang])

    defaults = %{
      "stress_marked" => false,
      "neutral_tone" => false,
      "vowel_letters" => "",
      "vocalization_marks" => [],
      "tones" => nil
    }

    if entry do
      Map.merge(defaults, entry)
    else
      script = script || get_in(@langs, [lang || "", "script"])

      Map.merge(defaults, %{
        "romanization" => if(script == "Latn", do: nil, else: "unspecified"),
        "stress" => "unknown"
      })
    end
  end

  @doc """
  D2 without the stress agreement (which runs after a word's entries share their
  target-side fields): returns `{word, dropped}`.
  """
  def check_fields(word, facts) do
    key = WordSpec.lang_data(word[:base_lang] || "").respelling

    {word, []}
    |> romanization(facts)
    |> pronunciation(facts, key)
    |> vocalized(facts)
  end

  defp romanization({word, dropped}, %{"romanization" => nil}),
    do: {Map.put(word, :romanization, nil), dropped}

  defp romanization({word, dropped}, _facts) do
    r = word[:romanization]

    cond do
      is_nil(r) ->
        {word, dropped}

      not Regex.match?(~r/^[\p{Latin}\p{M}0-9'’ʻʼ .·-]+$/u, r) ->
        {Map.put(word, :romanization, nil), dropped ++ [drop("romanization", "bad_romanization")]}

      Text.length(r) > Spec.rule(:max_romanization_chars) ->
        {Map.put(word, :romanization, nil), dropped ++ [drop("romanization", "too_long")]}

      true ->
        {word, dropped}
    end
  end

  defp pronunciation({word, dropped}, facts, key) do
    p = word[:pronunciation]

    cond do
      is_nil(key) or is_nil(p) ->
        {clear(word), dropped}

      not valid?(p, facts, key) ->
        {clear(word), dropped ++ [drop("pronunciation", "bad_pronunciation")]}

      true ->
        {careful, dropped} = careful(word[:pronunciation_careful], p, facts, key, dropped)

        source =
          if word[:pronunciation_source] in ["user", "wiktionary"],
            do: word[:pronunciation_source],
            else: "model"

        {Map.merge(word, %{pronunciation_careful: careful, pronunciation_source: source}),
         dropped}
    end
  end

  defp careful(nil, _p, _facts, _key, dropped), do: {nil, dropped}
  defp careful(p, p, _facts, _key, dropped), do: {nil, dropped}

  defp careful(c, _p, facts, key, dropped) do
    if valid?(c, facts, key),
      do: {c, dropped},
      else: {nil, dropped ++ [drop("pronunciation_careful", "bad_pronunciation")]}
  end

  defp clear(word),
    do:
      Map.merge(word, %{pronunciation: nil, pronunciation_careful: nil, pronunciation_source: nil})

  defp vocalized({word, dropped}, facts) do
    v = word[:native_vocalized]

    cond do
      is_nil(v) ->
        {word, dropped}

      facts["vocalization_marks"] == [] ->
        {Map.put(word, :native_vocalized, nil), dropped}

      vocalized_ok?(v, word[:native] || "", facts) ->
        {word, dropped}

      true ->
        {Map.put(word, :native_vocalized, nil),
         dropped ++ [drop("native_vocalized", "bad_vocalized")]}
    end
  end

  defp drop(field, reason), do: %{field: field, reason: reason}

  defp vocalized_ok?(v, native, facts) do
    stripped = Regex.replace(mark_regex(facts["vocalization_marks"]), v, "")

    stripped == :unicode.characters_to_nfc_binary(native) and
      (not facts["stress_marked"] or
         Enum.all?(String.split(v, " "), fn w ->
           count(w, @acute) <= 1 and not String.contains?(w, ["ё" <> @acute, "Ё" <> @acute])
         end))
  end

  defp mark_regex(marks) do
    class =
      Enum.map_join(marks, fn m ->
        m |> String.split("-") |> Enum.map_join("-", &"\\x{#{String.replace(&1, "U+", "")}}")
      end)

    Regex.compile!("[#{class}]", "u")
  end

  @doc """
  ru, uk, be: the capital syllable of the careful form (or the everyday one) and the vowel
  carrying U+0301 in `native_vocalized` must be the same, counted in vowel letters, when
  the form has one syllable per vowel letter.
  """
  def stress_agrees?(word, facts) do
    v = word[:native_vocalized]
    form = word[:pronunciation_careful] || word[:pronunciation]

    if facts["stress_marked"] && v && form do
      v_words = String.split(v, " ")
      f_words = String.split(form, " ")
      vowels = String.codepoints(facts["vowel_letters"])

      length(v_words) != length(f_words) or
        v_words |> Enum.zip(f_words) |> Enum.all?(&word_agrees?(&1, vowels))
    else
      true
    end
  end

  defp word_agrees?({w, f}, vowels) do
    syllables = String.split(f, "-")

    {count, stressed} =
      w
      |> String.codepoints()
      |> Enum.reduce({0, nil}, fn
        @acute, {n, nil} -> {n, n - 1}
        c, {n, s} -> {if(c in vowels, do: n + 1, else: n), s}
      end)

    length(syllables) != count or Enum.find_index(syllables, &capital?/1) == stressed
  end

  @doc "True when a pronunciation follows the format for these target facts and this key."
  def valid?(p, facts, key) when is_binary(p) do
    Text.length(p) <= Spec.rule(:max_pronunciation_chars) and
      Regex.match?(chars(key["alphabet"], facts["tones"]), p) and
      not Regex.match?(~r/^[ -]|[ -]$|--| {2}| -|- /, p) and
      Enum.all?(String.split(p, " "), &word_ok?(&1, facts))
  end

  def valid?(_, _, _), do: false

  defp chars(alphabet, tones) do
    letters = Regex.escape(String.downcase(alphabet) <> String.upcase(alphabet))
    Regex.compile!("^[#{letters}#{if tones, do: "0-9"}' -]+$", "u")
  end

  defp word_ok?(word, facts) do
    syllables = String.split(word, "-")
    parsed = Enum.map(syllables, &Regex.run(~r/^([^0-9]+)([0-9]?)$/u, &1))

    Enum.all?(parsed, &syllable_ok?(&1, facts)) and
      stress_ok?(Enum.count(parsed, fn [_, l, _] -> capital?(l) end), length(syllables), facts) and
      tones_ok?(parsed, facts)
  end

  defp syllable_ok?(nil, _facts), do: false

  defp syllable_ok?([_, letters, digit], facts) do
    Regex.match?(~r/[^']/, letters) and
      (String.upcase(letters) == letters or String.downcase(letters) == letters) and
      digit_ok?(digit, facts)
  end

  defp digit_ok?("", %{"tones" => nil}), do: true
  defp digit_ok?("", facts), do: facts["neutral_tone"]
  defp digit_ok?(_d, %{"tones" => nil}), do: false
  defp digit_ok?(d, %{"tones" => [lo, hi]}), do: String.to_integer(d) in lo..hi

  defp stress_ok?(caps, n, %{"stress" => "lexical"}), do: caps == if(n >= 2, do: 1, else: 0)
  defp stress_ok?(caps, _n, %{"stress" => "none"}), do: caps == 0
  defp stress_ok?(_caps, _n, _facts), do: true

  defp tones_ok?(parsed, %{"tones" => [_, _], "neutral_tone" => true}) do
    length(parsed) == 1 or Enum.any?(parsed, fn [_, _, d] -> d != "" end)
  end

  defp tones_ok?(_parsed, _facts), do: true

  @doc false
  def capital?(s) do
    letters = String.replace(s, ~r/[^\p{L}]/u, "")
    letters != "" and String.upcase(letters) == letters and String.downcase(letters) != letters
  end

  defp count(s, sub), do: length(String.split(s, sub)) - 1
end
