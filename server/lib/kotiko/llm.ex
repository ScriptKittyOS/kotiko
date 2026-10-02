# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.LLM do
  @moduledoc """
  Turns a free-form message into structured word entries. Talks to any OpenAI-compatible
  chat API: OpenRouter by default, or Ollama, OpenAI, etc. via LLM_URL.
  """
  require Logger
  alias Kotiko.Word

  @system """
  You are a vocabulary assistant for an English speaker learning many languages at once.
  The user sends a short message, often a voice transcript with misspellings, and the foreign
  word may be written phonetically in Latin letters (e.g. "what's spaseeba", "add shukran",
  "add sobaka", "how do you say dog in japanese"). Work out which word(s) in which language
  they are asking about or want to save. Any language is fine.

  Respond with ONLY a JSON object, no prose, exactly this shape:
  {
    "intent": "add" | "lookup" | "chat",
    "words": [
      {
        "lang": "BCP 47 code: ru, zh, ar, ja, es, ko, he, hi...",
        "language": "English name of the language, e.g. Russian, Mandarin, Arabic",
        "native": "the word in its own script, dictionary form, as it is normally written",
        "romanization": "the word in its language's standard Latin-letter spelling, for typing and search: pinyin with tone marks, modified Hepburn, Revised Romanization, simplified BGN/PCGN for Russian (pozhaluysta); never stress or reduced vowels; null if the language uses Latin script",
        "english": "the single most common English equivalent, lowercase",
        "english_forms": ["every English form that should be swapped for this word on a web page, e.g. house, houses"],
        "pronunciation": "how to say native, respelled for the learner (rules below)",
        "pronunciation_careful": "the same said slowly and clearly; null when it is the same",
        "native_vocalized": "Russian, Ukrainian, Belarusian: native with U+0301 after the stressed vowel; else null",
        "note": "one short sentence: gender, aspect, or a tiny usage example"
      }
    ],
    "reply": "only when intent is chat: a brief helpful answer"
  }

  Rules:
  - intent is "add" when the user explicitly asks to add, save or remember a word;
    "lookup" when they ask what something means or how to say something;
    "chat" when no specific word is involved (then "words" is []).
  - A message that is only a word or short phrase, in any script or spelled phonetically
    ("как", "shukran", "xie xie"), is a lookup of that word, never chat.
  - "How do you say X" means they want the foreign word for English X.
  - If the user names a language ("in arabic", "japanese for cat"), always use it.
  - lang is the bare language code. Add a script subtag only when the user asks for a
    non-default script, e.g. zh-Hant for traditional Chinese.
  - Dictionary form: nouns singular (nominative where the language has cases), verbs in the
    infinitive or citation form. Use the language's normal capitalization.
  - Write native the way it appears in everyday text: simplified characters for Mandarin,
    no vowel marks (harakat, niqqud) for Arabic or Hebrew. How to say the word goes in
    pronunciation, never in romanization.
  - english_forms: only forms of the word's main English meaning, as whole words or short
    phrases. Include common inflections (plural, -s, -ed, -ing) that keep the meaning.
    Never add other words or loose synonyms: for "как" that is ["how"], not "what", "as", "like".
  """

  @add_box """

  This message was typed into an "add a word" box, so it always names one or more words to
  save: intent is "add", never "chat".
  """

  # ── Placeholder until slice 09 ──────────────────────────────────────
  # Slice 09 owns the prompt (spec/prompt.json) and its validator. Until then these
  # sections add slice 07's pronunciation fields and base languages to today's prompt,
  # as briefly as possible.

  @pronunciation """

  Pronunciation rules. "pronunciation" tells the learner how to say native, using only
  the letters of the key below. Join syllables with hyphens and words with spaces. For
  languages with word stress, write the stressed syllable of each word of two or more
  syllables in capitals, and only that one; one-syllable words are lowercase. Japanese,
  Korean, French, Mandarin, Cantonese and Vietnamese: all lowercase. Mandarin and
  Cantonese: a tone digit after each syllable as actually said (你好 nee2-how3), none for
  the neutral tone. Write the everyday form a native speaker uses at a normal pace, with
  the reductions every speaker makes (молоко ma-la-KO; пожалуйста pa-ZHAL-sta), never slang.
  pronunciation_careful is the word said slowly and clearly (pa-ZHA-lu-sta); null when it
  is the same, which is most words. No IPA symbols and no accent marks.
  """

  @keys %{
    "en" =>
      "Key for English readers: a as in father, e as in bed, ee as in see, i as in sit, " <>
        "ih for Russian ы, o as in or, oh as in go, oo as in food, u as in put, uh as in " <>
        "cup, ay as in day, ai as in aisle, ow as in cow, oy as in boy; g as in go, s as " <>
        "in see, j as in jam, zh as in measure, kh as in loch, ch as in church, sh as in " <>
        "ship, ts as in cats, th as in thin, dh as in this, y as in yes. Examples: " <>
        "спасибо spa-SEE-ba, хорошо kha-ra-SHO, 谢谢 shyeh4-shyeh, gracias GRA-syas.",
    "es" =>
      "Key for Spanish readers, read as Spanish: vowels a e i o u, long vowels doubled; " <>
        "k for [k]; j for [x] and [h], never h; sh for [ʃ]; zh for [ʒ]; z for a buzzing " <>
        "s; ch, ts; ñ for a palatal n; y before a vowel, i after one; Russian soft " <>
        "consonants with i before the vowel. Examples: хорошо ja-ra-SHO, пожалуйста " <>
        "pa-ZHAL-sta, 谢谢 shie4-shie, house jaus."
  }

  @respell """
  You write pronunciations for words a learner already saved. The user message is JSON:
  "items", each with "lang", "native", "sense" and "base_langs". For each item and each of
  its base languages, return one object {"lang", "native", "base_lang", "pronunciation",
  "pronunciation_careful", "native_vocalized"}, copying lang and native exactly. Use sense
  to choose between words spelled alike (замок "castle": ZA-mak; "lock": za-MOK).
  native_vocalized: for Russian, Ukrainian and Belarusian, native with U+0301 after the
  stressed vowel (пожа́луйста), never on ё; otherwise null. Return only {"items": [...]}.
  """

  defp pronunciation_prompt(bases) do
    keys = bases |> Enum.map(&@keys[base_primary(&1)]) |> Enum.reject(&is_nil/1)
    without = Enum.reject(bases, &@keys[base_primary(&1)])

    @pronunciation <>
      Enum.join(keys, "\n") <>
      if(without == [],
        do: "",
        else: "\nFor entries whose base is #{Enum.join(without, ", ")}, pronunciation is null."
      ) <> "\n"
  end

  defp bases_prompt(["en"]), do: ""

  defp bases_prompt(bases) do
    """

    The learner reads: #{Enum.join(bases, ", ")}. Instead of "english" and "english_forms",
    give one entry per word and per language in that list, each with "base_lang" (that
    language's code), "gloss" (the meaning in that language, lowercase unless that
    language always capitalises it) and "forms" (the forms in that language to swap on its
    pages). Leave out a language when the word itself is in it. pronunciation is written
    for a reader of the entry's base_lang; romanization and native_vocalized are the same
    in every entry of a word.
    """
  end

  defp hint_prompt(nil), do: ""

  defp hint_prompt(lang),
    do: "\nThe text was selected on a page in #{lang}; prefer that language.\n"

  defp base_primary(tag), do: tag |> String.split("-") |> hd()

  # ── end of the placeholder ───────────────────────────────────────────

  @doc """
  `recent` is a list of %{lang, language} the user has been adding lately; it settles
  ambiguous input like "what's da" (Russian? Serbian?) without the user having to say.

  Tries each model in LLM_MODEL in turn, moving on when one is busy, fails, or (with
  `add: true`, for the popup's add box) finds no word. Free models are often rate limited.
  """
  def interpret(text, recent \\ [], opts \\ []) do
    add? = Keyword.get(opts, :add, false)
    bases = Keyword.get(opts, :base_langs) || ["en"]

    system =
      @system <>
        bases_prompt(bases) <>
        pronunciation_prompt(bases) <>
        recent_hint(recent) <>
        hint_prompt(opts[:hint_lang]) <> if(add?, do: @add_box, else: "")

    try_models(Application.fetch_env!(:kotiko, :llm_models), system, text, {add?, bases}, [])
  end

  defp try_models([], _system, _text, _req, failures), do: {:error, give_up(failures)}

  defp try_models([model | rest], system, text, {add?, bases} = req, failures) do
    case ask(model, system, text) |> normalized(model, bases) do
      {:ok, %{words: []}} when add? and rest != [] ->
        log_lookup(
          "LLM #{model}: found no word, trying the next model",
          " (#{inspect(text)})"
        )

        try_models(rest, system, text, req, [{model, "found no word"} | failures])

      {:ok, result} ->
        log_lookup(
          "LLM #{model}: found #{length(result.words)} word(s)",
          ": #{inspect(text)} -> #{Enum.map_join(result.words, ", ", & &1.native)}"
        )

        {:ok, result}

      {:fatal, reason} ->
        {:error, reason}

      {:error, reason} ->
        Logger.warning("LLM #{model}: #{reason}")
        try_models(rest, system, text, req, [{model, reason} | failures])
    end
  end

  # What the learner typed stays out of the logs unless LOG_LOOKUPS=true (or at debug).
  defp log_lookup(line, details) do
    if Application.get_env(:kotiko, :log_lookups, false) do
      Logger.info(line <> details)
    else
      Logger.info(line)
      Logger.debug(line <> details)
    end
  end

  defp give_up(failures) do
    if Enum.all?(failures, fn {_, r} -> String.starts_with?(r, "rate limited") end) do
      "all the free models are busy right now; try again in a minute"
    else
      "no model could answer (" <>
        Enum.map_join(Enum.reverse(failures), "; ", fn {m, r} -> "#{m}: #{r}" end) <> ")"
    end
  end

  defp normalized({:ok, parsed}, model, bases) do
    result = normalize(parsed, bases)

    if result.words == [] and parsed["words"] not in [nil, []] do
      Logger.warning("LLM #{model}: dropped the words it returned (fields missing)")
      Logger.debug("LLM #{model}: dropped #{inspect(parsed["words"])}")
    end

    {:ok, result}
  end

  defp normalized(other, _model, _bases), do: other

  @doc """
  The one-time pronunciation refresh's request (slice 07 section 8): `items` are
  `%{lang, native, sense, base_langs}`, at most 20. Tries at most two models with a
  45-second timeout each (slice 10 replaces this with its bulk batch budget).

  Returns `{:ok, [item]}` with the answer's raw items (string keys), or `{:error, reason}`
  with `:rate_limited`, `:quota_exhausted` or `{:failed, message}`.
  """
  def respell(items) do
    bases = items |> Enum.flat_map(& &1.base_langs) |> Enum.uniq()
    system = @respell <> pronunciation_prompt(bases)
    text = Jason.encode!(%{items: items})
    models = :kotiko |> Application.fetch_env!(:llm_models) |> Enum.take(2)
    respell_models(models, system, text, [])
  end

  defp respell_models([], _system, _text, failures) do
    reasons = Enum.map(failures, &elem(&1, 1))

    cond do
      Enum.any?(reasons, &(&1 == "rate limited (daily limit)")) -> {:error, :quota_exhausted}
      Enum.all?(reasons, &String.starts_with?(&1, "rate limited")) -> {:error, :rate_limited}
      true -> {:error, {:failed, give_up(failures)}}
    end
  end

  defp respell_models([model | rest], system, text, failures) do
    case ask(model, system, text, 45_000) do
      {:ok, %{"items" => items}} when is_list(items) ->
        log_lookup("LLM #{model}: respelled #{length(items)} item(s)", "")
        {:ok, Enum.filter(items, &is_map/1)}

      {:ok, _} ->
        respell_models(rest, system, text, [{model, "no items"} | failures])

      {:fatal, reason} ->
        {:error, {:failed, reason}}

      {:error, reason} ->
        Logger.warning("LLM #{model}: #{reason}")
        respell_models(rest, system, text, [{model, reason} | failures])
    end
  end

  defp ask(model, system, text, timeout \\ 60_000) do
    key = Application.get_env(:kotiko, :llm_api_key)
    url = Application.fetch_env!(:kotiko, :llm_url) <> "/chat/completions"

    body =
      %{
        model: model,
        temperature: 0.2,
        response_format: %{type: "json_object"},
        messages: [%{role: "system", content: system}, %{role: "user", content: text}]
      }
      # Thinking models take 5-20 s longer and don't get these lookups more right.
      |> then(
        &if(url =~ "openrouter.ai", do: Map.put(&1, :reasoning, %{enabled: false}), else: &1)
      )

    headers =
      [{"x-title", "Kotiko"}, {"user-agent", Kotiko.Health.user_agent()}] ++
        if(key, do: [{"authorization", "Bearer " <> key}], else: [])

    with {:ok, %Req.Response{status: 200, body: %{"choices" => [%{"message" => msg} | _]}}} <-
           Req.post(
             url,
             [json: body, headers: headers, receive_timeout: timeout, retry: false] ++
               req_options()
           ),
         content when is_binary(content) <- msg["content"],
         {:ok, parsed} when is_map(parsed) <- Jason.decode(extract_json(content)) do
      {:ok, parsed}
    else
      {:ok, %Req.Response{status: 401}} when is_nil(key) ->
        {:fatal, "LLM_API_KEY isn't set. Add it to server/.env and restart the server"}

      # .env is only read at startup, so a key added later needs a restart.
      {:ok, %Req.Response{status: 401}} ->
        {:fatal, "the API key was rejected. Check LLM_API_KEY in .env, then restart the server"}

      # OpenRouter's daily cap on free models says "free-models-per-day".
      {:ok, %Req.Response{status: 429, body: b}} ->
        if api_error(b) =~ "per-day",
          do: {:error, "rate limited (daily limit)"},
          else: {:error, "rate limited"}

      {:ok, %Req.Response{status: s, body: b}} ->
        {:error, "returned #{s}: #{api_error(b)}"}

      {:ok, other} ->
        {:error, "unexpected JSON: #{inspect(other, printable_limit: 300)}"}

      {:error, e} ->
        {:error, if(is_exception(e), do: Exception.message(e), else: inspect(e))}

      nil ->
        {:error, "empty answer"}

      other ->
        {:error, "unexpected answer: #{inspect(other, printable_limit: 300)}"}
    end
  end

  # Empty in production; tests route requests to a Req.Test stub.
  defp req_options, do: Application.get_env(:kotiko, :llm_req_options, [])

  defp api_error(%{"error" => %{"message" => m}}), do: m
  defp api_error(b), do: inspect(b)

  defp recent_hint([]), do: ""

  defp recent_hint(recent) do
    names = Enum.map_join(recent, ", ", &"#{&1.language || &1.lang} (#{&1.lang})")

    "\nThe user has recently been adding words in: #{names}. If the language of a word is " <>
      "ambiguous and the user didn't name one, prefer the first (most recent) language in that " <>
      "list that fits.\n"
  end

  # Drop any <think>...</think> block and keep the outermost {...}.
  defp extract_json(content) do
    content = Regex.replace(~r/<think>.*?<\/think>/s, content, "")

    case {:binary.match(content, "{"), :binary.matches(content, "}")} do
      {{start, _}, [_ | _] = closes} ->
        {last, _} = List.last(closes)
        binary_part(content, start, last - start + 1)

      _ ->
        content
    end
  end

  defp normalize(map, bases) do
    words =
      map
      |> Map.get("words", [])
      |> List.wrap()
      |> Enum.filter(&is_map/1)
      |> Enum.map(&normalize_word(&1, bases))
      |> Enum.reject(&(blank?(&1.lang) or blank?(&1.native) or blank?(&1.gloss)))

    intent = if map["intent"] in ["add", "lookup", "chat"], do: map["intent"], else: "lookup"
    intent = if intent == "chat" and words != [], do: "lookup", else: intent

    %{intent: intent, words: words, reply: clean(map["reply"])}
  end

  # Slice 07's fields. With one base, today's "english" and "english_forms" are read as
  # gloss and forms, and a missing base_lang is that base (slice 09's legacy-key rule).
  defp normalize_word(w, bases) do
    single = match?([_], bases)
    legacy = fn key, old -> if is_nil(w[key]) and single, do: w[old], else: w[key] end

    forms =
      legacy.("forms", "english_forms")
      |> split_forms()
      |> Enum.map(&clean/1)
      |> Enum.reject(&blank?/1)

    %{
      lang: Word.normalize_lang(w["lang"]),
      language: clean(w["language"]),
      native: clean(w["native"]),
      romanization: clean(w["romanization"]),
      native_vocalized: clean(w["native_vocalized"]),
      base_lang: clean(w["base_lang"]) || if(single, do: hd(bases)),
      gloss: clean(legacy.("gloss", "english")),
      forms: forms,
      pronunciation: clean(w["pronunciation"]),
      pronunciation_careful: clean(w["pronunciation_careful"]),
      note: clean(w["note"])
    }
  end

  defp split_forms(s) when is_binary(s), do: String.split(s, ~r/[,;、，；\n]/u)
  defp split_forms(forms), do: List.wrap(forms)

  defp clean(s) when is_binary(s), do: String.trim(s)
  defp clean(_), do: nil

  defp blank?(s), do: s in [nil, ""]
end
