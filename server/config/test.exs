# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

import Config

# runtime.exs reads nothing from the environment in test; everything is set here.
# One database file per test run, so parallel runs don't share it (test_helper deletes it).
data_dir = Path.join(System.tmp_dir!(), "kotiko-test-#{System.pid()}")

config :kotiko, Kotiko.Repo,
  database: Path.join(data_dir, "kotiko.db"),
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: 5

config :kotiko,
  data_dir: data_dir,
  # A chosen folder: Kotiko.DataDir never looks in the real home for an old database.
  data_dir_source: :env,
  # Router tests call the plug directly; the one socket test starts Bandit on port 0.
  start_http: false,
  # The janitor and the pronunciation refresh: tests call them directly.
  background_jobs: false,
  port: 0,
  bind: "127.0.0.1",
  bind_ip: {127, 0, 0, 1},
  api_token: "test-token-0123456789abcdefghijklmnopqrstuv",
  allowed_hosts: [],
  telegram_token: nil,
  allowed_ids: [],
  llm_url: "http://llm.test",
  llm_api_key: "test-llm-key",
  llm_models: ["m1", "m2", "m3"],
  llm_model_source: :env,
  log_lookups: false,
  llm_req_options: [plug: {Req.Test, Kotiko.LLM}],
  telegram_req_options: [plug: {Req.Test, Kotiko.Telegram}],
  transcribe_url: nil,
  transcribe_model: "whisper-1",
  transcribe_api_key: nil

config :logger, level: :warning
