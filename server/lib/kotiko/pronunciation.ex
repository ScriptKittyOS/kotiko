# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Pronunciation do
  @moduledoc """
  Checks the pronunciation fields of a word (slice 07 section 7): `pronunciation`,
  `pronunciation_careful` and `native_vocalized`. A failing field never rejects the word:
  it is set to nil and listed in `dropped_fields`.

  Minimal stand-in for slice 09: the facts per target language and the respelling key
  alphabets below are what slice 09 moves to `spec/pronunciation.json` and
  `spec/lang/<base>/respelling.json`, with its full validator (`Kotiko.WordSpec`).
  """
  alias Kotiko.Text

  @max_chars 96
  @acute "́"

  # Targets with word stress, written with one capital syllable per word.
  @lexical ~w(ru uk be bg sr hr bs sl mk pl cs sk es en de it pt nl el ro ca gl ar he fa tr
              sv no nb da is ka hy lt lv sq eu)
  # Targets without word stress: all lowercase.
  @no_stress ~w(ja ko fr vi zh yue)
  @tones %{"zh" => 1..4, "yue" => 1..6}
  # Marks that `native_vocalized` may add to `native`.
  @marks %{
    "ru" => ~r/\x{0301}/u,
    "uk" => ~r/\x{0301}/u,
    "be" => ~r/\x{0301}/u,
    "ar" => ~r/[\x{064B}-\x{065F}\x{0670}]/u,
    "he" => ~r/[\x{0591}-\x{05C7}]/u
  }
  @stress_marked ~w(ru uk be)
  # Bases with a respelling key and its letters (slice 07 section 7: en and es at launch).
  @alphabets %{"en" => "a-zA-Z", "es" => "a-zA-ZñÑ"}

  @doc "Base languages that get a `pronunciation` (those with a respelling key)."
  def bases_with_key, do: Map.keys(@alphabets)

  @doc "True when records for `base` get a pronunciation."
  def key?(base), do: Map.has_key?(@alphabets, base_primary(base))

  @doc """
  Checks the three fields of `word` (a map with `lang`, `native`, `base_lang` and the
  fields) and returns `{word, dropped}`: the word with failing fields set to nil and the
  list of `%{field, reason}` that were dropped. `pronunciation_source` follows
  `pronunciation`: kept (default `"model"`) when it survives, else nil.
  """
  def check(word) do
    {word, []}
    |> check_pronunciation()
    |> check_vocalized()
    |> stress_agreement()
  end

  defp check_pronunciation({word, dropped}) do
    target = word[:lang]
    base = word[:base_lang]

    cond do
      not key?(base) ->
        {clear_pronunciation(word), dropped}

      is_nil(word[:pronunciation]) ->
        {clear_pronunciation(word), dropped}

      not valid?(word[:pronunciation], target, base) ->
        {clear_pronunciation(word),
         dropped ++ [%{field: "pronunciation", reason: "bad_pronunciation"}]}

      true ->
        careful = word[:pronunciation_careful]

        {careful, dropped} =
          cond do
            is_nil(careful) or careful == word[:pronunciation] ->
              {nil, dropped}

            valid?(careful, target, base) ->
              {careful, dropped}

            true ->
              {nil, dropped ++ [%{field: "pronunciation_careful", reason: "bad_pronunciation"}]}
          end

        source =
          if word[:pronunciation_source] in ["model", "user"],
            do: word[:pronunciation_source],
            else: "model"

        {Map.merge(word, %{pronunciation_careful: careful, pronunciation_source: source}),
         dropped}
    end
  end

  defp clear_pronunciation(word) do
    Map.merge(word, %{pronunciation: nil, pronunciation_careful: nil, pronunciation_source: nil})
  end

  defp check_vocalized({word, dropped}) do
    v = word[:native_vocalized]
    lang = word[:lang]

    cond do
      is_nil(v) ->
        {word, dropped}

      not Map.has_key?(@marks, target_primary(lang)) ->
        {Map.put(word, :native_vocalized, nil), dropped}

      vocalized_ok?(v, word[:native], target_primary(lang)) ->
        {word, dropped}

      true ->
        {Map.put(word, :native_vocalized, nil),
         dropped ++ [%{field: "native_vocalized", reason: "bad_vocalized"}]}
    end
  end

  defp vocalized_ok?(v, native, lang) do
    stripped = Regex.replace(@marks[lang], v, "")

    stripped == native and
      (lang not in @stress_marked or
         Enum.all?(String.split(v, " "), fn w ->
           count(w, @acute) <= 1 and not String.contains?(w, ["ё" <> @acute, "Ё" <> @acute])
         end))
  end

  # ru, uk, be: the vowel carrying U+0301 must be the capitalised syllable of the careful
  # form (or the everyday one), when that form has one syllable per written vowel.
  defp stress_agreement({word, dropped}) do
    lang = target_primary(word[:lang])
    v = word[:native_vocalized]
    form = word[:pronunciation_careful] || word[:pronunciation]

    if (lang in @stress_marked and v) && form && not agrees?(v, form) do
      {Map.put(word, :native_vocalized, nil),
       dropped ++ [%{field: "native_vocalized", reason: "stress_mismatch"}]}
    else
      {word, dropped}
    end
  end

  defp agrees?(vocalized, form) do
    words = String.split(vocalized, " ")
    spoken = String.split(form, " ")

    length(words) != length(spoken) or
      Enum.zip(words, spoken)
      |> Enum.all?(fn {w, s} ->
        syllables = String.split(s, "-")
        vowels = vowel_positions(w)

        case {length(syllables) == length(vowels), Enum.find_index(syllables, &capital?/1),
              stressed_vowel(w)} do
          {false, _, _} -> true
          {true, nil, nil} -> true
          {true, cap, stressed} -> cap == stressed
        end
      end)
  end

  @vowels String.graphemes("аеёиоуыэюяіїєАЕЁИОУЫЭЮЯІЇЄ")

  defp vowel_positions(word) do
    word
    |> String.replace(@acute, "")
    |> String.graphemes()
    |> Enum.filter(&(&1 in @vowels))
  end

  # Index, counted in vowel letters, of the vowel followed by U+0301.
  defp stressed_vowel(word) do
    word
    |> String.codepoints()
    |> Enum.reduce_while({-1, nil}, fn
      @acute, {i, _} -> {:halt, {i, i}}
      c, {i, found} -> {:cont, {if(c in @vowels, do: i + 1, else: i), found}}
    end)
    |> elem(1)
  end

  @doc "True when a pronunciation string follows section 7's format for this target and base."
  def valid?(p, target, base) when is_binary(p) do
    tones = Map.get(@tones, target_primary(target))
    alphabet = Map.fetch!(@alphabets, base_primary(base))
    digits = if tones, do: "0-9", else: ""
    chars = Regex.compile!("^[#{alphabet}#{digits}' -]+$", "u")

    Text.length(p) <= @max_chars and Regex.match?(chars, p) and
      shape?(p, stress(target), tones)
  end

  def valid?(_, _, _), do: false

  defp shape?(p, stress, tones) do
    words = String.split(p, " ")

    Enum.all?(words, fn w ->
      syllables = String.split(w, "-")

      Enum.all?(syllables, &syllable?(&1, tones)) and
        stress_ok?(syllables, stress) and tones_ok?(syllables, tones)
    end)
  end

  defp syllable?(s, tones) do
    letters = String.replace(s, ~r/[0-9]+$/, "")

    letters != "" and Regex.match?(~r/[^']/u, letters) and not (letters =~ ~r/[0-9]/) and
      (String.upcase(letters) == letters or String.downcase(letters) == letters) and
      digit_ok?(s, tones)
  end

  defp digit_ok?(s, nil), do: not (s =~ ~r/[0-9]/)

  defp digit_ok?(s, range) do
    case Regex.run(~r/([0-9]+)$/, s) do
      nil -> true
      [_, d] -> String.to_integer(d) in range
    end
  end

  defp capital?(s) do
    letters = String.replace(s, ~r/[^\p{L}]/u, "")
    letters != "" and String.upcase(letters) == letters and String.downcase(letters) != letters
  end

  defp stress_ok?(syllables, :lexical) do
    caps = Enum.count(syllables, &capital?/1)
    if length(syllables) >= 2, do: caps == 1, else: caps == 0
  end

  defp stress_ok?(syllables, :none), do: not Enum.any?(syllables, &capital?/1)
  defp stress_ok?(_syllables, :unknown), do: true

  defp tones_ok?(_syllables, nil), do: true

  defp tones_ok?(syllables, 1..6//1) do
    Enum.all?(syllables, &(&1 =~ ~r/[0-9]$/))
  end

  defp tones_ok?(syllables, _mandarin) do
    length(syllables) == 1 or Enum.any?(syllables, &(&1 =~ ~r/[0-9]$/))
  end

  defp stress(target) do
    t = target_primary(target)

    cond do
      t in @lexical -> :lexical
      t in @no_stress -> :none
      true -> :unknown
    end
  end

  defp target_primary(nil), do: nil
  defp target_primary("yue" <> _), do: "yue"
  defp target_primary(tag), do: tag |> String.split("-") |> hd()

  defp base_primary(nil), do: nil
  defp base_primary(tag), do: tag |> String.split("-") |> hd()

  defp count(s, sub), do: length(String.split(s, sub)) - 1
end
