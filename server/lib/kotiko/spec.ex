# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Spec do
  @moduledoc """
  The shared word spec (slice 09): the files in the repository's `spec/` folder, read at
  compile time and embedded in this module, so a release or Docker image needs no `spec/`
  at runtime. The extension reads the same files from its copy in `extension/spec/`.

  Changing a file under `spec/` recompiles this module (`@external_resource`).
  """

  @root Path.expand("../../../spec", __DIR__)

  @json_files ~w(languages lang-aliases rules pronunciation models wiktionary)
  for name <- @json_files, do: @external_resource(Path.join(@root, name <> ".json"))
  @external_resource Path.join(@root, "prompt.md")
  @external_resource Path.join(@root, "VERSION")

  @lang_root Path.join(@root, "lang")
  @lang_kinds %{"stem" => :json, "variants" => :json, "respelling" => :json}

  read_json = fn path -> path |> File.read!() |> Jason.decode!() end

  # spec/lang/<folder>/: stopwords.txt, stem.json, variants.json, respelling.json. Folders
  # and files are optional; Kotiko.WordSpec.lang_data/1 resolves the fallbacks.
  lang_folders =
    @lang_root
    |> File.ls!()
    |> Enum.filter(&File.dir?(Path.join(@lang_root, &1)))
    |> Enum.reject(&(&1 == "schema"))
    |> Enum.sort()

  lang_data =
    Map.new(lang_folders, fn folder ->
      dir = Path.join(@lang_root, folder)

      files =
        for {kind, :json} <- @lang_kinds,
            path = Path.join(dir, kind <> ".json"),
            File.exists?(path),
            into: %{},
            do: {kind, read_json.(path)}

      stop = Path.join(dir, "stopwords.txt")

      files =
        if File.exists?(stop) do
          words =
            stop
            |> File.read!()
            |> String.split("\n")
            |> Enum.map(&String.trim/1)
            |> Enum.reject(&(&1 == "" or String.starts_with?(&1, "#")))

          Map.put(files, "stopwords", words)
        else
          files
        end

      {folder, files}
    end)

  for folder <- lang_folders, file <- File.ls!(Path.join(@lang_root, folder)) do
    @external_resource Path.join([@lang_root, folder, file])
  end

  @external_resource @lang_root

  @languages read_json.(Path.join(@root, "languages.json"))
  @aliases read_json.(Path.join(@root, "lang-aliases.json"))
  @rules read_json.(Path.join(@root, "rules.json"))
  @pronunciation read_json.(Path.join(@root, "pronunciation.json"))
  @models read_json.(Path.join(@root, "models.json"))
  @wiktionary read_json.(Path.join(@root, "wiktionary.json"))
  @prompt_text File.read!(Path.join(@root, "prompt.md"))
  @version @root |> Path.join("VERSION") |> File.read!() |> String.trim()
  @lang_data lang_data

  @doc "spec/VERSION."
  def version, do: @version

  @doc "spec/languages.json: `languages`, `regionNames`, `scriptNames`, `unicode_scripts`."
  def languages, do: @languages

  @doc "spec/lang-aliases.json."
  def aliases, do: @aliases

  @doc "spec/rules.json: every number the validator uses."
  def rules, do: @rules

  @doc "One number from rules.json, by name."
  def rule(name), do: Map.fetch!(@rules, to_string(name))

  @doc "spec/pronunciation.json: per target language, the romanization scheme and stress kind."
  def pronunciation, do: Map.delete(@pronunciation, "_comment")

  @doc """
  spec/models.json (slice 10): `prefer`, `prefer_respell`, `deny`, `fallback`, the
  `evidence` behind the order, and `policy` (budgets, health, catalog, quota, cache).
  """
  def models, do: Map.delete(@models, "_comment")

  @doc "One section of models.json's `policy`, by name."
  def llm_policy(name), do: Map.fetch!(@models["policy"], to_string(name))

  @doc "spec/wiktionary.json: where pronunciations come from (slice 49 section 4a)."
  def wiktionary, do: Map.delete(@wiktionary, "_comment")

  @doc "spec/prompt.md, unparsed."
  def prompt_text, do: @prompt_text

  @doc "The folders under spec/lang/, each a map of file kind to its content."
  def lang_folders, do: @lang_data
end
