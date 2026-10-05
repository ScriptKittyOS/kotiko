# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.DocsTest do
  # Slice 53 section 4.1: the reference documents in docs/reference stay current because
  # this test fails when a route or a setting is added, renamed or removed without them.
  use ExUnit.Case, async: true

  @root Path.expand("../../..", __DIR__)
  @http_api Path.join(@root, "docs/reference/http-api.md")
  @configuration Path.join(@root, "docs/reference/configuration.md")
  @router Path.join(@root, "server/lib/kotiko/router.ex")
  @config Path.join(@root, "server/lib/kotiko/config.ex")
  @runtime Path.join(@root, "server/config/runtime.exs")

  # `get "/words/:id" do`, `match "/health", via: :head do`, `forward "/api/v1", to: Mod`.
  @route ~r/^\s*(get|post|put|patch|delete|options|head)\s+"(\/[^"]*)"/m
  @head_match ~r/^\s*match\s+"(\/[^"]*)",\s*via:\s*:(\w+)/m
  @forward ~r/^\s*forward\s+"(\/[^"]*)",\s*to:\s*([\w.]+)/m

  # Every route the server answers, as "METHOD /path", read from the router sources (the
  # main router and every router it forwards to).
  defp routes(file, prefix \\ "") do
    source = File.read!(file)

    own =
      for([_, verb, path] <- Regex.scan(@route, source), do: {verb, path}) ++
        for([_, path, verb] <- Regex.scan(@head_match, source), do: {verb, path})

    forwarded =
      for [_, path, module] <- Regex.scan(@forward, source) do
        module |> module_file() |> routes(prefix <> path)
      end

    Enum.map(own, fn {verb, path} -> "#{String.upcase(verb)} #{prefix}#{path}" end) ++
      List.flatten(forwarded)
  end

  # Kotiko.RouterV1 -> server/lib/kotiko/router_v1.ex
  defp module_file("Kotiko." <> name),
    do: Path.join(@root, "server/lib/kotiko/#{Macro.underscore(name)}.ex")

  defp headings(file) do
    for [_, heading] <- Regex.scan(~r/^### (.+)$/m, File.read!(file)), do: String.trim(heading)
  end

  test "http-api.md has a `### METHOD /path` section for exactly the routes the server has" do
    routes = routes(@router) |> Enum.uniq() |> Enum.sort()
    documented = @http_api |> headings() |> Enum.filter(&(&1 =~ ~r/^[A-Z]+ \//)) |> Enum.sort()

    # Sanity check on the parser: these exist today.
    assert "GET /health" in routes
    assert "HEAD /health" in routes
    assert "PATCH /api/v1/words/:id" in routes

    assert routes -- documented == [],
           "Routes missing from docs/reference/http-api.md: #{inspect(routes -- documented)}"

    assert documented -- routes == [],
           "docs/reference/http-api.md documents routes the server doesn't have: " <>
             inspect(documented -- routes)
  end

  test "configuration.md describes every setting Kotiko.Config knows" do
    doc = File.read!(@configuration)

    for name <- Kotiko.Config.documented_vars() do
      assert doc =~ "### `#{name}`",
             "docs/reference/configuration.md has no `### `#{name}`` section"
    end
  end

  test "Kotiko.Config.documented_vars/0 lists every variable the parser reads" do
    source = File.read!(@config)

    read =
      ~r/(?:vars\["|setting\(vars, ")([A-Z][A-Z0-9_]+)"/
      |> Regex.scan(source)
      |> Enum.map(fn [_, name] -> name end)
      |> Enum.uniq()

    assert "PORT" in read
    assert read -- Kotiko.Config.documented_vars() == []
  end

  test "config/runtime.exs passes every documented setting to the server" do
    tokens = Regex.scan(~r/\b[A-Z][A-Z0-9_]*\b/, File.read!(@runtime)) |> List.flatten()
    {prefixes, names} = Enum.split_with(tokens, &String.ends_with?(&1, "_"))

    for name <- Kotiko.Config.documented_vars() do
      assert name in names or Enum.any?(prefixes, &String.starts_with?(name, &1)),
             "config/runtime.exs doesn't copy #{name}, so setting it would do nothing"
    end
  end
end
