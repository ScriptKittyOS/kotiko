# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Bot do
  @moduledoc """
  Long-polls Telegram. Text or voice in, word cards out.

    "what's da"            -> card with [Add] [Skip]
    "add sobaka"           -> saved immediately, card with [Undo]
    "how do you say cat"   -> card with [Add] [Skip]
    "shukran"              -> any language works; the model works out which one
    /list [language], /languages, /remove <word>, /bases, /language, /help

  The bot speaks the learner's language (slice 41 section 9): every text it sends comes
  from `Kotiko.I18n` in the locale `Kotiko.Bot.Learner` picks, and lookups ask for
  meanings in the learner's base languages (`Kotiko.Profile`). A card shows one target
  word with a meaning line per base, and its buttons carry the word's public id (UUID).
  """
  use GenServer
  require Logger

  alias Kotiko.{
    Bot.Learner,
    Bot.Prefs,
    I18n,
    Lang,
    Lookup,
    Profile,
    Pronunciation,
    Spec,
    Telegram,
    Text,
    Transcriber,
    UUID7,
    Word,
    Words
  }

  # Telegram's command menu, with the key of each description (section 9). Command names
  # must be ASCII lowercase, so they are the same in every locale.
  @commands [
    {"list", "bot_command_list"},
    {"languages", "bot_command_languages"},
    {"remove", "bot_command_remove"},
    {"bases", "bot_command_bases"},
    {"language", "bot_command_language"},
    {"help", "bot_command_help"}
  ]

  # A pronunciation written from this dictionary's IPA (slice 49 §4a). A name, not text.
  @dictionary "Wiktionary"

  def start_link(_), do: GenServer.start_link(__MODULE__, 0, name: __MODULE__)

  @impl true
  def init(offset) do
    send(self(), :commands)
    send(self(), :poll)
    {:ok, offset}
  end

  @impl true
  def handle_info(:commands, offset) do
    set_commands()
    {:noreply, offset}
  end

  def handle_info(:poll, offset) do
    params = %{offset: offset, timeout: 30, allowed_updates: ["message", "callback_query"]}

    offset =
      case Telegram.call("getUpdates", params, receive_timeout: 45_000) do
        {:ok, updates} ->
          Enum.each(updates, fn u ->
            Task.Supervisor.start_child(Kotiko.TaskSup, fn -> handle_update(u) end)
          end)

          case List.last(updates) do
            nil -> offset
            last -> last["update_id"] + 1
          end

        {:error, reason} ->
          Logger.warning("Telegram poll failed: #{reason}")
          Process.sleep(3_000)
          offset
      end

    send(self(), :poll)
    {:noreply, offset}
  end

  @doc """
  Sets the command menu (`setMyCommands`) once per shipped locale: the default locale's
  for every Telegram app, each other one for apps in its language. Failures are logged.
  """
  def set_commands(available \\ I18n.locales()) do
    for locale <- Enum.sort_by(available, &(&1 != I18n.default())) do
      commands =
        for {cmd, key} <- @commands, do: %{command: cmd, description: I18n.t(locale, key)}

      code = if locale != I18n.default(), do: Lang.primary(locale)

      case Telegram.call("setMyCommands", %{commands: commands, language_code: code}) do
        {:ok, _} -> :ok
        {:error, reason} -> Logger.warning("Telegram setMyCommands failed: #{reason}")
      end
    end

    :ok
  end

  # ── routing ──────────────────────────────────────────────────────────

  @doc """
  Handles one update from getUpdates. Public so tests can feed it updates directly.

  A crash never reaches the chat as exception text: the learner reads slice 25's
  `error_internal_ref` with a short reference, and the log line carries the same one.
  """
  def handle_update(update) do
    handle(update)
  rescue
    e ->
      ref = Base.encode16(:crypto.strong_rand_bytes(4), case: :lower)

      Logger.error(
        "Telegram update failed (ref #{ref}): " <> Exception.format(:error, e, __STACKTRACE__)
      )

      if chat = chat_id(update) do
        locale = Learner.fallback_locale(language_code(update))
        Telegram.send_message(chat, I18n.t(locale, "error_internal_ref", %{ref: ref}))
      end
  end

  defp handle(update) do
    from = sender(update)

    case Application.get_env(:kotiko, :allowed_ids, []) do
      [] ->
        if chat = chat_id(update) do
          locale = Learner.fallback_locale(language_code(update))
          Telegram.send_message(chat, I18n.t(locale, "bot_setup_your_id", %{id: from}))
        end

      allowed ->
        if from in allowed, do: dispatch(update, context(update)), else: :ignore
    end
  end

  defp sender(update) do
    get_in(update, ["message", "from", "id"]) || get_in(update, ["callback_query", "from", "id"])
  end

  # The IETF tag of the user's Telegram app (sometimes absent).
  defp language_code(update) do
    get_in(update, ["message", "from", "language_code"]) ||
      get_in(update, ["callback_query", "from", "language_code"])
  end

  defp chat_id(update) do
    get_in(update, ["message", "chat", "id"]) ||
      get_in(update, ["callback_query", "message", "chat", "id"])
  end

  defp context(update) do
    code = language_code(update)

    %{
      chat: chat_id(update),
      language_code: code,
      learner: Learner.resolve(sender(update), code)
    }
  end

  defp dispatch(%{"callback_query" => cq}, ctx), do: handle_callback(cq, ctx)

  defp dispatch(%{"message" => %{"text" => "/" <> _ = text}}, ctx),
    do: handle_command(text, ctx)

  defp dispatch(%{"message" => %{"text" => text}}, ctx), do: handle_text(text, ctx)

  defp dispatch(%{"message" => %{"voice" => %{"file_id" => fid}}}, ctx),
    do: handle_voice(fid, ctx)

  defp dispatch(%{"message" => %{"audio" => %{"file_id" => fid}}}, ctx),
    do: handle_voice(fid, ctx)

  defp dispatch(_, _ctx), do: :ignore

  # ── commands ─────────────────────────────────────────────────────────

  defp handle_command(text, ctx) do
    [cmd | rest] = String.split(text, ~r/\s+/, parts: 2)
    cmd = cmd |> String.split("@") |> hd() |> String.downcase()
    arg = rest |> List.first("") |> String.trim()

    case cmd do
      c when c in ["/start", "/help"] -> reply(ctx, t(ctx, "bot_help"))
      "/list" -> list(ctx, arg)
      "/languages" -> languages(ctx)
      "/remove" when arg == "" -> reply(ctx, t(ctx, "bot_remove_which"))
      "/remove" -> remove(ctx, arg)
      "/bases" -> bases(ctx, arg)
      "/language" -> language(ctx, arg)
      "/add" when arg != "" -> handle_text(arg, ctx, "add")
      _ -> reply(ctx, t(ctx, "bot_help"))
    end
  end

  defp list(ctx, arg) do
    langs = if arg == "", do: nil, else: Words.langs_matching(arg)

    case {langs, Words.recent(15, langs)} do
      {[], _} ->
        reply(ctx, t(ctx, "bot_list_none_in", %{term: arg}))

      {_, []} ->
        reply(ctx, t(ctx, "bot_list_none"))

      {_, words} ->
        lines =
          Enum.map(words, fn w ->
            t(ctx, "bot_list_line", %{
              word: w.native,
              gloss: w.gloss,
              language: language_name(ctx, w.lang)
            })
          end)

        header = t(ctx, "bot_list_header", %{count: Words.count_active()})
        reply(ctx, header <> "\n\n" <> Enum.join(lines, "\n"))
    end
  end

  defp languages(ctx) do
    case Words.languages() do
      [] ->
        reply(ctx, t(ctx, "bot_languages_none"))

      langs ->
        lines =
          Enum.map(langs, fn l ->
            t(ctx, "bot_languages_line", %{language: language_name(ctx, l.lang), count: l.count})
          end)

        reply(ctx, Enum.join(lines, "\n"))
    end
  end

  defp remove(ctx, arg) do
    case Words.find(arg) do
      [] ->
        reply(ctx, t(ctx, "bot_remove_none", %{term: arg}))

      matches ->
        Enum.each(matches, &Words.delete/1)
        removed = Enum.map_join(matches, ", ", &"#{&1.native} (#{&1.gloss})")
        reply(ctx, t(ctx, "bot_removed", %{words: removed}))
    end
  end

  # /bases: show the base languages, or set them ("/bases es en", names work too).
  defp bases(ctx, "") do
    reply(
      ctx,
      t(ctx, "bot_bases_show", %{languages: endonyms(ctx.learner.bases), max: Profile.max()})
    )
  end

  defp bases(ctx, arg) do
    tags = arg |> String.split(~r/[\s,]+/u, trim: true) |> Enum.map(&known_tag/1)

    with true <- Enum.all?(tags, &is_binary/1),
         {:ok, profile} <- Profile.put_bases(tags) do
      reply(ctx, t(ctx, "bot_bases_set", %{languages: endonyms(profile.base_langs)}))
    else
      _ -> reply(ctx, t(ctx, "bot_bases_invalid", %{max: Profile.max()}))
    end
  end

  # /language: show the bot's language, choose one, or follow the Telegram app ("auto").
  defp language(ctx, "") do
    reply(ctx, t(ctx, "bot_language_show", %{language: Lang.endonym(ctx.learner.locale)}))
  end

  defp language(ctx, arg) do
    choice = if String.downcase(arg) == "auto", do: :auto, else: known_tag(arg)

    case choice do
      nil ->
        reply(ctx, t(ctx, "bot_language_invalid"))

      :auto ->
        Prefs.put_locale(ctx.learner.telegram_id, nil)
        ctx = refresh(ctx)
        reply(ctx, t(ctx, "bot_language_auto"))

      tag ->
        Prefs.put_locale(ctx.learner.telegram_id, tag)
        ctx = refresh(ctx)

        if Learner.untranslated?(ctx.learner) do
          # The answer is the note itself: Kotiko can't write in that language yet.
          Prefs.noted(ctx.learner.telegram_id, "untranslated", ctx.learner.wanted)
          send_text(ctx, untranslated(ctx))
        else
          reply(ctx, t(ctx, "bot_language_set", %{language: Lang.endonym(tag)}))
        end
    end
  end

  defp refresh(ctx),
    do: %{ctx | learner: Learner.resolve(ctx.learner.telegram_id, ctx.language_code)}

  # A language a learner names by code or by name in any shipped locale ("es", "español",
  # "Spanish"), as a base tag; nil for anything Kotiko doesn't know.
  defp known_tag(term) do
    tag =
      case Lang.find(term) do
        [code] -> code
        _ -> if byte_size(term) <= 35, do: Lang.base_tag(term)
      end

    if tag && Lang.known?(tag), do: Lang.base_tag(tag)
  end

  defp endonyms(tags), do: Enum.map_join(tags, ", ", &Lang.endonym/1)

  # ── text & voice ─────────────────────────────────────────────────────

  defp handle_voice(file_id, ctx) do
    if Transcriber.configured?() do
      Telegram.typing(ctx.chat)

      with {:ok, audio} <- Telegram.download_file(file_id),
           {:ok, text} <- Transcriber.transcribe(audio) do
        reply(ctx, t(ctx, "bot_voice_heard", %{text: text}))
        handle_text(text, ctx)
      else
        {:error, reason} ->
          Logger.warning("Telegram voice note failed: #{inspect(reason)}")
          reply(ctx, t(ctx, "bot_voice_failed"))
      end
    else
      reply(ctx, t(ctx, "bot_voice_off"))
    end
  end

  defp handle_text(text, ctx, force_intent \\ nil) do
    Telegram.typing(ctx.chat)
    opts = [base_langs: ctx.learner.bases, origin: "telegram", budget: :telegram]

    case Lookup.interpret(text, opts) do
      {:ok, %{words: [], rejected: [_ | _] = rejected}} ->
        lines =
          Enum.map(rejected, fn r ->
            t(ctx, "bot_rejected_line", %{word: r.native || "?", reason: rejection(ctx, r.reason)})
          end)

        reply(ctx, t(ctx, "bot_rejected_intro") <> "\n" <> Enum.join(lines, "\n"))

      {:ok, %{words: [], reply: answer}} ->
        reply(ctx, answer || t(ctx, "bot_no_word"))

      {:ok, %{intent: intent, words: words}} ->
        intent = force_intent || intent
        words |> groups() |> Enum.each(&present(ctx, &1, intent, text))

      # One plain line per slice 25 code, from the catalog, in the learner's locale.
      {:error, e} ->
        reply(ctx, Lookup.message(e.code, e.details, e.retry_at, ctx.learner.locale))
    end
  end

  # The records of each target word (one per base, slice 07), in the model's order.
  defp groups(words) do
    key = fn w -> {w.lang, Text.native_key(w.native), w[:sense] || ""} end
    grouped = Enum.group_by(words, key)
    words |> Enum.map(key) |> Enum.uniq() |> Enum.map(&grouped[&1])
  end

  defp present(ctx, records, intent, source) do
    records = records |> Enum.map(&Map.put(&1, :source_text, source)) |> in_bases(ctx)

    existing =
      Enum.map(records, &Words.get_by_key(&1.lang, &1.native, &1[:sense] || "", &1.base_lang))

    cond do
      Enum.all?(existing, &match?(%Word{status: "active"}, &1)) ->
        send_card(ctx, existing, "bot_card_already", [
          [button(ctx, "bot_button_remove", "del", existing)]
        ])

      intent == "add" ->
        with [_ | _] = saved <- save(ctx, records, "active", explicit: true) do
          send_card(ctx, saved, "bot_card_added", [
            [button(ctx, "bot_button_undo", "del", saved)]
          ])
        end

      true ->
        # A lookup is kept as pending (server-local, never listed) until Add. Records the
        # learner already has are shown as they are.
        active = Enum.filter(existing, &match?(%Word{status: "active"}, &1))
        new = for {r, w} <- Enum.zip(records, existing), w not in active, do: r
        saved = save(ctx, new, "pending", [])

        if saved != [] do
          send_card(ctx, in_bases(active ++ saved, ctx), nil, [
            [
              button(ctx, "bot_button_add", "add", saved),
              button(ctx, "bot_button_skip", "skip", saved)
            ]
          ])
        end
    end
  end

  # Saves each record; one that fails is logged with a reference and the learner reads
  # slice 25's internal error with it, never the reason. Returns the saved words.
  defp save(ctx, records, status, opts) do
    results = Enum.map(records, &Words.add(Map.put(&1, :status, status), opts))

    case for({:error, reason} <- results, do: reason) do
      [] ->
        :ok

      reasons ->
        ref = Base.encode16(:crypto.strong_rand_bytes(4), case: :lower)
        Logger.error("Telegram: a word couldn't be saved (ref #{ref}): #{inspect(reasons)}")
        reply(ctx, t(ctx, "error_internal_ref", %{ref: ref}))
    end

    for {:ok, %{word: w}} <- results, do: w
  end

  # ── buttons ──────────────────────────────────────────────────────────

  defp handle_callback(%{"id" => id, "data" => data, "message" => m}, ctx) do
    chat = m["chat"]["id"]
    mid = m["message_id"]

    with [action, sid] <- String.split(data, ":", parts: 2),
         %Word{} = w <- button_word(sid) do
      group = Words.group(w)

      case action do
        "add" ->
          group
          |> Enum.filter(&(&1.status == "pending" and (&1.id == w.id or in_bases?(&1, ctx))))
          |> Enum.each(&Words.activate/1)

          shown = w |> Words.group() |> in_bases(ctx)
          Telegram.edit_message(chat, mid, card_text(ctx, shown, "bot_card_added"))
          Telegram.answer_callback(id, t(ctx, "bot_toast_added"))

        "skip" ->
          group |> Enum.filter(&(&1.status == "pending")) |> Enum.each(&Words.delete/1)

          Telegram.edit_message(
            chat,
            mid,
            card_text(ctx, in_bases(group, ctx), "bot_card_skipped")
          )

          Telegram.answer_callback(id)

        "del" ->
          Enum.each(group, &Words.delete/1)

          Telegram.edit_message(
            chat,
            mid,
            card_text(ctx, in_bases(group, ctx), "bot_card_removed")
          )

          Telegram.answer_callback(id, t(ctx, "bot_toast_removed"))

        _ ->
          Telegram.answer_callback(id)
      end
    else
      _ -> Telegram.answer_callback(id, t(ctx, "bot_toast_gone"))
    end
  end

  defp handle_callback(%{"id" => id}, _ctx), do: Telegram.answer_callback(id)

  # Buttons carry the word's public id; cards sent before this version carry the row id.
  defp button_word(sid) do
    cond do
      UUID7.valid?(sid) ->
        case Words.get(sid) do
          %Word{deleted_at: nil} = w -> w
          _ -> nil
        end

      match?({_, ""}, Integer.parse(sid)) ->
        sid |> String.to_integer() |> Words.get_row()

      true ->
        nil
    end
  end

  defp button(ctx, key, action, [%Word{uuid: uuid} | _]),
    do: %{text: t(ctx, key), callback_data: "#{action}:#{uuid}"}

  # ── cards (section 9, the popover's layout from slice 19 §1a) ────────

  defp send_card(ctx, words, status_key, buttons) do
    reply(ctx, card_text(ctx, words, status_key) <> bases_note(ctx), buttons)
  end

  defp card_text(ctx, words, nil), do: card(ctx, words)
  defp card_text(ctx, words, key), do: card(ctx, words) <> "\n\n" <> t(ctx, key)

  #   犬 · Japanese              headword · language name in the bot's locale
  #   i-nu                       the pronunciation in the learner's base language
  #   Slowly: …                  the careful form, when there is one
  #   inu · AI-generated         romanization · where the pronunciation came from
  #   = perro                    one meaning line per base, primary first
  #   = dog
  defp card(ctx, words) do
    main = pronunciation_record(ctx, words)
    pron = pronunciation(main)
    careful = careful(main, pron)
    rom = romanization(main, words)
    label = if pron, do: source_label(ctx, main)

    lines =
      if pron do
        [
          joined(pron, if(rom, do: nil, else: label)),
          careful && t(ctx, "bot_card_careful", %{pronunciation: careful}),
          rom && joined(rom, label)
        ]
      else
        [rom]
      end

    [joined(headword(main, words), language_name(ctx, main.lang)) | lines]
    |> Kernel.++(Enum.map(words, &("= " <> &1.gloss)))
    |> Kernel.++([main.note])
    |> Enum.reject(&(&1 in [nil, false, ""]))
    |> Enum.join("\n")
  end

  defp joined(a, nil), do: a
  defp joined(a, b), do: a <> " · " <> b

  # The record whose pronunciation the card shows: the learner's language when they read
  # it, else the primary base's, else the first.
  defp pronunciation_record(ctx, words) do
    l = ctx.learner

    Enum.find(words, &Lang.same_base?(&1.base_lang, l.pron_base)) ||
      Enum.find(words, &Lang.same_base?(&1.base_lang, hd(l.bases))) || hd(words)
  end

  # native_vocalized (the stress mark) for targets whose data says so (ru, uk, be).
  defp headword(main, words) do
    vocalized = Enum.find_value([main | words], &present_text(&1.native_vocalized))

    if vocalized && Pronunciation.facts(main.lang)["stress_marked"],
      do: vocalized,
      else: main.native
  end

  # A respelling that only repeats the word, with no stress to teach, adds nothing (19).
  defp pronunciation(%Word{pronunciation: p, native: native}) do
    with p when is_binary(p) <- present_text(p) do
      flat = fn s -> s |> String.downcase() |> String.replace(~r/[\s\x{2010}-]/u, "") end
      if flat.(p) == flat.(native) and p == String.downcase(p), do: nil, else: p
    end
  end

  defp careful(_main, nil), do: nil

  defp careful(%Word{pronunciation_careful: c}, pron) do
    c = present_text(c)
    if c && String.downcase(c) != String.downcase(pron), do: c
  end

  defp romanization(main, words) do
    rom = Enum.find_value([main | words], &present_text(&1.romanization))
    if rom && String.downcase(rom) != String.downcase(main.native), do: rom
  end

  defp source_label(_ctx, %Word{pronunciation_source: "user"}), do: nil

  defp source_label(ctx, %Word{pronunciation_source: "wiktionary"}),
    do: t(ctx, "bot_pron_checked", %{source: @dictionary})

  defp source_label(ctx, _word), do: t(ctx, "bot_pron_ai")

  defp present_text(v) when is_binary(v) do
    case String.trim(v) do
      "" -> nil
      s -> s
    end
  end

  defp present_text(_), do: nil

  # Records in the learner's bases, primary first; records for other bases go last.
  defp in_bases(words, ctx) do
    bases = ctx.learner.bases

    Enum.sort_by(words, fn w ->
      Enum.find_index(bases, &Lang.same_base?(&1, w.base_lang)) || length(bases)
    end)
  end

  defp in_bases?(word, ctx),
    do: Enum.any?(ctx.learner.bases, &Lang.same_base?(&1, word.base_lang))

  # Names come from the tag, never from the model (slice 08), in the bot's locale.
  defp language_name(ctx, tag), do: Lang.name(tag, ctx.learner.locale)

  defp rejection(ctx, "script_mismatch"), do: t(ctx, "bot_rejected_script_mismatch")
  defp rejection(ctx, "same_as_gloss"), do: t(ctx, "bot_rejected_same_as_gloss")
  defp rejection(ctx, "target_is_base"), do: t(ctx, "bot_rejected_same_as_gloss")
  defp rejection(ctx, "invalid_lang"), do: t(ctx, "bot_rejected_invalid_lang")

  defp rejection(ctx, "sign_language_unsupported"),
    do: t(ctx, "bot_rejected_sign_language_unsupported")

  defp rejection(ctx, "too_many_words"),
    do: t(ctx, "bot_rejected_too_many_words", %{max: Spec.rule(:max_words)})

  defp rejection(ctx, _), do: t(ctx, "bot_rejected_other")

  # ── sending ──────────────────────────────────────────────────────────

  defp t(ctx, key, vars \\ %{}), do: I18n.t(ctx.learner.locale, key, vars)

  # Every reply starts, once, with "Kotiko isn't translated into <language> yet" when the
  # bot writes in another language than the learner's.
  defp reply(ctx, text, buttons \\ nil) do
    l = ctx.learner

    if Learner.untranslated?(l) and Prefs.get(l.telegram_id).noted["untranslated"] != l.wanted do
      Prefs.noted(l.telegram_id, "untranslated", l.wanted)
      send_text(ctx, untranslated(ctx) <> "\n\n" <> text, buttons)
    else
      send_text(ctx, text, buttons)
    end
  end

  defp send_text(ctx, text, buttons \\ nil), do: Telegram.send_message(ctx.chat, text, buttons)

  defp untranslated(ctx),
    do: t(ctx, "bot_untranslated", %{language: Lang.endonym(ctx.learner.wanted)})

  # The first card while the base languages are a guess (no profile) says which ones.
  defp bases_note(ctx) do
    l = ctx.learner
    bases = Enum.join(l.bases, ",")

    if Learner.guessed_bases?(l) and Prefs.get(l.telegram_id).noted["bases"] != bases do
      Prefs.noted(l.telegram_id, "bases", bases)
      "\n\n" <> t(ctx, "bot_meanings_in", %{languages: endonyms(l.bases)})
    else
      ""
    end
  end
end
