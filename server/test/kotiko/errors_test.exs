# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.ErrorsTest do
  # Slice 25 on the server: every error answer has a stable code and a plain message from
  # one catalog (priv/locales/<locale>/messages.json), in the request's Accept-Language
  # among the shipped locales; a body that isn't JSON is a clear 415, never a 500.
  use Kotiko.ConnCase, async: false
  import ExUnit.CaptureLog
  alias Kotiko.{I18n, Lookup}

  defp error_of(conn), do: json_body(conn)["error"]

  describe "a body that isn't JSON" do
    # Slice 53 found these answered 500 internal: the parser passed the body on unread.
    test "is a 415 invalid_request on every body route of /api/v1, not a 500" do
      routes = [
        {"POST", "/api/v1/words"},
        {"POST", "/api/v1/words/batch"},
        {"PATCH", "/api/v1/words/#{Kotiko.UUID7.generate()}"},
        {"DELETE", "/api/v1/words"},
        {"POST", "/api/v1/jobs/pronunciation-refresh"}
      ]

      for {method, path} <- routes,
          type <- ["application/x-www-form-urlencoded", "text/plain", "multipart/form-data"] do
        # Plug.ErrorHandler answers, then re-raises (as it does for a 413 or bad JSON).
        {{status, _headers, body}, _log} =
          with_log(fn ->
            request_raising(method, path, auth(), body: "text=perro", content_type: type)
          end)

        assert status == 415, "#{method} #{path} as #{type}: #{status}"

        assert %{
                 "code" => "invalid_request",
                 "message" => message,
                 "details" => %{"reason" => "content_type"}
               } = Jason.decode!(body)["error"]

        assert message =~ "Content-Type: application/json"
      end
    end

    test "is a 415 with the 0.2 string error on the legacy route" do
      assert {415, _headers, body} =
               request_raising("POST", "/api/words", auth(),
                 body: "text=perro",
                 content_type: "text/plain"
               )

      assert %{"error" => "Send the body as JSON" <> _} = Jason.decode!(body)
    end

    test "JSON, with or without a charset, and no body at all still work" do
      conn =
        request("POST", "/api/v1/words", auth(),
          body: %{},
          content_type: "application/json; charset=utf-8"
        )

      assert {400, "invalid_request"} == {conn.status, error_of(conn)["code"]}
      assert request("POST", "/api/v1/jobs/pronunciation-refresh", auth()).status == 400
    end
  end

  describe "messages come from the catalog" do
    test "each /api/v1 error has the catalog's message for its code" do
      conn = request("GET", "/api/v1/words/#{Kotiko.UUID7.generate()}", auth())

      assert error_of(conn) == %{
               "code" => "word_gone",
               "message" => "That word was already removed.",
               "details" => %{}
             }

      conn =
        request("POST", "/api/v1/words", auth(),
          body: %{text: String.duplicate("a", 201), base_langs: ["en"]}
        )

      assert error_of(conn)["message"] == I18n.t("en", "error_input_too_long")

      conn = request("POST", "/api/v1/words/batch", auth(), body: %{words: "x"})
      assert error_of(conn)["message"] == "Send {\"words\": [...]}, with at most 500 words."

      conn = request("GET", "/api/v1/nope", auth())
      assert error_of(conn)["message"] == "No such route."

      conn = request("GET", "/api/v1/words", [])
      assert error_of(conn)["message"] =~ "access key"
    end

    test "every key the server's code uses exists, and none is left unfilled" do
      for key <-
            ~w(error_internal error_internal_ref error_request_too_large error_invalid_request
                    error_invalid_request_content_type error_invalid_word error_empty_input
                    error_input_too_long error_server_key_rejected error_word_gone
                    error_word_gone_scrubbed error_not_found error_word_conflict
                    error_word_conflict_duplicate error_server_address_invalid
                    error_server_address_invalid_host_not_allowed
                    error_server_address_invalid_no_host error_quota_exhausted
                    error_quota_exhausted_today error_quota_exhausted_payment_required
                    error_rate_limited error_model_unavailable error_lookup_timeout
                    error_bad_lookup_result error_key_rejected error_lookup_not_set_up
                    error_lookup_failed) do
        assert I18n.has?(key), key
      end

      assert I18n.error_message("en", "word_gone", %{reason: "scrubbed"}) =~ "too long ago"
      assert I18n.error_message("en", "word_conflict", %{reason: "duplicate"}) =~ "already has"

      assert I18n.error_message("en", "invalid_request", %{field: "confirm"}) =~
               "delete-all-words"

      assert I18n.error_message("en", "invalid_request", %{field: "limit"}) =~ "details.field"
      assert I18n.error_message("en", "a_code_nobody_made") == I18n.t("en", "error_internal")
      refute I18n.t("en", "error_internal") =~ "{"
    end

    test "lookup messages are the catalog's and never contain the learner's text" do
      at = ~U[2026-10-06 00:00:00Z]
      assert Lookup.message("quota_exhausted", %{}, at) =~ "after 00:00 UTC"

      assert Lookup.message("quota_exhausted", %{
               reason: "payment_required",
               provider: "openrouter"
             }) =~
               "OpenRouter needs credit"

      assert Lookup.message("key_rejected", %{}) =~ "The lookup service didn't accept"
      assert Lookup.message("something_new", %{}) == "The lookup failed. Try again."
    end
  end

  describe "the message's language (Accept-Language)" do
    test "picks the best shipped locale in the header's order of preference" do
      available = ["en", "es"]
      assert I18n.locale("es-PR, en;q=0.5", available) == "es"
      assert I18n.locale("fr-CA, es;q=0.4, en;q=0.9", available) == "en"
      assert I18n.locale("ES", available) == "es"
      assert I18n.locale("fr, de", available) == "en", "nothing shipped matches: the default"
      assert I18n.locale("es;q=0, en", available) == "en", "q=0 means not acceptable"
      assert I18n.locale("*", available) == "en"
      assert I18n.locale("", available) == "en"
      assert I18n.locale("garbage;;;q=x", available) == "en"
    end

    test "English is the one shipped locale today, and the default" do
      assert I18n.locales() == ["en"]
      assert I18n.default() == "en"

      assert I18n.t("es", "error_word_gone") == I18n.t("en", "error_word_gone"),
             "a missing locale falls back"
    end

    test "a request in another language gets the default's message, and the same code" do
      conn =
        request(
          "GET",
          "/api/v1/words/#{Kotiko.UUID7.generate()}",
          auth() ++ [{"accept-language", "fr-CA,fr;q=0.9"}]
        )

      assert %{"code" => "word_gone", "message" => "That word was already removed."} =
               error_of(conn)
    end
  end
end
