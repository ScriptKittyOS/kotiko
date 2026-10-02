# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.TextTest do
  use ExUnit.Case, async: true
  use ExUnitProperties
  alias Kotiko.{Text, UUID7}

  # Shared with JavaScript: test/unit/native-key.test.mjs reads the same file.
  @fixture Path.expand("../../../spec/fixtures/native-key.json", __DIR__)

  for %{"note" => note, "input" => input, "key" => key} <-
        @fixture |> File.read!() |> Jason.decode!() |> Map.fetch!("cases") do
    @input input
    @key key
    test "native_key: #{note}" do
      assert Text.native_key(@input) == @key
    end
  end

  property "native_key is idempotent and the same for NFD and NFC" do
    check all(s <- string(:printable, max_length: 20)) do
      key = Text.native_key(s)
      assert Text.native_key(key) == key
      assert Text.native_key(:unicode.characters_to_nfd_binary(s)) == key
      assert Text.native_key(:unicode.characters_to_nfc_binary(s)) == key
    end
  end

  test "clean: NFC, invisible and control characters, whitespace" do
    assert Text.clean("  phở  ") == "phở"
    assert Text.clean("a​b­c﻿") == "abc"
    assert Text.clean("ice\n\tcream  cone") == "ice cream cone"
    assert Text.clean("می‌خواهم") == "می‌خواهم"
    assert Text.clean("   ") == nil
    assert Text.clean(42) == nil
    assert Text.clean(<<0xFF>>) == nil
  end

  describe "UUID7" do
    test "follows the RFC 9562 layout and sorts by time" do
      ms = 1_759_352_627_123
      id = UUID7.generate(ms)

      assert UUID7.valid?(id)
      <<_::binary-14, version, _::binary-4, variant, _::binary>> = id
      assert version == ?7
      assert variant in ~c"89ab"
      assert UUID7.timestamp_ms(id) == ms
      assert UUID7.generate(ms + 1) > id
      at = ~U[2026-10-01 21:23:47.123Z]
      assert UUID7.generate(at) |> UUID7.timestamp_ms() == DateTime.to_unix(at, :millisecond)
    end

    test "ids are unique and only lowercase hyphenated UUIDs are valid" do
      ids = for _ <- 1..1000, do: UUID7.generate()
      assert length(Enum.uniq(ids)) == 1000
      refute UUID7.valid?(String.upcase(hd(ids)))
      refute UUID7.valid?("abc")
      refute UUID7.valid?(nil)
      assert UUID7.valid?("123e4567-e89b-12d3-a456-426614174000")
    end
  end
end
