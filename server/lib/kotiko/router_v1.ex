# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.RouterV1 do
  @moduledoc """
  `/api/v1` (slice 07 section 5), forwarded from `Kotiko.Router` after the token check
  and body parsing. Errors use one shape,
  `{"error": {"code": "...", "message": "...", "details": {...}}}`, with slice 25's codes;
  slice 25 owns the wording (and its translations).
  """
  use Plug.Router
  require Logger

  alias Kotiko.{
    AddRequests,
    Lang,
    Lookup,
    PronunciationRefresh,
    Spec,
    UUID7,
    Word,
    WordSpec,
    Words
  }

  plug :match
  plug :dispatch

  @max_limit 20_000
  @max_batch 500

  # ── reads ────────────────────────────────────────────────────────────

  get "/words" do
    conn = fetch_query_params(conn)
    q = conn.query_params

    with {:ok, langs} <- tags(q["lang"], &canonical/1, "lang"),
         {:ok, bases} <- tags(q["base"], &Lang.base_tag/1, "base"),
         {:ok, statuses} <- statuses(q["status"]),
         {:ok, limit} <- limit(q["limit"]) do
      cursor = Words.last_seq()
      words = Words.list(langs: langs, bases: bases, statuses: statuses, limit: limit)
      json(conn, 200, %{words: Enum.map(words, &Word.to_api/1), cursor: to_string(cursor)})
    else
      {:error, field} -> invalid(conn, %{field: field})
    end
  end

  get "/words/:id" do
    case word(id) do
      %Word{} = w -> json(conn, 200, %{word: Word.to_api(w)})
      nil -> gone(conn)
    end
  end

  # ── adds ─────────────────────────────────────────────────────────────

  post "/words/batch" do
    body = conn.body_params
    crid = body["client_request_id"]

    cond do
      not request_id?(crid) ->
        invalid(conn, %{field: "client_request_id"})

      not is_list(body["words"]) ->
        invalid(conn, %{field: "words"}, "Send {\"words\": [...]}.")

      length(body["words"]) > @max_batch ->
        invalid(
          conn,
          %{field: "words", max: @max_batch},
          "At most #{@max_batch} words at a time."
        )

      true ->
        checked =
          body["words"]
          |> Enum.with_index()
          |> Enum.map(fn {w, i} -> {i, structured(w, "bulk")} end)

        AddRequests.once(crid, fn -> {200, save_checked(checked, crid, false)} end)
        |> respond(conn)
    end
  end

  post "/words" do
    body = conn.body_params
    crid = body["client_request_id"]

    cond do
      not request_id?(crid) ->
        invalid(conn, %{field: "client_request_id"})

      is_map(body["word"]) ->
        checked = [{nil, structured(body["word"], "manual")}]
        explicit? = explicit_origin?(body["word"])

        AddRequests.once(crid, fn -> {200, save_checked(checked, crid, explicit?)} end)
        |> respond(conn)

      is_binary(body["text"]) ->
        add_text(conn, body, crid)

      true ->
        invalid(conn, %{field: "text"}, "Send {\"text\": \"...\"} or {\"word\": {...}}.")
    end
  end

  defp add_text(conn, body, crid) do
    with {:ok, text} <- WordSpec.prepare_input(body["text"]),
         {:ok, bases} <- base_langs(body["base_langs"]),
         {:ok, hint} <- hint_lang(body["hint_lang"]) do
      opts = [add: true, base_langs: bases, hint_lang: hint, origin: "add"]

      if body["preview"] == true do
        preview(conn, text, opts)
      else
        AddRequests.once(crid, fn -> lookup_and_save(text, opts, crid) end) |> respond(conn)
      end
    else
      {:error, :empty_input} ->
        error(conn, 400, "empty_input", "Type a word to add.")

      {:error, :input_too_long} ->
        error(conn, 400, "input_too_long", "That's a lot of text for one word.")

      {:error, field} ->
        invalid(conn, %{field: field})
    end
  end

  # Interpret and check, save nothing: the learner picks candidates, and the client saves
  # them through the structured form (the full-control decision, slice 24).
  defp preview(conn, text, opts) do
    case Lookup.interpret(text, opts) do
      {:ok, found} ->
        candidates = Enum.map(found.words, &candidate/1)

        json(
          conn,
          200,
          %{candidates: candidates}
          |> Map.merge(outcome(found))
          |> put_reply(found.reply)
        )

      {:error, e} ->
        lookup_failed(conn, e)
    end
  end

  defp lookup_and_save(text, opts, crid) do
    case Lookup.interpret(text, opts) do
      {:ok, found} ->
        {:ok, json} =
          Lookup.save(found.words, [explicit: true], fn results ->
            body =
              %{results: Enum.flat_map(results, &result_json/1)}
              |> Map.merge(outcome(found))
              |> put_reply(found.reply)
              |> Jason.encode!()

            AddRequests.store(crid, body)
            body
          end)

        {200, json}

      {:error, e} ->
        {:lookup_failed, e}
    end
  end

  # What the pipeline found besides the words (slice 09 section 4): rejections with
  # reasons, dropped forms and fields, bases the model skipped, and slice 25's code when
  # no word survived.
  defp outcome(found) do
    %{
      rejected: found.rejected,
      dropped_forms: found.dropped_forms,
      dropped_fields: found.dropped_fields,
      missing_bases: found.missing_bases
    }
    |> then(&if(found.code, do: Map.put(&1, :code, found.code), else: &1))
  end

  defp structured(word, default_origin) when is_map(word),
    do: WordSpec.validate_word(word, origin: default_origin, status: "active")

  defp structured(_word, _origin), do: {:error, :not_an_object, %{}}

  defp explicit_origin?(word), do: word["origin"] in [nil, "add", "manual", "telegram"]

  # Saves the valid words in one transaction (keeping the response for the request id)
  # and lists the rest as rejected. Returns the encoded body.
  defp save_checked(checked, crid, explicit?) do
    valid = for {i, {:ok, attrs, dropped}} <- checked, do: {i, attrs, dropped}

    rejected =
      for {i, {:error, reason, s}} <- checked,
          do: s |> Map.put(:reason, to_string(reason)) |> put_index(i)

    dropped =
      for {i, attrs, d} <- valid,
          f <- d,
          do: f |> Map.merge(Lookup.summary(attrs)) |> put_index(i)

    {:ok, body} =
      Lookup.save(Enum.map(valid, &elem(&1, 1)), [explicit: explicit?], fn results ->
        results =
          valid
          |> Enum.zip(results)
          |> Enum.flat_map(fn {{i, _, _}, r} ->
            r |> result_json() |> Enum.map(&put_index(&1, i))
          end)

        body = Jason.encode!(%{results: results, rejected: rejected, dropped_fields: dropped})
        AddRequests.store(crid, body)
        body
      end)

    body
  end

  defp put_index(map, nil), do: map
  defp put_index(map, i), do: Map.put(map, :index, i)

  defp result_json({:ok, %{result: r, word: w, previous: p}}) do
    base = %{result: to_string(r), word: Word.to_api(w)}
    [if(p, do: Map.put(base, :previous, Word.to_api(p)), else: base)]
  end

  # The reason can hold the word itself (a changeset): only its shape at warning level
  # (slice 10 section 6), the whole of it at debug.
  defp result_json({:error, reason}) do
    Logger.warning("Couldn't save a word: #{save_error(reason)}")
    Logger.debug("Couldn't save a word: #{inspect(reason)}")
    []
  end

  defp save_error(%Ecto.Changeset{errors: errors}),
    do: "invalid " <> Enum.map_join(errors, ", ", fn {field, _} -> to_string(field) end)

  defp save_error(reason) when is_atom(reason), do: to_string(reason)
  defp save_error({reason, _}) when is_atom(reason), do: to_string(reason)
  defp save_error(_reason), do: "see the debug log"

  defp candidate(attrs) do
    attrs
    |> Map.take(~w(lang native base_lang sense romanization native_vocalized gloss forms
                   pronunciation pronunciation_careful pronunciation_source note)a)
    |> Map.merge(%{status: "active", origin: attrs.origin, language: Lang.endonym(attrs.lang)})
  end

  defp put_reply(body, nil), do: body
  defp put_reply(body, reply), do: Map.put(body, :reply, reply)

  defp respond({:stored, json}, conn), do: raw_json(conn, 200, json)
  defp respond({200, json}, conn), do: raw_json(conn, 200, json)
  defp respond({:lookup_failed, e}, conn), do: lookup_failed(conn, e)

  # Slice 10's structured lookup errors: slice 25's code, its details and, when known,
  # when to try again (also as Retry-After).
  defp lookup_failed(conn, e) do
    {status, retry_after, message, details} = Lookup.http_error(e)

    conn
    |> then(&if(retry_after, do: put_resp_header(&1, "retry-after", "#{retry_after}"), else: &1))
    |> error(status, e.code, message, details)
  end

  # ── edits ────────────────────────────────────────────────────────────

  patch "/words/:id" do
    with true <- UUID7.valid?(id) || :gone,
         {:ok, expected} <- if_updated_at(conn),
         {:ok, patch} <- WordSpec.patch(conn.body_params) do
      case Words.update(id, patch, if_updated_at: expected) do
        {:ok, w} -> json(conn, 200, %{word: Word.to_api(w)})
        {:error, e} -> write_error(conn, e)
      end
    else
      :gone -> gone(conn)
      {:error, :if_updated_at} -> invalid(conn, %{field: "if_updated_at"})
      {:error, %{} = e} -> invalid_word(conn, e)
    end
  end

  delete "/words/:id" do
    with %Word{} <- word(id),
         {:ok, w} <- Words.delete(id) do
      json(conn, 200, %{word: Word.to_api(w)})
    else
      _ -> gone(conn)
    end
  end

  post "/words/:id/restore" do
    with %Word{} <- word(id),
         {:ok, w} <- Words.restore(id) do
      json(conn, 200, %{word: Word.to_api(w)})
    else
      nil -> gone(conn)
      {:error, e} -> write_error(conn, e)
    end
  end

  defp write_error(conn, :not_found), do: gone(conn)
  defp write_error(conn, :deleted), do: gone(conn)

  defp write_error(conn, :scrubbed) do
    error(conn, 410, "word_gone", "That word was removed too long ago to restore.", %{
      reason: "scrubbed"
    })
  end

  defp write_error(conn, {:stale, w}) do
    error(conn, 409, "word_conflict", "This word changed since.", %{
      reason: "stale",
      word: Word.to_api(w)
    })
  end

  defp write_error(conn, {:conflict, other}) do
    error(conn, 409, "word_conflict", "Another word already has that key.", %{
      reason: "duplicate",
      other_id: other
    })
  end

  defp write_error(conn, {:invalid, e}), do: invalid_word(conn, e)

  # ── the lookup client (slice 10 section 3) ───────────────────────────

  # The free lookups left today (OpenRouter with a key; else null), the models a lookup
  # would ask now and the last lookup's result. Answers from memory: no model call, and
  # at most one quota refresh in the background.
  get "/llm/status" do
    Kotiko.LLM.Quota.maybe_refresh()
    json(conn, 200, Kotiko.LLM.status())
  end

  # ── the one-time pronunciation refresh (section 8) ───────────────────

  get "/jobs/pronunciation-refresh" do
    json(conn, 200, PronunciationRefresh.status())
  end

  post "/jobs/pronunciation-refresh" do
    case conn.body_params do
      %{"action" => action} when action in ["pause", "resume"] ->
        json(conn, 200, PronunciationRefresh.control(String.to_existing_atom(action)))

      _ ->
        invalid(conn, %{field: "action"}, "Send {\"action\": \"pause\"} or \"resume\".")
    end
  end

  match _ do
    error(conn, 404, "not_found", "No such route.")
  end

  # ── parameters ───────────────────────────────────────────────────────

  # Pending words (Telegram lookups not yet added) are server-local: never shown here.
  defp word(id) do
    case Words.get(id) do
      %Word{status: "pending"} -> nil
      other -> other
    end
  end

  defp request_id?(nil), do: true
  defp request_id?(id), do: AddRequests.valid_id?(id)

  defp tags(nil, _normalize, _field), do: {:ok, nil}
  defp tags("", _normalize, _field), do: {:ok, nil}

  defp tags(value, normalize, field) do
    tags = value |> String.split(",", trim: true) |> Enum.map(normalize)
    if Enum.all?(tags, &is_binary/1), do: {:ok, tags}, else: {:error, field}
  end

  defp statuses(nil), do: {:ok, nil}

  defp statuses(value) do
    statuses = String.split(value, ",", trim: true)

    if statuses != [] and Enum.all?(statuses, &(&1 in Word.statuses())),
      do: {:ok, statuses},
      else: {:error, "status"}
  end

  defp limit(nil), do: {:ok, @max_limit}

  defp limit(value) do
    case Integer.parse(value) do
      {n, ""} when n >= 1 and n <= @max_limit -> {:ok, n}
      _ -> {:error, "limit"}
    end
  end

  defp canonical(tag) do
    case Lang.canonical(tag) do
      {:ok, t} -> t
      _ -> nil
    end
  end

  defp base_langs(list) when is_list(list) and list != [] do
    bases = Enum.map(list, &Lang.base_tag/1)

    if length(list) <= Spec.rule(:max_base_langs) and Enum.all?(bases, &is_binary/1),
      do: {:ok, Enum.uniq(bases)},
      else: {:error, "base_langs"}
  end

  defp base_langs(_), do: {:error, "base_langs"}

  defp hint_lang(nil), do: {:ok, nil}

  defp hint_lang(tag) do
    case Lang.canonical(tag) do
      {:ok, lang} -> {:ok, lang}
      _ -> {:error, "hint_lang"}
    end
  end

  # From the body's if_updated_at or an If-Match: "<updated_at>" header.
  defp if_updated_at(conn) do
    value =
      conn.body_params["if_updated_at"] ||
        case get_req_header(conn, "if-match") do
          [v | _] -> v |> String.trim() |> String.trim_leading("W/") |> String.trim("\"")
          [] -> nil
        end

    case value do
      nil ->
        {:ok, nil}

      v when is_binary(v) ->
        case DateTime.from_iso8601(v) do
          {:ok, dt, _} -> {:ok, dt}
          _ -> {:error, :if_updated_at}
        end

      _ ->
        {:error, :if_updated_at}
    end
  end

  # ── responses ────────────────────────────────────────────────────────

  defp gone(conn), do: error(conn, 404, "word_gone", "That word was already removed.")

  defp invalid(conn, details, message \\ "The server couldn't read that request."),
    do: error(conn, 400, "invalid_request", message, details)

  defp invalid_word(conn, details),
    do: error(conn, 400, "invalid_word", "That change isn't a valid word.", details)

  defp error(conn, status, code, message, details \\ %{}) do
    json(conn, status, %{error: %{code: code, message: message, details: details}})
  end

  defp json(conn, status, body), do: raw_json(conn, status, Jason.encode!(body))

  defp raw_json(conn, status, body) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, body)
  end
end
