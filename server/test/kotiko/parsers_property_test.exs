# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.ParsersPropertyTest do
  # Dynamic analysis (OpenSSF dynamic_analysis): the small parsers every request goes
  # through, with generated input. Language tags, text cleaning, word ids and the log
  # filter that keeps keys out of the logs.
  use ExUnit.Case, async: true
  use ExUnitProperties
  alias Kotiko.{Gen, Lang, Text, UUID7}
  alias Kotiko.Log.Redact

  property "Lang: any input canonicalises to a stable tag or an error code" do
    check all(input <- one_of([Gen.lang(), Gen.text(max_length: 20), Gen.json()])) do
      case Lang.canonical(input) do
        {:ok, tag} ->
          assert Lang.canonical(tag) == {:ok, tag}
          assert is_binary(Lang.name(tag, "en")) and is_binary(Lang.endonym(tag))

        {:error, code} ->
          assert code in [:invalid_lang, :sign_language_unsupported]
      end

      case Lang.base_tag(input) do
        nil -> :ok
        base -> assert Lang.base_tag(base) == base and Lang.same_base?(base, base)
      end
    end
  end

  property "Text.clean: idempotent, trimmed, single-spaced, nil for blank" do
    check all(input <- one_of([Gen.text(max_length: 40), Gen.scalar()])) do
      case Text.clean(input) do
        # Only non-text, invalid UTF-8, or nothing but whitespace, control and invisible
        # characters.
        nil ->
          if is_binary(input) and String.valid?(input) do
            assert String.replace(input, ~r/[\p{Cc}\s\x{200B}\x{FEFF}\x{00AD}]/u, "") == ""
          end

        s ->
          assert Text.clean(s) == s
          assert s == String.trim(s) and s != ""
          refute s =~ ~r/\s{2}|[\x{200B}\x{FEFF}\x{00AD}]/u
          assert Text.length(s) == length(String.to_charlist(s))
      end
    end
  end

  property "UUID7: valid, ordered by time, and the time reads back" do
    check all(
            a <- integer(0..(2 ** 48 - 2)),
            gap <- integer(1..1_000_000)
          ) do
      b = min(a + gap, 2 ** 48 - 1)
      ida = UUID7.generate(a)
      idb = UUID7.generate(b)

      assert UUID7.valid?(ida) and UUID7.valid?(idb)
      assert UUID7.timestamp_ms(ida) == a and UUID7.timestamp_ms(idb) == b
      assert String.at(ida, 14) == "7" and String.at(ida, 19) in ~w(8 9 a b)
      assert ida < idb
    end
  end

  property "UUID7.valid?/1 accepts only lowercase hyphenated UUIDs" do
    check all(input <- one_of([Gen.text(max_length: 40), Gen.json()])) do
      if UUID7.valid?(input), do: assert(input =~ ~r/\A[0-9a-f-]{36}\z/)
      refute UUID7.valid?(if is_binary(input), do: String.upcase(input) <> "G", else: input)
    end
  end

  # A token that can't occur in the text around it by chance.
  defp token(chars), do: map(string(chars, min_length: 20, max_length: 60), &("Zq" <> &1))

  property "Redact: keys and tokens never survive in a log line" do
    alnum = Enum.concat([?a..?z, ?A..?Z, ?0..?9])

    check all(
            bearer <- token(alnum ++ ~c"._~+/=-"),
            key <- token(alnum),
            bot <- token(alnum ++ ~c"_-"),
            id <- positive_integer(),
            around <- Gen.text(max_length: 20)
          ) do
      line =
        "#{around} Authorization: Bearer #{bearer} key sk-or-v1-#{key} " <>
          "GET /bot#{id}:#{bot}/getUpdates sk-#{key} #{around}"

      redacted = Redact.redact(line)

      for secret <- [bearer, key, bot], do: refute(redacted =~ secret)
      assert Redact.redact(redacted) == redacted

      event = %{level: :warning, msg: {:string, line}, meta: %{}}
      assert %{msg: {:string, filtered}} = Redact.filter(event, [])
      refute IO.chardata_to_string(filtered) =~ bearer
    end
  end

  property "Redact.filter: any log event passes through, never raising" do
    check all(
            msg <-
              one_of([
                map(Gen.text(), &{:string, &1}),
                map(list_of(Gen.text(max_length: 5), max_length: 4), &{:string, &1}),
                map(map_of(atom(:alphanumeric), Gen.scalar(), max_length: 3), &{:report, &1}),
                map(list_of(Gen.scalar(), max_length: 3), &{"~p ~p ~p", &1})
              ])
          ) do
      event = %{level: :info, msg: msg, meta: %{}}
      assert %{msg: _} = Redact.filter(event, [])
    end
  end
end
