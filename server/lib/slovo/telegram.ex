defmodule Slovo.Telegram do
  @moduledoc "Minimal Telegram Bot API client (long polling, no webhook needed)."

  defp token, do: Application.fetch_env!(:slovo, :telegram_token)

  def call(method, params, opts \\ []) do
    params = params |> Enum.reject(fn {_k, v} -> is_nil(v) end) |> Map.new()

    case Req.post("https://api.telegram.org/bot#{token()}/#{method}",
           json: params,
           receive_timeout: Keyword.get(opts, :receive_timeout, 15_000),
           retry: false
         ) do
      {:ok, %Req.Response{body: %{"ok" => true, "result" => result}}} -> {:ok, result}
      {:ok, %Req.Response{status: s, body: body}} -> {:error, "telegram #{s}: #{inspect(body)}"}
      {:error, e} -> {:error, if(is_exception(e), do: Exception.message(e), else: inspect(e))}
    end
  end

  def send_message(chat_id, text, buttons \\ nil) do
    markup = if buttons, do: %{inline_keyboard: buttons}
    call("sendMessage", %{chat_id: chat_id, text: text, reply_markup: markup})
  end

  def edit_message(chat_id, message_id, text) do
    call("editMessageText", %{chat_id: chat_id, message_id: message_id, text: text})
  end

  def answer_callback(callback_id, text \\ nil) do
    call("answerCallbackQuery", %{callback_query_id: callback_id, text: text})
  end

  def typing(chat_id), do: call("sendChatAction", %{chat_id: chat_id, action: "typing"})

  def download_file(file_id) do
    with {:ok, %{"file_path" => path}} <- call("getFile", %{file_id: file_id}),
         {:ok, %Req.Response{status: 200, body: body}} <-
           Req.get("https://api.telegram.org/file/bot#{token()}/#{path}",
             decode_body: false,
             receive_timeout: 60_000
           ) do
      {:ok, body}
    else
      {:ok, %Req.Response{status: s}} -> {:error, "file download returned #{s}"}
      {:error, e} when is_binary(e) -> {:error, e}
      {:error, e} -> {:error, if(is_exception(e), do: Exception.message(e), else: inspect(e))}
      other -> {:error, inspect(other)}
    end
  end
end
