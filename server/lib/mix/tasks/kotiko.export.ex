# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Mix.Tasks.Kotiko.Export do
  @shortdoc "Writes every word to a Kotiko JSON backup"
  @moduledoc """
  Writes the server's words as a Kotiko JSON backup (slice 12; the same file as
  `GET /api/v1/export` and the extension's "Export backup"), for files too large for HTTP.

      mix kotiko.export --output kotiko-backup.json
      mix kotiko.export > kotiko-backup.json
      mix kotiko.export --include-pending ...   also Telegram lookups never added

  Reads the data folder like `run.sh` (`--env-file PATH`, or `--data-dir DIR`).
  """
  use Mix.Task
  alias Kotiko.{Backup, TaskEnv}

  @switches [output: :string, include_pending: :boolean, env_file: :string, data_dir: :string]

  @impl true
  def run(args) do
    {opts, _} = OptionParser.parse!(args, strict: @switches)

    pending = opts[:include_pending] == true
    TaskEnv.with_repo(opts, fn _dir -> write(opts[:output], pending) end)
  end

  defp write(nil, pending), do: Backup.export(&IO.binwrite(:stdio, &1), include_pending: pending)

  defp write(path, pending) do
    File.open!(path, [:write, :binary], fn f ->
      n = Backup.export(&IO.binwrite(f, &1), include_pending: pending)
      Mix.shell().info("Wrote #{n} #{if n == 1, do: "word", else: "words"} to #{path}.")
    end)
  end
end
