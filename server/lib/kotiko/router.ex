# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Router do
  use Plug.Router
  use Plug.ErrorHandler
  require Logger
  alias Kotiko.{AddRequests, AuthThrottle, I18n, Lookup, RateLimit, Token, Word, Words}

  # First, on every route including /health: refuse names we don't answer to (DNS rebinding).
  plug Kotiko.Plug.HostCheck
  plug :match
  plug :authorize
  # Only after auth, so strangers can't make the server parse large bodies.
  plug :parse_body
  plug :dispatch

  # Only JSON: a body of another type is refused with 415 (slice 25), never passed on unread.
  @parsers [parsers: [:json], json_decoder: Jason]
  @small_body Plug.Parsers.init([length: 64_000] ++ @parsers)
  @batch_body Plug.Parsers.init([length: 1_000_000] ++ @parsers)
  @proof_body Plug.Parsers.init([length: 1_000] ++ @parsers)

  # 64 KB everywhere, except the batch add, which takes up to 500 words (slice 07), and the
  # proof, which anyone may send: a nonce fits in 1 KB.
  defp parse_body(%{path_info: ["api", "v1", "words", "batch"]} = conn, _opts),
    do: Plug.Parsers.call(conn, @batch_body)

  defp parse_body(%{path_info: ["api", "v1", "proof"]} = conn, _opts),
    do: Plug.Parsers.call(conn, @proof_body)

  defp parse_body(conn, _opts), do: Plug.Parsers.call(conn, @small_body)

  # Open (no token): which server this is, its version and whether the database works.
  # Clients that only check for a 200 keep working.
  get "/health" do
    {status, body} = Kotiko.Health.report()
    conn |> put_resp_header("cache-control", "no-store") |> json(status, body)
  end

  match "/health", via: :head do
    {status, _body} = Kotiko.Health.report()
    conn |> put_resp_header("cache-control", "no-store") |> send_resp(status, "")
  end

  # Open (no token): proves this server holds the API token without revealing it, so the
  # extension can check an address before it sends the token there (slice 54, B-01).
  post "/api/v1/proof" do
    limit = Application.get_env(:kotiko, :proof_requests_per_minute, 30)
    {count, seconds} = RateLimit.hit(:proof, RateLimit.client(conn.remote_ip), 60_000)

    cond do
      is_integer(limit) and count > limit ->
        rate_limited(conn, "too_many_proofs", seconds)

      Token.nonce?(conn.body_params["nonce"]) ->
        token = Application.fetch_env!(:kotiko, :api_token)
        proof = Token.proof(token, conn.body_params["nonce"])
        conn |> put_resp_header("cache-control", "no-store") |> json(200, %{proof: proof})

      true ->
        error(conn, true, 400, "invalid_request", %{field: "nonce"})
    end
  end

  # Slice 07's versioned API: words with ids, edits, deletes that can be undone.
  forward "/api/v1", to: Kotiko.RouterV1

  # ── legacy routes, for 0.2 extensions (removed one minor version after slice 07) ──

  # The 0.2 extension polls this: active words for English pages in every language, or
  # only some with ?lang=ru,ar, in the 0.2 shape (`english` is the gloss).
  get "/api/words" do
    conn = fetch_query_params(conn)

    langs =
      case conn.query_params["lang"] do
        l when is_binary(l) and l != "" -> String.split(l, ",", trim: true)
        _ -> nil
      end

    words =
      langs
      |> Words.legacy_active()
      |> Enum.filter(&(Word.enabled_forms(&1) != []))
      |> Enum.map(&Word.to_legacy_json/1)

    json(conn, 200, %{words: words})
  end

  # "Add a word" box in the 0.2 popup: the same free-form text the bot understands
  # ("shukran", "how do you say dog in japanese"), for English pages. Re-adding a word
  # merges into it and is reported in `reply`, so the popup offers no Undo that would
  # delete the original.
  post "/api/words" do
    case conn.body_params do
      %{"text" => text} when is_binary(text) and text != "" ->
        crid = conn.body_params["client_request_id"]
        crid = if AddRequests.valid_id?(crid), do: crid

        case AddRequests.once(crid, fn -> legacy_add(text, crid) end) do
          {:stored, body} -> raw_json(conn, 200, body)
          {status, body} -> raw_json(conn, status, body)
        end

      _ ->
        json(conn, 400, %{error: "Send {\"text\": \"...\"}"})
    end
  end

  delete "/api/words/:id" do
    # At most 18 digits, so a huge id is a 404, not a 500 from SQLite.
    with true <- id =~ ~r/\A\d{1,18}\z/,
         %Word{} = w <- Words.get_row(String.to_integer(id)),
         {:ok, _} <- Words.delete(w) do
      json(conn, 200, %{ok: true})
    else
      _ -> json(conn, 404, %{error: "No such word."})
    end
  end

  match _ do
    send_resp(conn, 404, "not found")
  end

  # Returns {status, encoded body}; a 200 is kept for the client_request_id in the same
  # transaction that saved the words.
  defp legacy_add(text, crid) do
    case Lookup.interpret(text, add: true, base_langs: ["en"], origin: "add") do
      {:ok, %{words: [], rejected: [], reply: reply}} ->
        {200, Jason.encode!(%{words: [], reply: reply || "I couldn't find a word in that."})}

      {:ok, %{words: [], rejected: rejected}} ->
        # The rejected words are the learner's: only at debug, with LOG_LOOKUPS (B-07).
        if Kotiko.LLM.log_lookups?(), do: Logger.debug("Couldn't save #{inspect(rejected)}")
        reasons = rejected |> Enum.map(& &1.reason) |> Enum.uniq()
        Logger.warning("Couldn't save a word: #{Enum.join(reasons, ", ")}")
        {422, Jason.encode!(%{error: "Couldn't save that word: #{Enum.join(reasons, ", ")}"})}

      {:ok, %{words: words}} ->
        {:ok, body} =
          Lookup.save(words, [explicit: true], fn results ->
            body = Jason.encode!(legacy_body(results))
            AddRequests.store(crid, body)
            body
          end)

        {200, body}

      # 0.2 extensions read the string `error`; newer ones read `code` and `details`.
      {:error, e} ->
        {status, _retry_after, message, details} = Lookup.http_error(e, I18n.default())
        {status, Jason.encode!(%{error: message, code: e.code, details: details})}
    end
  end

  # Only new words go in `words` (each gets an Undo in the 0.2 popup); words already in
  # the list are named in `reply`. A Telegram lookup that was never added counts as new.
  defp legacy_body(results) do
    {new, known} =
      results
      |> Enum.flat_map(fn
        {:ok, r} -> [r]
        {:error, _} -> []
      end)
      |> Enum.split_with(fn r ->
        r.result == :created or (r.result == :updated and r.previous.status == "pending")
      end)

    body = %{words: Enum.map(new, &Word.to_legacy_json(&1.word))}

    case known |> Enum.map(& &1.word.native) |> Enum.uniq() do
      [] ->
        body

      # `reply` is for the 0.2 popup; newer clients read the structured `known` list.
      natives ->
        body
        |> Map.put(:reply, "Already in your list: " <> Enum.join(natives, ", "))
        |> Map.put(:known, natives)
    end
  end

  defp json(conn, status, body), do: raw_json(conn, status, Jason.encode!(body))

  defp raw_json(conn, status, body) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, body)
  end

  # Plug.Parsers' errors keep their status (413 too large, 400 bad JSON); anything else is
  # a 500 with a reference to find in the log, never an empty body or a stack trace.
  # The legacy /api/words routes keep the {"error": "<string>"} shape 0.2 extensions read.
  # /api/v1 uses its own error shape, {"error": {"code", "message", "details"}}.
  @impl Plug.ErrorHandler
  def handle_errors(conn, %{kind: kind, reason: reason}) do
    v1? = conn.request_path == "/api/v1" or String.starts_with?(conn.request_path, "/api/v1/")

    case conn.status do
      413 ->
        error(conn, v1?, 413, "request_too_large")

      # A body that isn't JSON (`curl -d` alone sends a form).
      415 ->
        error(conn, v1?, 415, "invalid_request", %{reason: "content_type"})

      s when s in 400..499 ->
        error(conn, v1?, s, "invalid_request")

      _ ->
        ref = Base.encode16(:crypto.strong_rand_bytes(4), case: :lower)
        Logger.error("Request failed (ref #{ref}): #{Exception.format_banner(kind, reason)}")
        message = I18n.t(I18n.locale(conn), "error_internal_ref", %{ref: ref})
        error(conn, v1?, 500, "internal", %{ref: ref}, message)
    end
  end

  # The message is the catalog's, in the request's language (slice 25 §1).
  defp error(conn, v1?, status, code, details \\ %{}, message \\ nil) do
    message = message || I18n.error_message(I18n.locale(conn), code, details)

    if v1?,
      do: json(conn, status, %{error: %{code: code, message: message, details: details}}),
      else: json(conn, status, %{error: message})
  end

  # Deny by default: only the exact GET or HEAD /health and POST /api/v1/proof are open.
  # path_info is not yet percent-decoded here, but routing decodes it, so matching on
  # ["api" | _] let "/%61pi/words" through without a token.
  defp authorize(%{path_info: ["health"], method: m} = conn, _opts) when m in ~w(GET HEAD),
    do: conn

  defp authorize(%{path_info: ["api", "v1", "proof"], method: "POST"} = conn, _opts), do: conn

  # An address that sent too many wrong tokens gets 429 whatever it sends now
  # (Kotiko.AuthThrottle).
  defp authorize(conn, _opts) do
    case AuthThrottle.check(conn.remote_ip) do
      :ok -> check_token(conn)
      {:locked, seconds} -> rate_limited(conn, "auth_failures", seconds)
    end
  end

  defp check_token(conn) do
    expected = Application.fetch_env!(:kotiko, :api_token)

    case get_req_header(conn, "authorization") do
      ["Bearer " <> token] ->
        if Plug.Crypto.secure_compare(token, expected) do
          conn
        else
          AuthThrottle.failed(conn.remote_ip)
          deny(conn)
        end

      _ ->
        deny(conn)
    end
  end

  defp rate_limited(conn, reason, seconds) do
    conn
    |> put_resp_header("retry-after", to_string(seconds))
    |> error(true, 429, "rate_limited", %{reason: reason})
    |> halt()
  end

  defp deny(conn) do
    body = %{
      error: %{
        code: "server_key_rejected",
        message: I18n.error_message(I18n.locale(conn), "server_key_rejected")
      }
    }

    conn
    |> put_resp_header("www-authenticate", "Bearer")
    |> json(401, body)
    |> halt()
  end
end
