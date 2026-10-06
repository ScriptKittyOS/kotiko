# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

# Credo's default checks in strict mode (low-priority issues count too, so a plain
# `mix credo` reports the same as CI's `mix credo --strict`), with two limits relaxed for
# code that reads best as one flat list: the bot's command dispatch and the transcriber's
# response handling.
%{
  configs: [
    %{
      name: "default",
      files: %{included: ["lib/", "test/", "config/", "mix.exs"], excluded: []},
      strict: true,
      checks: %{
        extra: [
          {Credo.Check.Refactor.CyclomaticComplexity, max_complexity: 17},
          {Credo.Check.Refactor.Nesting, max_nesting: 3}
        ]
      }
    }
  ]
}
