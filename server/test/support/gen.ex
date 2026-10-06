# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Gen do
  @moduledoc """
  StreamData generators for the property tests: JSON values as a client could send them
  (after Plug's JSON parser), and words that are almost right, so a property reaches the
  checks past the first one instead of failing on a missing field every time.
  """
  import StreamData
  import ExUnitProperties, only: [gen: 2]

  @doc "Text with the awkward cases mixed in: control and invisible characters, other scripts."
  def text(opts \\ []) do
    max = Keyword.get(opts, :max_length, 30)

    one_of([
      string(:printable, max_length: max),
      string(:utf8, max_length: max),
      member_of(["", " ", "\t\n", "​", "да", "犬", "perro", "ı", "ς", "á", "\u0000x"])
    ])
  end

  @doc "A scalar JSON value."
  def scalar do
    one_of([
      constant(nil),
      boolean(),
      integer(),
      float(),
      text()
    ])
  end

  @doc "Any JSON value: scalars, lists and objects with string keys, a few levels deep."
  def json do
    tree(scalar(), fn inner ->
      one_of([
        list_of(inner, max_length: 4),
        map_of(text(max_length: 12), inner, max_length: 4)
      ])
    end)
  end

  @doc "An object with any of `keys`, each with a value from `value`."
  def object(keys, value), do: optional_map(Map.new(keys, &{&1, value}))

  @doc "A language tag: a real one, a malformed one or something that isn't a string."
  def lang do
    one_of([
      member_of(~w(ru ja es en de ar zh-Hant pt-BR sr-Latn tr el he hi ase EN es_419 x qqq-zz)),
      text(max_length: 12),
      scalar()
    ])
  end

  # Words that pass the checks with a matching language, so most generated words get past
  # the first check: [lang, native, gloss].
  @plausible [
    ["ru", "да", "yes"],
    ["ja", "犬", "dog"],
    ["es", "casa", "house"],
    ["de", "Haus", "house"],
    ["ar", "شكرا", "thanks"],
    ["sv", "Åland", "Åland"],
    ["zh-Hant", "謝謝", "thank you"],
    ["el", "ναι", "yes"]
  ]

  @doc """
  A word object from a client: mostly a plausible word with a few fields replaced by junk
  or missing, sometimes junk throughout.
  """
  def word do
    gen all(
          [lang, native, gloss] <- member_of(@plausible),
          base <- frequency([{4, member_of(~w(en es fr pt-BR))}, {1, lang()}]),
          lang <- frequency([{4, constant(lang)}, {1, lang()}]),
          native <- frequency([{4, constant(native)}, {1, text()}, {1, scalar()}]),
          gloss <- frequency([{4, constant(gloss)}, {1, text()}, {1, scalar()}]),
          forms <-
            frequency([
              {3, list_of(member_of(["perro", "dogs", "Yes", gloss, ""]), max_length: 5)},
              {1, list_of(one_of([text(), json()]), max_length: 5)},
              {1, json()}
            ]),
          extra <-
            object(
              ~w(sense romanization native_vocalized pronunciation pronunciation_careful
                 pronunciation_source note status origin source_text id),
              frequency([{2, text()}, {1, json()}])
            ),
          drop <-
            frequency([
              {4, constant([])},
              {1, list_of(member_of(~w(lang base_lang native gloss forms)), max_length: 2)}
            ])
        ) do
      %{
        "lang" => lang,
        "base_lang" => base,
        "native" => native,
        "gloss" => gloss,
        "forms" => forms
      }
      |> Map.merge(extra)
      |> Map.drop(drop)
    end
  end
end
