# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.ConfigPropertyTest do
  # Dynamic analysis (OpenSSF dynamic_analysis): Kotiko.Config.parse/2 with generated
  # .env files. Whatever the owner writes, the server either starts with typed settings
  # or prints every problem; it never crashes on a setting, and never prints a secret.
  use ExUnit.Case, async: true
  use ExUnitProperties
  alias Kotiko.{Config, Gen}

  defp resolver("localhost"), do: {:ok, {127, 0, 0, 1}}
  defp resolver(_), do: {:error, :nxdomain}

  defp parse(vars) do
    Config.parse(vars,
      resolver: &resolver/1,
      ensure_dir: fn _ -> :ok end,
      default_data_dir: "/srv/kotiko-default"
    )
  end

  # Plausible values for each setting, mixed with junk.
  defp value("PORT"), do: one_of([map(integer(-5..70_000), &to_string/1), Gen.text()])

  defp value("BIND"),
    do: member_of(["127.0.0.1", "0.0.0.0", "::1", "localhost", "nope.invalid", "1.2.3"])

  defp value("ALLOWED_TELEGRAM_IDS"),
    do: one_of([map(list_of(integer()), &Enum.join(&1, ",")), Gen.text()])

  defp value(name) when name in ~w(LLM_URL PUBLIC_URL TRANSCRIBE_URL),
    do:
      member_of([
        "https://openrouter.ai/api/v1",
        "http://127.0.0.1:11434/v1",
        "ftp://x",
        "http://",
        "openrouter.ai"
      ])

  defp value("LOG_LEVEL"), do: member_of(~w(debug info warning error loud INFO))

  defp value(name) when name in ~w(LOG_LOOKUPS KOTIKO_LOG_SQL KOTIKO_WIKTIONARY),
    do: member_of(~w(true false 1 0 yes no maybe))

  defp value(_name), do: Gen.text()

  # A secret that can't appear by chance anywhere else.
  defp secret do
    gen(all(s <- string(:alphanumeric, min_length: 4, max_length: 40)), do: "SeCrEt" <> s)
  end

  defp env do
    plain = Config.documented_vars() -- Config.secret_vars()

    gen all(
          values <- fixed_map(Map.new(plain, &{&1, value(&1)})),
          keep <- list_of(member_of(plain), max_length: length(plain)),
          secrets <- optional_map(Map.new(Config.secret_vars(), &{&1, secret()}))
        ) do
      values |> Map.take(keep) |> Map.merge(secrets)
    end
  end

  property "any .env starts with typed settings or lists its problems, never echoing a secret" do
    check all(vars <- env()) do
      secrets = Map.take(vars, Config.secret_vars()) |> Map.values()

      case parse(vars) do
        {:ok, config, warnings} ->
          assert config[:port] in 1..65_535
          assert is_tuple(config[:bind_ip])
          assert Enum.all?(config[:allowed_ids], &is_integer/1)
          assert config[:log_level] in [:debug, :info, :warning, :error]
          assert is_boolean(config[:log_lookups]) and is_boolean(config[:log_sql])
          assert [_ | _] = config[:llm_models]
          assert config[:llm_model_source] in [:env, :default]
          for w <- warnings, s <- secrets, do: refute(w =~ s)

        {:error, [_ | _] = problems, warnings} ->
          message = Config.format_problems(problems, nil, false)
          for s <- secrets, text <- [message | warnings], do: refute(text =~ s)
      end
    end
  end

  property "PORT is a whole number from 1 to 65535, or a problem that names PORT" do
    check all(raw <- one_of([map(integer(), &to_string/1), Gen.text()])) do
      case parse(%{"PORT" => raw}) do
        # An empty line is the default.
        {:ok, config, _} ->
          expected =
            if String.trim(raw) == "", do: {4747, ""}, else: Integer.parse(String.trim(raw))

          assert {config[:port], ""} == expected

        {:error, [{label, _lines}], _} ->
          assert label =~ ~r/^PORT=/
      end
    end
  end

  property "ALLOWED_TELEGRAM_IDS keeps every listed ID, in order" do
    check all(ids <- list_of(integer(), min_length: 1), spaces <- member_of(["", " ", ", "])) do
      raw = Enum.join(ids, "," <> spaces)
      assert {:ok, config, _} = parse(%{"ALLOWED_TELEGRAM_IDS" => raw})
      assert config[:allowed_ids] == ids
    end
  end
end
