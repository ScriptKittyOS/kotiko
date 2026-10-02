# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Log.Redact do
  @moduledoc """
  A primary `:logger` filter that takes keys and tokens out of every log event before any
  handler sees it, at every level, so logs can be shared in an issue:

    * `Bearer <token>` becomes `Bearer [redacted]`
    * OpenRouter and OpenAI style keys (`sk-or-v1-...`, `sk-...`) become `[redacted-key]`
    * the Telegram bot token in request URLs (`/bot123:ABC.../getUpdates`) becomes
      `bot[redacted]`
    * the configured values of API_TOKEN, LLM_API_KEY, TELEGRAM_BOT_TOKEN and
      TRANSCRIBE_API_KEY become `[redacted]`

  Events that contain none of these pass through untouched; one that does is rewritten
  to plain text.
  """

  @filter_id :kotiko_redact
  @secrets_key {__MODULE__, :secrets}
  # Shorter values would redact ordinary words.
  @min_secret_length 8

  @patterns [
    {~r/Bearer\s+[A-Za-z0-9._~+\/=-]+/, "Bearer [redacted]"},
    {~r/sk-or-v1-[A-Za-z0-9]+/, "[redacted-key]"},
    {~r/sk-[A-Za-z0-9_-]{20,}/, "[redacted-key]"},
    {~r/bot\d+:[A-Za-z0-9_-]+/, "bot[redacted]"}
  ]

  @doc "Adds the filter to the primary logger config. Safe to call more than once."
  def install do
    case :logger.add_primary_filter(@filter_id, {&__MODULE__.filter/2, []}) do
      :ok -> :ok
      {:error, {:already_exist, _}} -> :ok
    end
  end

  @doc "Sets the literal secret values to redact (nil and short values are ignored)."
  def put_secrets(values) do
    secrets =
      values
      |> Enum.filter(&(is_binary(&1) and String.length(&1) >= @min_secret_length))
      |> Enum.uniq()
      # Longest first, so a secret that contains another is replaced whole.
      |> Enum.sort_by(&(-byte_size(&1)))

    :persistent_term.put(@secrets_key, secrets)
  end

  @doc "The values of the secret settings in the app env."
  def configured_secrets do
    Enum.map(
      [:api_token, :llm_api_key, :telegram_token, :transcribe_api_key],
      &Application.get_env(:kotiko, &1)
    )
  end

  @doc "Redacts one string."
  def redact(text) when is_binary(text) do
    text = Enum.reduce(secrets(), text, &String.replace(&2, &1, "[redacted]"))

    Enum.reduce(@patterns, text, fn {re, replacement}, acc ->
      Regex.replace(re, acc, replacement)
    end)
  end

  defp secrets, do: :persistent_term.get(@secrets_key, [])

  @doc false
  # The :logger filter callback. It must never raise: logger removes a filter that crashes.
  def filter(%{msg: msg, meta: meta} = event, _extra) do
    text = to_text(msg, meta)
    redacted = redact(text)

    if redacted == text, do: event, else: %{event | msg: {:string, redacted}}
  rescue
    _ -> %{event | msg: {:string, "[a log message was dropped: it couldn't be checked for keys]"}}
  end

  defp to_text({:string, chardata}, _meta), do: chardata_to_string(chardata)

  defp to_text({:report, report}, %{report_cb: cb}) when is_function(cb, 1) do
    {format, args} = cb.(report)
    format_to_string(format, args)
  end

  defp to_text({:report, report}, %{report_cb: cb}) when is_function(cb, 2) do
    report
    |> cb.(%{depth: :unlimited, chars_limit: :unlimited, single_line: false})
    |> chardata_to_string()
  end

  defp to_text({:report, report}, _meta) do
    {format, args} = :logger.format_report(report)
    format_to_string(format, args)
  end

  defp to_text({format, args}, _meta), do: format_to_string(format, args)

  defp format_to_string(format, args), do: format |> :io_lib.format(args) |> chardata_to_string()

  defp chardata_to_string(chardata) do
    case :unicode.characters_to_binary(chardata) do
      binary when is_binary(binary) -> binary
      _ -> chardata |> :unicode.characters_to_binary(:latin1) |> to_string()
    end
  end
end
