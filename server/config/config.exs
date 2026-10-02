# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0

import Config

config :slovo, ecto_repos: [Slovo.Repo]

# Slovo.Config.load! sets the database path from SLOVO_DATA_DIR at boot, and `log` from
# SLOVO_LOG_SQL: every extension sync is a query, so SQL stays out of the logs.
config :slovo, Slovo.Repo,
  pool_size: 5,
  journal_mode: :wal,
  busy_timeout: 5_000,
  default_transaction_mode: :immediate,
  log: false

# Until Slovo.Config.load! applies LOG_LEVEL (default info) at boot.
config :logger, level: :info

if config_env() == :test, do: import_config("test.exs")
