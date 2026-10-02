# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

import Config

config :kotiko, ecto_repos: [Kotiko.Repo]

# Kotiko.Config.load! sets the database path from KOTIKO_DATA_DIR at boot, and `log` from
# KOTIKO_LOG_SQL: every extension sync is a query, so SQL stays out of the logs.
config :kotiko, Kotiko.Repo,
  pool_size: 5,
  journal_mode: :wal,
  busy_timeout: 5_000,
  default_transaction_mode: :immediate,
  log: false

# Until Kotiko.Config.load! applies LOG_LEVEL (default info) at boot.
config :logger, level: :info

if config_env() == :test, do: import_config("test.exs")
