# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.PronounceTest do
  # Slice 49 §4a: the shared cases in spec/fixtures/pronounce/, run here and by
  # test/unit/pronounce.test.mjs, so the server and the extension write the same
  # pronunciation from the same Wiktionary IPA; and how pages are fetched.
  use ExUnit.Case, async: false

  alias Kotiko.Pronounce

  @moduletag :spec
  @fixtures Path.expand("../../../spec/fixtures/pronounce", __DIR__)
  @cases @fixtures
         |> Path.join("cases.json")
         |> File.read!()
         |> Jason.decode!()
         |> Map.fetch!("cases")

  defp atoms(map), do: Map.new(map, fn {k, v} -> {String.to_atom(k), v} end)

  setup do
    Pronounce.clear_cache()
    :ok
  end

  for c <- @cases do
    test "case #{c["name"]}" do
      c = unquote(Macro.escape(c))
      word = atoms(c["word"])
      {out, status} = enrich_with_blocks(word, c["blocks"])

      assert status == c["expect"]["status"]

      for {k, v} <- c["expect"], k != "status" do
        assert Map.get(out, String.to_atom(k)) == v, "#{k}"
      end

      if status == "wiktionary" do
        assert out.pronunciation_source == "wiktionary"
        assert out.pronunciation_careful == nil
      else
        assert out == word
      end
    end
  end

  # Runs enrich with a fetcher that serves a page made of `blocks`, so the cases exercise
  # the same path as a real page without the network.
  defp enrich_with_blocks(word, blocks) do
    html =
      "<h2>#{Pronounce.heading(word.lang)}</h2>" <>
        Enum.map_join(blocks, fn b ->
          "<h3>Pronunciation</h3>" <>
            Enum.map_join(b, &"<span class=\"IPA\">#{&1}</span>") <> "<h3>Noun</h3>"
        end)

    Pronounce.enrich(word,
      cache: false,
      fetch_page: fn _ -> if blocks == [], do: :none, else: {:ok, html} end
    )
  end

  test "reading a page: the language's section only, one block per Pronunciation heading" do
    html = File.read!(Path.join(@fixtures, "page.html"))
    want = @fixtures |> Path.join("page.json") |> File.read!() |> Jason.decode!()
    assert Pronounce.blocks_from_html(html, want["heading"]) == want["blocks"]

    assert Pronounce.blocks_from_html(html, want["missing"]["heading"]) ==
             want["missing"]["blocks"]

    assert Pronounce.blocks_from_html(nil, "Russian") == []
  end

  test "section headings from CLDR names, with Wiktionary's own where they differ" do
    assert Pronounce.heading("ru") == "Russian"
    assert Pronounce.heading("pt-BR") == "Portuguese"
    assert Pronounce.heading("sr") == "Serbo-Croatian"
    assert Pronounce.heading("no") == "Norwegian Bokmål"
  end

  describe "fetching" do
    @word %{
      lang: "ru",
      base_lang: "en",
      native: "это",
      pronunciation: "eh-TO",
      pronunciation_source: "model"
    }
    @html ~s(<h2 id="Russian">Russian</h2><h3>Pronunciation</h3><span class="IPA">[ˈɛtə]</span><h3>Pronoun</h3>)

    test "asks Wiktionary's REST API for the word, once, then the cache answers" do
      test_pid = self()

      Req.Test.stub(Kotiko.Pronounce, fn conn ->
        send(test_pid, {:asked, conn.request_path, Plug.Conn.get_req_header(conn, "user-agent")})
        Req.Test.html(conn, @html)
      end)

      assert {%{pronunciation: "EH-ta", native_vocalized: "э́то"}, "wiktionary"} =
               Pronounce.enrich(@word)

      assert {%{pronunciation: "EH-ta"}, "wiktionary"} = Pronounce.enrich(@word)
      assert_received {:asked, path, [agent]}

      assert path ==
               "/w/rest.php/v1/page/" <> URI.encode("это", &URI.char_unreserved?/1) <> "/html"

      assert agent =~ "Kotiko"
      refute_received {:asked, _, _}
    end

    test "no page is remembered; a refused request is not, and keeps the model's" do
      Req.Test.stub(Kotiko.Pronounce, &Plug.Conn.send_resp(&1, 404, "not found"))
      assert {%{pronunciation: "eh-TO"}, "no_data"} = Pronounce.enrich(@word)

      Pronounce.clear_cache()

      Req.Test.stub(Kotiko.Pronounce, fn conn ->
        conn
        |> Plug.Conn.put_resp_header("retry-after", "600")
        |> Plug.Conn.send_resp(429, "slow down")
      end)

      assert {%{pronunciation: "eh-TO"}, "unavailable"} = Pronounce.enrich(@word)
      Req.Test.stub(Kotiko.Pronounce, &Req.Test.html(&1, @html))
      assert {%{pronunciation: "EH-ta"}, "wiktionary"} = Pronounce.enrich(@word)
    end

    test "a short wait Wikimedia asks for is waited once" do
      {:ok, n} = Agent.start_link(fn -> 0 end)

      Req.Test.stub(Kotiko.Pronounce, fn conn ->
        if Agent.get_and_update(n, &{&1, &1 + 1}) == 0,
          do:
            conn |> Plug.Conn.put_resp_header("retry-after", "0") |> Plug.Conn.send_resp(429, ""),
          else: Req.Test.html(conn, @html)
      end)

      assert {:ok, _} = Pronounce.fetch_page("это")
      assert Agent.get(n, & &1) == 2
    end
  end
end
