# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Slovo.Repo do
  use Ecto.Repo, otp_app: :slovo, adapter: Ecto.Adapters.SQLite3
end
