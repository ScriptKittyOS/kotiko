# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.WiktionaryPassTest do
  # Slice 49 §4a: saved words get their pronunciation from Wiktionary in the background,
  # one at a time, with the page fetcher passed in.
  use Kotiko.DataCase, async: false
  alias Kotiko.{Pronounce, WiktionaryPass}

  @page ~s(<h2>Russian</h2><h3>Pronunciation</h3><span class="IPA">[ˈɛtə]</span><h3>Pronoun</h3>)

  setup do
    Pronounce.clear_cache()
    Repo.query!("DELETE FROM maintenance_jobs WHERE name = 'wiktionary_pronunciations'")
    :ok
  end

  defp eto(attrs \\ %{}) do
    word_fixture(
      Map.merge(
        %{
          native: "это",
          romanization: "eto",
          gloss: "this",
          forms: ["this"],
          pronunciation: "eh-TO",
          pronunciation_source: "model"
        },
        attrs
      )
    )
  end

  defp page(_title), do: {:ok, @page}

  test "a saved word gets Wiktionary's pronunciation and stress mark, once" do
    w = eto()
    assert w.pronunciation_source == "model"
    assert {:continue, uuid} = WiktionaryPass.step(fetch_page: &page/1)
    assert uuid == w.uuid
    after_ = Words.get(w.uuid)

    assert {after_.pronunciation, after_.pronunciation_source, after_.native_vocalized} ==
             {"EH-ta", "wiktionary", "э́то"}

    assert :done = WiktionaryPass.step(fetch_page: fn _ -> flunk("asked again") end)
  end

  test "the learner's own pronunciation is never touched" do
    w = eto()
    {:ok, _} = Words.update(w.uuid, %{pronunciation: "EH-to"})
    assert :done = WiktionaryPass.step(fetch_page: fn _ -> flunk("asked") end)
    assert %{pronunciation: "EH-to", pronunciation_source: "user"} = Words.get(w.uuid)
  end

  test "a word Wiktionary can't help keeps the model's and isn't asked about again" do
    w = eto()
    assert {:continue, _} = WiktionaryPass.step(fetch_page: fn _ -> :none end)
    assert %{pronunciation: "eh-TO", pronunciation_source: "model"} = Words.get(w.uuid)
    assert :done = WiktionaryPass.step(fetch_page: fn _ -> flunk("asked again") end)
  end

  test "when Wiktionary can't be reached it waits ten minutes, then tries again" do
    w = eto()
    now = Words.now()

    assert {:wait, at} =
             WiktionaryPass.step(now: now, fetch_page: fn _ -> {:error, :rate_limited} end)

    assert DateTime.diff(at, now) == 600
    assert {:wait, ^at} = WiktionaryPass.step(now: DateTime.add(now, 60), fetch_page: &page/1)
    assert {:continue, _} = WiktionaryPass.step(now: DateTime.add(now, 601), fetch_page: &page/1)
    assert %{pronunciation: "EH-ta"} = Words.get(w.uuid)
  end

  test "languages without lexical stress, and bases without a key, are left alone" do
    word_fixture(%{lang: "ja", native: "犬", romanization: "inu", gloss: "dog", forms: ["dog"]})
    word_fixture(%{base_lang: "fr", gloss: "oui", forms: ["oui"]})
    assert :done = WiktionaryPass.step(fetch_page: fn _ -> flunk("asked") end)
  end
end
