# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Words do
  @moduledoc """
  Every read and write of words, shared by the API routers, the bot and the background
  jobs (slice 07 section 4).

  Each write runs in one immediate transaction (the repo's `default_transaction_mode`),
  so read-merge-write is serialised, takes the next change number (`seq`) from
  `sync_state`, and returns `{:ok, result}` or `{:error, reason}`; none raises on bad
  input. A live word is identified by `(lang, native_key, sense, base_lang)`; deletes
  leave a tombstone that can be restored for 30 days.
  """
  import Ecto.Query
  require Logger
  alias Kotiko.{Lang, Repo, Text, UUID7, Word, WordMerge, WordSpec}

  @restore_days 30
  @purge_days 180
  @natural_index "words_lang_native_key_sense_base_lang_index"

  # ── reads ────────────────────────────────────────────────────────────

  @doc "The word with this public id, live or tombstone (pending words are server-local)."
  def get(uuid) when is_binary(uuid) do
    if UUID7.valid?(uuid), do: Repo.one(from w in Word, where: w.uuid == ^uuid)
  end

  def get(_), do: nil

  @doc "A live word by its internal row id (legacy routes and Telegram buttons)."
  def get_row(id) when is_integer(id),
    do: Repo.one(from w in live(), where: w.id == ^id)

  def get_row(_), do: nil

  @doc "The live word holding a natural key, or nil."
  def get_by_key(lang, native, sense \\ "", base_lang) do
    key = Text.native_key(native)

    Repo.one(
      from w in live(),
        where:
          w.lang == ^lang and w.native_key == ^key and w.sense == ^(sense || "") and
            w.base_lang == ^base_lang
    )
  end

  @doc """
  Live words for `GET /api/v1/words`. Options: `:langs`, `:bases`, `:statuses` (default
  active and paused; pending is never listed), `:limit`. Newest first.
  """
  def list(opts \\ []) do
    statuses = (opts[:statuses] || ~w(active paused)) -- ["pending"]

    from(w in live(),
      where: w.status in ^statuses,
      order_by: [desc: w.created_at, desc: w.id],
      limit: ^(opts[:limit] || 20_000)
    )
    |> where_in(:lang, opts[:langs])
    |> where_in(:base_lang, opts[:bases])
    |> Repo.all()
  end

  @doc "The last change number, the `cursor` of `GET /api/v1/words`."
  def last_seq do
    Repo.one(from s in "sync_state", where: s.id == 1, select: s.last_seq) || 0
  end

  @doc "The sync_state row: last_seq, purged_through_seq and reset_epoch."
  def sync_state do
    Repo.one(
      from s in "sync_state",
        where: s.id == 1,
        select: %{
          last_seq: s.last_seq,
          purged_through_seq: s.purged_through_seq,
          reset_epoch: s.reset_epoch
        }
    )
  end

  @doc """
  Active words for the legacy `GET /api/words`, newest first: only records for English
  pages (`base_lang` "en"), since a 0.2 extension knows no other base.
  """
  def legacy_active(langs \\ nil) do
    from(w in live(),
      where: w.status == "active" and w.base_lang == "en",
      order_by: [desc: w.created_at, desc: w.id]
    )
    |> where_in(:lang, langs)
    |> Repo.all()
  end

  defp live, do: from(w in Word, where: is_nil(w.deleted_at))

  defp where_in(q, _field, nil), do: q
  defp where_in(q, _field, []), do: q
  defp where_in(q, :lang, values), do: from(w in q, where: w.lang in ^values)
  defp where_in(q, :base_lang, values), do: from(w in q, where: w.base_lang in ^values)

  @doc "Active words, newest first, optionally in some languages (the bot's /list)."
  def recent(limit \\ 15, langs \\ nil) do
    from(w in live(),
      where: w.status == "active",
      order_by: [desc: w.updated_at, desc: w.id],
      limit: ^limit
    )
    |> where_in(:lang, langs)
    |> Repo.all()
  end

  def count_active,
    do: Repo.aggregate(from(w in live(), where: w.status == "active"), :count)

  @doc "Every language with active words: [%{lang, count}], biggest first."
  def languages do
    from(w in live(),
      where: w.status == "active",
      group_by: w.lang,
      select: %{lang: w.lang, count: count(w.id)},
      order_by: [desc: count(w.id)]
    )
    |> Repo.all()
  end

  @doc "Languages of the most recently touched words, newest first. Hints for the model."
  def recent_languages(limit \\ 5) do
    from(w in live(),
      group_by: w.lang,
      select: %{lang: w.lang},
      order_by: [desc: max(w.updated_at)],
      limit: ^limit
    )
    |> Repo.all()
  end

  @doc """
  The stored language tags a learner means by `term`: a code, an endonym or a name in any
  shipped locale ("cantonese", "cantonés", "粵語", "yue"), matched on the primary language
  so "chinese" finds zh and zh-Hant words (slice 08 section 5).
  """
  def langs_matching(term) do
    wanted = Lang.find(term)

    languages()
    |> Enum.map(& &1.lang)
    |> Enum.filter(
      &(Lang.primary(&1) in wanted or String.downcase(&1) == String.downcase(String.trim(term)))
    )
  end

  @doc """
  Live words matching a term by native form, romanization or gloss.
  Done in Elixir because SQLite's lower() only folds ASCII, not Cyrillic.
  """
  def find(term) do
    t = term |> String.trim() |> String.downcase()

    Repo.all(live())
    |> Enum.filter(fn w ->
      Enum.any?([w.native, w.romanization, w.gloss], &(&1 && String.downcase(&1) == t))
    end)
  end

  # ── writes ───────────────────────────────────────────────────────────

  @doc """
  Saves a validated word (`Kotiko.WordSpec`): inserts it, or merges it into
  the live word with the same natural key (`Kotiko.WordMerge`). Returns
  `{:ok, %{result: :created | :updated | :unchanged, word: word, previous: word | nil}}`.

  Options: `:explicit` (the learner's own add: un-pauses a paused word), `:now`.
  """
  def add(attrs, opts \\ []) do
    transaction(fn -> do_add(attrs, opts, true) end)
  end

  defp do_add(attrs, opts, retry?) do
    now = opts[:now] || now()

    case get_by_key(attrs.lang, attrs.native, attrs[:sense] || "", attrs.base_lang) do
      nil -> insert(attrs, now, opts, retry?)
      word -> merge(word, attrs, now, opts)
    end
  end

  defp insert(attrs, now, opts, retry?) do
    fields =
      attrs
      |> Map.take(~w(lang native base_lang sense gloss forms romanization native_vocalized
                     pronunciation pronunciation_careful pronunciation_source note status
                     origin source_text)a)
      |> Map.merge(%{
        uuid: new_uuid(attrs[:id], now),
        native_key: Text.native_key(attrs.native),
        sense: attrs[:sense] || "",
        status: attrs[:status] || "active",
        origin: attrs[:origin] || "add",
        created_at: now,
        updated_at: now,
        seq: next_seq()
      })

    %Word{}
    |> Ecto.Changeset.change(fields)
    |> Ecto.Changeset.unique_constraint(:native_key, name: @natural_index)
    |> Repo.insert()
    |> case do
      {:ok, word} ->
        {:ok, %{result: :created, word: word, previous: nil}}

      # A backstop: with immediate transactions another writer can't get in between,
      # but if one does, merge into its row once instead of failing.
      {:error, %Ecto.Changeset{}} when retry? ->
        do_add(attrs, opts, false)

      {:error, changeset} ->
        {:error, {:invalid, changeset.errors}}
    end
  end

  defp merge(word, attrs, now, opts) do
    case WordMerge.changes(Map.from_struct(word), attrs, opts) do
      changes when changes == %{} ->
        {:ok, %{result: :unchanged, word: word, previous: nil}}

      changes ->
        {:ok, updated} = write(word, changes, now)
        {:ok, %{result: :updated, word: updated, previous: word}}
    end
  end

  # The client's id when it is a valid UUID no row has; else a new UUIDv7.
  defp new_uuid(id, now) do
    if is_binary(id) and UUID7.valid?(id) and
         not Repo.exists?(from w in Word, where: w.uuid == ^id),
       do: id,
       else: UUID7.generate(now)
  end

  @doc """
  An explicit edit (slice 07 section 4): every field in `patch` (from
  `Kotiko.WordSpec.patch/1`) is set; `nil` clears a nullable field; `forms` replaces the
  list. Options: `:if_updated_at` (a `DateTime`; a mismatch is `{:error, {:stale, word}}`),
  `:now`.

  Setting `pronunciation` or `pronunciation_careful` makes `pronunciation_source` "user"
  unless the patch names it; clearing `pronunciation` clears the other two. Errors:
  `:not_found`, `:deleted`, `{:stale, word}`, `{:conflict, other_uuid}`,
  `{:invalid, %{field, reason}}`.
  """
  def update(uuid, patch, opts \\ []) do
    transaction(fn ->
      with {:ok, word} <- fetch_live(uuid),
           :ok <- fresh(word, opts[:if_updated_at]),
           {:ok, changes} <- patch_changes(word, patch, opts),
           :ok <- key_free(word, changes) do
        if changes == %{},
          do: {:ok, word},
          else: write(word, changes, opts[:now] || now())
      end
    end)
  end

  defp fetch_live(uuid) do
    case get(uuid) do
      nil -> {:error, :not_found}
      %Word{status: "pending"} -> {:error, :not_found}
      %Word{deleted_at: nil} = w -> {:ok, w}
      %Word{} -> {:error, :deleted}
    end
  end

  defp fresh(_word, nil), do: :ok

  defp fresh(word, %DateTime{} = expected) do
    if same_ms?(word.updated_at, expected), do: :ok, else: {:error, {:stale, word}}
  end

  defp same_ms?(a, b),
    do:
      DateTime.compare(DateTime.truncate(a, :millisecond), DateTime.truncate(b, :millisecond)) ==
        :eq

  defp patch_changes(word, patch, opts) do
    patch = pronunciation_patch(patch)

    changes =
      patch
      |> Enum.reject(fn {k, v} -> Map.get(word, k) == v end)
      |> Map.new()

    changes =
      if Map.has_key?(changes, :native),
        do: Map.put(changes, :native_key, Text.native_key(changes.native)),
        else: changes

    after_patch = word |> Map.from_struct() |> Map.merge(changes)

    script =
      if Map.has_key?(changes, :lang) or Map.has_key?(changes, :native),
        do: Lang.check_script(after_patch.lang, after_patch.native),
        else: {:ok, after_patch.lang}

    cond do
      Lang.same_base?(after_patch.lang, after_patch.base_lang) ->
        {:error, {:invalid, %{field: "lang", reason: "target_is_base"}}}

      script == {:error, :script_mismatch} ->
        {:error, {:invalid, %{field: "lang", reason: "script_mismatch"}}}

      script != {:ok, after_patch.lang} ->
        {:ok, tag} = script
        patch_changes(word, Map.put(patch, :lang, tag), opts)

      opts[:skip_pronunciation_check] ->
        {:ok, changes}

      # Only the fields the patch sets are checked: fixing a typo in `native` is never
      # refused because of a pronunciation saved earlier.
      Enum.any?(
        ~w(pronunciation pronunciation_careful native_vocalized)a,
        &Map.has_key?(patch, &1)
      ) ->
        case WordSpec.check_pronunciation(after_patch, Map.keys(patch)) do
          :ok -> {:ok, changes}
          {:error, e} -> {:error, {:invalid, e}}
        end

      true ->
        {:ok, changes}
    end
  end

  defp pronunciation_patch(patch) do
    cond do
      Map.has_key?(patch, :pronunciation) and is_nil(patch.pronunciation) ->
        Map.merge(patch, %{pronunciation_careful: nil, pronunciation_source: nil})

      (Map.has_key?(patch, :pronunciation) or Map.has_key?(patch, :pronunciation_careful)) and
          not Map.has_key?(patch, :pronunciation_source) ->
        Map.put(patch, :pronunciation_source, "user")

      true ->
        patch
    end
  end

  defp key_free(word, changes) do
    if Enum.any?([:lang, :native, :native_key, :sense], &Map.has_key?(changes, &1)) do
      merged = word |> Map.from_struct() |> Map.merge(changes)

      case get_by_key(merged.lang, merged.native, merged.sense, merged.base_lang) do
        %Word{id: id} when id == word.id -> :ok
        %Word{uuid: other} -> {:error, {:conflict, other}}
        nil -> :ok
      end
    else
      :ok
    end
  end

  @doc """
  Tombstones a word: `deleted_at = updated_at = now`. Its content stays for 30 days so
  `restore/2` can bring it back. Deleting a tombstone changes nothing.
  """
  def delete(word_or_uuid, opts \\ [])

  def delete(%Word{uuid: uuid}, opts), do: delete(uuid, opts)

  def delete(uuid, opts) do
    transaction(fn ->
      case get(uuid) do
        nil ->
          {:error, :not_found}

        %Word{deleted_at: nil} = w ->
          at = later(opts[:now] || now(), w.updated_at)
          write(w, %{deleted_at: at}, at)

        w ->
          {:ok, w}
      end
    end)
  end

  @doc """
  Undoes a delete, if no live word took the natural key since (`{:error, {:conflict,
  other_uuid}}`) and the tombstone hasn't been scrubbed (`{:error, :scrubbed}`, after 30
  days). Restoring a live word changes nothing.
  """
  def restore(uuid, opts \\ []) do
    now = opts[:now] || now()

    transaction(fn ->
      case get(uuid) do
        nil ->
          {:error, :not_found}

        %Word{deleted_at: nil} = w ->
          {:ok, w}

        w ->
          cond do
            Word.scrubbed?(w) or older_than?(w.deleted_at, now, @restore_days) ->
              {:error, :scrubbed}

            other = get_by_key(w.lang, w.native, w.sense, w.base_lang) ->
              {:error, {:conflict, other.uuid}}

            true ->
              write(w, %{deleted_at: nil, merged_into: nil}, now)
          end
      end
    end)
  end

  @doc "Makes a word active (the bot's Add button)."
  def activate(%Word{} = w), do: transaction(fn -> write(w, %{status: "active"}, now()) end)

  # One change to one row: a new seq, and an updated_at later than the last one.
  defp write(word, changes, now) do
    word
    |> Ecto.Changeset.change(
      Map.merge(changes, %{updated_at: later(now, word.updated_at), seq: next_seq()})
    )
    |> Repo.update()
  end

  defp next_seq do
    %{rows: [[seq]]} =
      Repo.query!("UPDATE sync_state SET last_seq = last_seq + 1 WHERE id = 1 RETURNING last_seq")

    seq
  end

  # updated_at only moves forward, by at least a millisecond, so if_updated_at always
  # sees a change.
  defp later(now, nil), do: now

  defp later(now, prev) do
    if DateTime.compare(now, prev) == :gt, do: now, else: DateTime.add(prev, 1, :millisecond)
  end

  @doc """
  Runs `fun` in one immediate transaction, queued behind other writes of this server
  (`Kotiko.WriteLock`). `fun` returns `{:ok, value}` or `{:error, reason}`; so does this.
  Nested calls join the outer transaction.
  """
  def transaction(fun) do
    Kotiko.WriteLock.run(fn ->
      case Repo.transaction(fun) do
        {:ok, result} -> result
        {:error, _} = e -> e
      end
    end)
  end

  @doc "Now, in UTC, to the millisecond (the precision of the wire format)."
  def now do
    %DateTime{} = dt = DateTime.utc_now()
    {us, _} = dt.microsecond
    %{dt | microsecond: {div(us, 1000) * 1000, 6}}
  end

  # ── tombstone lifecycle (Kotiko.Janitor) ─────────────────────────────

  @doc """
  Clears the content of tombstones deleted more than 30 days before `now`: they can't be
  restored after that. `native_key` becomes the uuid, so it stays unique and meaningless.
  Returns the number scrubbed.
  """
  def scrub_tombstones(now \\ now()) do
    cutoff = DateTime.add(now, -@restore_days, :day)

    query =
      from(w in Word,
        where: not is_nil(w.deleted_at) and w.deleted_at < ^cutoff and w.native_key != w.uuid,
        update: [
          set: [
            native: "",
            native_key: w.uuid,
            romanization: nil,
            native_vocalized: nil,
            pronunciation: nil,
            pronunciation_careful: nil,
            pronunciation_source: nil,
            gloss: "",
            note: nil,
            source_text: nil,
            forms: ^[]
          ]
        ]
      )

    {:ok, n} = transaction(fn -> {:ok, query |> Repo.update_all([]) |> elem(0)} end)
    n
  end

  @doc """
  Removes tombstones deleted more than 180 days before `now` and records the highest
  removed `seq` as `purged_through_seq` (slice 39 sends older cursors to a full resync).
  Returns the number removed.
  """
  def purge_tombstones(now \\ now()) do
    cutoff = DateTime.add(now, -@purge_days, :day)
    old = from(w in Word, where: not is_nil(w.deleted_at) and w.deleted_at < ^cutoff)

    transaction(fn ->
      case Repo.one(from w in old, select: max(w.seq)) do
        nil ->
          {:ok, 0}

        max_seq ->
          {n, _} = Repo.delete_all(old)

          Repo.query!(
            "UPDATE sync_state SET purged_through_seq = max(purged_through_seq, ?) WHERE id = 1",
            [max_seq]
          )

          {:ok, n}
      end
    end)
    |> elem(1)
  end

  @doc "The live words of `uuids`, in any order."
  def get_many(uuids), do: Repo.all(from w in live(), where: w.uuid in ^uuids)

  @doc false
  def older_than?(%DateTime{} = at, now, days),
    do: DateTime.compare(at, DateTime.add(now, -days, :day)) == :lt
end
