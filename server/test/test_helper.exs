# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0

# Any HTTP request a test didn't stub fails loudly instead of reaching the internet.
# LLM and Telegram calls go to Req.Test stubs (config/test.exs); this catches the rest.
Req.default_options(
  plug: fn conn ->
    raise "Unstubbed HTTP request in a test: #{conn.method} #{conn.host}#{conn.request_path}. " <>
            "Tests never reach the network; stub it with Req.Test " <>
            "(see test/support/llm_stub.ex and telegram_stub.ex)."
  end
)

# @tag :pending marks known bugs whose fix belongs to a later slice. Run them with
# `mix test --include pending`.
ExUnit.start(exclude: [:pending])
Ecto.Adapters.SQL.Sandbox.mode(Slovo.Repo, :manual)

data_dir = Application.fetch_env!(:slovo, :data_dir)
ExUnit.after_suite(fn _ -> File.rm_rf(data_dir) end)
