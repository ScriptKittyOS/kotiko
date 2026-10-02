# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.LLM.Cache do
  @moduledoc """
  Repeated lookups are free (slice 10 section 4).

  **Key**: SHA-256 of the spec version, the prompt's hash, the mode, `hint_lang`, the
  recent-language list, the base languages **in order** (the primary base picks the
  examples) and the input text after NFC, trimming, collapsing whitespace and lowercasing
  in the primary base's locale (`key/1`).

  **Value**: `Kotiko.WordSpec.process/2`'s checked result, never the raw answer, and only
  for results with words (no-word results, errors and chat replies are never kept). Rows
  live 30 days in `lookup_cache`; the daily `Kotiko.Janitor` removes older ones and keeps
  the 5,000 hit most recently.

  **Single flight**: identical lookups at the same time share one model call
  (`run/3`); the process only keeps who is waiting for which key.
  """
  use GenServer
  import Ecto.Query
  require Logger
  alias Kotiko.{Repo, Spec, Word, WordSpec, Words}

  @prompt_hash :crypto.hash(:sha256, Spec.prompt_text()) |> Base.encode16(case: :lower)

  # ── keys ─────────────────────────────────────────────────────────────

  @doc """
  The cache key of a request: `%{text, mode, hint_lang, recent, base_langs}`.
  """
  def key(req) do
    bases = req.base_langs
    text = normalize(req.text, List.first(bases))

    [
      Spec.version(),
      @prompt_hash,
      req.mode,
      req[:hint_lang],
      req[:recent] || [],
      bases,
      text
    ]
    |> Jason.encode!()
    |> then(&:crypto.hash(:sha256, &1))
    |> Base.encode16(case: :lower)
  end

  @doc "The input text as the key sees it: NFC, trimmed, single spaces, lowercase in `base`'s locale."
  def normalize(text, base) do
    text
    |> String.normalize(:nfc)
    |> String.trim()
    |> String.replace(~r/\s+/u, " ")
    |> WordSpec.fold(base)
  end

  # ── reads and writes ─────────────────────────────────────────────────

  @doc "The kept result for `key`, if it is younger than 30 days: `{:ok, result}` or `:miss`."
  def get(key, now \\ Words.now()) do
    cutoff = now |> DateTime.add(-ttl_days(), :day) |> Word.timestamp()

    row =
      Repo.one(
        from c in "lookup_cache",
          where: c.key == ^key and c.inserted_at > ^cutoff,
          select: c.result
      )

    case row && decode(row) do
      nil ->
        :miss

      result ->
        touch(key, now)
        {:ok, result}
    end
  rescue
    e ->
      Logger.debug("Lookup cache unavailable: #{Exception.message(e)}")
      :miss
  end

  @doc "Keeps `result` for `key` when it found words. Never raises."
  def put(key, result, model, now \\ Words.now())

  def put(key, %{words: [_ | _]} = result, model, now) do
    at = Word.timestamp(now)

    row = %{
      key: key,
      result: encode(result),
      model: model,
      inserted_at: at,
      last_hit_at: at,
      hits: 0
    }

    Words.transaction(fn ->
      Repo.insert_all("lookup_cache", [row],
        on_conflict: {:replace, [:result, :model, :inserted_at, :last_hit_at]},
        conflict_target: :key
      )

      {:ok, :ok}
    end)

    :ok
  rescue
    e ->
      Logger.debug("Couldn't keep a lookup: #{Exception.message(e)}")
      :ok
  end

  def put(_key, _result, _model, _now), do: :ok

  defp touch(key, now) do
    Words.transaction(fn ->
      Repo.update_all(from(c in "lookup_cache", where: c.key == ^key),
        set: [last_hit_at: Word.timestamp(now)],
        inc: [hits: 1]
      )

      {:ok, :ok}
    end)
  end

  @doc """
  The daily cleanup: removes entries older than 30 days, then all but the 5,000 hit most
  recently. Returns how many it removed.
  """
  def prune(now \\ Words.now()) do
    cutoff = now |> DateTime.add(-ttl_days(), :day) |> Word.timestamp()
    max = Spec.llm_policy(:cache)["max_entries"]

    {:ok, n} =
      Words.transaction(fn ->
        {old, _} = Repo.delete_all(from c in "lookup_cache", where: c.inserted_at <= ^cutoff)

        keep =
          from c in "lookup_cache",
            order_by: [desc: c.last_hit_at, desc: c.inserted_at],
            limit: ^max,
            select: c.key

        {extra, _} = Repo.delete_all(from c in "lookup_cache", where: c.key not in subquery(keep))
        {:ok, old + extra}
      end)

    n
  end

  @doc "Removes every entry (slice 12's delete-all)."
  def clear do
    {:ok, n} = Words.transaction(fn -> {:ok, elem(Repo.delete_all("lookup_cache"), 0)} end)
    n
  end

  @doc "How many entries there are."
  def count, do: Repo.aggregate("lookup_cache", :count)

  # The checked result is an Elixir map with atom keys; term_to_binary keeps it exactly.
  defp encode(result), do: result |> :erlang.term_to_binary() |> Base.encode64()

  defp decode(text) do
    with {:ok, bin} <- Base.decode64(text),
         %{words: [_ | _]} = result <- :erlang.binary_to_term(bin, [:safe]) do
      result
    else
      _ -> nil
    end
  rescue
    _ -> nil
  end

  defp ttl_days, do: Spec.llm_policy(:cache)["ttl_days"]

  # ── single flight ────────────────────────────────────────────────────

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @doc """
  Runs `fun` once for concurrent callers with the same `key`: the first caller runs it and
  gets its result; the others wait (at most `wait_ms`) and get `{:shared, result}`. A
  waiter whose leader died runs `fun` itself; one that waited too long gets
  `{:error, :wait_timeout}`.
  """
  def run(key, wait_ms, fun) do
    case GenServer.call(__MODULE__, {:join, key}) do
      :leader ->
        try do
          result = fun.()
          GenServer.cast(__MODULE__, {:finish, key, {:result, result}})
          result
        catch
          kind, reason ->
            GenServer.cast(__MODULE__, {:finish, key, :retry})
            :erlang.raise(kind, reason, __STACKTRACE__)
        end

      {:wait, ref} ->
        receive do
          {^ref, {:result, result}} -> {:shared, result}
          {^ref, :retry} -> fun.()
        after
          max(wait_ms, 0) ->
            GenServer.cast(__MODULE__, {:leave, key, ref})
            {:error, :wait_timeout}
        end
    end
  end

  @impl true
  def init(_opts), do: {:ok, %{flights: %{}, monitors: %{}}}

  @impl true
  def handle_call({:join, key}, {pid, _tag}, state) do
    case state.flights do
      %{^key => flight} ->
        ref = make_ref()
        flights = Map.put(state.flights, key, %{flight | waiters: [{pid, ref} | flight.waiters]})
        {:reply, {:wait, ref}, %{state | flights: flights}}

      _ ->
        mon = Process.monitor(pid)
        flights = Map.put(state.flights, key, %{leader: mon, waiters: []})

        {:reply, :leader,
         %{state | flights: flights, monitors: Map.put(state.monitors, mon, key)}}
    end
  end

  @impl true
  def handle_cast({:finish, key, message}, state), do: {:noreply, finish(state, key, message)}

  def handle_cast({:leave, key, ref}, state) do
    flights =
      case state.flights do
        %{^key => f} ->
          Map.put(state.flights, key, %{
            f
            | waiters: Enum.reject(f.waiters, &(elem(&1, 1) == ref))
          })

        _ ->
          state.flights
      end

    {:noreply, %{state | flights: flights}}
  end

  @impl true
  def handle_info({:DOWN, mon, :process, _pid, _reason}, state) do
    case state.monitors do
      %{^mon => key} -> {:noreply, finish(state, key, :retry)}
      _ -> {:noreply, state}
    end
  end

  defp finish(state, key, message) do
    case Map.pop(state.flights, key) do
      {nil, _} ->
        state

      {flight, flights} ->
        Process.demonitor(flight.leader, [:flush])
        for {pid, ref} <- flight.waiters, do: send(pid, {ref, message})
        %{state | flights: flights, monitors: Map.delete(state.monitors, flight.leader)}
    end
  end
end
