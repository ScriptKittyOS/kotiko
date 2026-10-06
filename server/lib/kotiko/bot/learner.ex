# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Bot.Learner do
  @moduledoc """
  Who the bot is talking to (slice 41 section 9): which language it writes in, which
  languages it looks meanings up in, and whose pronunciation a card shows.

  **The learner's language** (`wanted`) is the first of:

  1. their `/language` choice (`Kotiko.Bot.Prefs`);
  2. the interface language they chose in the extension (`Kotiko.Profile`'s `ui_lang`);
  3. the `language_code` their Telegram app sends with each update, as a base tag;
  4. their primary base language.

  **The bot's locale** is the first of those with a shipped catalog
  (`server/priv/locales/<locale>`, matched by tag then primary subtag), else English, the
  source locale. When that isn't the learner's language, the bot says once that Kotiko
  isn't translated into it yet.

  **Base languages** come from the profile; without one, from the Telegram app's language;
  without that, from the saved words' bases; without any, the source locale. Every case
  but the profile is a guess, and the first card says which languages it used.

  **The pronunciation** shown is the record's whose base is the learner's language when
  they read it, else the primary base's: a Spanish reader with Spanish and English bases
  sees the Spanish-key respelling even while the bot's text falls back to English.
  """
  alias Kotiko.{Bot.Prefs, I18n, Lang, Profile, Words}

  defstruct [
    :telegram_id,
    :locale,
    :wanted,
    :pron_base,
    bases: [],
    bases_source: :default,
    noted: %{}
  ]

  @doc """
  The learner behind a Telegram user id and `language_code` (nil when the app sent none).
  `available` is the shipped locales (tests pass others).
  """
  def resolve(telegram_id, language_code, available \\ I18n.locales()) do
    profile = Profile.get()
    prefs = Prefs.get(telegram_id)
    app = base_tag(language_code)
    {bases, source} = bases(profile, app)

    wanted =
      [prefs.locale, profile && profile.ui_lang, app, hd(bases)]
      |> Enum.reject(&is_nil/1)
      |> hd()

    locale =
      Enum.find_value(
        [prefs.locale, profile && profile.ui_lang, app, hd(bases)],
        I18n.default(),
        &(&1 && I18n.shipped(&1, available))
      )

    %__MODULE__{
      telegram_id: telegram_id,
      locale: locale,
      wanted: wanted,
      bases: bases,
      bases_source: source,
      pron_base: Enum.find(bases, hd(bases), &Lang.same_base?(&1, wanted)),
      noted: prefs.noted
    }
  end

  @doc "The locale for an update when nothing else can be read (the bot's error path)."
  def fallback_locale(language_code, available \\ I18n.locales()),
    do: I18n.shipped(base_tag(language_code) || "", available) || I18n.default()

  defp bases(%{base_langs: [_ | _] = bases}, _app), do: {bases, :profile}
  defp bases(_profile, app) when is_binary(app), do: {[app], :telegram}

  defp bases(_profile, _app) do
    case Words.base_langs_in_use() do
      [] -> {[I18n.default()], :default}
      in_use -> {in_use, :words}
    end
  end

  defp base_tag(code) when is_binary(code) and byte_size(code) in 1..35, do: Lang.base_tag(code)
  defp base_tag(_code), do: nil

  @doc """
  True when the bot writes in another language than the learner's: the one-time note
  "Kotiko isn't translated into <language> yet" is due (unless already shown for it).
  """
  def untranslated?(%__MODULE__{wanted: wanted, locale: locale}),
    do: Lang.primary(wanted) != Lang.primary(locale)

  @doc "True when the base languages are a guess (no profile)."
  def guessed_bases?(%__MODULE__{bases_source: source}), do: source != :profile
end
