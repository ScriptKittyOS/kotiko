# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.WordsEdgesTest do
  # Kotiko.Words at its edges: ids that aren't ids, words that are pending or deleted,
  # and the cleanup steps with their default clock. words_test.exs covers the main paths.
  use Kotiko.DataCase, async: false
  alias Kotiko.UUID7

  test "get/1 and get_row/1 answer nil for anything that isn't an id" do
    for id <- [nil, 42, "42", "not-a-uuid", String.upcase(UUID7.generate())],
        do: assert(Words.get(id) == nil, inspect(id))

    for id <- [nil, "7", 1.0], do: assert(Words.get_row(id) == nil, inspect(id))
  end

  test "get_by_key/3 finds a live word with no sense, in any case of the native" do
    w = word_fixture(%{native: "Да"})
    assert Words.get_by_key("ru", "да", "en").id == w.id
    assert Words.get_by_key("ru", "ДА", nil, "en").id == w.id
    assert Words.get_by_key("ru", "да", "es") == nil
  end

  test "get_many/1 returns the live words among the ids" do
    a = word_fixture()
    b = word_fixture(%{native: "нет", gloss: "no", forms: ["no"]})
    {:ok, _} = Words.delete(b)

    assert [%Word{id: id}] = Words.get_many([a.uuid, b.uuid, UUID7.generate()])
    assert id == a.id
  end

  test "recent/0 lists the newest active words first" do
    old = word_fixture()
    new = word_fixture(%{native: "нет", gloss: "no", forms: ["no"]})
    word_fixture(%{native: "спасибо", gloss: "thanks", forms: ["thanks"]}, "pending")

    assert Enum.map(Words.recent(), & &1.id) == [new.id, old.id]
  end

  test "update/3 refuses a pending word as not found and a tombstone as deleted" do
    pending = word_fixture(%{}, "pending")
    assert Words.update(pending.uuid, %{gloss: "yeah"}) == {:error, :not_found}

    gone = word_fixture(%{native: "нет", gloss: "no", forms: ["no"]})
    {:ok, _} = Words.delete(gone)
    assert Words.update(gone.uuid, %{gloss: "nope"}) == {:error, :deleted}
    assert Words.update(UUID7.generate(), %{gloss: "x"}) == {:error, :not_found}
  end

  test "update/3 moves the tag to the script the edited native is written in" do
    w = word_fixture(%{lang: "sr", native: "хвала", romanization: "hvala", gloss: "thanks"})
    assert w.lang == "sr"

    assert {:ok, updated} = Words.update(w.uuid, %{native: "hvala"})
    assert {updated.lang, updated.native} == {"sr-Latn", "hvala"}
  end

  test "delete/1 of an unknown id is not found; deleting twice keeps the first time" do
    assert Words.delete(UUID7.generate()) == {:error, :not_found}

    w = word_fixture()
    {:ok, first} = Words.delete(w)
    assert {:ok, again} = Words.delete(w.uuid)
    assert again.deleted_at == first.deleted_at
  end

  test "the tombstone cleanups default to now and leave fresh tombstones alone" do
    w = word_fixture()
    {:ok, _} = Words.delete(w)

    assert Words.scrub_tombstones() == 0
    assert Words.purge_tombstones() == 0
    assert Repo.get(Word, w.id).native == "да"
  end
end
