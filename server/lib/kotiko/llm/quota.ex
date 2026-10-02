# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.LLM.Quota do
  @moduledoc """
  How many free lookups are left today (slice 10 section 3). OpenRouter only, and only
  with a key: `GET {LLM_URL}/key` reports `data.free_model_daily_requests` (`used`,
  `limit`, `remaining`) per UTC day.

  Fetched at boot, then at most once every 5 minutes while lookups happen, and right after
  any 429. Between fetches it keeps an estimate: every attempt that got an answer other
  than a 429 takes one off `remaining` (`estimated: true`). `resets_at` is the next UTC
  midnight after the fetch; past it, the known numbers no longer count.

  `check/0` is the gate before a lookup (no model call when nothing is left), and
  `low?/1` is what background jobs ask so they stop with
  `spec/models.json`'s `reserve_for_learner` (10) lookups left for the learner's own adds.
  """
  use GenServer
  require Logger
  alias Kotiko.LLM.Client
  alias Kotiko.Spec

  # ── the API ──────────────────────────────────────────────────────────

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @doc "Whether quota is tracked: OpenRouter with a key."
  def enabled?, do: Client.openrouter?() and Client.key?()

  @doc """
  The known quota, or nil: `%{used, limit, remaining, resets_at, estimated, is_free_tier}`
  (`remaining` and `used` may be nil when OpenRouter didn't say).
  """
  def snapshot do
    if enabled?(), do: GenServer.call(__MODULE__, :snapshot), else: nil
  end

  @doc """
  The gate before a lookup: `:ok`, or `{:exhausted, resets_at}` when nothing is left
  today, so the lookup returns `quota_exhausted` without asking a model.
  """
  def check do
    case snapshot() do
      %{remaining: 0, resets_at: at} -> {:exhausted, at}
      _ -> :ok
    end
  end

  @doc """
  For background jobs: the time to wait until (the next reset) when `reserve` or fewer
  lookups are left today, else nil. Unknown quota is not low.
  """
  def low?(reserve \\ Spec.llm_policy(:quota)["reserve_for_learner"]) do
    case snapshot() do
      %{remaining: r, resets_at: at} when is_integer(r) and r <= reserve -> at
      _ -> nil
    end
  end

  @doc "One attempt got an answer that counts against the quota (anything but a 429)."
  def counted do
    if enabled?(), do: GenServer.cast(__MODULE__, :counted)
    :ok
  end

  @doc """
  Fetches `/key` in the calling process and keeps the answer. `timeout` in ms. Returns
  the snapshot, or `{:error, reason}`.
  """
  def refresh(timeout \\ Spec.llm_policy(:quota)["timeout_ms"]) do
    if enabled?() do
      case Client.get("/key", timeout) do
        {:ok, %{"data" => data}} when is_map(data) ->
          GenServer.call(__MODULE__, {:put, data, DateTime.utc_now()})

        {:ok, _} ->
          {:error, "no key data"}

        {:error, reason} ->
          Logger.debug("Couldn't read the free lookups left: #{reason}")
          {:error, reason}
      end
    else
      nil
    end
  end

  @doc """
  Refreshes when the known numbers are older than 5 minutes or from before the last
  reset. In the background unless `:llm_sync_refresh` is set (tests).
  """
  def maybe_refresh do
    if enabled?() and GenServer.call(__MODULE__, :stale?) do
      if Application.get_env(:kotiko, :llm_sync_refresh, false),
        do: refresh(),
        else: Task.Supervisor.start_child(Kotiko.TaskSup, fn -> refresh() end)
    end

    :ok
  end

  @doc "Sets the known quota from a `/key` `data` map (tests and `refresh/1`)."
  def put(data, at \\ DateTime.utc_now()), do: GenServer.call(__MODULE__, {:put, data, at})

  @doc "Forgets the known quota (tests)."
  def reset, do: GenServer.call(__MODULE__, :reset)

  # ── the process ──────────────────────────────────────────────────────

  @impl true
  def init(opts) do
    if Keyword.get(opts, :fetch, true) and enabled?(), do: send(self(), :boot_fetch)
    {:ok, %{data: nil, fetched_at: nil, resets_at: nil, estimated: false, warned_on: nil}}
  end

  @impl true
  def handle_call(:snapshot, _from, state), do: {:reply, public(state), state}

  def handle_call(:stale?, _from, state) do
    stale? =
      is_nil(state.fetched_at) or past_reset?(state) or
        DateTime.diff(DateTime.utc_now(), state.fetched_at, :millisecond) >=
          Kotiko.LLM.scaled(Spec.llm_policy(:quota)["refresh_ms"])

    {:reply, stale?, state}
  end

  def handle_call({:put, data, at}, _from, state) do
    daily = data["free_model_daily_requests"]

    known =
      if is_map(daily) do
        %{
          used: int(daily["used"]),
          limit: int(daily["limit"]),
          remaining: int(daily["remaining"]),
          is_free_tier: data["is_free_tier"]
        }
      end

    state = %{state | data: known, fetched_at: at, resets_at: next_midnight(at), estimated: false}
    state = warn_exhausted(state)
    {:reply, public(state), state}
  end

  def handle_call(:reset, _from, _state) do
    {:reply, :ok, %{data: nil, fetched_at: nil, resets_at: nil, estimated: false, warned_on: nil}}
  end

  @impl true
  def handle_cast(:counted, %{data: %{remaining: r} = d} = state) when is_integer(r) do
    if past_reset?(state) do
      {:noreply, state}
    else
      used = if is_integer(d.used), do: d.used + 1, else: d.used
      d = %{d | remaining: max(r - 1, 0), used: used}
      {:noreply, warn_exhausted(%{state | data: d, estimated: true})}
    end
  end

  def handle_cast(:counted, state), do: {:noreply, state}

  @impl true
  def handle_info(:boot_fetch, state) do
    Task.Supervisor.start_child(Kotiko.TaskSup, fn -> refresh() end)
    {:noreply, state}
  end

  # ── helpers ──────────────────────────────────────────────────────────

  defp public(%{data: nil}), do: nil

  defp public(state) do
    if past_reset?(state) do
      nil
    else
      Map.merge(state.data, %{resets_at: state.resets_at, estimated: state.estimated})
    end
  end

  defp past_reset?(%{resets_at: nil}), do: false

  defp past_reset?(%{resets_at: at}),
    do: DateTime.compare(DateTime.utc_now(), at) != :lt

  # Once a day, when the free lookups run out.
  defp warn_exhausted(%{data: %{remaining: 0}, resets_at: at} = state) do
    today = Date.utc_today()

    if state.warned_on != today do
      Logger.warning(
        "No free lookups left today; adding words with lookups works again after " <>
          "#{Calendar.strftime(at, "%H:%M")} UTC."
      )

      %{state | warned_on: today}
    else
      state
    end
  end

  defp warn_exhausted(state), do: state

  defp int(n) when is_integer(n), do: n
  defp int(n) when is_float(n), do: trunc(n)
  defp int(_), do: nil

  @doc false
  def next_midnight(%DateTime{} = at) do
    at
    |> DateTime.shift_zone!("Etc/UTC")
    |> DateTime.to_date()
    |> Date.add(1)
    |> DateTime.new!(~T[00:00:00.000], "Etc/UTC")
  end
end
