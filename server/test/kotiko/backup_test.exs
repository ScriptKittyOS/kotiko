# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.BackupTest do
  # Slice 12 on the server: GET /api/v1/export, DELETE /api/v1/words, a backup restored
  # through the batch route (the fixtures the extension's tests use too), and Backup.import.
  use Kotiko.ConnCase, async: false
  import Ecto.Query
  alias Kotiko.{Backup, Word, Words}

  @fixtures Path.expand("../../../spec/fixtures/export", __DIR__)
  @confirm %{"confirm" => "delete-all-words"}

  defp fixture(name), do: @fixtures |> Path.join(name) |> File.read!() |> Jason.decode!()

  defp call(method, path, body \\ nil) do
    opts = if body, do: [body: body], else: []
    conn = request(method, path, auth(), opts)
    {conn.status, if(conn.resp_body in [nil, ""], do: nil, else: json_body(conn))}
  end

  defp rows, do: Repo.aggregate(from(w in "words"), :count)
  defp epoch, do: Words.sync_state().reset_epoch

  describe "GET /api/v1/export" do
    test "the section 2 document: every word that isn't deleted, in id order, with every field" do
      a = word_fixture(%{native: "да", gloss: "yes"})
      b = word_fixture(%{native: "нет", gloss: "no"}, "paused")
      gone = word_fixture(%{native: "дом", gloss: "house"})
      {:ok, _} = Words.delete(gone.uuid)
      _pending = word_fixture(%{native: "ждёт", gloss: "waits"}, "pending")

      {200, doc} = call(:get, "/api/v1/export")
      assert doc["format"] == "kotiko.words"
      assert doc["schemaVersion"] == 2
      assert doc["app"]["source"] == "server"
      assert doc["exportedAt"] =~ ~r/\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\z/
      assert Enum.map(doc["words"], & &1["id"]) == [a.uuid, b.uuid]
      [w | _] = doc["words"]

      assert Map.keys(w) |> Enum.sort() ==
               ~w(base_lang created_at deleted_at forms gloss id lang merged_into native
                  native_vocalized note origin pronunciation pronunciation_careful
                  pronunciation_source romanization sense source_text status updated_at)

      assert w ==
               a |> Word.to_api() |> Map.delete(:language) |> Jason.encode!() |> Jason.decode!()
    end

    test "include=pending adds Telegram lookups never added; download=1 makes it a file" do
      word_fixture(%{native: "да", gloss: "yes"})
      word_fixture(%{native: "ждёт", gloss: "waits"}, "pending")
      {200, doc} = call(:get, "/api/v1/export?include=pending")
      assert Enum.map(doc["words"], & &1["status"]) == ["active", "pending"]

      conn = request(:get, "/api/v1/export?download=1", auth())
      assert [disposition] = get_resp_header(conn, "content-disposition")
      assert disposition =~ ~r/\Aattachment; filename="kotiko-backup-\d{4}-\d{2}-\d{2}\.json"\z/
      assert get_resp_header(conn, "cache-control") == ["no-store"]
    end

    test "an empty server exports an empty list; the file is two-space JSON" do
      conn = request(:get, "/api/v1/export", auth())
      assert conn.resp_body =~ ~r/\A\{\n  "format": "kotiko.words",\n/
      assert json_body(conn)["words"] == []
    end

    test "streams words 500 at a time: a large export is written in pieces, never one term" do
      for i <- 1..1201,
          do: word_fixture(%{native: "дом#{i}", gloss: "word#{i}", forms: ["word#{i}"]})

      {:ok, pieces} = Agent.start_link(fn -> [] end)
      n = Backup.export(fn data -> Agent.update(pieces, &[data | &1]) end)
      assert n == 1201
      # head, three pages of words, tail
      assert Agent.get(pieces, &length/1) == 5
      doc = Agent.get(pieces, & &1) |> Enum.reverse() |> IO.iodata_to_binary() |> Jason.decode!()
      assert length(doc["words"]) == 1201
    end

    test "needs the token" do
      assert request(:get, "/api/v1/export").status == 401
    end
  end

  describe "DELETE /api/v1/words" do
    test "without the confirmation: 400, nothing deleted" do
      word_fixture()
      before = epoch()

      assert {400,
              %{"error" => %{"code" => "invalid_request", "details" => %{"field" => "confirm"}}}} =
               call(:delete, "/api/v1/words")

      assert {400, _} = call(:delete, "/api/v1/words", %{"confirm" => "yes"})
      assert rows() == 1
      assert epoch() == before
    end

    test "deletes every word, pending lookup and tombstone; reset_epoch goes up; old cursors start over" do
      word_fixture(%{native: "да", gloss: "yes"})
      word_fixture(%{native: "нет", gloss: "no"}, "paused")
      word_fixture(%{native: "ждёт", gloss: "waits"}, "pending")
      gone = word_fixture(%{native: "дом", gloss: "house"})
      {:ok, _} = Words.delete(gone.uuid)

      {200, _} =
        call(:post, "/api/v1/words/batch", %{
          "words" => [
            %{
              "lang" => "ru",
              "native" => "кот",
              "base_lang" => "en",
              "gloss" => "cat",
              "forms" => ["cat"]
            }
          ],
          "client_request_id" => "0199a000-0000-7000-8000-0000000000aa"
        })

      before = epoch()

      assert {200, %{"deleted" => 3, "reset_epoch" => e}} =
               call(:delete, "/api/v1/words", @confirm)

      assert e == before + 1
      assert rows() == 0
      assert Repo.aggregate(from(r in "add_requests"), :count) == 0
      state = Words.sync_state()
      assert state.purged_through_seq == state.last_seq

      assert {200, %{"deleted" => 0, "reset_epoch" => e2}} =
               call(:delete, "/api/v1/words", @confirm)

      assert e2 == e + 1
    end

    test "auth comes first: no token, no body parsing, nothing deleted" do
      word_fixture()
      conn = request(:delete, "/api/v1/words", [], body: @confirm)
      assert conn.status == 401
      assert rows() == 1
    end
  end

  describe "restoring a backup through the batch route (the extension's server mode)" do
    test "the shared multi-script backup: new words keep their ids; the same file again changes nothing" do
      words = fixture("multi-script.json")["words"]
      body = %{"words" => words, "client_request_id" => "0199a000-0000-7000-8000-0000000000b1"}
      {200, %{"results" => results, "rejected" => []}} = call(:post, "/api/v1/words/batch", body)
      assert Enum.map(results, & &1["result"]) == List.duplicate("created", length(words))
      assert Enum.map(results, & &1["word"]["id"]) == Enum.map(words, & &1["id"])
      saved = Map.new(results, &{&1["word"]["id"], &1["word"]})

      # The server keeps a note on one line (slice 09's cleaning); everything else is as sent.
      one_line = fn
        nil -> nil
        v -> String.replace(v, ~r/\s+/, " ")
      end

      for w <- words do
        s = saved[w["id"]]
        assert s["note"] == one_line.(w["note"])
        # "migrated" is the server's own upgrade's origin, never a client's (slice 07).
        assert s["origin"] == if(w["origin"] == "migrated", do: "bulk", else: w["origin"])

        for f <-
              ~w(lang native base_lang gloss romanization status pronunciation pronunciation_careful pronunciation_source),
            do: assert(s[f] == w[f], "#{w["native"]}: #{f}")
      end

      again = %{body | "client_request_id" => "0199a000-0000-7000-8000-0000000000b2"}
      {200, %{"results" => results}} = call(:post, "/api/v1/words/batch", again)
      assert Enum.all?(results, &(&1["result"] == "unchanged"))
    end

    test "batches over 500 words are refused" do
      w = %{"lang" => "ru", "native" => "да", "base_lang" => "en", "gloss" => "yes"}

      assert {400, %{"error" => %{"details" => %{"max" => 500}}}} =
               call(:post, "/api/v1/words/batch", %{"words" => List.duplicate(w, 501)})
    end
  end

  describe "Backup.import/1 and the export round trip" do
    test "export, delete everything, import: the same words with the same ids" do
      Backup.import(fixture("bilingual.json"))

      before =
        Words.list()
        |> Enum.map(&{&1.uuid, &1.lang, &1.native, &1.base_lang, &1.gloss, &1.pronunciation})
        |> Enum.sort()

      doc = Jason.decode!(Backup.export_binary())
      {:ok, _} = Backup.delete_all()
      assert rows() == 0
      assert {:ok, %{created: 5, rejected: 0}} = Backup.import(doc)

      after_ =
        Words.list()
        |> Enum.map(&{&1.uuid, &1.lang, &1.native, &1.base_lang, &1.gloss, &1.pronunciation})
        |> Enum.sort()

      assert after_ == before
      assert {:ok, %{created: 0, unchanged: 5}} = Backup.import(doc)
    end

    test "a version 1 backup: gloss is the old english, base en" do
      assert {:ok, %{created: 3}} = Backup.import(fixture("v1.json"))

      assert Words.list(statuses: ~w(active paused))
             |> Enum.map(&{&1.native, &1.gloss, &1.base_lang})
             |> Enum.sort() ==
               [{"кошка", "cat", "en"}, {"пожалуйста", "please", "en"}, {"水", "water", "en"}]
    end

    test "a newer backup is refused and changes nothing; invalid words are counted, not fatal" do
      assert {:error, {:backup_newer, 3}} = Backup.import(fixture("newer.json"))
      assert {:error, :not_backup} = Backup.import(%{"words" => "x"})
      assert {:ok, %{created: 2, rejected: 6}} = Backup.import(fixture("invalid-words.json"))
      assert Words.get_by_key("ru", "пожалуйста", "", "en").pronunciation == nil
    end
  end
end
