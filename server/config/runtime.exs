# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

import Config

# Only copies the raw settings; Kotiko.Config.load! parses and checks them at boot, so a
# typo in .env gets a readable message instead of a crash here. Tests set everything in
# config/test.exs and never read the environment.
if config_env() != :test do
  names =
    ~w(PORT BIND API_TOKEN ALLOWED_HOSTS PUBLIC_URL ALLOWED_TELEGRAM_IDS TELEGRAM_BOT_TOKEN
       LOG_LEVEL LOG_LOOKUPS)

  # SLOVO_ is the old prefix: its variables still work, with a warning. legacy-name-ok
  prefixes = ~w(KOTIKO_ SLOVO_ LLM_ TRANSCRIBE_)

  env =
    System.get_env()
    |> Enum.filter(fn {name, _} -> name in names or String.starts_with?(name, prefixes) end)
    |> Enum.map(fn {name, value} -> {name, String.trim(value)} end)
    # Sourcing .env exports empty values too: treat them as unset.
    |> Enum.reject(fn {_name, value} -> value == "" end)
    |> Map.new()

  config :kotiko, env: env
end
