# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0

import Config

config :slovo, ecto_repos: [Slovo.Repo]

# Every extension sync is a query; keep SQL out of the logs.
config :logger, level: :info

if config_env() == :test, do: import_config("test.exs")
