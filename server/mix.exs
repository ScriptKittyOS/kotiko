# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.MixProject do
  use Mix.Project

  def project do
    [
      app: :kotiko,
      # x-release-please-start-version
      version: "0.2.0",
      # x-release-please-end
      elixir: "~> 1.15",
      elixirc_paths: elixirc_paths(Mix.env()),
      # The VM exits when the app stops, so systemd (or Docker) restarts it.
      start_permanent: true,
      deps: deps(),
      aliases: aliases()
    ]
  end

  def application do
    [extra_applications: [:logger, :crypto], mod: {Kotiko.Application, []}]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  # mix_audit's own deps (yaml_elixir) are only on the code path after compile.
  defp aliases, do: ["deps.audit": ["compile", "deps.audit"]]

  defp deps do
    [
      {:bandit, "~> 1.5"},
      {:plug, "~> 1.16"},
      # Plug.Crypto.non_executable_binary_to_term/2 for the lookup cache (comes with plug).
      {:plug_crypto, "~> 2.0"},
      {:jason, "~> 1.4"},
      {:req, "~> 0.5"},
      {:telemetry, "~> 1.0"},
      {:ecto_sql, "~> 3.12"},
      {:ecto_sqlite3, "~> 0.17"},
      {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
      {:mix_audit, "~> 2.1", only: [:dev, :test], runtime: false},
      # Slice 30 §11: the CycloneDX SBOM attached to each release (mix sbom.cyclonedx).
      {:sbom, "~> 0.11", only: :dev, runtime: false},
      {:stream_data, "~> 1.1", only: :test}
    ]
  end
end
