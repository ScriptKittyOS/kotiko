# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.BackgroundJobsTest do
  # The background processes around the job steps the other tests call directly: each
  # one runs a step when its timer fires, survives a step that raises, and schedules the
  # next step from the result. config/test.exs doesn't start them; each test starts its
  # own, with the first timer far away, and fires the timer itself.
  use Kotiko.DataCase, async: false
  import ExUnit.CaptureLog
  alias Kotiko.{Janitor, PronunciationRefresh, WiktionaryPass}

  # Fires `msg` in the process and waits until it has been handled.
  defp fire(pid, msg) do
    send(pid, msg)
    :sys.get_state(pid)
  end

  defp next_in(%{timer: nil}), do: nil
  defp next_in(%{timer: ref}), do: Process.read_timer(ref)

  defp job_row(name, fields) do
    sets = Enum.map_join(fields, ", ", fn {k, _} -> "#{k} = ?" end)

    Repo.query!(
      "UPDATE maintenance_jobs SET #{sets} WHERE name = ?",
      Keyword.values(fields) ++ [name]
    )
  end

  defp ensure_job(name) do
    Repo.query!(
      "INSERT OR IGNORE INTO maintenance_jobs (name, state, done, total, attempts) " <>
        "VALUES (?, 'running', 0, 0, '{}')",
      [name]
    )
  end

  describe "Janitor" do
    test "a run clears old tombstones and the process keeps going" do
      pid = start_supervised!(Janitor)
      word = word_fixture()
      {:ok, _} = Words.delete(word)
      long_ago = Word.timestamp(DateTime.add(Words.now(), -200, :day))
      Repo.query!("UPDATE words SET deleted_at = ? WHERE id = ?", [long_ago, word.id])

      # The summary is an info line; the test config logs warnings and up.
      level = Logger.level()
      Logger.configure(level: :info)
      on_exit(fn -> Logger.configure(level: level) end)
      log = capture_log(fn -> fire(pid, :run) end)

      assert Repo.get(Word, word.id) == nil
      assert log =~ "removed 1 deleted over 180 days ago"
      assert Process.alive?(pid)
    end

    test "run/0 cleans up as of now" do
      assert %{scrubbed: 0, purged: 0, add_requests: _, lookup_cache: _} = Janitor.run()
    end
  end

  describe "WiktionaryPass" do
    setup do
      ensure_job("wiktionary_pronunciations")
      :ok
    end

    test "with no word left it is done and looks again in six hours" do
      pid = start_supervised!({WiktionaryPass, first_run: :timer.hours(1)})
      state = fire(pid, :tick)
      assert_in_delta next_in(state), :timer.hours(6), 1_000
    end

    test "while Wikimedia asked it to wait, it waits until then" do
      at = DateTime.add(Words.now(), 120, :second)
      job_row("wiktionary_pronunciations", state: "waiting", retry_at: Word.timestamp(at))
      word_fixture()

      pid = start_supervised!({WiktionaryPass, first_run: :timer.hours(1)})
      state = fire(pid, :tick)
      assert_in_delta next_in(state), 120_000, 5_000
    end

    test "a step that raises is logged and tried again in ten minutes" do
      job_row("wiktionary_pronunciations", attempts: "not json")
      pid = start_supervised!({WiktionaryPass, first_run: :timer.hours(1)})

      log = capture_log(fn -> fire(pid, :tick) |> next_in() |> send_to_self() end)

      assert_received {:next, ms}
      assert_in_delta ms, :timer.minutes(10), 1_000
      assert log =~ "Wiktionary pronunciations failed"
      assert Process.alive?(pid)
    end
  end

  defp send_to_self(ms), do: send(self(), {:next, ms})

  describe "PronunciationRefresh" do
    test "a finished job schedules nothing more" do
      job_row("pronunciation_refresh", state: "done")
      pid = start_supervised!({PronunciationRefresh, first_run: :timer.hours(1)})
      assert next_in(fire(pid, :tick)) == nil
    end

    test "without a model key for OpenRouter it waits an hour" do
      put_app_env(:llm_api_key, nil)
      put_app_env(:llm_url, "https://openrouter.ai/api/v1")
      job_row("pronunciation_refresh", state: "running", retry_at: nil)

      pid = start_supervised!({PronunciationRefresh, first_run: :timer.hours(1)})
      assert_in_delta next_in(fire(pid, :tick)), :timer.hours(1), 1_000
      assert PronunciationRefresh.status().state == "waiting"
    end

    test "a waiting job waits until its time" do
      at = DateTime.add(Words.now(), 300, :second)
      job_row("pronunciation_refresh", state: "waiting", retry_at: Word.timestamp(at))

      pid = start_supervised!({PronunciationRefresh, first_run: :timer.hours(1)})
      assert_in_delta next_in(fire(pid, :tick)), 300_000, 5_000
      assert %{state: "waiting", retry_at: _} = PronunciationRefresh.status()
    end

    test "a step that raises is logged and tried again in an hour" do
      job_row("pronunciation_refresh", state: "running", attempts: "not json")
      pid = start_supervised!({PronunciationRefresh, first_run: :timer.hours(1)})

      log = capture_log(fn -> send_to_self(next_in(fire(pid, :tick))) end)

      assert_received {:next, ms}
      assert_in_delta ms, :timer.hours(1), 1_000
      assert log =~ "Pronunciation refresh failed"
    end

    test "resuming a paused job wakes the process" do
      job_row("pronunciation_refresh", state: "paused")
      pid = start_supervised!({PronunciationRefresh, first_run: :timer.hours(1)})
      :erlang.trace(pid, true, [:receive])

      assert %{state: "running"} = PronunciationRefresh.control(:resume)
      assert_receive {:trace, ^pid, :receive, :tick}
      # Let the step finish before the test's sandbox goes away.
      :sys.get_state(pid)
    end

    test "with no job row the status is done, with nothing to do" do
      Repo.query!("DELETE FROM maintenance_jobs WHERE name = 'pronunciation_refresh'")
      assert PronunciationRefresh.status() == %{state: "done", done: 0, total: 0}
    end
  end
end
