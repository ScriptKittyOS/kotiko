# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.LangTest do
  # Slice 08: the same fixtures as test/unit/lang.test.mjs, so both runtimes give the same
  # tag for the same input.
  use ExUnit.Case, async: true
  alias Kotiko.Lang

  @moduletag :spec

  @root Path.expand("../../../spec/fixtures", __DIR__)
  @tags @root |> Path.join("lang-tags.json") |> File.read!() |> Jason.decode!()
  @bases @root |> Path.join("base-tags.json") |> File.read!() |> Jason.decode!()

  test "lang-tags.json has at least 80 cases and base-tags.json at least 30" do
    assert length(@tags["cases"]) >= 80
    assert length(@bases["cases"]) >= 30
  end

  describe "canonical/1 (lang-tags.json)" do
    for c <- @tags["cases"] do
      @case c
      test "#{inspect(c["input"])}: #{c["note"]}" do
        c = @case

        case c do
          %{"tag" => tag, "known" => known} ->
            assert Lang.canonical(c["input"]) == {:ok, tag}
            assert Lang.known?(tag) == known

          %{"error" => code} ->
            assert Lang.canonical(c["input"]) == {:error, String.to_existing_atom(code)}
        end
      end
    end
  end

  describe "check_script/2 (lang-tags.json)" do
    for c <- @tags["script_checks"] do
      @case c
      test "#{c["tag"]} #{c["native"]}: #{c["note"]}" do
        c = @case

        expected =
          if c["error"],
            do: {:error, String.to_existing_atom(c["error"])},
            else: {:ok, c["result"]}

        assert Lang.check_script(c["tag"], c["native"]) == expected
      end
    end
  end

  test "names and endonyms come from the tag (lang-tags.json)" do
    for %{"tag" => tag, "locale" => locale, "name" => name} <- @tags["names"] do
      assert Lang.name(tag, locale) == name, "#{tag} in #{locale}"
    end

    for %{"tag" => tag, "endonym" => endonym} <- @tags["endonyms"] do
      assert Lang.endonym(tag) == endonym, tag
    end
  end

  describe "base_tag/1 and same_base?/2 (base-tags.json)" do
    for c <- @bases["cases"] do
      @case c
      test "base of #{inspect(c["input"])} is #{inspect(c["base"])}" do
        assert Lang.base_tag(@case["input"]) == @case["base"]
      end
    end

    test "same_base?" do
      for %{"a" => a, "b" => b, "same" => same} <- @bases["same_base"] do
        assert Lang.same_base?(a, b) == same, "#{a} / #{b}"
        assert Lang.same_base?(b, a) == same, "#{b} / #{a}"
      end
    end
  end

  test "the acceptance cases of slice 08" do
    assert Lang.canonical("zh-TW") == {:ok, "zh-Hant"}
    assert Lang.canonical("cmn") == {:ok, "zh"}
    assert Lang.canonical("iw") == {:ok, "he"}
    assert Lang.canonical("i-klingon") == {:ok, "tlh"}
    assert Lang.canonical("pt-BR") == {:ok, "pt-BR"}
    assert Lang.canonical("de-AT") == {:ok, "de"}
    assert Lang.canonical("ar-EG") == {:ok, "arz"}
    assert Lang.canonical("en-GB") == {:ok, "en-GB"}
    assert Lang.check_script("sr", "hvala") == {:ok, "sr-Latn"}
    assert Lang.check_script("ru", "spasibo") == {:error, :script_mismatch}
    assert Lang.check_script("ja", "ありがとう") == {:ok, "ja"}
    assert Lang.name("yue", "en") == "Cantonese"
    assert Lang.name("yue", "es") == "cantonés"
    assert Lang.endonym("yue") == "粵語"
  end

  test "find/1 resolves names in every shipped locale, endonyms and codes" do
    for term <- ["cantonese", "Cantonés", "粵語", "yue", " YUE "] do
      assert "yue" in Lang.find(term), term
    end

    assert Lang.find("japonés") == ["ja"]
    assert Lang.find("klingon") == ["tlh"]
    assert Lang.find("no such language") == []
  end
end
