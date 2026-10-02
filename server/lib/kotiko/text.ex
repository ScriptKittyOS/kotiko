# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Text do
  @moduledoc """
  Text normalisation shared by every word field, and the natural key's `native_key`
  (slice 07 section 2). Slice 09's validator adds the per-language rules on top.
  """

  # Zero-width space, byte-order mark and soft hyphen: invisible, never part of a word.
  # U+200C and U+200D stay: Persian and Indic scripts need them.
  @invisible ["​", "﻿", "­"]

  @doc """
  NFC, invisible characters and control characters removed (a newline or tab becomes a
  space), internal whitespace collapsed, trimmed. Blank or non-text becomes nil.
  """
  def clean(s) when is_binary(s) do
    if String.valid?(s) do
      s
      |> :unicode.characters_to_nfc_binary()
      |> String.replace(@invisible, "")
      |> String.replace(~r/[\p{Cc}\s]+/u, " ")
      |> String.trim()
      |> blank_to_nil()
    end
  end

  def clean(_), do: nil

  @doc "True for nil and strings that are empty after trimming."
  def blank?(nil), do: true
  def blank?(s) when is_binary(s), do: String.trim(s) == ""
  def blank?(_), do: false

  @doc """
  The case-insensitive key of a word in its own script: NFC, then Unicode default
  lowercase (not locale-specific), then final sigma ς as σ, so Elixir and JavaScript agree
  (`String.downcase("ΣΑΣ")` is "σασ", JavaScript's `toLowerCase()` gives "σας").
  """
  def native_key(native) when is_binary(native) do
    native
    |> :unicode.characters_to_nfc_binary()
    |> String.downcase()
    |> String.replace("ς", "σ")
  end

  @doc "Lowercase used to compare forms (slice 09 replaces it with the base's locale)."
  def fold(s) when is_binary(s), do: String.downcase(s)

  @doc "Length in Unicode code points, as the extension counts it."
  def length(s) when is_binary(s), do: s |> String.to_charlist() |> Kernel.length()

  defp blank_to_nil(""), do: nil
  defp blank_to_nil(s), do: s
end
