# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Application do
  @moduledoc """
  Starts the database, the HTTP API and, when configured, the Telegram bot.

  Boot order (later slices plug their steps in here):

    1. `Kotiko.Config.load!/0`     parse and check the settings; exit 78 on a mistake
    2. `Kotiko.DataDir.resolve_and_migrate!/0`
                                  the data folder; copies the words from before the
                                  rename to Kotiko, once; makes the files private
    3. API token                  from API_TOKEN, the saved file, or a new one
    4. `Kotiko.Migrations.run!/0`  back the database up if a migration is pending, then
                                  migrate on one connection, before the pool opens
    5. startup summary            version, data, who can reach it, model, bot
    6. the supervision tree       Repo, tasks, background jobs, HTTP, bot

  The log filter that keeps keys out of the logs goes in first of all.
  """
  use Application
  require Logger
  alias Kotiko.{Config, DataDir, Exposure, Token}
  alias Kotiko.Log.Redact
  alias Kotiko.Plug.HostCheck

  @impl true
  def start(_type, _args) do
    Redact.install()
    Config.load!()
    DataDir.resolve_and_migrate!()
    token_source = load_token()
    Redact.put_secrets(Redact.configured_secrets())
    HostCheck.init_table()
    words = Kotiko.Migrations.run!()
    http = http_settings()
    log_summary(token_source, words, http)

    Kotiko.Lookup.init()

    children =
      [Kotiko.WriteLock, Kotiko.Repo, {Task.Supervisor, name: Kotiko.TaskSup}] ++
        llm_children() ++ background_children() ++ http_children(http) ++ bot_child()

    Supervisor.start_link(children, strategy: :one_for_one, name: Kotiko.Supervisor)
  end

  # API_TOKEN, else the saved token file, else a new one. Config.load! has already
  # checked API_TOKEN; what can still go wrong is the saved file.
  defp load_token do
    data_dir = Application.fetch_env!(:kotiko, :data_dir)

    case Token.resolve(Application.get_env(:kotiko, :api_token), data_dir) do
      {:ok, token, source} ->
        Application.put_env(:kotiko, :api_token, token)
        if match?({:generated, _}, source), do: print_new_token(token)
        source

      {:error, message} ->
        Config.abort!([{"API token", [message]}])
    end
  end

  # Only to an interactive terminal, never to journald or a log file.
  defp print_new_token(token) do
    if Keyword.get(io_opts(), :stdout, false) do
      IO.puts("\nNew API token (paste it into the extension's Connection settings):\n#{token}\n")
    end
  end

  defp io_opts do
    case :io.getopts(:standard_io) do
      opts when is_list(opts) -> opts
      _ -> []
    end
  end

  defp http_settings do
    if Application.get_env(:kotiko, :start_http, true) do
      port = Application.fetch_env!(:kotiko, :port)
      ip = Application.get_env(:kotiko, :bind_ip) || bind_ip()
      url = Exposure.server_url(Application.get_env(:kotiko, :public_url), ip, port)
      %{ip: ip, port: port, exposure: Exposure.classify(ip, url)}
    end
  end

  defp bind_ip do
    {:ok, ip} = Config.parse_bind(Application.fetch_env!(:kotiko, :bind))
    ip
  end

  defp log_summary(token_source, words, http) do
    {listen_line, exposure_warning} =
      case http do
        nil -> {"HTTP API: off", nil}
        %{exposure: {:info, _class, message}} -> {message, nil}
        %{exposure: {:warning, _class, message}} -> {"See the warning below.", message}
      end

    Logger.info(Enum.join(summary_lines(token_source, words, listen_line), "\n  "))
    if exposure_warning, do: Logger.warning(exposure_warning)

    if Application.get_env(:kotiko, :allowed_hosts) == :any do
      Logger.warning(
        "ALLOWED_HOSTS=* turns off the Host check, so web pages can reach this server " <>
          "through DNS rebinding. Use it only behind a proxy that checks Host itself."
      )
    end
  end

  @doc false
  # One info block: everything someone needs to see the server is set up as they meant.
  def summary_lines(token_source, words, listen_line) do
    data_dir = Application.fetch_env!(:kotiko, :data_dir)
    database = Application.fetch_env!(:kotiko, Kotiko.Repo)[:database]

    [
      "Starting the Kotiko server, version #{Kotiko.Health.version()}",
      "Data:      #{data_dir} (#{Path.basename(database)}, #{plural(words, "active word")})",
      "Listening: #{listen_line}",
      "API token: #{token_line(token_source)}",
      "Model:     #{model_line()}",
      "Telegram:  #{telegram_line()}",
      "Voice notes: #{if Kotiko.Transcriber.configured?(), do: "on", else: "off (TRANSCRIBE_URL is empty)"}"
    ]
  end

  defp token_line(:env), do: "from .env"
  defp token_line({_saved_or_generated, path}), do: "saved in #{path}"

  defp model_line do
    url = Application.fetch_env!(:kotiko, :llm_url)
    models = Application.fetch_env!(:kotiko, :llm_models)
    provider = if Config.openrouter?(url), do: "OpenRouter", else: url

    case Application.get_env(:kotiko, :llm_model_source, :env) do
      :default -> "#{provider}, its current free models (checked 10 s after start)"
      :env -> "#{provider}, #{plural(length(models), "model")} from LLM_MODEL"
    end
  end

  defp telegram_line do
    cond do
      is_nil(Application.get_env(:kotiko, :telegram_token)) ->
        "off (TELEGRAM_BOT_TOKEN is empty)"

      Application.get_env(:kotiko, :allowed_ids, []) == [] ->
        "on, waiting for ALLOWED_TELEGRAM_IDS (message the bot and it tells you your ID)"

      true ->
        "on, #{plural(length(Application.get_env(:kotiko, :allowed_ids)), "allowed account")}"
    end
  end

  defp plural(1, noun), do: "1 #{noun}"
  defp plural(n, noun), do: "#{n} #{noun}s"

  defp http_children(nil), do: []

  # BIND's address, and the other loopback address too (Kotiko.Listener).
  defp http_children(%{ip: ip, port: port, exposure: {_level, class, message}}) do
    Kotiko.Listener.child_specs(ip, port) ++ repeat_public_warning(class, message)
  end

  # Reachable from the internet: say so again every day, not just once at boot.
  defp repeat_public_warning(:public, message) do
    [Supervisor.child_spec({Task, fn -> warn_daily(message) end}, id: :public_warning)]
  end

  defp repeat_public_warning(_class, _message), do: []

  defp warn_daily(message) do
    Process.sleep(:timer.hours(24))
    Logger.warning(message)
    warn_daily(message)
  end

  # The lookup client (slice 10): the model list, the quota, the cache's single flight and
  # the two model calls in flight. Tests keep them but skip the boot fetches.
  defp llm_children do
    fetch? = Application.get_env(:kotiko, :background_jobs, true)

    [
      {Kotiko.LLM.Catalog, fetch: fetch?},
      {Kotiko.LLM.Quota, fetch: fetch?},
      Kotiko.LLM.Cache,
      Kotiko.LLM.Slots
    ]
  end

  # The daily cleanup, the one-time pronunciation refresh (slice 07) and the Wiktionary
  # pronunciations pass (slice 49 §4a). Off in tests, which call them directly.
  defp background_children do
    if Application.get_env(:kotiko, :background_jobs, true),
      do: [Kotiko.Janitor, Kotiko.PronunciationRefresh, Kotiko.WiktionaryPass],
      else: []
  end

  defp bot_child do
    if Application.get_env(:kotiko, :telegram_token), do: [Kotiko.Bot], else: []
  end
end
