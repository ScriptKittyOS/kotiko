defmodule Slovo.Application do
  use Application
  require Logger

  @impl true
  def start(_type, _args) do
    Application.get_env(:slovo, :api_token) ||
      raise "API_TOKEN is not set. Copy .env.example to .env and fill it in."

    Application.get_env(:slovo, :llm_api_key) ||
      Logger.warning(
        "LLM_API_KEY is not set; adding words will fail unless LLM_URL needs no key."
      )

    port = Application.fetch_env!(:slovo, :port)
    bind = Application.fetch_env!(:slovo, :bind)
    {:ok, ip} = :inet.parse_address(String.to_charlist(bind))

    children =
      [
        Slovo.Repo,
        {Ecto.Migrator, repos: [Slovo.Repo]},
        {Task.Supervisor, name: Slovo.TaskSup},
        {Bandit, plug: Slovo.Router, ip: ip, port: port}
      ] ++ bot_child()

    Logger.info("Slovo API on http://#{bind}:#{port}")
    Supervisor.start_link(children, strategy: :one_for_one, name: Slovo.Supervisor)
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
