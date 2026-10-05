# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.I18n do
  @moduledoc """
  The server's messages (slice 25 §1, slice 50 §8), from
  `priv/locales/<locale>/messages.json`: `error_<code>` keys with `{name}` placeholders.

  Error responses carry a stable `code` for programs and a `message` for people (curl,
  scripts, the Telegram bot). The extension ignores `message` and words the code itself.
  The message's language follows the request's `Accept-Language` among the locales
  shipped here, else English; a key missing from a locale falls back to English.
  Only English ships today (DECISIONS 2026-10-05); a translator adds a folder.
  """

  @dir Path.expand("../../priv/locales", __DIR__)
  @default "en"

  @catalogs (for locale <- File.ls!(@dir),
                 file = Path.join([@dir, locale, "messages.json"]),
                 File.regular?(file),
                 into: %{} do
               @external_resource file
               messages = file |> File.read!() |> Jason.decode!()
               {locale, Map.new(messages, fn {key, entry} -> {key, entry["message"]} end)}
             end)

  @doc "The shipped locales."
  def locales, do: Map.keys(@catalogs)

  @doc "The default locale, used when nothing in `Accept-Language` is shipped."
  def default, do: @default

  @doc """
  The best shipped locale for an `Accept-Language` header (or a conn): exact tags first,
  then their primary language, in the header's order of preference (`q`).
  """
  def locale(conn_or_header, available \\ locales())

  def locale(%Plug.Conn{} = conn, available),
    do: conn |> Plug.Conn.get_req_header("accept-language") |> Enum.join(",") |> locale(available)

  def locale(header, available) when is_binary(header) do
    header
    |> String.split(",", trim: true)
    |> Enum.map(&parse_range/1)
    |> Enum.reject(&is_nil/1)
    |> Enum.sort_by(fn {_tag, q} -> q end, :desc)
    |> Enum.find_value(@default, fn {tag, _q} -> match(tag, available) end)
  end

  def locale(_, _available), do: @default

  defp parse_range(range) do
    [tag | params] = range |> String.trim() |> String.split(";")
    q = Enum.find_value(params, 1.0, &quality/1)
    tag = tag |> String.trim() |> String.downcase() |> String.replace("_", "-")
    if tag != "" and q > 0, do: {tag, q}
  end

  defp quality(param) do
    with "q=" <> value <- String.trim(param),
         {q, _} <- Float.parse(value) do
      q
    else
      _ -> nil
    end
  end

  @doc """
  The shipped locale for one language tag, by the exact tag, then its primary language
  (`es-419` -> `es`), or nil when none is shipped.
  """
  def shipped(tag, available \\ locales())

  def shipped(tag, available) when is_binary(tag),
    do: match(tag |> String.trim() |> String.downcase() |> String.replace("_", "-"), available)

  def shipped(_tag, _available), do: nil

  defp match("*", _available), do: nil
  defp match("", _available), do: nil

  defp match(tag, available) do
    primary = tag |> String.split("-") |> hd()
    Enum.find(available, &(String.downcase(&1) == tag)) || Enum.find(available, &(&1 == primary))
  end

  @doc "The message for `key` in `locale`, its placeholders filled; English when missing."
  def t(locale, key, vars \\ %{}) do
    template = get_in(@catalogs, [locale, key]) || get_in(@catalogs, [@default, key]) || key

    Regex.replace(~r/\{([a-z_]+)\}/, template, fn whole, name ->
      case Map.fetch(vars, name) do
        {:ok, value} -> to_string(value)
        :error -> lookup_atom(vars, name, whole)
      end
    end)
  end

  defp lookup_atom(vars, name, whole) do
    Enum.find_value(vars, whole, fn {k, v} -> if to_string(k) == name, do: to_string(v) end)
  end

  @doc "True when `key` has a message in English."
  def has?(key), do: Map.has_key?(@catalogs[@default], key)

  @doc """
  The message for an error code: `error_<code>_<reason>`, then `error_<code>_<field>`, then
  `error_<code>`, then `error_internal`. `details` fill its placeholders.
  """
  def error_message(locale, code, details \\ %{}) do
    d = Map.new(details, fn {k, v} -> {to_string(k), v} end)

    key =
      [d["reason"], d["field"]]
      |> Enum.filter(&is_binary/1)
      |> Enum.map(&"error_#{code}_#{&1}")
      |> Kernel.++(["error_#{code}"])
      |> Enum.find("error_internal", &has?/1)

    t(locale, key, d)
  end
end
