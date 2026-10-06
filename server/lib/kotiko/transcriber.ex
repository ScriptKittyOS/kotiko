# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Transcriber do
  @moduledoc """
  Speech-to-text for Telegram voice notes. Talks to anything that accepts a multipart
  upload with a `file` field and answers with `{"text": ...}`: a local whisper.cpp
  server (/inference) or any OpenAI-compatible /v1/audio/transcriptions endpoint.
  """

  def configured?, do: Application.get_env(:kotiko, :transcribe_url) != nil

  def transcribe(audio) when is_binary(audio) do
    url = Application.fetch_env!(:kotiko, :transcribe_url)

    auth =
      case Application.get_env(:kotiko, :transcribe_api_key) do
        nil -> []
        key -> [{"authorization", "Bearer " <> key}]
      end

    headers = [{"user-agent", Kotiko.Health.user_agent()} | auth]

    form = [
      file: {audio, filename: "voice.ogg", content_type: "audio/ogg"},
      model: Application.fetch_env!(:kotiko, :transcribe_model),
      response_format: "json"
    ]

    # The options are empty in production; tests route the request to a Req.Test stub.
    options =
      [form_multipart: form, headers: headers, receive_timeout: 120_000] ++
        Application.get_env(:kotiko, :transcribe_req_options, [])

    case Req.post(url, options) do
      {:ok, %Req.Response{status: 200, body: %{"text" => text}}} ->
        {:ok, String.trim(text)}

      {:ok, %Req.Response{status: 200, body: body}} when is_binary(body) ->
        case Jason.decode(body) do
          {:ok, %{"text" => text}} -> {:ok, String.trim(text)}
          _ -> {:ok, String.trim(body)}
        end

      {:ok, %Req.Response{status: s, body: b}} ->
        {:error, "transcriber returned #{s}: #{inspect(b)}"}

      {:error, e} ->
        {:error, if(is_exception(e), do: Exception.message(e), else: inspect(e))}
    end
  end
end
