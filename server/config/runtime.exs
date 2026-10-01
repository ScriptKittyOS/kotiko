import Config

# Treat unset and empty-string env vars the same (sourcing .env exports blanks).
env = fn name, default ->
  case System.get_env(name) do
    nil -> default
    "" -> default
    v -> String.trim(v)
  end
end

data_dir = env.("SLOVO_DATA_DIR", Path.expand("~/.local/share/slovo"))
File.mkdir_p!(data_dir)

config :slovo, Slovo.Repo,
  database: Path.join(data_dir, "slovo.db"),
  pool_size: 5

allowed_ids =
  env.("ALLOWED_TELEGRAM_IDS", "")
  |> String.split(",")
  |> Enum.map(&String.trim/1)
  |> Enum.reject(&(&1 == ""))
  |> Enum.map(&String.to_integer/1)

config :slovo,
  port: String.to_integer(env.("PORT", "4747")),
  bind: env.("BIND", "127.0.0.1"),
  api_token: env.("API_TOKEN", nil),
  telegram_token: env.("TELEGRAM_BOT_TOKEN", nil),
  allowed_ids: allowed_ids,
  llm_url: env.("LLM_URL", "https://openrouter.ai/api/v1") |> String.trim_trailing("/"),
  llm_api_key: env.("LLM_API_KEY", nil),
  # Comma-separated; later ones are fallbacks (OpenRouter only).
  llm_models:
    env.("LLM_MODEL", "google/gemma-4-31b-it:free,qwen/qwen3.8-27b:free")
    |> String.split(",", trim: true)
    |> Enum.map(&String.trim/1),
  transcribe_url: env.("TRANSCRIBE_URL", nil),
  transcribe_model: env.("TRANSCRIBE_MODEL", "whisper-1"),
  transcribe_api_key: env.("TRANSCRIBE_API_KEY", nil)
