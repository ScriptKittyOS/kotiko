# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Janitor do
  @moduledoc """
  Daily cleanup (slice 07 section 4): 5 minutes after boot and then every 24 hours.

    * tombstones older than 30 days lose their content (they can't be restored after that)
    * tombstones older than 180 days are removed
    * kept add responses (`client_request_id`) older than 24 hours are removed

  Slices 10 and 41 add their own cleanup steps to `run/1`.
  """
  use GenServer
  require Logger
  alias Kotiko.{AddRequests, Words}

  @first_run :timer.minutes(5)
  @every :timer.hours(24)

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @impl true
  def init(_opts) do
    Process.send_after(self(), :run, @first_run)
    {:ok, nil}
  end

  @impl true
  def handle_info(:run, state) do
    try do
      run()
    rescue
      e -> Logger.error("Daily cleanup failed: #{Exception.message(e)}")
    end

    Process.send_after(self(), :run, @every)
    {:noreply, state}
  end

  @doc "One cleanup pass at `now`. Returns what it did."
  def run(now \\ Words.now()) do
    result = %{
      scrubbed: Words.scrub_tombstones(now),
      purged: Words.purge_tombstones(now),
      add_requests: AddRequests.purge(now)
    }

    if result.scrubbed + result.purged > 0 do
      Logger.info(
        "Daily cleanup: cleared #{result.scrubbed} word(s) deleted over 30 days ago and " <>
          "removed #{result.purged} deleted over 180 days ago."
      )
    end

    result
  end
end
