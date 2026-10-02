# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.DataCase do
  @moduledoc """
  Tests that touch the database. Each test runs in a sandbox transaction that is rolled
  back afterwards. SQLite allows one writer at a time, so these tests run with
  `async: false`; the shared sandbox then also covers processes the test starts.
  """
  use ExUnit.CaseTemplate
  alias Ecto.Adapters.SQL.Sandbox

  using do
    quote do
      alias Kotiko.{Repo, Word, Words}
      import Kotiko.DataCase
    end
  end

  setup tags do
    setup_sandbox(tags)
    :ok
  end

  def setup_sandbox(tags) do
    pid = Sandbox.start_owner!(Kotiko.Repo, shared: not tags[:async])
    on_exit(fn -> Sandbox.stop_owner(pid) end)

    # The sandbox's transaction is deferred, unlike the server's (immediate): a test that
    # reads and then writes would get "Database busy" at once if the previous test's
    # connection hadn't rolled back yet. Taking the write lock first waits for it instead.
    Ecto.Adapters.SQL.query!(
      Kotiko.Repo,
      "UPDATE sync_state SET last_seq = last_seq WHERE id = 1"
    )
  end

  @doc "A word as a client or the model sends it (slice 07 fields, string or atom keys)."
  def word_attrs(attrs \\ %{}) do
    Map.merge(
      %{
        lang: "ru",
        language: "Russian",
        native: "да",
        romanization: "da",
        base_lang: "en",
        gloss: "yes",
        forms: ["yes"],
        note: "The everyday yes."
      },
      Map.new(attrs)
    )
  end

  @doc "Checks `attrs` like `Kotiko.WordSpec.validate_word/2` and returns the attributes to save."
  def valid_attrs(attrs \\ %{}, opts \\ []) do
    {:ok, valid, _dropped} = Kotiko.WordSpec.validate_word(word_attrs(attrs), opts)
    valid
  end

  @doc "Saves a word through `Kotiko.Words.add/2` and returns it."
  def word_fixture(attrs \\ %{}, status \\ "active") do
    {:ok, %{word: word}} = Kotiko.Words.add(%{valid_attrs(attrs) | status: status})
    word
  end

  @doc "Sets an app env value for one test and restores it afterwards."
  def put_app_env(key, value) do
    old = Application.fetch_env(:kotiko, key)
    Application.put_env(:kotiko, key, value)

    on_exit(fn ->
      case old do
        {:ok, v} -> Application.put_env(:kotiko, key, v)
        :error -> Application.delete_env(:kotiko, key)
      end
    end)
  end
end
