# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.WordsTest do
  use Kotiko.DataCase, async: false
  alias Kotiko.UUID7

  # The same target word for a Spanish reader and an English reader.
  @bases %{
    "es" => %{
      lang: "ja",
      native: "犬",
      romanization: "inu",
      base_lang: "es",
      gloss: "perro",
      forms: ["perro", "perros"],
      note: nil,
      language: "Japanese"
    },
    "en" => %{
      lang: "ja",
      native: "犬",
      romanization: "inu",
      base_lang: "en",
      gloss: "dog",
      forms: ["dog", "dogs"],
      note: nil,
      language: "Japanese"
    }
  }

  defp base(b, attrs \\ %{}), do: Map.merge(@bases[b], Map.new(attrs))

  defp add(attrs, opts \\ []) do
    {:ok, result} = Words.add(valid_attrs(attrs, Keyword.take(opts, [:status, :source])), opts)
    result
  end

  defp texts(word), do: Enum.map(word.forms, & &1.text)

  describe "add/2" do
    test "creates a word with a UUIDv7, timestamps, a seq and a native_key" do
      before = Words.last_seq()

      %{result: :created, word: w, previous: nil} =
        add(%{native: "Москва", gloss: "moscow", forms: []})

      assert UUID7.valid?(w.uuid)
      assert UUID7.timestamp_ms(w.uuid) == DateTime.to_unix(w.created_at, :millisecond)
      assert w.created_at == w.updated_at
      assert w.native_key == "москва"
      assert w.sense == ""
      assert w.seq == before + 1
      assert Words.last_seq() == before + 1
      assert texts(w) == ["moscow"]
    end

    test "uses the client's id when it is a valid UUID nobody has, else a new one" do
      id = UUID7.generate()
      assert %{word: %{uuid: ^id}} = add(%{id: id})
      assert %{word: %{uuid: other}} = add(%{id: id, native: "нет", gloss: "no"})
      assert other != id
      assert %{word: %{uuid: generated}} = add(%{id: "not-a-uuid", native: "дом", gloss: "house"})
      assert UUID7.valid?(generated)
    end

    test "F05: re-adding a known word keeps its note and romanization and unions its forms" do
      original =
        word_fixture(%{
          native: "спасибо",
          romanization: "spasibo",
          gloss: "thanks",
          forms: ["thanks", "thank you"],
          note: "My own mnemonic"
        })

      %{result: :unchanged, word: again} =
        add(%{
          native: "спасибо",
          romanization: nil,
          gloss: "thanks",
          forms: ["thanks"],
          note: nil
        })

      assert again.id == original.id
      assert again.note == "My own mnemonic"
      assert again.romanization == "spasibo"
      assert texts(again) == ["thanks", "thank you"]

      %{result: :updated, word: merged, previous: previous} =
        add(%{
          native: "спасибо",
          romanization: nil,
          gloss: "thank you",
          forms: ["thx"],
          note: nil
        })

      assert previous == again
      assert merged.uuid == original.uuid
      assert merged.gloss == "thanks"
      assert merged.note == "My own mnemonic"
      assert texts(merged) == ["thanks", "thank you", "thx"]
    end

    test "an unchanged re-add writes nothing and takes no seq" do
      %{word: w} = add(%{})
      seq = Words.last_seq()
      assert %{result: :unchanged, word: ^w} = add(%{})
      assert Words.last_seq() == seq
    end

    test "NFD and NFC spellings and capitalisation are the same word" do
      %{word: w} = add(%{lang: "vi", native: "phở", gloss: "pho", romanization: nil})
      nfd = :unicode.characters_to_nfd_binary("Phở")

      %{result: :unchanged, word: again} =
        add(%{lang: "vi", native: nfd, gloss: "pho", romanization: nil})

      assert again.id == w.id
      assert again.native == "phở"
    end

    test "homographs with a sense are two words" do
      %{word: castle} = add(%{native: "замок", gloss: "castle", sense: "Castle"})
      %{word: lock} = add(%{native: "замок", gloss: "lock", sense: "lock"})
      assert castle.id != lock.id
      assert castle.sense == "castle"
    end
  end

  # Section 4's merge table, each case for a Spanish-base and an English-base word.
  describe "merge rules" do
    for b <- ["es", "en"] do
      @b b

      test "#{b}: an empty note or romanization is filled, a written one is never replaced" do
        add(base(@b, romanization: nil))
        %{result: :updated, word: w} = add(base(@b, note: "Mine.", romanization: "inu"))
        assert {w.note, w.romanization} == {"Mine.", "inu"}

        %{result: :unchanged, word: w} = add(base(@b, note: "Model's note.", romanization: "INU"))
        assert {w.note, w.romanization} == {"Mine.", "inu"}
      end

      test "#{b}: a different gloss is kept as a form; the gloss stays" do
        %{word: first} = add(base(@b))
        other = if @b == "es", do: "can", else: "hound"
        %{result: :updated, word: w} = add(base(@b, gloss: other, forms: [other]))
        assert w.gloss == first.gloss
        assert other in texts(w)
      end

      test "#{b}: forms are unioned; existing flags, including disabled, are kept" do
        %{word: w} = add(base(@b))
        [first, second] = w.forms
        {:ok, _} = Words.update(w.uuid, %{forms: [first, %{second | enabled: false}]})

        new = if @b == "es", do: "perrito", else: "doggy"

        %{result: :updated, word: w} =
          add(base(@b, forms: [String.upcase(second.text), %{text: new, case: "lower"}]))

        assert Enum.map(w.forms, &{&1.text, &1.enabled}) ==
                 [{first.text, true}, {second.text, false}, {new, true}]

        assert List.last(w.forms).case == "lower"
      end

      test "#{b}: the forms cap keeps existing forms first" do
        many = for i <- 1..9, do: "#{@b}form#{i}"
        %{word: w} = add(base(@b, gloss: "#{@b}form1", forms: many))
        assert length(w.forms) == 9

        %{result: :updated, word: w} =
          add(base(@b, gloss: "#{@b}form1", forms: ["x1", "x2", "x3"]))

        assert length(w.forms) == 10
        assert texts(w) == many ++ ["x1"]
      end

      test "#{b}: status: pending becomes active; paused un-pauses only on an explicit add" do
        %{word: w} = add(base(@b), status: "pending")
        assert w.status == "pending"
        %{result: :updated, word: w} = add(base(@b))
        assert w.status == "active"

        {:ok, _} = Words.update(w.uuid, %{status: "paused"})
        assert %{result: :unchanged, word: %{status: "paused"}} = add(base(@b))
        assert %{result: :updated, word: %{status: "active"}} = add(base(@b), explicit: true)
        assert %{result: :unchanged, word: %{status: "active"}} = add(base(@b), status: "pending")
      end

      test "#{b}: a re-add fills an empty pronunciation, never a learner's" do
        p = if @b == "es", do: "i-nu", else: "ee-noo"
        add(base(@b))

        %{result: :updated, word: w} = add(base(@b, pronunciation: p), source: :model)
        assert {w.pronunciation, w.pronunciation_source} == {p, "model"}

        {:ok, w} = Words.update(w.uuid, %{pronunciation: "i-nuu"})
        assert w.pronunciation_source == "user"

        %{result: :unchanged, word: w} = add(base(@b, pronunciation: p), source: :model)
        assert {w.pronunciation, w.pronunciation_source} == {"i-nuu", "user"}
      end
    end

    test "a bilingual group: two records, one per base; a later add touches only its own" do
      %{result: :created, word: es} = add(base("es", pronunciation: "i-nu"))
      %{result: :created, word: en} = add(base("en", pronunciation: "ee-noo"))
      assert es.uuid != en.uuid
      assert {es.gloss, en.gloss} == {"perro", "dog"}
      assert {texts(es), texts(en)} == {["perro", "perros"], ["dog", "dogs"]}
      assert es.pronunciation != en.pronunciation

      assert %{result: :unchanged} = add(base("es"))
      assert Repo.get(Word, en.id) == en
    end

    test "a word can't be its own base" do
      assert {:error, :target_is_base, _} =
               Kotiko.WordSpec.validate_word(%{
                 lang: "en",
                 native: "dog",
                 base_lang: "en",
                 gloss: "dog"
               })
    end
  end

  describe "concurrency" do
    test "F06: 20 concurrent adds of the same word give one row and no exceptions" do
      results =
        1..20
        |> Task.async_stream(fn _ ->
          try do
            Words.add(valid_attrs(%{native: "犬", lang: "ja", gloss: "dog", forms: ["dog"]}))
          rescue
            e -> {:raised, e}
          end
        end)
        |> Enum.map(fn {:ok, r} -> r end)

      assert Enum.all?(results, &match?({:ok, %{word: %Word{}}}, &1))
      assert Repo.aggregate(Word, :count) == 1
      assert Enum.count(results, &match?({:ok, %{result: :created}}, &1)) == 1
      assert Enum.count(results, &match?({:ok, %{result: :unchanged}}, &1)) == 19
    end
  end

  describe "update/3" do
    test "changes only the fields given and bumps updated_at and seq" do
      w = word_fixture()
      {:ok, u} = Words.update(w.uuid, %{romanization: "da!", note: nil})
      assert {u.romanization, u.note, u.gloss} == {"da!", nil, w.gloss}
      assert DateTime.compare(u.updated_at, w.updated_at) == :gt
      assert u.seq > w.seq
    end

    test "an old if_updated_at is stale and returns the current word" do
      w = word_fixture()
      {:ok, u} = Words.update(w.uuid, %{note: "First."})

      assert {:error, {:stale, ^u}} =
               Words.update(w.uuid, %{note: "Second."}, if_updated_at: w.updated_at)

      assert {:ok, _} = Words.update(w.uuid, %{note: "Second."}, if_updated_at: u.updated_at)
    end

    test "a change of lang onto another live word's key is a conflict" do
      ru = word_fixture()
      sr = word_fixture(%{lang: "sr", language: "Serbian"})
      assert {:error, {:conflict, other}} = Words.update(sr.uuid, %{lang: "ru"})
      assert other == ru.uuid
    end

    test "setting a pronunciation makes it the learner's; clearing it clears all three" do
      w = word_fixture(%{native: "пожалуйста", gloss: "please"})

      {:ok, w} =
        Words.update(w.uuid, %{
          pronunciation: "pa-ZHAL-sta",
          pronunciation_careful: "pa-ZHA-lu-sta"
        })

      assert w.pronunciation_source == "user"

      {:ok, w} = Words.update(w.uuid, %{pronunciation: nil})
      assert {w.pronunciation, w.pronunciation_careful, w.pronunciation_source} == {nil, nil, nil}

      assert {:ok, %{pronunciation_source: "model"}} =
               Words.update(w.uuid, %{pronunciation: "pa-ZHAL-sta", pronunciation_source: "model"})
    end

    test "fixing native is never refused because of a saved pronunciation" do
      w = word_fixture(%{native: "пожалуйста", gloss: "please"})

      {:ok, w} =
        Words.update(w.uuid, %{pronunciation: "pa-ZHAL-sta", native_vocalized: "пожа́луйста"})

      assert {:ok, %{native: "пожалуста"}} = Words.update(w.uuid, %{native: "пожалуста"})
    end

    test "an invalid pronunciation is refused" do
      w = word_fixture(%{native: "пожалуйста", gloss: "please"})

      assert {:error, {:invalid, %{field: "pronunciation", reason: "bad_pronunciation"}}} =
               Words.update(w.uuid, %{pronunciation: "PA-ZHAL-STA"})
    end
  end

  describe "tombstones" do
    test "delete then restore gives back the same id and content" do
      w = word_fixture(%{note: "Mine."})
      {:ok, d} = Words.delete(w.uuid)
      assert d.deleted_at && d.updated_at == d.deleted_at
      assert Words.get_row(w.id) == nil
      assert {:ok, ^d} = Words.delete(w.uuid)

      {:ok, r} = Words.restore(w.uuid)
      assert r.deleted_at == nil

      assert Map.take(r, [:uuid, :native, :gloss, :forms, :note]) ==
               Map.take(w, [:uuid, :native, :gloss, :forms, :note])
    end

    test "re-adding a deleted word creates a new id and keeps the tombstone" do
      w = word_fixture()
      {:ok, _} = Words.delete(w.uuid)
      %{result: :created, word: again} = add(%{})
      assert again.uuid != w.uuid
      assert Words.get(w.uuid).deleted_at
      assert {:error, {:conflict, other}} = Words.restore(w.uuid)
      assert other == again.uuid
    end

    test "after 30 days the content is scrubbed and restore is refused" do
      w = word_fixture(%{note: "Mine."})
      {:ok, _} = Words.delete(w.uuid)
      later = DateTime.add(Words.now(), 31, :day)

      assert {:error, :scrubbed} = Words.restore(w.uuid, now: later)
      assert Kotiko.Janitor.run(later).scrubbed == 1

      s = Words.get(w.uuid)
      assert {s.native, s.gloss, s.forms, s.note, s.native_key} == {"", "", [], nil, s.uuid}
      assert {s.lang, s.base_lang, s.seq} == {w.lang, w.base_lang, s.seq}
      assert {:error, :scrubbed} = Words.restore(w.uuid)
    end

    test "after 180 days the row goes; seq still only increases" do
      a = word_fixture()
      b = word_fixture(%{native: "нет", gloss: "no"})
      {:ok, _} = Words.delete(a.uuid)
      {:ok, newest} = Words.delete(b.uuid)
      before = Words.last_seq()
      assert newest.seq == before

      result = Kotiko.Janitor.run(DateTime.add(Words.now(), 181, :day))
      assert result.purged == 2
      assert Words.get(b.uuid) == nil
      assert Words.sync_state().purged_through_seq == before

      %{word: w} = add(%{native: "дом", gloss: "house"})
      assert w.seq == before + 1
    end

    test "seq strictly increases across inserts, merges, edits, deletes and restores" do
      %{word: w} = add(%{})
      %{word: m} = add(%{note: nil, forms: ["yes", "yeah"]})
      {:ok, u} = Words.update(w.uuid, %{note: "x"})
      {:ok, d} = Words.delete(w.uuid)
      {:ok, r} = Words.restore(w.uuid)
      seqs = [w.seq, m.seq, u.seq, d.seq, r.seq]
      assert seqs == Enum.sort(Enum.uniq(seqs))
    end
  end

  describe "queries" do
    test "list/1 returns live active and paused words, never pending" do
      word_fixture()
      word_fixture(%{lang: "ar", language: "Arabic", native: "شكرا", gloss: "thanks"})
      word_fixture(%{native: "нет", gloss: "no"}, "pending")
      word_fixture(base("es"))

      assert Words.list() |> Enum.map(& &1.native) |> Enum.sort() ==
               Enum.sort(["да", "犬", "شكرا"])

      assert [%{native: "شكرا"}] = Words.list(langs: ["ar"])
      assert [%{native: "犬"}] = Words.list(bases: ["es"])
      assert [_] = Words.list(limit: 1)
    end

    test "legacy_active/1 lists only active records for English pages" do
      word_fixture()
      word_fixture(base("es"))
      word_fixture(%{native: "нет", gloss: "no"}, "pending")
      assert [%{native: "да"}] = Words.legacy_active()
    end

    test "find/1 matches native, romanization and gloss, ignoring Cyrillic case" do
      word = word_fixture(%{native: "Москва", romanization: "Moskva", gloss: "moscow"})

      for term <- ["москва", "МОСКВА", "moskva", " Moscow "] do
        assert [%{id: id}] = Words.find(term)
        assert id == word.id
      end
    end

    test "langs_matching/1 resolves a language name or code" do
      word_fixture(%{lang: "ar", language: "Arabic", native: "شكرا", gloss: "thanks"})
      assert Words.langs_matching("arabic") == ["ar"]
      assert Words.langs_matching("AR") == ["ar"]
      assert Words.langs_matching("klingon") == []
    end

    test "language names come from the tag, never from the model" do
      %{word: w} =
        add(%{
          language: "Mandarin",
          lang: "yue",
          native: "多謝",
          gloss: "thanks",
          romanization: nil
        })

      assert Word.to_api(w).language == "粵語"
      assert Word.to_legacy_json(w).language == "Cantonese"
      assert Words.langs_matching("cantonés") == ["yue"]
      assert Words.langs_matching("粵語") == ["yue"]
    end
  end

  describe "the janitor" do
    test "removes kept add responses after 24 hours" do
      :ok = Kotiko.AddRequests.store(UUID7.generate(), ~s({"results":[]}))
      assert Kotiko.Janitor.run(DateTime.add(Words.now(), 23, :hour)).add_requests == 0
      assert Kotiko.Janitor.run(DateTime.add(Words.now(), 25, :hour)).add_requests == 1
    end
  end
end
