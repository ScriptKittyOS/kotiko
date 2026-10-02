# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Slovo.LLM do
  @moduledoc """
  Turns a free-form message into structured word entries. Talks to any OpenAI-compatible
  chat API: OpenRouter by default, or Ollama, OpenAI, etc. via LLM_URL.
  """
  require Logger
  alias Slovo.Word

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
        "romanization": "Latin pronunciation (pinyin with tone marks for Mandarin); null if the language uses Latin script",
        "english": "the single most common English equivalent, lowercase",
        "english_forms": ["every English form that should be swapped for this word on a web page, e.g. house, houses"],
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
    no vowel marks (harakat, niqqud) for Arabic or Hebrew. Put pronunciation in romanization.
  - english_forms: only forms of the word's main English meaning, as whole words or short
    phrases. Include common inflections (plural, -s, -ed, -ing) that keep the meaning.
    Never add other words or loose synonyms: for "как" that is ["how"], not "what", "as", "like".
  """

  @add_box """

  This message was typed into an "add a word" box, so it always names one or more words to
  save: intent is "add", never "chat".
  """

  @doc """
  `recent` is a list of %{lang, language} the user has been adding lately; it settles
  ambiguous input like "what's da" (Russian? Serbian?) without the user having to say.

  Tries each model in LLM_MODEL in turn, moving on when one is busy, fails, or (with
  `add: true`, for the popup's add box) finds no word. Free models are often rate limited.
  """
  def interpret(text, recent \\ [], opts \\ []) do
    add? = Keyword.get(opts, :add, false)
    system = @system <> recent_hint(recent) <> if(add?, do: @add_box, else: "")
    try_models(Application.fetch_env!(:slovo, :llm_models), system, text, add?, [])
  end

  defp try_models([], _system, _text, _add?, failures), do: {:error, give_up(failures)}

  defp try_models([model | rest], system, text, add?, failures) do
    case ask(model, system, text) do
      {:ok, %{words: []}} when add? and rest != [] ->
        log_lookup(
          "LLM #{model}: found no word, trying the next model",
          " (#{inspect(text)})"
        )

        try_models(rest, system, text, add?, [{model, "found no word"} | failures])

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
        try_models(rest, system, text, add?, [{model, reason} | failures])
    end
  end

  # What the learner typed stays out of the logs unless LOG_LOOKUPS=true (or at debug).
  defp log_lookup(line, details) do
    if Application.get_env(:slovo, :log_lookups, false) do
      Logger.info(line <> details)
    else
      Logger.info(line)
      Logger.debug(line <> details)
    end
  end

  defp give_up(failures) do
    if Enum.all?(failures, fn {_, r} -> r == "rate limited" end) do
      "all the free models are busy right now; try again in a minute"
    else
      "no model could answer (" <>
        Enum.map_join(Enum.reverse(failures), "; ", fn {m, r} -> "#{m}: #{r}" end) <> ")"
    end
  end

  defp ask(model, system, text) do
    key = Application.get_env(:slovo, :llm_api_key)
    url = Application.fetch_env!(:slovo, :llm_url) <> "/chat/completions"

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
      [{"x-title", "Slovo"}] ++ if(key, do: [{"authorization", "Bearer " <> key}], else: [])

    with {:ok, %Req.Response{status: 200, body: %{"choices" => [%{"message" => msg} | _]}}} <-
           Req.post(
             url,
             [json: body, headers: headers, receive_timeout: 60_000, retry: false] ++
               req_options()
           ),
         content when is_binary(content) <- msg["content"],
         {:ok, parsed} when is_map(parsed) <- Jason.decode(extract_json(content)) do
      result = normalize(parsed)

      if result.words == [] and parsed["words"] not in [nil, []] do
        Logger.warning("LLM #{model}: dropped the words it returned (fields missing)")
        Logger.debug("LLM #{model}: dropped #{inspect(parsed["words"])}")
      end

      {:ok, result}
    else
      {:ok, %Req.Response{status: 401}} when is_nil(key) ->
        {:fatal, "LLM_API_KEY isn't set. Add it to server/.env and restart the server"}

      # .env is only read at startup, so a key added later needs a restart.
      {:ok, %Req.Response{status: 401}} ->
        {:fatal, "the API key was rejected. Check LLM_API_KEY in .env, then restart the server"}

      {:ok, %Req.Response{status: 429}} ->
        {:error, "rate limited"}

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
  defp req_options, do: Application.get_env(:slovo, :llm_req_options, [])

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

  defp normalize(map) do
    words =
      map
      |> Map.get("words", [])
      |> List.wrap()
      |> Enum.filter(&is_map/1)
      |> Enum.map(&normalize_word/1)
      |> Enum.reject(&(blank?(&1.lang) or blank?(&1.native) or blank?(&1.english)))

    intent = if map["intent"] in ["add", "lookup", "chat"], do: map["intent"], else: "lookup"
    intent = if intent == "chat" and words != [], do: "lookup", else: intent

    %{intent: intent, words: words, reply: clean(map["reply"])}
  end

  defp normalize_word(w) do
    lang = Word.normalize_lang(w["lang"])
    native = clean(w["native"])

    forms =
      w["english_forms"]
      |> List.wrap()
      |> Enum.map(&clean/1)
      |> Enum.reject(&blank?/1)
      |> Enum.join("\n")

    %{
      lang: lang,
      language: clean(w["language"]),
      native: native,
      romanization: clean(w["romanization"]),
      english: clean(w["english"]),
      english_forms: forms,
      note: clean(w["note"])
    }
  end

  defp clean(s) when is_binary(s), do: String.trim(s)
  defp clean(_), do: nil

  defp blank?(s), do: s in [nil, ""]
end
