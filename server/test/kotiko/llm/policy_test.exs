# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.LLM.PolicyTest do
  # Slice 10: the shared fixtures of spec/fixtures/llm-policy.json, which
  # test/unit/llm-policy.test.mjs runs against extension/lib/llm/policy.js.
  use ExUnit.Case, async: true
  alias Kotiko.LLM.Policy

  @moduletag :spec
  @fixture Path.expand("../../../../spec/fixtures/llm-policy.json", __DIR__)
           |> File.read!()
           |> Jason.decode!()

  # JSON keys and values to the Elixir side's atoms (kinds, actions, health).
  @atom_values ~w(kind action health)

  defp atomize(map) when is_map(map) do
    Map.new(map, fn {k, v} ->
      key = String.to_atom(k)
      {key, if(k in @atom_values and is_binary(v), do: String.to_atom(v), else: v)}
    end)
  end

  defp transport("timeout"), do: :timeout
  defp transport(other), do: String.to_atom(other)

  for c <- @fixture["classify"] do
    @case c
    test "classify: #{c["name"]}" do
      input = @case["input"]

      out =
        if input["transport"] do
          Policy.classify(%{transport: transport(input["transport"])})
        else
          Policy.classify(%{
            status: input["status"],
            headers: input["headers"],
            body: input["body"],
            now_ms: input["now_ms"]
          })
        end

      for {k, v} <- atomize(@case["expect"]) do
        assert Map.get(out, k) == v, "#{k}: #{inspect(Map.get(out, k))} != #{inspect(v)}"
      end
    end
  end

  for c <- @fixture["next"] do
    @case c
    test "next: #{c["name"]}" do
      state = atomize(Map.merge(@fixture["defaults"]["state"], @case["state"]))
      out = Policy.next(atomize(@case["outcome"]), state)

      for {k, v} <- atomize(@case["expect"]) do
        assert Map.get(out, k) == v, "#{k}: #{inspect(Map.get(out, k))} != #{inspect(v)}"
      end
    end
  end

  test "the defaults match spec/models.json" do
    assert Policy.default_state().min_attempt_ms == Kotiko.Spec.llm_policy(:min_attempt_ms)

    assert Policy.default_state().daily_reset_min_ms ==
             Kotiko.Spec.llm_policy(:daily_reset_min_ms)

    assert Policy.default_state().remaining_ms ==
             Kotiko.Spec.llm_policy(:budgets)["add"]["deadline_ms"]
  end
end
