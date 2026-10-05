# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Backup do
  @moduledoc """
  Slice 12 on the server: the JSON backup (`GET /api/v1/export`, `mix kotiko.export`),
  restoring one (`mix kotiko.import`; the extension uses the batch route) and deleting
  every word (`DELETE /api/v1/words`, `mix kotiko.reset`).

  The backup is the document of `spec/export.schema.json`, the same one the extension
  writes, with `app.source` "server". Words are read in id order, 500 at a time, and
  handed to a writer as they are read, so a 20,000-word export never builds one large
  term.
  """
  import Ecto.Query
  alias Kotiko.{Repo, Word, Words, WordSpec}

  @format "kotiko.words"
  @schema_version 2
  @page 500

  def format, do: @format
  def schema_version, do: @schema_version

  @doc """
  Writes the backup as a fold: `write.(iodata, acc)` is called with each piece in order
  and returns the next `acc`. Returns `{word_count, acc}`. Options: `:include_pending`
  (Telegram lookups never added; left out by default), `:now`.
  """
  def reduce(acc, write, opts \\ []) do
    now = opts[:now] || Words.now()

    head = [
      "{\n",
      ~s(  "format": "#{@format}",\n),
      ~s(  "schemaVersion": #{@schema_version},\n),
      ~s(  "exportedAt": #{Jason.encode!(Word.timestamp(now))},\n),
      ~s(  "app": ),
      Jason.encode!(%{name: "Kotiko", version: Kotiko.Health.version(), source: "server"}),
      ",\n",
      ~s(  "words": [)
    ]

    {count, acc} = pages(0, 0, opts[:include_pending] == true, write, write.(head, acc))
    {count, write.(if(count == 0, do: "]\n}\n", else: "\n  ]\n}\n"), acc)}
  end

  @doc "Writes the backup through `write.(iodata)`; returns the number of words."
  def export(write, opts \\ []) do
    {count, _} = reduce(nil, fn data, acc -> write.(data) && acc end, opts)
    count
  end

  defp pages(after_id, count, pending?, write, acc) do
    statuses = if pending?, do: Word.statuses(), else: Word.statuses() -- ["pending"]

    words =
      Repo.all(
        from w in Word,
          where: is_nil(w.deleted_at) and w.id > ^after_id and w.status in ^statuses,
          order_by: [asc: w.id],
          limit: @page
      )

    case words do
      [] ->
        {count, acc}

      _ ->
        chunk =
          words
          |> Enum.with_index(count)
          |> Enum.map(fn {w, i} -> [if(i == 0, do: "\n", else: ",\n"), word_json(w)] end)

        acc = write.(chunk, acc)
        pages(List.last(words).id, count + length(words), pending?, write, acc)
    end
  end

  # One word, pretty-printed and indented to sit inside "words": every slice 07 field,
  # without the derived `language`.
  defp word_json(w) do
    w
    |> Word.to_api()
    |> Map.delete(:language)
    |> ordered()
    |> Jason.encode!(pretty: true)
    |> String.split("\n")
    |> Enum.map_join("\n", &("    " <> &1))
  end

  @fields ~w(id lang native base_lang sense gloss forms romanization native_vocalized
             pronunciation pronunciation_careful pronunciation_source note status origin
             source_text created_at updated_at deleted_at merged_into)a

  defp ordered(map), do: Jason.OrderedObject.new(for f <- @fields, do: {f, Map.get(map, f)})

  @doc "The whole backup as one binary (small exports and tests)."
  def export_binary(opts \\ []) do
    {_, pieces} = reduce([], &[&1 | &2], opts)
    pieces |> Enum.reverse() |> IO.iodata_to_binary()
  end

  @doc """
  Deletes every word: live words, pending Telegram lookups and tombstones, the add
  responses kept for retries (they hold copies of words) and the lookup cache (what was
  looked up). Increments `reset_epoch` (slice 39: other devices don't push their copies
  straight back) and marks every older change as purged, so a sync cursor from before
  the reset starts over. Returns `{:ok, %{deleted: n, reset_epoch: e}}`; `deleted`
  counts the words that weren't tombstones or pending.
  """
  def delete_all do
    Words.transaction(fn ->
      counted =
        Repo.aggregate(
          from(w in Word, where: is_nil(w.deleted_at) and w.status != "pending"),
          :count
        )

      Repo.delete_all(Word)
      Repo.query!("DELETE FROM add_requests")
      Repo.query!("DELETE FROM lookup_cache")

      %{rows: [[epoch]]} =
        Repo.query!(
          "UPDATE sync_state SET reset_epoch = reset_epoch + 1, " <>
            "purged_through_seq = last_seq WHERE id = 1 RETURNING reset_epoch"
        )

      {:ok, %{deleted: counted, reset_epoch: epoch}}
    end)
  end

  @doc """
  Restores a backup document (a map, as `Jason.decode!/1` gives) through the same checks
  and merge as the batch route: words new here keep their ids; one with the same natural
  key merges (slice 07). Returns `{:ok, %{created, updated, unchanged, rejected}}` or
  `{:error, :not_backup | {:backup_newer, version}}`.
  """
  def import(%{"words" => words} = doc) when is_list(words) do
    version = doc["schemaVersion"]

    cond do
      not is_integer(version) or version < 1 ->
        {:error, :not_backup}

      version > @schema_version ->
        {:error, {:backup_newer, version}}

      true ->
        counts = %{created: 0, updated: 0, unchanged: 0, rejected: 0}

        counts =
          words
          |> Enum.reject(&(is_map(&1) and &1["deleted_at"] not in [nil, ""]))
          |> Enum.map(&upgrade(&1, version))
          |> Enum.chunk_every(@page)
          |> Enum.reduce(counts, &import_chunk/2)

        {:ok, counts}
    end
  end

  def import(_), do: {:error, :not_backup}

  # base-neutral-ok-start: version 1 backups, whose words were for English pages
  defp upgrade(%{} = w, version) do
    if (version < 2 or is_nil(w["gloss"])) and is_binary(w["english"]),
      do: w |> Map.put("gloss", w["english"]) |> Map.put_new("base_lang", "en"),
      else: w
  end

  # base-neutral-ok-end

  defp upgrade(w, _version), do: w

  defp import_chunk(chunk, counts) do
    checked =
      Enum.map(chunk, fn
        %{"status" => "pending"} -> {:error, :pending, %{}}
        w when is_map(w) -> WordSpec.validate_word(w, origin: "import", status: "active")
        _ -> {:error, :not_an_object, %{}}
      end)

    valid = for {:ok, attrs, _dropped} <- checked, do: attrs
    rejected = Enum.count(checked, &match?({:error, _, _}, &1))
    {:ok, results} = Kotiko.Lookup.save(valid, explicit: false)

    Enum.reduce(results, %{counts | rejected: counts.rejected + rejected}, fn
      {:ok, %{result: r}}, acc -> Map.update!(acc, r, &(&1 + 1))
      {:error, _}, acc -> Map.update!(acc, :rejected, &(&1 + 1))
    end)
  end
end
