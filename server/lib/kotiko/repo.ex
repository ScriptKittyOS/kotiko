# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Repo do
  use Ecto.Repo, otp_app: :kotiko, adapter: Ecto.Adapters.SQLite3
end
