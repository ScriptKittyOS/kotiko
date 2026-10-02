# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
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

# The migration tests run the migrations again on their own databases; Ecto compiles the
# migration files each time, which would warn about redefining their modules.
Code.put_compiler_option(:ignore_module_conflict, true)
Ecto.Adapters.SQL.Sandbox.mode(Kotiko.Repo, :manual)

data_dir = Application.fetch_env!(:kotiko, :data_dir)
ExUnit.after_suite(fn _ -> File.rm_rf(data_dir) end)
