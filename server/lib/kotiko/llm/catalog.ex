# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.LLM.Catalog do
  @moduledoc """
  Which models a lookup asks, in what order, and what each supports (slice 10 section 1).

  **The chain.** `LLM_MODEL` wins: an explicit list is used as given, in order, never
  filtered. Otherwise (OpenRouter's free models) the chain is OpenRouter's live
  `/models` list filtered for what Kotiko needs (`filter/2`), ordered by
  `spec/models.json`'s `prefer` (or `prefer_respell` for respellings) and then newest
  first; until a fetch succeeds, a cache younger than 7 days
  (`<data_dir>/models-cache.json`); without either, `spec/models.json`'s `fallback`.

  **Fetching.** Only when LLM_URL is OpenRouter: 10 s after boot (never blocking it), every
  24 hours, and when every model of a lookup answered "not found". A failed fetch keeps
  what there was and warns at most once an hour.

  **Health.** Three failures in a row skip a model for 10 minutes; "not found" skips it for
  an hour; a success moves it to the front of its chain (lookups or respellings) for an
  hour, the "what worked last" rule. An explicit LLM_MODEL list keeps its order (no
  promotion) but skips failing models too. If every model is skipped, none is.
  Health lives in memory and starts fresh on each boot.
  """
  use GenServer
  require Logger
  alias Kotiko.LLM.Client
  alias Kotiko.Spec

  @cache_file "models-cache.json"

  # ── the API ──────────────────────────────────────────────────────────

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @doc """
  The models to ask for `kind` (`:lookup` or `:respell`), best first, as
  `%{id, caps}` with `caps` `%{json_mode, reasoning_toggle, max_tokens, free}`.
  """
  def chain(kind \\ :lookup), do: GenServer.call(__MODULE__, {:chain, kind})

  @doc "Records what an attempt said about a model: `:success`, `:failure`, `:skip_long` or `:none`."
  def report(_id, _kind, :none), do: :ok
  def report(id, kind, health), do: GenServer.cast(__MODULE__, {:report, id, kind, health})

  @doc """
  Fetches `/models` now, in the calling process, and keeps the result. Returns `:ok` or
  `{:error, reason}`. Does nothing (`:ok`) when LLM_URL isn't OpenRouter.
  """
  def refresh do
    if Client.openrouter?() do
      timeout = scaled(Spec.llm_policy(:catalog)["timeout_ms"])

      case Client.get("/models", timeout) do
        {:ok, %{"data" => list}} when is_list(list) ->
          {entries, caps} = filter(list, DateTime.utc_now())
          GenServer.call(__MODULE__, {:put, entries, caps, :live, DateTime.utc_now()})

        {:ok, _other} ->
          fetch_failed("the answer had no model list")

        {:error, reason} ->
          fetch_failed(reason)
      end
    else
      :ok
    end
  end

  @doc "Starts `refresh/0` in the background."
  def refresh_async do
    Task.Supervisor.start_child(Kotiko.TaskSup, fn -> refresh() end)
    :ok
  end

  @doc """
  For `/api/v1/llm/status`: where the list came from (`env`, `live`, `cache` or
  `fallback`), when it was fetched, the lookup chain's ids and the models skipped now.
  """
  def status, do: GenServer.call(__MODULE__, :status)

  @doc "Forgets health and promotions, and with `entries: true` the fetched list (tests)."
  def reset(opts \\ []), do: GenServer.call(__MODULE__, {:reset, opts})

  @doc """
  The models of a `/models` answer Kotiko can use, and every model's capabilities.
  Returns `{entries, caps}`: `entries` are `%{id, created, caps}` that pass every rule of
  section 1 (free, text out, JSON mode, not expiring within a day, no mandatory reasoning,
  a context of at least 8,000, not denied); `caps` maps every id to its capabilities, so an
  explicit LLM_MODEL still gets them.
  """
  def filter(list, now) do
    rules = Spec.llm_policy(:catalog)
    deny = Enum.map(Spec.models()["deny"], &glob/1)

    known = for %{"id" => id} = m <- list, is_binary(id), do: {id, m}
    caps = Map.new(known, fn {id, m} -> {id, caps(m)} end)

    entries =
      for {id, m} <- known,
          caps[id].free,
          text_out?(m),
          caps[id].json_mode or "structured_outputs" in params(m),
          not expiring?(m["expiration_date"], now, rules["expiry_margin_ms"]),
          get_in(m, ["reasoning", "mandatory"]) != true,
          is_integer(m["context_length"]) and m["context_length"] >= rules["min_context_length"],
          not Enum.any?(deny, &Regex.match?(&1, id)),
          do: %{id: id, created: m["created"] || 0, caps: caps[id]}

    {entries, caps}
  end

  @doc "The capabilities Kotiko assumes for a model the catalog doesn't know."
  def default_caps(id) do
    %{
      json_mode: true,
      reasoning_toggle: Client.openrouter?(),
      max_tokens: false,
      free: String.ends_with?(id, ":free")
    }
  end

  # ── the process ──────────────────────────────────────────────────────

  @impl true
  def init(opts) do
    state = %{
      entries: nil,
      caps: %{},
      source: nil,
      fetched_at: nil,
      health: %{},
      promoted: %{}
    }

    state = load_cache(state)
    fetch? = Keyword.get(opts, :fetch, true) and Client.openrouter?()

    if fetch?,
      do: Process.send_after(self(), :fetch, Spec.llm_policy(:catalog)["first_fetch_ms"])

    {:ok, Map.put(state, :fetch?, fetch?)}
  end

  @impl true
  def handle_call({:chain, kind}, _from, state) do
    {:reply, build_chain(state, kind, now()), state}
  end

  def handle_call({:put, entries, caps, source, at}, _from, state) do
    state = %{state | entries: entries, caps: caps, source: source, fetched_at: at}
    if source == :live, do: write_cache(state)
    {:reply, :ok, state}
  end

  def handle_call(:status, _from, state) do
    t = now()
    chain = build_chain(state, :lookup, t)

    skipped =
      for {id, %{skip_until: until}} when is_integer(until) and until > t <- state.health,
          do: %{id: id, for_s: div(until - t + 999, 1000)}

    {:reply,
     %{
       source: source(state),
       fetched_at: state.fetched_at,
       models: Enum.map(chain, & &1.id),
       skipped: Enum.sort_by(skipped, & &1.id)
     }, state}
  end

  def handle_call({:reset, opts}, _from, state) do
    state = %{state | health: %{}, promoted: %{}}

    state =
      if opts[:entries],
        do: %{state | entries: nil, caps: %{}, source: nil, fetched_at: nil},
        else: state

    {:reply, :ok, state}
  end

  @impl true
  def handle_cast({:report, id, kind, health}, state) do
    {:noreply, record(state, id, kind, health, now())}
  end

  @impl true
  def handle_info(:fetch, state) do
    refresh_async()
    Process.send_after(self(), :fetch, Spec.llm_policy(:catalog)["refresh_ms"])
    {:noreply, state}
  end

  # ── the chain ────────────────────────────────────────────────────────

  defp build_chain(state, kind, t) do
    explicit? = Application.get_env(:kotiko, :llm_model_source, :env) == :env

    base =
      if explicit? do
        :kotiko
        |> Application.fetch_env!(:llm_models)
        |> Enum.map(&%{id: &1, caps: Map.get(state.caps, &1) || default_caps(&1)})
      else
        ordered(state.entries, kind) || fallback(state.caps)
      end

    healthy = Enum.reject(base, &skipped?(state, &1.id, t))
    chain = if healthy == [], do: base, else: healthy
    if explicit?, do: chain, else: promote(chain, state, kind, t)
  end

  defp ordered(nil, _kind), do: nil
  defp ordered([], _kind), do: nil

  defp ordered(entries, kind) do
    prefer = prefer(kind)
    rank = fn id -> Enum.find_index(prefer, &(&1 == id)) || length(prefer) end

    entries
    |> Enum.sort_by(&{rank.(&1.id), -&1.created, &1.id})
    |> Enum.map(&Map.take(&1, [:id, :caps]))
  end

  defp fallback(caps) do
    Enum.map(Spec.models()["fallback"], &%{id: &1, caps: Map.get(caps, &1) || default_caps(&1)})
  end

  defp prefer(:respell), do: Spec.models()["prefer_respell"]
  defp prefer(_lookup), do: Spec.models()["prefer"]

  defp skipped?(state, id, t) do
    case state.health[id] do
      %{skip_until: until} when is_integer(until) -> until > t
      _ -> false
    end
  end

  # The models that answered last move to the front, most recent first.
  defp promote(chain, state, kind, t) do
    # Monotonic time can be negative: only a recorded promotion counts.
    {front, rest} =
      Enum.split_with(chain, fn m ->
        case Map.get(state.promoted, {kind, m.id}) do
          nil -> false
          until -> until > t
        end
      end)

    Enum.sort_by(front, &(-Map.fetch!(state.promoted, {kind, &1.id}))) ++ rest
  end

  defp record(state, id, kind, :success, t) do
    promote_ms = scaled(Spec.llm_policy(:health)["promote_ms"])

    %{
      state
      | health: Map.put(state.health, id, %{failures: 0, skip_until: nil}),
        promoted: Map.put(state.promoted, {kind, id}, t + promote_ms)
    }
  end

  defp record(state, id, _kind, :failure, t) do
    rules = Spec.llm_policy(:health)
    h = Map.get(state.health, id, %{failures: 0, skip_until: nil})
    failures = h.failures + 1

    h =
      if failures >= rules["failures_to_skip"],
        do: %{failures: 0, skip_until: t + scaled(rules["skip_ms"])},
        else: %{h | failures: failures}

    %{state | health: Map.put(state.health, id, h), promoted: unpromote(state.promoted, id)}
  end

  defp record(state, id, _kind, :skip_long, t) do
    until = t + scaled(Spec.llm_policy(:health)["not_found_skip_ms"])

    %{
      state
      | health: Map.put(state.health, id, %{failures: 0, skip_until: until}),
        promoted: unpromote(state.promoted, id)
    }
  end

  defp record(state, _id, _kind, _none, _t), do: state

  defp unpromote(promoted, id), do: Map.reject(promoted, fn {{_k, m}, _} -> m == id end)

  defp source(state) do
    cond do
      Application.get_env(:kotiko, :llm_model_source, :env) == :env -> "env"
      state.entries not in [nil, []] -> to_string(state.source)
      true -> "fallback"
    end
  end

  # ── filter rules ─────────────────────────────────────────────────────

  defp caps(m) do
    p = params(m)
    pricing = m["pricing"] || %{}

    %{
      json_mode: "response_format" in p,
      reasoning_toggle: "reasoning" in p,
      max_tokens: "max_tokens" in p,
      free:
        String.ends_with?(m["id"], ":free") or
          (zero?(pricing["prompt"]) and zero?(pricing["completion"]))
    }
  end

  defp params(m), do: List.wrap(m["supported_parameters"])

  defp zero?(price), do: price in ["0", 0, "0.0"]

  # A model that says nothing about its output is taken to write text.
  defp text_out?(m) do
    case get_in(m, ["architecture", "output_modalities"]) do
      list when is_list(list) -> "text" in list
      _ -> true
    end
  end

  defp expiring?(nil, _now, _margin), do: false

  defp expiring?(date, now, margin) when is_binary(date) do
    at =
      case DateTime.from_iso8601(date) do
        {:ok, dt, _} ->
          dt

        _ ->
          case Date.from_iso8601(String.slice(date, 0, 10)) do
            {:ok, d} -> DateTime.new!(d, ~T[00:00:00], "Etc/UTC")
            _ -> nil
          end
      end

    at != nil and DateTime.diff(at, now, :millisecond) <= margin
  end

  defp expiring?(_other, _now, _margin), do: false

  defp glob(pattern) do
    pattern
    |> String.split("*")
    |> Enum.map_join(".*", &Regex.escape/1)
    |> then(&Regex.compile!("\\A" <> &1 <> "\\z", "i"))
  end

  # ── the cache file ───────────────────────────────────────────────────

  defp cache_path, do: Path.join(Application.fetch_env!(:kotiko, :data_dir), @cache_file)

  # Sobelow: a fixed file name in the configured data folder, never from a request.
  # sobelow_skip ["Traversal.FileModule"]
  defp load_cache(state) do
    with true <- Client.openrouter?(),
         {:ok, raw} <- File.read(cache_path()),
         {:ok, %{"fetched_at" => at, "entries" => entries, "caps" => caps}} <- Jason.decode(raw),
         {:ok, fetched_at, _} <- DateTime.from_iso8601(at),
         true <-
           DateTime.diff(DateTime.utc_now(), fetched_at, :millisecond) <
             Spec.llm_policy(:catalog)["cache_max_age_ms"] do
      %{
        state
        | entries: Enum.map(entries, &entry_from_json/1),
          caps: Map.new(caps, fn {id, c} -> {id, caps_from_json(c)} end),
          source: :cache,
          fetched_at: fetched_at
      }
    else
      _ -> state
    end
  rescue
    _ -> state
  end

  # Sobelow: a fixed file name in the configured data folder, never from a request.
  # sobelow_skip ["Traversal.FileModule"]
  defp write_cache(state) do
    json =
      Jason.encode!(%{
        fetched_at: DateTime.to_iso8601(state.fetched_at),
        entries: state.entries,
        caps: state.caps
      })

    path = cache_path()
    tmp = path <> ".tmp"

    with :ok <- File.write(tmp, json), :ok <- File.rename(tmp, path) do
      :ok
    else
      {:error, reason} ->
        Logger.warning("Couldn't save the model list to #{path}: #{:file.format_error(reason)}")
    end
  end

  defp entry_from_json(%{"id" => id, "created" => created, "caps" => caps}),
    do: %{id: id, created: created || 0, caps: caps_from_json(caps)}

  defp caps_from_json(c) do
    %{
      json_mode: c["json_mode"] == true,
      reasoning_toggle: c["reasoning_toggle"] == true,
      max_tokens: c["max_tokens"] == true,
      free: c["free"] == true
    }
  end

  defp fetch_failed(reason) do
    every = Spec.llm_policy(:catalog)["warn_every_ms"]
    last = :persistent_term.get({__MODULE__, :warned}, nil)
    t = now()

    if is_nil(last) or t - last >= every do
      :persistent_term.put({__MODULE__, :warned}, t)

      Logger.warning(
        "Couldn't fetch OpenRouter's model list (#{reason}); using the saved or built-in list."
      )
    end

    {:error, reason}
  end

  defp now, do: System.monotonic_time(:millisecond)

  defp scaled(ms), do: Kotiko.LLM.scaled(ms)
end
