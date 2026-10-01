defmodule Slovo.Router do
  use Plug.Router
  require Logger
  alias Slovo.{LLM, Word, Words}

  plug :match
  plug Plug.Parsers, parsers: [:json], json_decoder: Jason, pass: ["*/*"]
  plug :authorize
  plug :dispatch

  get "/health" do
    send_resp(conn, 200, "ok")
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
                Logger.warning("Couldn't save #{inspect(cs.changes)}: #{inspect(cs.errors)}")
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
    with {wid, ""} <- Integer.parse(id), %Word{} = w <- Words.get(wid) do
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

  # Everything under /api needs the Bearer token; /health doesn't.
  defp authorize(%{path_info: ["api" | _]} = conn, _opts) do
    expected = Application.fetch_env!(:slovo, :api_token)

    case get_req_header(conn, "authorization") do
      ["Bearer " <> token] ->
        if Plug.Crypto.secure_compare(token, expected), do: conn, else: deny(conn)

      _ ->
        deny(conn)
    end
  end

  defp authorize(conn, _opts), do: conn

  defp deny(conn), do: conn |> send_resp(401, "unauthorized") |> halt()
end
