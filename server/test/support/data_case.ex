# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Slovo.DataCase do
  @moduledoc """
  Tests that touch the database. Each test runs in a sandbox transaction that is rolled
  back afterwards. SQLite allows one writer at a time, so these tests run with
  `async: false`; the shared sandbox then also covers processes the test starts.
  """
  use ExUnit.CaseTemplate
  alias Ecto.Adapters.SQL.Sandbox

  using do
    quote do
      alias Slovo.{Repo, Word, Words}
      import Slovo.DataCase
    end
  end

  setup tags do
    setup_sandbox(tags)
    :ok
  end

  def setup_sandbox(tags) do
    pid = Sandbox.start_owner!(Slovo.Repo, shared: not tags[:async])
    on_exit(fn -> Sandbox.stop_owner(pid) end)
  end

  @doc "Word attributes as the LLM module returns them."
  def word_attrs(attrs \\ %{}) do
    Map.merge(
      %{
        lang: "ru",
        language: "Russian",
        native: "да",
        romanization: "da",
        english: "yes",
        english_forms: "yes",
        note: "The everyday yes."
      },
      Map.new(attrs)
    )
  end

  def word_fixture(attrs \\ %{}, status \\ "active") do
    {:ok, word} = Slovo.Words.upsert(word_attrs(attrs), status)
    word
  end

  @doc "Sets an app env value for one test and restores it afterwards."
  def put_app_env(key, value) do
    old = Application.fetch_env(:slovo, key)
    Application.put_env(:slovo, key, value)

    on_exit(fn ->
      case old do
        {:ok, v} -> Application.put_env(:slovo, key, v)
        :error -> Application.delete_env(:slovo, key)
      end
    end)
  end
end
