# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Slovo.Router do
  use Plug.Router
  use Plug.ErrorHandler
  require Logger
  alias Slovo.{LLM, Word, Words}

  # First, on every route including /health: refuse names we don't answer to (DNS rebinding).
  plug Slovo.Plug.HostCheck
  plug :match
  plug :authorize
  # Only after auth, so strangers can't make the server parse large bodies.
  plug Plug.Parsers, parsers: [:json], json_decoder: Jason, pass: ["*/*"], length: 64_000
  plug :dispatch

  # Open (no token): which server this is, its version and whether the database works.
  # Clients that only check for a 200 keep working.
  get "/health" do
    {status, body} = Slovo.Health.report()
    conn |> put_resp_header("cache-control", "no-store") |> json(status, body)
  end

  match "/health", via: :head do
    {status, _body} = Slovo.Health.report()
    conn |> put_resp_header("cache-control", "no-store") |> send_resp(status, "")
  end

  # The browser extension polls this. Returns active words in every language, or only
  # some with ?lang=ru,ar.
  get "/api/words" do
    conn = fetch_query_params(conn)

    langs =
      case conn.query_params["lang"] do
        l when is_binary(l) and l != "" -> String.split(l, ",", trim: true)
        _ -> nil
      end

    json(conn, 200, %{words: langs |> Words.active() |> Enum.map(&Word.to_json/1)})
  end

  # "Add a word" box in the popup: same free-form text the bot understands
  # ("shukran", "how do you say dog in japanese"). Everything it finds is saved as active.
  post "/api/words" do
    case conn.body_params do
      %{"text" => text} when is_binary(text) and text != "" ->
        case LLM.interpret(text, Words.recent_languages(), add: true) do
          {:ok, %{words: [], reply: reply}} ->
            json(conn, 200, %{words: [], reply: reply || "I couldn't find a word in that."})

          {:ok, %{words: found}} ->
            results = Enum.map(found, &Words.upsert(Map.put(&1, :source_text, text), "active"))

            case {for({:ok, w} <- results, do: Word.to_json(w)),
                  for({:error, cs} <- results, do: cs)} do
              {[], [cs | _]} ->
                # The changes hold the learner's words: only at debug.
                Logger.debug("Couldn't save #{inspect(cs.changes)}")
                Logger.warning("Couldn't save a word: #{inspect(cs.errors)}")
                json(conn, 422, %{error: "Couldn't save that word: #{changeset_errors(cs)}"})

              {saved, _} ->
                json(conn, 200, %{words: saved})
            end

          {:error, reason} ->
            json(conn, 502, %{error: "The language model failed: #{reason}"})
        end

      _ ->
        json(conn, 400, %{error: "Send {\"text\": \"...\"}"})
    end
  end

  delete "/api/words/:id" do
    # At most 18 digits, so a huge id is a 404, not a 500 from SQLite.
    with true <- id =~ ~r/\A\d{1,18}\z/, %Word{} = w <- Words.get(String.to_integer(id)) do
      Words.delete(w)
      json(conn, 200, %{ok: true})
    else
      _ -> json(conn, 404, %{error: "No such word."})
    end
  end

  match _ do
    send_resp(conn, 404, "not found")
  end

  defp changeset_errors(cs) do
    Enum.map_join(cs.errors, ", ", fn {field, {msg, _}} ->
      "#{field} #{msg} (#{inspect(Ecto.Changeset.get_field(cs, field))})"
    end)
  end

  defp json(conn, status, body) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, Jason.encode!(body))
  end

  # Plug.Parsers' errors keep their status (413 too large, 400 bad JSON); anything else is
  # a 500 with a reference to find in the log, never an empty body or a stack trace.
  # Today's /api/words routes keep the {"error": "<string>"} shape older extensions read.
  @impl Plug.ErrorHandler
  def handle_errors(conn, %{kind: kind, reason: reason}) do
    case conn.status do
      413 ->
        json(conn, 413, %{error: "That request is too large."})

      s when s in 400..499 ->
        json(conn, s, %{error: "The server couldn't read that request."})

      _ ->
        ref = Base.encode16(:crypto.strong_rand_bytes(4), case: :lower)
        Logger.error("Request failed (ref #{ref}): #{Exception.format_banner(kind, reason)}")

        json(conn, 500, %{
          error: "Something went wrong in Slovo. Check the server log for ref #{ref}."
        })
    end
  end

  # Deny by default: only the exact GET or HEAD /health is open. path_info is not yet
  # percent-decoded here, but routing decodes it, so matching on ["api" | _] let
  # "/%61pi/words" through without a token.
  defp authorize(%{path_info: ["health"], method: m} = conn, _opts) when m in ~w(GET HEAD),
    do: conn

  defp authorize(conn, _opts) do
    expected = Application.fetch_env!(:slovo, :api_token)

    case get_req_header(conn, "authorization") do
      ["Bearer " <> token] ->
        if Plug.Crypto.secure_compare(token, expected), do: conn, else: deny(conn)

      _ ->
        deny(conn)
    end
  end

  defp deny(conn) do
    body = %{
      error: %{
        code: "server_key_rejected",
        message: "This Slovo server didn't accept the access key. Paste it again in Connection."
      }
    }

    conn
    |> put_resp_header("www-authenticate", "Bearer")
    |> json(401, body)
    |> halt()
  end
end
