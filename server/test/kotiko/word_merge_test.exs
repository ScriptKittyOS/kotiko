# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.WordMergeTest do
  use ExUnit.Case, async: true
  alias Kotiko.WordMerge

  # Shared with JavaScript: test/unit/word-merge.test.mjs reads the same file (slice 11's
  # local store merges with the same rules).
  @fixture Path.expand("../../../spec/fixtures/merge.json", __DIR__)

  defp atomize(map), do: Map.new(map, fn {k, v} -> {String.to_atom(k), v} end)

  for %{"name" => name} = c <- @fixture |> File.read!() |> Jason.decode!() |> Map.fetch!("cases") do
    @case c
    test "merge: #{name}" do
      opts = [explicit: get_in(@case, ["opts", "explicit"]) == true]
      changes = WordMerge.changes(atomize(@case["existing"]), atomize(@case["incoming"]), opts)
      assert changes |> Jason.encode!() |> Jason.decode!() == @case["changes"]
    end
  end
end
