# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.WordsTest do
  use Kotiko.DataCase, async: false

  describe "upsert/2 (today's behaviour)" do
    test "inserts a new word with the given status" do
      assert {:ok, %Word{id: id, status: "pending", native: "да"}} =
               Words.upsert(word_attrs(), "pending")

      assert Words.get(id).lang == "ru"
    end

    test "updates the existing (lang, native) row instead of adding another" do
      first = word_fixture(%{}, "pending")
      assert {:ok, again} = Words.upsert(word_attrs(note: "Changed."), "active")

      assert again.id == first.id
      assert again.status == "active"
      assert again.note == "Changed."
      assert Repo.aggregate(Word, :count) == 1
    end

    test "the same native word in another language is another row" do
      ru = word_fixture(%{})
      sr = word_fixture(%{lang: "sr", language: "Serbian"})
      assert ru.id != sr.id
    end

    test "keeps the first name a language was saved under" do
      word_fixture(%{language: "Mandarin", lang: "zh", native: "狗", english: "dog"})

      {:ok, w} =
        Words.upsert(
          word_attrs(language: "Chinese", lang: "zh", native: "猫", english: "cat"),
          "active"
        )

      assert w.language == "Mandarin"
    end

    test "returns a changeset error for an invalid language tag" do
      assert {:error, %Ecto.Changeset{errors: errors}} =
               Words.upsert(word_attrs(lang: "russian"), "active")

      assert Keyword.has_key?(errors, :lang)
    end
  end

  describe "queries" do
    test "active/1 lists active words, optionally by language" do
      word_fixture(%{})
      word_fixture(%{lang: "ar", language: "Arabic", native: "شكرا", english: "thanks"})
      word_fixture(%{native: "нет", english: "no"}, "pending")

      assert Enum.map(Words.active(), & &1.native) |> Enum.sort() == ["да", "شكرا"]
      assert [%{native: "شكرا"}] = Words.active(["ar"])
    end

    test "find/1 matches native, romanization and English, ignoring Cyrillic case" do
      word = word_fixture(%{native: "Москва", romanization: "Moskva", english: "moscow"})

      for term <- ["москва", "МОСКВА", "moskva", " Moscow "] do
        assert [%{id: id}] = Words.find(term)
        assert id == word.id
      end
    end

    test "langs_matching/1 resolves a language name or code" do
      word_fixture(%{lang: "ar", language: "Arabic", native: "شكرا", english: "thanks"})
      assert Words.langs_matching("arabic") == ["ar"]
      assert Words.langs_matching("AR") == ["ar"]
      assert Words.langs_matching("klingon") == []
    end
  end

  # Known bugs from research 06. Slice 07 (word model v2) fixes them and drops the tag.
  describe "known bugs, fixed in slice 07" do
    @tag :pending
    test "F05: re-adding a known word keeps its note and romanization and unions its forms" do
      original =
        word_fixture(%{
          native: "спасибо",
          romanization: "spasibo",
          english: "thanks",
          english_forms: "thanks\nthank you",
          note: "My own mnemonic"
        })

      {:ok, again} =
        Words.upsert(
          word_attrs(
            native: "спасибо",
            romanization: nil,
            english: "thank you",
            english_forms: "thank you",
            note: nil
          ),
          "active"
        )

      assert again.id == original.id
      assert again.note == "My own mnemonic"
      assert again.romanization == "spasibo"
      assert "thanks" in Word.forms(again)
    end

    @tag :pending
    test "F06: 20 concurrent upserts of the same word give one row and no exceptions" do
      results =
        1..20
        |> Task.async_stream(fn _ ->
          try do
            Words.upsert(word_attrs(native: "犬", lang: "ja", english: "dog"), "active")
          rescue
            e -> {:raised, e}
          end
        end)
        |> Enum.map(fn {:ok, r} -> r end)

      assert Enum.all?(results, &match?({:ok, %Word{}}, &1))
      assert Repo.aggregate(Word, :count) == 1
    end
  end
end
