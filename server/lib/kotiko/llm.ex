# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.LLM do
  @moduledoc """
  Turns a free-form message into structured word entries. Talks to any OpenAI-compatible
  chat API: OpenRouter by default, or Ollama, OpenAI, etc. via LLM_URL.
  """
  require Logger
  alias Kotiko.{Lang, WordSpec}
  alias Kotiko.WordSpec.Prompt

  @doc """
  Asks the model about `text` with the prompt of `spec/prompt.md` (slice 09) and checks
  the answer with `Kotiko.WordSpec.process/2`. `recent` is a list of language tags the
  learner has been adding lately; it settles ambiguous input like "what's da" (Russian?
  Serbian?) without the learner having to say.

  Options: `:base_langs` (default `["en"]`), `:add` (the add box), `:hint_lang`.

  Tries each model in LLM_MODEL in turn, moving on when one is busy, fails, answers with
  no JSON, or (with `add: true`) finds no word. Free models are often rate limited.
  Returns `{:ok, result}` (`Kotiko.WordSpec.process/2`'s result) or `{:error, message}`.
  """
  def interpret(text, recent \\ [], opts \\ []) do
    add? = Keyword.get(opts, :add, false)
    bases = Keyword.get(opts, :base_langs) || ["en"]
    mode = if add?, do: "add", else: "auto"

    system =
      Prompt.system(%{base_langs: bases, mode: mode, recent: recent, hint_lang: opts[:hint_lang]})

    input = %{text: text, mode: mode, base_langs: bases}
    try_models(Application.fetch_env!(:kotiko, :llm_models), system, text, {add?, input}, [])
  end

  defp try_models([], _system, _text, _req, failures), do: {:error, give_up(failures)}

  defp try_models([model | rest], system, text, {add?, input} = req, failures) do
    case ask(model, system, text) |> checked(model, input) do
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

  defp checked({:ok, content}, model, input) do
    case WordSpec.process(input, content) do
      {:ok, result} ->
        if result.words == [] and result.rejected != [] do
          reasons = result.rejected |> Enum.map(& &1.reason) |> Enum.uniq() |> Enum.join(", ")
          Logger.warning("LLM #{model}: rejected the words it returned (#{reasons})")
          Logger.debug("LLM #{model}: rejected #{inspect(result.rejected)}")
        end

        language_check(model, content)
        {:ok, result}

      {:error, :unparseable} ->
        {:error, "unexpected answer: #{inspect(content, printable_limit: 300)}"}
    end
  end

  defp checked(other, _model, _input), do: other

  # The model's "language" is a self-check only (slice 08 section 4): names come from the
  # tag. A disagreement is logged for prompt tuning.
  defp language_check(model, content) do
    with %{"words" => words} when is_list(words) <- WordSpec.extract(content) do
      for %{"lang" => lang, "language" => name} <- words,
          is_binary(name),
          {:ok, tag} <- [Lang.canonical(lang)],
          String.downcase(Lang.name(tag, "en")) != String.downcase(name) do
        Logger.debug(
          "LLM #{model}: called #{tag} #{inspect(name)}; Kotiko calls it #{Lang.name(tag, "en")}"
        )
      end
    end

    :ok
  end

  @doc """
  The one-time pronunciation refresh's request (slice 07 section 8): `items` are
  `%{lang, native, sense, base_langs}`, at most 20. Tries at most two models with a
  45-second timeout each (slice 10 replaces this with its bulk batch budget).

  Returns `{:ok, [item]}` with the answer's items checked by
  `Kotiko.WordSpec.process_respell/2` (a failing field is nil), or `{:error, reason}` with
  `:rate_limited`, `:quota_exhausted` or `{:failed, message}`.
  """
  def respell(items) do
    system = Prompt.respell_system(items)
    text = Jason.encode!(%{items: items})
    models = :kotiko |> Application.fetch_env!(:llm_models) |> Enum.take(2)
    respell_models(models, items, system, text, [])
  end

  defp respell_models([], _items, _system, _text, failures) do
    reasons = Enum.map(failures, &elem(&1, 1))

    cond do
      Enum.any?(reasons, &(&1 == "rate limited (daily limit)")) -> {:error, :quota_exhausted}
      Enum.all?(reasons, &String.starts_with?(&1, "rate limited")) -> {:error, :rate_limited}
      true -> {:error, {:failed, give_up(failures)}}
    end
  end

  defp respell_models([model | rest], items, system, text, failures) do
    case ask(model, system, text, 45_000) do
      {:ok, content} ->
        case WordSpec.process_respell(items, content) do
          {:ok, %{items: answers}} ->
            log_lookup("LLM #{model}: respelled #{length(answers)} item(s)", "")
            {:ok, answers}

          {:error, :unparseable} ->
            respell_models(rest, items, system, text, [{model, "no items"} | failures])
        end

      {:fatal, reason} ->
        {:error, {:failed, reason}}

      {:error, reason} ->
        Logger.warning("LLM #{model}: #{reason}")
        respell_models(rest, items, system, text, [{model, reason} | failures])
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
         content when is_binary(content) <- msg["content"] do
      {:ok, content}
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
end
