# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.WordSpecTest do
  # Slice 09: the shared fixtures, run here and by test/unit/wordspec.test.mjs. Every
  # normalize fixture must give exactly the output in normalize-results.json (written from
  # the JavaScript pipeline), so the two runtimes save the same word for the same answer.
  use ExUnit.Case, async: true
  alias Kotiko.{Pronunciation, Spec, WordSpec}
  alias Kotiko.WordSpec.Prompt

  @moduletag :spec

  @fixtures Path.expand("../../../spec/fixtures", __DIR__)
  @normalize_dir Path.join(@fixtures, "normalize")
  @results @fixtures |> Path.join("normalize-results.json") |> File.read!() |> Jason.decode!()

  @normalize @normalize_dir
             |> File.ls!()
             |> Enum.filter(&String.ends_with?(&1, ".json"))
             |> Enum.sort()

  defp read(path), do: path |> File.read!() |> Jason.decode!()

  # JSON in, JSON out: the comparison is on the decoded shape both runtimes write.
  defp json(term), do: term |> Jason.encode!() |> Jason.decode!()

  defp run(%{"input" => %{"items" => items}, "raw" => raw}) do
    case WordSpec.process_respell(items, raw) do
      {:ok, result} -> json(result)
      {:error, :unparseable} -> %{"error" => "unparseable"}
    end
  end

  defp run(%{"input" => input, "raw" => raw}) do
    case WordSpec.process(input, raw) do
      {:ok, result} -> json(result)
      {:error, :unparseable} -> %{"error" => "unparseable"}
    end
  end

  # `expect` lists only the keys a reader checks; forms may be given as their texts.
  defp partial(actual, expected, where) when is_map(expected) do
    for {k, v} <- expected do
      if k == "forms" and is_list(v) and Enum.all?(v, &is_binary/1),
        do: assert(Enum.map(actual[k], & &1["text"]) == v, "#{where}.forms"),
        else: partial(actual[k], v, "#{where}.#{k}")
    end
  end

  defp partial(actual, expected, where) when is_list(expected) do
    assert is_list(actual) and length(actual) == length(expected),
           "#{where}: #{inspect(actual)} has #{length(List.wrap(actual))} items, not #{length(expected)}"

    expected
    |> Enum.zip(actual)
    |> Enum.with_index()
    |> Enum.each(fn {{e, a}, i} -> partial(a, e, "#{where}[#{i}]") end)
  end

  defp partial(actual, expected, where), do: assert(actual == expected, where)

  test "at least 80 normalize fixtures" do
    assert length(@normalize) >= 80
    assert Map.keys(@results["results"]) |> Enum.sort() == @normalize
  end

  describe "spec/fixtures/normalize" do
    for file <- @normalize do
      @file_name file
      test file do
        f = read(Path.join(@normalize_dir, @file_name))
        out = run(f)
        partial(out, f["expect"], f["name"])
        assert out == @results["results"][@file_name]
      end
    end
  end

  describe "spec/fixtures/pronunciation" do
    dir = Path.join(@fixtures, "pronunciation")

    for file <- dir |> File.ls!() |> Enum.sort() do
      @path Path.join(dir, file)
      test file do
        f = read(@path)
        word = Map.new(f["word"], fn {k, v} -> {String.to_existing_atom(k), v} end)
        {checked, dropped} = Pronunciation.check(word)
        partial(json(checked), f["expect"]["word"], f["name"])
        assert json(dropped) == f["expect"]["dropped_fields"], f["name"]
      end
    end
  end

  test "input checks (input.json)" do
    for c <- read(Path.join(@fixtures, "input.json"))["cases"] do
      expected =
        if c["error"], do: {:error, String.to_existing_atom(c["error"])}, else: {:ok, c["text"]}

      assert WordSpec.prepare_input(c["input"]) == expected, inspect(c["input"])
    end
  end

  test "base-language data resolution (lang-data.json)" do
    for c <- read(Path.join(@fixtures, "lang-data.json"))["cases"] do
      folders = WordSpec.lang_data(c["base"]).folders
      assert json(folders) == c["folders"], c["base"]
    end
  end

  describe "the related-form check (stem/*.json)" do
    for file <- @fixtures |> Path.join("stem") |> File.ls!() |> Enum.sort() do
      @path Path.join([@fixtures, "stem", file])
      test file do
        f = read(@path)
        data = WordSpec.lang_data(f["base"])

        for [form, gloss, related] <- f["pairs"] do
          assert WordSpec.related?(form, gloss, f["base"], data) == related,
                 "#{form} / #{gloss} should be #{if related, do: "related", else: "unrelated"}"
        end
      end
    end
  end

  test "the prompt is the same text in both runtimes (prompt.json)" do
    for c <- read(Path.join(@fixtures, "prompt.json"))["cases"] do
      system =
        if c["respell"],
          do: Prompt.respell_system(c["respell"]),
          else: Prompt.system(c["request"])

      assert :crypto.hash(:sha256, system) |> Base.encode16(case: :lower) == c["sha256"],
             c["name"]

      for s <- c["contains"] || [], do: assert(system =~ s, "#{c["name"]}: #{s}")
      for s <- c["excludes"] || [], do: refute(system =~ s, "#{c["name"]}: #{s}")
    end
  end

  test "every rule the validator uses is in rules.json" do
    for key <- ~w(max_input_chars max_words max_base_langs max_native_chars max_gloss_chars
                  max_romanization_chars max_pronunciation_chars max_note_chars max_form_chars
                  max_forms max_reply_chars max_respell_items max_vocabulary) do
      assert is_integer(Spec.rule(key)), key
    end
  end

  test "an input over 200 characters is refused before any model call" do
    assert WordSpec.prepare_input(String.duplicate("a", 201)) == {:error, :input_too_long}
    assert {:ok, _} = WordSpec.prepare_input(String.duplicate("a", 200))
  end

  test "no tag in lang-tags.json crashes the pipeline (F17)" do
    tags =
      @fixtures
      |> Path.join("lang-tags.json")
      |> read()
      |> Map.fetch!("cases")
      |> Enum.map(& &1["input"])

    for tag <- tags do
      raw =
        Jason.encode!(%{
          intent: "add",
          words: [%{lang: tag, native: "да", gloss: "yes", forms: ["yes"]}]
        })

      assert {:ok, %{}} = WordSpec.process(%{text: "da", mode: "add", base_langs: ["en"]}, raw)
    end
  end
end
