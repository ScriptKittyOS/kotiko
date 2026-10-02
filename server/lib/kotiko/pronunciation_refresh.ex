# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.PronunciationRefresh do
  @moduledoc """
  The one-time job that gives saved words a pronunciation (slice 07 section 8).

  The v2 migration creates its state, a `maintenance_jobs` row named
  `pronunciation_refresh`: `running` when there were words, `done` on a new install. The
  job then asks the model for up to 20 words at a time (grouped by target word, so one
  request covers every base of a word), checks each answer and writes only
  `pronunciation`, `pronunciation_careful`, `pronunciation_source: "model"` and a missing
  `native_vocalized`, through `Kotiko.Words.update/3` with the `updated_at` read before
  the request, so a word the learner edits meanwhile is left alone. It runs one request
  at a time and only while no lookup for the learner is waiting. A word whose answer is
  missing or invalid twice is skipped. Once no word is left, the state is `done` and the
  job never starts again: new words get their pronunciation when they are added.

  Until slice 10 ships, quota is unknown unless `:llm_quota` is set (a function returning
  `{remaining, resets_at}`, used by the tests); a 429 waits a minute, a daily limit until
  the next UTC midnight.
  """
  use GenServer
  import Ecto.Query
  require Logger
  alias Kotiko.{Config, LLM, Lookup, Pronunciation, Repo, Text, Word, Words}

  @job "pronunciation_refresh"
  @batch 20
  @max_attempts 2
  @keep_quota 10

  # ── the API (GET and POST /api/v1/jobs/pronunciation-refresh) ────────

  @doc "The job's state: %{state, done, total} plus retry_at while waiting."
  def status do
    case load() do
      nil -> %{state: "done", done: 0, total: 0}
      job -> public(job)
    end
  end

  @doc "Pauses or resumes the job (`:pause` or `:resume`) and returns `status/0`."
  def control(action) do
    case {action, load()} do
      {:pause, %{state: s}} when s in ["running", "waiting"] ->
        save(%{state: "paused"})

      {:resume, %{state: "paused"}} ->
        save(%{state: "running", retry_at: nil})
        if pid = Process.whereis(__MODULE__), do: send(pid, :tick)

      _ ->
        :ok
    end

    status()
  end

  defp public(job) do
    base = %{state: job.state, done: job.done, total: job.total}

    if job.state == "waiting",
      do: Map.put(base, :retry_at, Word.timestamp(job.retry_at)),
      else: base
  end

  # ── the process ──────────────────────────────────────────────────────

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @impl true
  def init(opts) do
    Process.send_after(self(), :tick, Keyword.get(opts, :first_run, :timer.minutes(1)))
    {:ok, %{gap: Keyword.get(opts, :gap, :timer.seconds(5)), timer: nil}}
  end

  @impl true
  def handle_info(:tick, state) do
    if state.timer, do: Process.cancel_timer(state.timer)

    result =
      try do
        step()
      rescue
        e ->
          Logger.error("Pronunciation refresh failed: #{Exception.message(e)}")
          {:wait, nil}
      end

    {:noreply, %{state | timer: schedule(result, state.gap)}}
  end

  defp schedule(:done, _gap), do: nil
  defp schedule(:paused, _gap), do: nil
  defp schedule({:continue, _}, gap), do: Process.send_after(self(), :tick, gap)
  defp schedule(:busy, _gap), do: Process.send_after(self(), :tick, :timer.seconds(10))
  defp schedule({:wait, nil}, _gap), do: Process.send_after(self(), :tick, :timer.hours(1))

  defp schedule({:wait, %DateTime{} = at}, _gap) do
    ms = max(DateTime.diff(at, DateTime.utc_now(), :millisecond), 1_000)
    Process.send_after(self(), :tick, ms)
  end

  # ── one step ─────────────────────────────────────────────────────────

  @doc """
  Does at most one request. Returns `:done`, `:paused`, `:busy` (a lookup for the learner
  is running), `{:wait, retry_at | nil}` or `{:continue, written}`. `opts[:now]` sets the
  clock.
  """
  def step(opts \\ []) do
    now = opts[:now] || Words.now()
    job = load()

    cond do
      is_nil(job) or job.state == "done" -> :done
      job.state == "paused" -> :paused
      job.state == "waiting" and later?(job.retry_at, now) -> {:wait, job.retry_at}
      Lookup.busy?() -> :busy
      not provider?() -> wait(nil)
      low = quota_low(now) -> wait(low)
      true -> batch(job, now)
    end
  end

  defp later?(nil, _now), do: false
  defp later?(at, now), do: DateTime.compare(at, now) == :gt

  defp provider? do
    Application.get_env(:kotiko, :llm_api_key) != nil or
      not Config.openrouter?(Application.fetch_env!(:kotiko, :llm_url))
  end

  # Keeps the last free lookups of the day for the learner (slice 10 section 3).
  defp quota_low(now) do
    case Application.get_env(:kotiko, :llm_quota) do
      fun when is_function(fun, 0) ->
        case fun.() do
          {remaining, resets_at} when remaining <= @keep_quota -> resets_at || next_midnight(now)
          _ -> nil
        end

      _ ->
        nil
    end
  end

  defp wait(retry_at) do
    save(%{state: "waiting", retry_at: retry_at})
    {:wait, retry_at}
  end

  defp batch(job, now) do
    case eligible(job.attempts) do
      [] ->
        save(%{state: "done", retry_at: nil, finished_at: now})
        Logger.info("Pronunciations added to your saved words (#{job.done} words).")
        :done

      words ->
        groups = words |> Enum.group_by(&{&1.lang, &1.native_key, &1.sense}) |> Map.values()

        groups =
          groups |> Enum.sort_by(&Enum.min_by(&1, fn w -> w.seq end).seq) |> Enum.take(@batch)

        request(job, groups, now)
    end
  end

  defp request(job, groups, now) do
    items =
      Enum.map(groups, fn [w | _] = records ->
        %{
          lang: w.lang,
          native: w.native,
          sense: w.sense,
          base_langs: Enum.map(records, & &1.base_lang)
        }
      end)

    case LLM.respell(items) do
      {:ok, answers} ->
        {written, failed} = write(List.flatten(groups), answers)
        attempts = Enum.reduce(failed, job.attempts, &Map.update(&2, &1, 1, fn n -> n + 1 end))
        done = job.done + written

        save(%{
          state: "running",
          retry_at: nil,
          done: done,
          total: done + length(eligible(attempts)),
          attempts: attempts
        })

        {:continue, written}

      {:error, :rate_limited} ->
        wait(DateTime.add(now, 1, :minute))

      {:error, :quota_exhausted} ->
        wait(next_midnight(now))

      {:error, {:failed, reason}} ->
        Logger.warning("Pronunciation refresh: #{reason}; trying again in 5 minutes")
        wait(DateTime.add(now, 5, :minute))
    end
  end

  # Returns {written, uuids of words whose answer was missing or invalid}.
  defp write(records, answers) do
    Enum.reduce(records, {0, []}, fn w, {written, failed} ->
      case write_one(w, answer_for(w, answers)) do
        :written -> {written + 1, failed}
        # Edited meanwhile (by the learner or a re-add): left alone.
        :stale -> {written, failed}
        :failed -> {written, [w.uuid | failed]}
      end
    end)
  end

  defp write_one(_w, nil), do: :failed

  defp write_one(w, answer) do
    case Pronunciation.check(answer) do
      {%{pronunciation: p} = checked, _dropped} when is_binary(p) ->
        case Words.update(w.uuid, patch(w, checked), if_updated_at: w.updated_at) do
          {:ok, _} -> :written
          {:error, _} -> :stale
        end

      _ ->
        :failed
    end
  end

  # Only the pronunciation fields, and native_vocalized when the word has none.
  defp patch(w, checked) do
    patch = %{
      pronunciation: checked.pronunciation,
      pronunciation_careful: checked.pronunciation_careful,
      pronunciation_source: "model"
    }

    if is_nil(w.native_vocalized) and checked.native_vocalized,
      do: Map.put(patch, :native_vocalized, checked.native_vocalized),
      else: patch
  end

  defp answer_for(w, answers) do
    key = Text.native_key(w.native)

    Enum.find_value(answers, fn a ->
      native = Text.clean(a["native"])

      if is_binary(native) and Text.native_key(native) == key and
           Word.normalize_lang(a["lang"]) == w.lang and
           Word.normalize_base(a["base_lang"]) == w.base_lang do
        %{
          lang: w.lang,
          native: w.native,
          base_lang: w.base_lang,
          pronunciation: Text.clean(a["pronunciation"]),
          pronunciation_careful: Text.clean(a["pronunciation_careful"]),
          native_vocalized: Text.clean(a["native_vocalized"]),
          pronunciation_source: "model"
        }
      end
    end)
  end

  @doc "Live saved words still without a pronunciation, for bases with a respelling key."
  def eligible(attempts \\ %{}) do
    skipped = for {uuid, n} <- attempts, n >= @max_attempts, do: uuid

    from(w in Word,
      where:
        is_nil(w.deleted_at) and w.status != "pending" and
          (is_nil(w.pronunciation) or w.pronunciation == "") and
          w.base_lang in ^Pronunciation.bases_with_key() and w.uuid not in ^skipped,
      order_by: w.seq
    )
    |> Repo.all()
  end

  defp next_midnight(now) do
    now |> DateTime.to_date() |> Date.add(1) |> DateTime.new!(~T[00:00:00.000000], "Etc/UTC")
  end

  # ── the state row ────────────────────────────────────────────────────

  defp load do
    from(j in "maintenance_jobs",
      where: j.name == @job,
      select: %{
        state: j.state,
        done: j.done,
        total: j.total,
        attempts: j.attempts,
        retry_at: j.retry_at
      }
    )
    |> Repo.one()
    |> case do
      nil -> nil
      job -> %{job | attempts: Jason.decode!(job.attempts), retry_at: parse(job.retry_at)}
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
