# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.StartupSummaryTest do
  # The info block the server logs at boot (Kotiko.Application.summary_lines/3): what an
  # owner reads to see the server is set up as they meant. The boot itself runs in
  # boot_test.exs, in a separate VM.
  use ExUnit.Case, async: false
  import Kotiko.DataCase, only: [put_app_env: 2]
  alias Kotiko.Application, as: App

  defp line(lines, prefix), do: Enum.find(lines, &String.starts_with?(&1, prefix))

  test "names the version, the data folder, the database and the active words" do
    lines = App.summary_lines(:env, 1, "HTTP API: off")
    data_dir = Elixir.Application.fetch_env!(:kotiko, :data_dir)

    assert hd(lines) == "Starting the Kotiko server, version #{Kotiko.Health.version()}"
    assert line(lines, "Data:") == "Data:      #{data_dir} (kotiko.db, 1 active word)"
    assert line(lines, "Listening:") == "Listening: HTTP API: off"
    assert line(lines, "Data:") =~ "1 active word)"
    assert App.summary_lines(:env, 12, "x") |> line("Data:") =~ "12 active words)"
  end

  test "says where the API token comes from, never the token itself" do
    token = Elixir.Application.fetch_env!(:kotiko, :api_token)

    assert line(App.summary_lines(:env, 0, ""), "API token:") == "API token: from .env"

    assert line(App.summary_lines({:saved, "/data/api-token"}, 0, ""), "API token:") ==
             "API token: saved in /data/api-token"

    assert line(App.summary_lines({:generated, "/data/api-token"}, 0, ""), "API token:") ==
             "API token: saved in /data/api-token"

    refute Enum.any?(App.summary_lines(:env, 0, ""), &(&1 =~ token))
  end

  test "describes the model: OpenRouter's free list, or the models from LLM_MODEL" do
    put_app_env(:llm_url, "https://openrouter.ai/api/v1")
    put_app_env(:llm_model_source, :default)

    assert line(App.summary_lines(:env, 0, ""), "Model:") ==
             "Model:     OpenRouter, its current free models (checked 10 s after start)"

    put_app_env(:llm_url, "http://127.0.0.1:11434/v1")
    put_app_env(:llm_model_source, :env)
    put_app_env(:llm_models, ["llama3"])

    assert line(App.summary_lines(:env, 0, ""), "Model:") ==
             "Model:     http://127.0.0.1:11434/v1, 1 model from LLM_MODEL"

    put_app_env(:llm_models, ["a", "b"])
    assert line(App.summary_lines(:env, 0, ""), "Model:") =~ ", 2 models from LLM_MODEL"
  end

  test "describes the bot: off, waiting for IDs, or on with its accounts" do
    put_app_env(:telegram_token, nil)

    assert line(App.summary_lines(:env, 0, ""), "Telegram:") =~
             "off (TELEGRAM_BOT_TOKEN is empty)"

    put_app_env(:telegram_token, "123:abc")
    put_app_env(:allowed_ids, [])
    assert line(App.summary_lines(:env, 0, ""), "Telegram:") =~ "waiting for ALLOWED_TELEGRAM_IDS"

    put_app_env(:allowed_ids, [1, 2])

    assert line(App.summary_lines(:env, 0, ""), "Telegram:") ==
             "Telegram:  on, 2 allowed accounts"
  end

  test "says whether voice notes are transcribed" do
    put_app_env(:transcribe_url, nil)
    assert List.last(App.summary_lines(:env, 0, "")) =~ "off (TRANSCRIBE_URL is empty)"

    put_app_env(:transcribe_url, "http://127.0.0.1:8080/inference")
    assert List.last(App.summary_lines(:env, 0, "")) == "Voice notes: on"
  end

  test "the model line never shows a user name or password in LLM_URL (B-05)" do
    put_app_env(:llm_url, "http://proxyuser:Pr0xy-Pa55-SECRET@127.0.0.1:42100/llm/v1")
    put_app_env(:llm_model_source, :env)
    put_app_env(:llm_models, ["m"])

    model = line(App.summary_lines(:env, 0, ""), "Model:")
    assert model == "Model:     http://127.0.0.1:42100/llm/v1, 1 model from LLM_MODEL"
  end
end
