defmodule Slovo.LLM do
  @moduledoc """
  Turns a free-form message into structured word entries. Talks to any OpenAI-compatible
  chat API: OpenRouter by default, or Ollama, OpenAI, etc. via LLM_URL.
  """
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
  - "How do you say X" means they want the foreign word for English X.
  - If the user names a language ("in arabic", "japanese for cat"), always use it.
  - lang is the bare language code. Add a script subtag only when the user asks for a
    non-default script, e.g. zh-Hant for traditional Chinese.
  - Dictionary form: nouns singular (nominative where the language has cases), verbs in the
    infinitive or citation form. Use the language's normal capitalization.
  - Write native the way it appears in everyday text: simplified characters for Mandarin,
    no vowel marks (harakat, niqqud) for Arabic or Hebrew. Put pronunciation in romanization.
  - english_forms: only whole English words or short phrases with the same meaning.
    Include common inflections (plural, -s, -ed, -ing) that keep the meaning.
  """

  @doc """
  `recent` is a list of %{lang, language} the user has been adding lately; it settles
  ambiguous input like "what's da" (Russian? Serbian?) without the user having to say.
  """
  def interpret(text, recent \\ []) do
    key = Application.get_env(:slovo, :llm_api_key)
    url = Application.fetch_env!(:slovo, :llm_url) <> "/chat/completions"
    [model | fallbacks] = Application.fetch_env!(:slovo, :llm_models)

    body =
      %{
        model: model,
        temperature: 0.2,
        response_format: %{type: "json_object"},
        messages: [
          %{role: "system", content: @system <> recent_hint(recent)},
          %{role: "user", content: text}
        ]
      }
      # OpenRouter tries these in order when the first model is down or rate limited.
      |> then(&if(fallbacks == [], do: &1, else: Map.put(&1, :models, [model | fallbacks])))

    headers =
      [{"x-title", "Slovo"}] ++ if(key, do: [{"authorization", "Bearer " <> key}], else: [])

    with {:ok, %Req.Response{status: 200, body: %{"choices" => [%{"message" => msg} | _]}}} <-
           Req.post(url, json: body, headers: headers, receive_timeout: 120_000),
         content when is_binary(content) <- msg["content"],
         {:ok, parsed} when is_map(parsed) <- Jason.decode(extract_json(content)) do
      {:ok, normalize(parsed)}
    else
      {:ok, %Req.Response{status: 401}} ->
        {:error, "the API key was rejected (check LLM_API_KEY)"}

      {:ok, %Req.Response{status: 429}} ->
        {:error, "the free model is rate limited; try again in a minute"}

      {:ok, %Req.Response{status: s, body: b}} ->
        {:error, "#{url} returned #{s}: #{api_error(b)}"}

      {:ok, other} ->
        {:error, "Model returned unexpected JSON: #{inspect(other)}"}

      {:error, e} ->
        {:error, if(is_exception(e), do: Exception.message(e), else: inspect(e))}

      nil ->
        {:error, "the model returned an empty answer"}

      other ->
        {:error, "unexpected answer from the model: #{inspect(other)}"}
    end
  end

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
