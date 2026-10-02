# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Word.Forms do
  @moduledoc """
  A word's `forms` column: a JSON array of Form objects (slice 07 section 1), loaded as
  maps `%{text, enabled, case, ambiguous}`.
  """
  use Ecto.Type

  @cases ~w(any lower exact proper)

  @impl true
  def type, do: :string

  @impl true
  def cast(forms) when is_list(forms) do
    if Enum.all?(forms, &is_map/1), do: {:ok, Enum.map(forms, &form/1)}, else: :error
  end

  def cast(_), do: :error

  @impl true
  def load(json) when is_binary(json) do
    case Jason.decode(json) do
      {:ok, list} when is_list(list) -> {:ok, list |> Enum.filter(&is_map/1) |> Enum.map(&form/1)}
      _ -> :error
    end
  end

  def load(nil), do: {:ok, []}

  @impl true
  def dump(forms) when is_list(forms), do: {:ok, Jason.encode!(Enum.map(forms, &form/1))}
  def dump(_), do: :error

  @impl true
  def equal?(a, b), do: a == b

  @doc "A Form with defaults filled in, from a map with atom or string keys."
  def form(map) do
    get = fn key -> Map.get(map, key, Map.get(map, to_string(key))) end
    enabled = get.(:enabled)
    ambiguous = get.(:ambiguous)
    kase = get.(:case)

    %{
      text: get.(:text),
      enabled: if(is_boolean(enabled), do: enabled, else: true),
      case: if(kase in @cases, do: kase, else: "any"),
      ambiguous: if(is_boolean(ambiguous), do: ambiguous, else: false)
    }
  end

  @doc "The allowed values of a Form's `case`."
  def cases, do: @cases
end
