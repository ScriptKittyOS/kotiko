# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Slovo.Application do
  @moduledoc "Starts the database, the HTTP API and, when configured, the Telegram bot."
  use Application
  require Logger
  alias Slovo.{Exposure, Token}

  @impl true
  def start(_type, _args) do
    load_token()

    Application.get_env(:slovo, :llm_api_key) ||
      Logger.warning(
        "LLM_API_KEY is not set; adding words will fail unless LLM_URL needs no key."
      )

    Slovo.Plug.HostCheck.init_table()

    children =
      [
        Slovo.Repo,
        {Ecto.Migrator, repos: [Slovo.Repo]},
        {Task.Supervisor, name: Slovo.TaskSup}
      ] ++ http_children() ++ bot_child()

    Supervisor.start_link(children, strategy: :one_for_one, name: Slovo.Supervisor)
  end

  # API_TOKEN, else the saved token file, else a new one. Stops boot if it's too short.
  defp load_token do
    data_dir = Application.fetch_env!(:slovo, :data_dir)
    File.mkdir_p!(data_dir)

    case Token.resolve(Application.get_env(:slovo, :api_token), data_dir) do
      {:ok, token, source} ->
        Application.put_env(:slovo, :api_token, token)
        announce_token(source, token)

      {:error, message} ->
        raise message
    end
  end

  defp announce_token(:env, _token), do: Logger.info("API token: from .env")
  defp announce_token({:file, path}, _token), do: Logger.info("API token: saved in #{path}")

  defp announce_token({:generated, path}, token) do
    Logger.info("API token: saved in #{path}")

    # Only to an interactive terminal, never to journald or a log file.
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

  defp http_children do
    if Application.get_env(:slovo, :start_http, true) do
      port = Application.fetch_env!(:slovo, :port)
      bind = Application.fetch_env!(:slovo, :bind)
      {:ok, ip} = :inet.parse_address(String.to_charlist(bind))

      Logger.info("Slovo API on http://#{bind}:#{port}")
      url = Exposure.server_url(Application.get_env(:slovo, :public_url), ip, port)
      {level, class, message} = Exposure.classify(ip, url)
      Logger.log(level, message)

      if Application.get_env(:slovo, :allowed_hosts) == :any do
        Logger.warning(
          "ALLOWED_HOSTS=* turns off the Host check, so web pages can reach this server " <>
            "through DNS rebinding. Use it only behind a proxy that checks Host itself."
        )
      end

      [{Bandit, plug: Slovo.Router, ip: ip, port: port}] ++ repeat_public_warning(class, message)
    else
      []
    end
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

  defp bot_child do
    if Application.get_env(:slovo, :telegram_token) do
      [Slovo.Bot]
    else
      Logger.warning("TELEGRAM_BOT_TOKEN not set; running the API without the bot.")
      []
    end
  end
end
