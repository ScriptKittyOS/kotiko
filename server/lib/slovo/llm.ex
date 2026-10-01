defmodule Slovo.LLM do
  @moduledoc "Turns a free-form message into structured word entries using a local Ollama model."

  @system """
  You are a vocabulary assistant for an English speaker learning Russian and Mandarin Chinese.
  The user sends a short message, often a voice transcript with misspellings, and the foreign
  word may be written phonetically in Latin letters (e.g. "what's spaseeba", "add sobaka").
  Work out which Russian or Mandarin word(s) they are asking about or want to save.

  Respond with ONLY a JSON object, no prose, exactly this shape:
  {
    "intent": "add" | "lookup" | "chat",
    "words": [
      {
        "lang": "ru" | "zh",
        "native": "dictionary form in Cyrillic, or simplified Chinese characters",
        "romanization": "Latin transliteration for ru; pinyin with tone marks for zh",
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
  - If the language is ambiguous, assume Russian.
  - Russian: nouns in nominative singular, verbs in the infinitive, lowercase.
  - english_forms: only whole English words or short phrases with the same meaning.
    Include common inflections (plural, -s, -ed, -ing) that keep the meaning.
  """

  def interpret(text) do
    model =
      Application.get_env(:slovo, :ollama_model) ||
        raise "OLLAMA_MODEL is not set in .env"

    url = Application.fetch_env!(:slovo, :ollama_url) <> "/api/chat"

    body = %{
      model: model,
      stream: false,
      format: "json",
      options: %{temperature: 0.2},
      messages: [
        %{role: "system", content: @system},
        %{role: "user", content: text}
      ]
    }

    with {:ok, %Req.Response{status: 200, body: %{"message" => %{"content" => content}}}} <-
           Req.post(url, json: body, receive_timeout: 300_000),
         {:ok, parsed} when is_map(parsed) <- Jason.decode(extract_json(content)) do
      {:ok, normalize(parsed)}
    else
      {:ok, %Req.Response{status: s, body: b}} -> {:error, "Ollama returned #{s}: #{inspect(b)}"}
      {:ok, other} -> {:error, "Model returned unexpected JSON: #{inspect(other)}"}
      {:error, e} -> {:error, if(is_exception(e), do: Exception.message(e), else: inspect(e))}
    end
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
      |> Enum.reject(&(blank?(&1.native) or blank?(&1.english)))

    intent = if map["intent"] in ["add", "lookup", "chat"], do: map["intent"], else: "lookup"
    intent = if intent == "chat" and words != [], do: "lookup", else: intent

    %{intent: intent, words: words, reply: clean(map["reply"])}
  end

  defp normalize_word(w) do
    lang = if w["lang"] in ["ru", "zh"], do: w["lang"], else: "ru"
    native = clean(w["native"])
    native = if lang == "ru" and native, do: String.downcase(native), else: native

    forms =
      w["english_forms"]
      |> List.wrap()
      |> Enum.map(&clean/1)
      |> Enum.reject(&blank?/1)
      |> Enum.join("\n")

    %{
      lang: lang,
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
