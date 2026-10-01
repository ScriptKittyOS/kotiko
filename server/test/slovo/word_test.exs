# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Slovo.WordTest do
  use ExUnit.Case, async: true
  use ExUnitProperties
  alias Slovo.Word

  @lang_format ~r/^[a-z]{2,3}(-[A-Z][a-z]{3})?$/

  test "normalize_lang drops regions and the default Mandarin script" do
    assert Word.normalize_lang("ZH_cn") == "zh"
    assert Word.normalize_lang("zh-hant-TW") == "zh-Hant"
    assert Word.normalize_lang("zh-Hans") == "zh"
    assert Word.normalize_lang("sr-latn") == "sr-Latn"
    assert Word.normalize_lang(nil) == nil
  end

  property "well-formed tags in any case or separator normalize to a valid tag" do
    check all(
            primary <- string(?a..?z, min_length: 2, max_length: 3),
            script <- one_of([constant(nil), string(?a..?z, length: 4)]),
            region <- one_of([constant(nil), string(?A..?Z, length: 2)]),
            sep <- member_of(["-", "_"]),
            upper? <- boolean()
          ) do
      tag = Enum.reject([primary, script, region], &is_nil/1) |> Enum.join(sep)
      tag = if upper?, do: String.upcase(tag), else: tag

      assert Word.normalize_lang(tag) =~ @lang_format
    end
  end

  test "forms joins english_forms and english without duplicates" do
    assert Word.forms(%Word{english: "house", english_forms: "house\nHouses\n\nhouses"}) ==
             ["house", "Houses"]
  end
end
