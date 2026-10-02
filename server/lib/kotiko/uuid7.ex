# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.UUID7 do
  @moduledoc """
  UUIDv7 (RFC 9562 section 5.7): 48 bits of Unix time in milliseconds, the version (7),
  12 random bits, the variant (0b10) and 62 more random bits. Ids made this way sort in
  creation order, so a word's id says roughly when it was saved.
  """

  @pattern ~r/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/

  @doc "A new UUIDv7 for now, a `DateTime`, or a Unix time in milliseconds."
  def generate(at \\ System.system_time(:millisecond))

  def generate(%DateTime{} = at), do: at |> DateTime.to_unix(:millisecond) |> generate()

  def generate(ms) when is_integer(ms) and ms >= 0 do
    <<rand_a::12, rand_b::62, _::6>> = :crypto.strong_rand_bytes(10)
    format(<<ms::48, 7::4, rand_a::12, 2::2, rand_b::62>>)
  end

  @doc "True for a lowercase, hyphenated UUID of any version (what paths and bodies accept)."
  def valid?(id) when is_binary(id), do: Regex.match?(@pattern, id)
  def valid?(_), do: false

  @doc "The Unix time in milliseconds stored in a UUIDv7."
  def timestamp_ms(id) do
    {:ok, <<ms::48, _::80>>} = id |> String.replace("-", "") |> Base.decode16(case: :lower)
    ms
  end

  defp format(<<a::binary-4, b::binary-2, c::binary-2, d::binary-2, e::binary-6>>) do
    Enum.map_join([a, b, c, d, e], "-", &Base.encode16(&1, case: :lower))
  end
end
