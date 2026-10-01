defmodule Slovo.Bot do
  @moduledoc """
  Long-polls Telegram. Text or voice in, word cards out.

    "what's da"            -> card with [Add] [Skip]
    "add sobaka"           -> saved immediately, card with [Undo]
    "how do you say cat"   -> card with [Add] [Skip]
    /list, /remove <word>, /help
  """
  use GenServer
  require Logger
  alias Slovo.{LLM, Telegram, Transcriber, Word, Words}

  @help """
  Send me a word any way you like, typed or as a voice note:

  • "what's da" or "what does spasibo mean"
  • "how do you say dog"
  • "add sobaka" (saves it straight away)

  Tap Add on a card and that word starts replacing its English on web pages.

  /list  your newest words
  /remove <word>  stop replacing a word
  """

  def start_link(_), do: GenServer.start_link(__MODULE__, 0, name: __MODULE__)

  @impl true
  def init(offset) do
    send(self(), :poll)
    {:ok, offset}
  end

  @impl true
  def handle_info(:poll, offset) do
    params = %{offset: offset, timeout: 30, allowed_updates: ["message", "callback_query"]}

    offset =
      case Telegram.call("getUpdates", params, receive_timeout: 45_000) do
        {:ok, updates} ->
          Enum.each(updates, fn u ->
            Task.Supervisor.start_child(Slovo.TaskSup, fn -> safe_handle(u) end)
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

  # ── routing ──────────────────────────────────────────────────────────

  defp safe_handle(update) do
    handle(update)
  rescue
    e ->
      Logger.error(Exception.format(:error, e, __STACKTRACE__))
      if chat = chat_id(update), do: Telegram.send_message(chat, "Error: #{Exception.message(e)}")
  end

  defp handle(update) do
    from =
      get_in(update, ["message", "from", "id"]) ||
        get_in(update, ["callback_query", "from", "id"])

    case Application.get_env(:slovo, :allowed_ids, []) do
      [] ->
        if chat = chat_id(update) do
          Telegram.send_message(
            chat,
            "Almost set up. Your Telegram ID is #{from}.\n\n" <>
              "Put ALLOWED_TELEGRAM_IDS=#{from} in .env and restart the server."
          )
        end

      allowed ->
        if from in allowed, do: dispatch(update), else: :ignore
    end
  end

  defp chat_id(update) do
    get_in(update, ["message", "chat", "id"]) ||
      get_in(update, ["callback_query", "message", "chat", "id"])
  end

  defp dispatch(%{"callback_query" => cq}), do: handle_callback(cq)
  defp dispatch(%{"message" => %{"text" => "/" <> _ = text} = msg}), do: handle_command(text, msg)
  defp dispatch(%{"message" => %{"text" => text} = msg}), do: handle_text(text, msg)
  defp dispatch(%{"message" => %{"voice" => %{"file_id" => fid}} = msg}), do: handle_voice(fid, msg)
  defp dispatch(%{"message" => %{"audio" => %{"file_id" => fid}} = msg}), do: handle_voice(fid, msg)
  defp dispatch(_), do: :ignore

  # ── commands ─────────────────────────────────────────────────────────

  defp handle_command(text, msg) do
    chat = msg["chat"]["id"]
    [cmd | rest] = String.split(text, ~r/\s+/, parts: 2)
    cmd = cmd |> String.split("@") |> hd()
    arg = rest |> List.first("") |> String.trim()

    case cmd do
      c when c in ["/start", "/help"] ->
        Telegram.send_message(chat, @help)

      "/list" ->
        case Words.recent(15) do
          [] ->
            Telegram.send_message(chat, "No words yet. Send me one.")

          words ->
            lines = Enum.map(words, &"#{&1.native}  =  #{&1.english}")
            header = "#{Words.count_active()} words. Newest:\n\n"
            Telegram.send_message(chat, header <> Enum.join(lines, "\n"))
        end

      "/remove" when arg == "" ->
        Telegram.send_message(chat, "Which word? e.g. /remove да")

      "/remove" ->
        case Words.find(arg) do
          [] ->
            Telegram.send_message(chat, "No saved word matches \"#{arg}\".")

          matches ->
            Enum.each(matches, &Words.delete/1)
            removed = Enum.map_join(matches, ", ", &"#{&1.native} (#{&1.english})")
            Telegram.send_message(chat, "Removed #{removed}. Pages show the English again.")
        end

      "/add" when arg != "" ->
        handle_text(arg, msg, "add")

      _ ->
        Telegram.send_message(chat, @help)
    end
  end

  # ── text & voice ─────────────────────────────────────────────────────

  defp handle_voice(file_id, msg) do
    chat = msg["chat"]["id"]

    if Transcriber.configured?() do
      Telegram.typing(chat)

      with {:ok, audio} <- Telegram.download_file(file_id),
           {:ok, text} <- Transcriber.transcribe(audio) do
        Telegram.send_message(chat, "🎙 \"#{text}\"")
        handle_text(text, msg)
      else
        {:error, reason} -> Telegram.send_message(chat, "Couldn't transcribe that: #{reason}")
      end
    else
      Telegram.send_message(
        chat,
        "Voice notes aren't switched on yet (TRANSCRIBE_URL is empty). " <>
          "Type it, or use your keyboard's mic button to dictate a text message."
      )
    end
  end

  defp handle_text(text, msg, force_intent \\ nil) do
    chat = msg["chat"]["id"]
    Telegram.typing(chat)

    case LLM.interpret(text) do
      {:ok, %{words: [], reply: reply}} ->
        Telegram.send_message(
          chat,
          reply || "I couldn't find a word in that. Try \"what's da\" or \"add sobaka\"."
        )

      {:ok, %{intent: intent, words: words}} ->
        intent = force_intent || intent
        Enum.each(words, &present_word(chat, &1, intent, text))

      {:error, reason} ->
        Telegram.send_message(chat, "The language model failed: #{reason}")
    end
  end

  defp present_word(chat, attrs, intent, source) do
    attrs = Map.put(attrs, :source_text, source)

    case Words.get_by(attrs.lang, attrs.native) do
      %Word{status: "active"} = w ->
        Telegram.send_message(chat, card(w) <> "\n\n✓ Already in your list.", [
          [btn("Remove", "del:#{w.id}")]
        ])

      _ when intent == "add" ->
        {:ok, w} = Words.upsert(attrs, "active")

        Telegram.send_message(chat, card(w) <> "\n\n✅ Added. It shows up on pages now.", [
          [btn("Undo", "del:#{w.id}")]
        ])

      _ ->
        {:ok, w} = Words.upsert(attrs, "pending")

        Telegram.send_message(chat, card(w), [
          [btn("✅ Add", "add:#{w.id}"), btn("Skip", "skip:#{w.id}")]
        ])
    end
  end

  # ── buttons ──────────────────────────────────────────────────────────

  defp handle_callback(%{"id" => id, "data" => data, "message" => m}) do
    chat = m["chat"]["id"]
    mid = m["message_id"]

    with [action, sid] <- String.split(data, ":", parts: 2),
         {wid, ""} <- Integer.parse(sid),
         %Word{} = w <- Words.get(wid) do
      case action do
        "add" ->
          {:ok, w} = Words.activate(w)
          Telegram.edit_message(chat, mid, card(w) <> "\n\n✅ Added. It shows up on pages now.")
          Telegram.answer_callback(id, "Added")

        "skip" ->
          if w.status == "pending", do: Words.delete(w)
          Telegram.edit_message(chat, mid, card(w) <> "\n\nSkipped.")
          Telegram.answer_callback(id)

        "del" ->
          Words.delete(w)
          Telegram.edit_message(chat, mid, card(w) <> "\n\n🗑 Removed.")
          Telegram.answer_callback(id, "Removed")

        _ ->
          Telegram.answer_callback(id)
      end
    else
      _ -> Telegram.answer_callback(id, "That word is already gone.")
    end
  end

  defp handle_callback(%{"id" => id}), do: Telegram.answer_callback(id)

  # ── formatting ───────────────────────────────────────────────────────

  defp card(%Word{} = w) do
    flag = if w.lang == "zh", do: "🇨🇳", else: "🇷🇺"
    head = if w.romanization, do: "#{flag} #{w.native}  (#{w.romanization})", else: "#{flag} #{w.native}"

    [head, "= #{w.english}", w.note]
    |> Enum.reject(&(&1 in [nil, ""]))
    |> Enum.join("\n")
  end

  defp btn(text, data), do: %{text: text, callback_data: data}
end
