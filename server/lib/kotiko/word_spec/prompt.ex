# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.WordSpec.Prompt do
  @moduledoc """
  The lookup and respell system prompts (slice 09 section 2), built from the sections of
  `spec/prompt.md`. The learner's text is never put into the system prompt.
  `extension/lib/wordspec.js` builds the same text for the same request
  (`spec/fixtures/prompt.json`).
  """
  alias Kotiko.{Lang, Spec, WordSpec}

  @sections ~r/^```prompt ([^\s`]+)\n(.*?)\n```$/ms
            |> Regex.scan(Spec.prompt_text(), capture: :all_but_first)
            |> Map.new(fn [name, text] -> {name, text} end)

  @pron Spec.pronunciation()

  @doc "The sections of spec/prompt.md, by name."
  def sections, do: @sections

  @doc """
  The system prompt of a lookup. `request` has `base_langs` (base tags, primary first),
  `mode` ("add" or "auto"), `recent` (language tags the learner added lately, newest
  first) and `hint_lang` (the page's language, or nil).
  """
  def system(request) do
    bases =
      request
      |> get(:base_langs)
      |> List.wrap()
      |> Enum.map(&Lang.base_tag/1)
      |> Enum.reject(&is_nil/1)

    recent =
      request |> get(:recent) |> List.wrap() |> Enum.filter(&match?({:ok, _}, Lang.canonical(&1)))

    hint =
      case Lang.canonical(get(request, :hint_lang)) do
        {:ok, tag} -> tag
        _ -> nil
      end

    b0 = List.first(bases) || ""

    vars =
      Map.merge(
        %{
          "base_list" => Enum.map_join(bases, ", ", &named/1),
          "base_tags" => Enum.join(bases, ", "),
          "max_words" => to_string(Spec.rule(:max_words)),
          "romanization_schemes" => romanization_schemes(),
          "recent_list" => Enum.map_join(recent, ", ", &named/1),
          "lang_name" => if(hint, do: Lang.endonym(hint), else: ""),
          "primary_base" => b0,
          "primary_base_name" => if(b0 == "", do: "", else: Lang.endonym(b0))
        },
        pronunciation_vars(bases)
      )

    examples =
      @sections["examples." <> b0] || @sections["examples." <> Lang.primary(b0)] ||
        @sections["examples._generic"]

    [
      @sections["system"],
      @sections["bases"],
      @sections["pronunciation"],
      get(request, :mode) == "add" && @sections["add_mode"],
      recent != [] && @sections["recent_hint"],
      hint && @sections["hint_lang"],
      examples,
      length(bases) > 1 && @sections["multi_base"]
    ]
    |> Enum.filter(&is_binary/1)
    |> Enum.map_join("\n\n", &render(&1, vars))
  end

  @doc "The system prompt of a respell request: `items` are `%{lang, native, sense, base_langs}`."
  def respell_system(items) do
    bases =
      items
      |> Enum.flat_map(&List.wrap(get(&1, :base_langs)))
      |> Enum.map(&Lang.base_tag/1)
      |> Enum.reject(&is_nil/1)
      |> Enum.uniq()

    vars = pronunciation_vars(bases)
    Enum.map_join([@sections["respell"], @sections["pronunciation"]], "\n\n", &render(&1, vars))
  end

  @doc false
  # A line whose placeholders all render empty is left out.
  def render(template, vars) do
    template
    |> String.split("\n")
    |> Enum.flat_map(fn line ->
      names = Regex.scan(~r/\{\{(\w+)\}\}/, line, capture: :all_but_first) |> List.flatten()
      values = Enum.map(names, &(vars[&1] || ""))

      if names != [] and Enum.all?(values, &(&1 == "")),
        do: [],
        else: [Regex.replace(~r/\{\{(\w+)\}\}/, line, fn _, n -> vars[n] || "" end)]
    end)
    |> Enum.join("\n")
  end

  defp named(tag), do: "#{tag} (#{Lang.endonym(tag)})"

  defp romanization_schemes do
    named =
      for {tag, t} <- Enum.sort(@pron["targets"]),
          not String.contains?(tag, "-"),
          t["romanization"] not in [nil, "unspecified"],
          do: "#{tag}: #{@pron["schemes"][t["romanization"]]}"

    Enum.join(named ++ ["any other language: its most standard transliteration"], "; ")
  end

  defp pronunciation_vars(bases) do
    {with_key, without} = Enum.split_with(bases, &WordSpec.lang_data(&1).respelling)

    %{
      "variants" => "Where varieties differ, pick one and keep to it.",
      "respelling_keys" =>
        Enum.map_join(with_key, "\n", &key_text(&1, WordSpec.lang_data(&1).respelling)),
      "bases_without_key" => Enum.join(without, ", ")
    }
  end

  defp key_text(base, key) do
    examples =
      Enum.map_join(key["examples"], ", ", fn e ->
        careful =
          if e["pronunciation_careful"], do: " (careful: #{e["pronunciation_careful"]})", else: ""

        "#{e["native"]} #{e["pronunciation"]}#{careful}"
      end)

    "#{base}: #{key["prompt_summary"]} Examples: #{examples}."
  end

  defp get(map, key), do: Map.get(map, key, Map.get(map, to_string(key)))
end
