# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.LLM.Client do
  @moduledoc """
  One HTTP attempt against an OpenAI-compatible chat API (slice 10 section 2): builds the
  request for one model and its capabilities, enforces the attempt's timeout, and
  returns either `{:content, text}` (a 200 with a message) or an outcome from
  `Kotiko.LLM.Policy.classify/1`.

  Also the two GET requests of OpenRouter: `get/2` for `/models` and `/key`.
  """
  alias Kotiko.LLM.Policy
  alias Kotiko.Spec

  @referer "https://github.com/ScriptKittyOS/kotiko"

  @doc """
  Asks `model` once. `caps` is the model's `%{json_mode, reasoning_toggle, max_tokens}`;
  `opts`: `:timeout_ms` (required), `:json` (send `response_format`, default
  `caps.json_mode`), `:max_tokens` (the output cap, sent on every request in the field
  `max_tokens_field/0` names).
  """
  def attempt(model, caps, messages, opts) do
    timeout = Keyword.fetch!(opts, :timeout_ms)
    json? = Keyword.get(opts, :json, caps.json_mode)

    body =
      %{model: model, temperature: Spec.rule(:temperature), messages: messages}
      |> put_if(json?, :response_format, %{type: "json_object"})
      # Thinking takes 5-20 s longer and doesn't get these lookups more right.
      |> put_if(openrouter?() and caps.reasoning_toggle, :reasoning, %{enabled: false})
      # The spec's output cap on every request, whatever the catalog says, so a model on a
      # paid endpoint that keeps writing can't bill the key up to the provider's own limit
      # (security review D-03). OpenRouter ignores it for a model that doesn't take it.
      |> put_if(is_integer(opts[:max_tokens]), max_tokens_field(), opts[:max_tokens])

    request = fn ->
      Req.post(
        url("/chat/completions"),
        [
          json: body,
          headers: headers(),
          receive_timeout: timeout,
          connect_options: [timeout: min(timeout, 10_000)],
          retry: false
        ] ++ req_options()
      )
    end

    case run(request, timeout) do
      {:ok, %Req.Response{status: 200, body: body} = resp} -> answer(resp, body)
      {:ok, %Req.Response{} = resp} -> classify(resp)
      {:error, exception} -> transport(exception)
      :timeout -> %{kind: :timeout, status: nil, detail: "no answer in #{timeout} ms"}
    end
  end

  @doc "GET `{LLM_URL}<path>` with the key, for `/models` and `/key`. `{:ok, body}` or `{:error, reason}`."
  def get(path, timeout) do
    request = fn ->
      Req.get(
        url(path),
        [headers: headers(), receive_timeout: timeout, retry: false] ++ req_options()
      )
    end

    case run(request, timeout) do
      {:ok, %Req.Response{status: 200, body: body}} when is_map(body) -> {:ok, body}
      {:ok, %Req.Response{status: status}} -> {:error, "answered #{status}"}
      {:error, e} -> {:error, if(is_exception(e), do: Exception.message(e), else: inspect(e))}
      :timeout -> {:error, "no answer in #{timeout} ms"}
    end
  end

  @doc "Whether LLM_URL is OpenRouter (its catalog, quota and app headers)."
  def openrouter?, do: Kotiko.Config.openrouter?(Application.fetch_env!(:kotiko, :llm_url))

  @doc """
  The request field for the output cap: the `maxTokensField` of the spec/providers.json
  preset on LLM_URL's host (OpenAI's reasoning models take only `max_completion_tokens`),
  `max_tokens` otherwise.
  """
  def max_tokens_field do
    host = host(Application.fetch_env!(:kotiko, :llm_url))

    field =
      Enum.find_value(Spec.providers(), "max_tokens", fn p ->
        host && is_binary(p["baseUrl"]) && host(p["baseUrl"]) == host && p["maxTokensField"]
      end)

    if field == "max_completion_tokens", do: :max_completion_tokens, else: :max_tokens
  end

  defp host(url) do
    case URI.parse(url).host do
      host when is_binary(host) and host != "" -> String.downcase(host)
      _ -> nil
    end
  end

  @doc "Whether an API key is configured."
  def key?, do: Application.get_env(:kotiko, :llm_api_key) not in [nil, ""]

  # The request runs in its own process so the timeout holds whatever the HTTP client
  # does (a stalled TLS handshake, a test plug). A crash in it is re-raised here.
  defp run(request, timeout) do
    task = Task.Supervisor.async_nolink(Kotiko.TaskSup, request)

    case Task.yield(task, timeout) || Task.shutdown(task, :brutal_kill) do
      {:ok, result} -> result
      {:exit, {exception, stack}} when is_exception(exception) -> reraise exception, stack
      {:exit, reason} -> {:error, reason}
      nil -> :timeout
    end
  end

  defp answer(_resp, %{"choices" => [%{"message" => %{"content" => content}} | _]})
       when is_binary(content) and content != "",
       do: {:content, content}

  # OpenRouter can answer 200 with an error object (a provider failed mid-request).
  defp answer(resp, %{"error" => %{"code" => code}} = body) when is_integer(code) do
    classify(%{resp | status: code, body: body})
  end

  defp answer(_resp, body), do: %{kind: :unparseable, status: 200, detail: detail(body)}

  defp classify(%Req.Response{status: status, headers: headers, body: body}) do
    %{status: status, headers: headers, body: body}
    |> Policy.classify()
    |> Map.put(:detail, detail(body))
  end

  defp transport(%Req.TransportError{reason: :timeout}),
    do: %{kind: :timeout, status: nil, detail: "timeout"}

  defp transport(e) do
    detail = if is_exception(e), do: Exception.message(e), else: inspect(e)
    %{kind: :network, status: nil, detail: detail}
  end

  # For the debug log only, after slice 29's redaction filter.
  defp detail(body) when is_binary(body), do: String.slice(body, 0, 300)
  defp detail(body), do: body |> inspect(printable_limit: 300) |> String.slice(0, 300)

  defp headers do
    key = Application.get_env(:kotiko, :llm_api_key)

    [{"x-title", "Kotiko"}, {"user-agent", Kotiko.Health.user_agent()}] ++
      if(openrouter?(), do: [{"http-referer", @referer}], else: []) ++
      if(key, do: [{"authorization", "Bearer " <> key}], else: [])
  end

  # The path goes before LLM_URL's query, if it has one (`?api-version=...`): the query
  # stays on every request.
  defp url(path) do
    uri = URI.parse(Application.fetch_env!(:kotiko, :llm_url))
    URI.to_string(%{uri | path: String.trim_trailing(uri.path || "", "/") <> path})
  end

  defp put_if(map, true, key, value), do: Map.put(map, key, value)
  defp put_if(map, _false, _key, _value), do: map

  # Empty in production; tests route requests to a Req.Test stub.
  defp req_options, do: Application.get_env(:kotiko, :llm_req_options, [])
end
