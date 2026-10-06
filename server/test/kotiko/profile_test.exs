# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.ProfileTest do
  # Slice 41 section 9: the learner's languages on the server, set by the extension.
  use Kotiko.ConnCase, async: false
  alias Kotiko.Profile

  defp put(body, headers \\ auth()), do: request("PUT", "/api/v1/profile", headers, body: body)

  describe "GET and PUT /api/v1/profile" do
    test "starts empty, then holds the base languages in order, as base tags" do
      conn = request("GET", "/api/v1/profile", auth())
      assert conn.status == 200
      assert json_body(conn) == %{"base_langs" => [], "ui_lang" => nil, "updated_at" => nil}

      conn = put(%{"base_langs" => ["es-PR", "en-US", "zh-TW", "es"], "ui_lang" => "es-419"})
      assert conn.status == 200

      assert %{"base_langs" => ["es", "en", "zh-Hant"], "ui_lang" => "es", "updated_at" => at} =
               json_body(conn)

      assert {:ok, _, 0} = DateTime.from_iso8601(at)

      assert json_body(request("GET", "/api/v1/profile", auth()))["base_langs"] == [
               "es",
               "en",
               "zh-Hant"
             ]

      # A second write replaces the first; "auto" or no ui_lang means none chosen.
      for ui <- ["auto", nil] do
        body =
          if ui, do: %{"base_langs" => ["ja"], "ui_lang" => ui}, else: %{"base_langs" => ["ja"]}

        assert %{"base_langs" => ["ja"], "ui_lang" => nil} = json_body(put(body))
      end

      assert %{base_langs: ["ja"], ui_lang: nil} = Profile.get()
    end

    test "refuses what isn't 1 to 4 language tags, naming the field, and keeps the profile" do
      {:ok, _} = Profile.put(%{"base_langs" => ["es"]})

      for body <- [
            %{},
            %{"base_langs" => []},
            %{"base_langs" => "es"},
            %{"base_langs" => ["es", "en", "fr", "de", "it"]},
            %{"base_langs" => ["es", 3]},
            %{"base_langs" => ["not a tag"]},
            %{"base_langs" => ["es"], "ui_lang" => "not a tag"},
            %{"base_langs" => ["es"], "ui_lang" => 7}
          ] do
        conn = put(body)
        assert conn.status == 400, inspect(body)

        assert %{"code" => "invalid_request", "details" => %{"field" => field}, "message" => msg} =
                 json_body(conn)["error"]

        assert field in ["base_langs", "ui_lang"]
        assert msg =~ if(field == "base_langs", do: "1 to 4 language tags", else: "ui_lang")
      end

      assert Profile.get().base_langs == ["es"]
    end

    test "needs the access token, like every /api/v1 route" do
      assert request("GET", "/api/v1/profile").status == 401
      assert put(%{"base_langs" => ["es"]}, []).status == 401
      assert put(%{"base_langs" => ["es"]}, auth("wrong")).status == 401
      assert Profile.get() == nil
    end
  end
end
