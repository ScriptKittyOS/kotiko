# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0

import Config

# Tests set everything in config/test.exs and never read the environment.
if config_env() != :test do
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

  # "*" turns the Host check off (unusual proxy setups); see Slovo.Plug.HostCheck.
  allowed_hosts =
    case env.("ALLOWED_HOSTS", "") do
      "*" ->
        :any

      hosts ->
        hosts
        |> String.split(",", trim: true)
        |> Enum.map(&(&1 |> String.trim() |> String.downcase() |> String.trim_trailing(".")))
        |> Enum.reject(&(&1 == ""))
    end

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
    public_url: env.("PUBLIC_URL", nil),
    allowed_hosts: allowed_hosts,
    data_dir: data_dir,
    # nil means "use or create <data_dir>/api-token"; Slovo.Token checks the length.
    # A whitespace-only value arrives here as "" and is refused as too short.
    api_token: env.("API_TOKEN", nil),
    telegram_token: env.("TELEGRAM_BOT_TOKEN", nil),
    allowed_ids: allowed_ids,
    llm_url: env.("LLM_URL", "https://openrouter.ai/api/v1") |> String.trim_trailing("/"),
    llm_api_key: env.("LLM_API_KEY", nil),
    # Comma-separated, tried in order: free models are often busy, so keep several.
    llm_models:
      env.(
        "LLM_MODEL",
        "apodex/apodex-1.1-mini:free,qwen/qwen3.8-27b:free,google/gemma-4-31b-it:free," <>
          "dots-studio/dots-3-note-preview:free,nvidia/nemotron-3-super-120b-a12b:free"
      )
      |> String.split(",", trim: true)
      |> Enum.map(&String.trim/1),
    transcribe_url: env.("TRANSCRIBE_URL", nil),
    transcribe_model: env.("TRANSCRIBE_MODEL", "whisper-1"),
    transcribe_api_key: env.("TRANSCRIBE_API_KEY", nil)
end
