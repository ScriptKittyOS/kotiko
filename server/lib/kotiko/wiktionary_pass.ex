# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.WiktionaryPass do
  @moduledoc """
  Gives saved words their pronunciation from Wiktionary (slice 49 section 4a), once, in the
  background: words added before pronunciations came from Wiktionary, and any word whose
  page couldn't be read when it was added (offline, or Wikimedia asking Kotiko to slow
  down).

  A `maintenance_jobs` row named `wiktionary_pronunciations` holds the state; `attempts`
  maps each word's uuid to `"done"` once it has been looked at, or to the number of times
  Wiktionary couldn't be reached. One word per step, a few seconds apart, so Wikimedia is
  never hurried. A word whose page has a usable pronunciation gets it, through
  `Kotiko.Words.update/3` with the `updated_at` read before the request, so a word the
  learner edits meanwhile is left alone; the learner's own pronunciation is never
  replaced. A word Wiktionary can't help keeps the model's, and isn't asked about again.
  When Wiktionary can't be reached the job waits ten minutes; after three failures for one
  word it moves on. New words get their pronunciation when they are added, so once no word
  is left the job is done; a word whose page couldn't be read when it was added starts it
  again.
  """
  use GenServer
  import Ecto.Query
  require Logger
  alias Kotiko.{Pronounce, Repo, Spec, Word, Words}

  @job "wiktionary_pronunciations"
  @max_attempts 3

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @impl true
  def init(opts) do
    Process.send_after(self(), :tick, Keyword.get(opts, :first_run, :timer.minutes(2)))
    {:ok, %{gap: Keyword.get(opts, :gap, :timer.seconds(3)), timer: nil}}
  end

  @impl true
  def handle_info(:tick, state) do
    if state.timer, do: Process.cancel_timer(state.timer)

    result =
      try do
        step()
      rescue
        e ->
          Logger.error("Wiktionary pronunciations failed: #{Exception.message(e)}")
          {:wait, nil}
      end

    {:noreply, %{state | timer: schedule(result, state.gap)}}
  end

  defp schedule(:done, _gap), do: Process.send_after(self(), :tick, :timer.hours(6))
  defp schedule({:continue, _}, gap), do: Process.send_after(self(), :tick, gap)
  defp schedule({:wait, nil}, _gap), do: Process.send_after(self(), :tick, :timer.minutes(10))

  defp schedule({:wait, %DateTime{} = at}, _gap) do
    ms = max(DateTime.diff(at, DateTime.utc_now(), :millisecond), 1_000)
    Process.send_after(self(), :tick, ms)
  end

  @doc """
  Looks at one word. Returns `:done`, `{:wait, retry_at}` or `{:continue, word_uuid}`.
  Options: `:now`, `:fetch_page` (tests).
  """
  def step(opts \\ []) do
    now = opts[:now] || Words.now()
    job = load()

    cond do
      job.retry_at && DateTime.compare(job.retry_at, now) == :gt ->
        {:wait, job.retry_at}

      w = next(job.attempts) ->
        look(job, w, now, opts)

      true ->
        save(%{state: "done", retry_at: nil, finished_at: now})
        :done
    end
  end

  defp look(job, w, now, opts) do
    fetch = opts[:fetch_page] || (&Pronounce.fetch_page(&1, max_wait_ms: 10_000))

    case Pronounce.enrich(Map.from_struct(w), fetch_page: fetch) do
      {checked, "wiktionary"} ->
        patch =
          Map.take(checked, [
            :pronunciation,
            :pronunciation_careful,
            :pronunciation_source,
            :native_vocalized
          ])

        _ = Words.update(w.uuid, patch, if_updated_at: w.updated_at)
        done(job, w, now)

      {_, "unavailable"} ->
        n = if(is_integer(job.attempts[w.uuid]), do: job.attempts[w.uuid], else: 0) + 1
        attempts = Map.put(job.attempts, w.uuid, if(n >= @max_attempts, do: "done", else: n))
        retry = DateTime.add(now, 600, :second)
        save(%{state: "waiting", attempts: attempts, retry_at: retry})
        {:wait, retry}

      _ ->
        done(job, w, now)
    end
  end

  defp done(job, w, _now) do
    save(%{
      state: "running",
      attempts: Map.put(job.attempts, w.uuid, "done"),
      retry_at: nil,
      done: job.done + 1
    })

    {:continue, w.uuid}
  end

  # The next live word with a pronunciation that isn't the learner's or Wiktionary's, in a
  # language with lexical stress and a base whose key can write one.
  defp next(attempts) do
    stressed = stressed_langs()
    bases = bases_with_table()
    finished = for {uuid, "done"} <- attempts, do: uuid

    from(w in Word,
      where:
        is_nil(w.deleted_at) and w.status != "pending" and
          (is_nil(w.pronunciation_source) or w.pronunciation_source == "model") and
          w.uuid not in ^finished,
      order_by: w.seq
    )
    |> Repo.all()
    |> Enum.find(fn w ->
      (w.lang in stressed or primary(w.lang) in stressed) and
        (w.base_lang in bases or primary(w.base_lang) in bases)
    end)
  end

  defp primary(tag), do: tag |> String.split("-") |> hd()

  defp stressed_langs do
    kinds = Spec.wiktionary()["stress"] || []
    for {lang, f} <- Spec.pronunciation()["targets"], f["stress"] in kinds, do: lang
  end

  defp bases_with_table do
    for {base, files} <- Spec.lang_folders(), get_in(files, ["respelling", "ipa"]), do: base
  end

  # ── the state row ────────────────────────────────────────────────────

  defp load do
    query =
      from(j in "maintenance_jobs",
        where: j.name == @job,
        select: %{state: j.state, done: j.done, attempts: j.attempts, retry_at: j.retry_at}
      )

    case Repo.one(query) do
      nil ->
        Repo.insert_all("maintenance_jobs", [
          %{name: @job, state: "running", done: 0, total: 0, attempts: "{}"}
        ])

        %{state: "running", done: 0, attempts: %{}, retry_at: nil}

      job ->
        %{job | attempts: Jason.decode!(job.attempts), retry_at: parse(job.retry_at)}
    end
  end

  defp save(fields) do
    fields =
      Enum.map(fields, fn
        {:attempts, a} -> {:attempts, Jason.encode!(a)}
        {k, %DateTime{} = dt} -> {k, Word.timestamp(dt)}
        other -> other
      end)

    Words.transaction(fn ->
      {:ok, Repo.update_all(from(j in "maintenance_jobs", where: j.name == @job), set: fields)}
    end)
  end

  defp parse(nil), do: nil

  defp parse(text) do
    case DateTime.from_iso8601(text) do
      {:ok, %DateTime{microsecond: {us, _}} = dt, _} -> %{dt | microsecond: {us, 6}}
      _ -> nil
    end
  end
end
