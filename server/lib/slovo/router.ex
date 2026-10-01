defmodule Slovo.Router do
  use Plug.Router

  plug :match
  plug :dispatch

  get "/health" do
    send_resp(conn, 200, "ok")
  end

  # The browser extension polls this. Returns active words for one language.
  get "/api/words" do
    if authorized?(conn) do
      conn = fetch_query_params(conn)
      lang = if conn.query_params["lang"] in ["ru", "zh"], do: conn.query_params["lang"], else: "ru"
      words = lang |> Slovo.Words.active() |> Enum.map(&Slovo.Word.to_json/1)

      conn
      |> put_resp_content_type("application/json")
      |> send_resp(200, Jason.encode!(%{words: words}))
    else
      send_resp(conn, 401, "unauthorized")
    end
  end

  match _ do
    send_resp(conn, 404, "not found")
  end

  defp authorized?(conn) do
    expected = Application.fetch_env!(:slovo, :api_token)

    case get_req_header(conn, "authorization") do
      ["Bearer " <> token] -> Plug.Crypto.secure_compare(token, expected)
      _ -> false
    end
  end
end
