# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.AddRequests do
  @moduledoc """
  Idempotent adds (slice 07 section 4): the first successful response to a
  `client_request_id` is kept for 24 hours, and a repeat gets the same bytes back with no
  model call and no write.

  Repeats that arrive while the first is still looking the word up wait for it (a lock
  per id on this node), so six retries of one add make one model call.
  """
  import Ecto.Query
  alias Kotiko.{Repo, UUID7, Words}

  @keep_hours 24

  @doc "True for a usable `client_request_id` (a UUID, any case)."
  def valid_id?(id), do: is_binary(id) and UUID7.valid?(String.downcase(id))

  @doc """
  Runs `fun` once per `id`: returns `{:stored, json}` when a response for `id` was kept,
  else whatever `fun` returns. With a nil `id`, just runs `fun`.
  """
  def once(nil, fun), do: fun.()

  def once(id, fun) do
    id = String.downcase(id)

    :global.trans(
      {{__MODULE__, id}, self()},
      fn ->
        case fetch(id) do
          {:ok, json} -> {:stored, json}
          :none -> fun.()
        end
      end,
      [node()]
    )
  end

  @doc "The response kept for `id`, if any."
  def fetch(id) do
    case Repo.one(from r in "add_requests", where: r.client_request_id == ^id, select: r.response) do
      nil -> :none
      json -> {:ok, json}
    end
  end

  @doc "Keeps `json` as the response for `id`. Call it inside the transaction that saved the words."
  def store(nil, _json), do: :ok

  def store(id, json) do
    Repo.insert_all(
      "add_requests",
      [
        %{
          client_request_id: String.downcase(id),
          response: json,
          inserted_at: Kotiko.Word.timestamp(Words.now())
        }
      ],
      on_conflict: :nothing
    )

    :ok
  end

  @doc "Deletes kept responses older than 24 hours. Returns how many."
  def purge(now \\ Words.now()) do
    cutoff = now |> DateTime.add(-@keep_hours, :hour) |> Kotiko.Word.timestamp()

    {:ok, n} =
      Words.transaction(fn ->
        {:ok,
         Repo.delete_all(from r in "add_requests", where: r.inserted_at < ^cutoff) |> elem(0)}
      end)

    n
  end
end
