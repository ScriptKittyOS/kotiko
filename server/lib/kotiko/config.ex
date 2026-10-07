# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Config do
  @moduledoc """
  Reads and checks the settings from `.env` (the environment). `config/runtime.exs` only
  copies the raw strings into the app env as `:env`, so it can't crash; this module parses
  them, collects every problem at once, and stops the server with one readable message
  and exit status 78 (`EX_CONFIG`) when anything is wrong.

  `parse/2` is a pure function of a map of variables (plus a host name resolver and a
  data folder check, both replaceable in tests). `load!/0` runs it at boot.

  `config/test.exs` sets parsed values directly and no `:env`, so tests skip `load!/0`.
  """
  require Logger

  @default_port 4747
  @default_bind "127.0.0.1"
  @openrouter_url "https://openrouter.ai/api/v1"
  # Without LLM_MODEL, Kotiko.LLM.Catalog follows OpenRouter's current free models; this
  # shipped list (spec/models.json `fallback`) is used until the first fetch or a cache.
  @default_models Kotiko.Spec.models()["fallback"]
  @log_levels ~w(debug info warning error)
  @prefixed_vars ~w(KOTIKO_DATA_DIR KOTIKO_LOG_SQL KOTIKO_WIKTIONARY)
  # The old names still work, with a warning, until a later release removes them.
  # legacy-name-ok
  @renamed %{"KOTIKO_DATA_DIR" => "SLOVO_DATA_DIR", "KOTIKO_LOG_SQL" => "SLOVO_LOG_SQL"}
  # legacy-name-ok
  @prefixes ~w(KOTIKO_ SLOVO_)
  @secret_vars ~w(API_TOKEN LLM_API_KEY TELEGRAM_BOT_TOKEN TRANSCRIBE_API_KEY)
  # Each secret can come from a file instead (Docker secrets, systemd credentials):
  # LLM_API_KEY_FILE=/run/secrets/llm_api_key. See read_secret_files/2.
  @secret_file_vars Enum.map(@secret_vars, &(&1 <> "_FILE"))
  # A key or token is a few hundred bytes at most; this stops a wrong path such as a log
  # file or a disk image from being read into memory.
  @max_secret_file_bytes 64 * 1024
  # The other settings, without the KOTIKO_ prefix. config/runtime.exs copies them into
  # the app env by name or by their LLM_ and TRANSCRIBE_ prefixes.
  @plain_vars ~w(PORT BIND ALLOWED_HOSTS PUBLIC_URL ALLOWED_TELEGRAM_IDS LLM_URL LLM_MODEL
                 TRANSCRIBE_URL TRANSCRIBE_MODEL LOG_LEVEL LOG_LOOKUPS)
  @wrap_at 84

  @typedoc "A label (`BIND=kotiko.local`) and the lines that explain it."
  @type problem :: {String.t(), [String.t()]}

  def default_models, do: @default_models
  def secret_vars, do: @secret_vars

  @doc """
  Every setting this module reads, by its current name: what
  `docs/reference/configuration.md` must describe (`Kotiko.DocsTest` checks both).
  """
  def documented_vars,
    do: Enum.sort(@plain_vars ++ @secret_vars ++ @secret_file_vars ++ @prefixed_vars)

  @doc """
  Parses and applies the settings in the app env's `:env`. Problems print one block to
  stderr and halt with status 78. Returns the parsed keyword list (empty in tests).
  """
  def load! do
    case Application.get_env(:kotiko, :env) do
      nil ->
        []

      vars ->
        case parse(vars) do
          {:ok, config, warnings} ->
            apply_config(config)
            Enum.each(warnings, &Logger.warning/1)
            config

          {:error, problems, _warnings} ->
            abort!(problems)
        end
    end
  end

  @doc """
  Prints the problems as one block on stderr and halts. Status 78 tells systemd
  (`RestartPreventExitStatus=78`) not to retry until someone fixes the settings.
  """
  def abort!(problems), do: halt!(format_problems(problems, settings_source()), 78)

  @doc "Writes `message` to stderr and stops the VM with `status`."
  def halt!(message, status) do
    IO.write(:stderr, message)
    System.halt(status)
  end

  defp settings_source do
    if File.regular?(".env"), do: Path.expand(".env"), else: nil
  end

  @doc """
  The message `abort!/1` prints. `source` is the .env path, or nil; `service?` adds how
  to restart the systemd service (systemd sets INVOCATION_ID for the processes it runs).
  """
  def format_problems(problems, source, service? \\ System.get_env("INVOCATION_ID") != nil) do
    count = length(problems)
    noun = if count == 1, do: "1 problem", else: "#{count} problems"
    where = if source, do: " (#{source})", else: ""
    these = if count == 1, do: "this", else: "these"

    blocks =
      Enum.map(problems, fn {label, lines} ->
        body = lines |> Enum.flat_map(&wrap(&1, @wrap_at)) |> Enum.map_join("\n", &("    " <> &1))
        "  #{label}\n#{body}\n"
      end)

    restart = if service?, do: " (systemctl --user restart kotiko)", else: ""

    "The server can't start: #{noun} in your settings#{where}\n\n" <>
      Enum.join(blocks, "\n") <> "\nFix #{these} and start the server again#{restart}.\n"
  end

  defp wrap(text, width) do
    text
    |> String.split(" ", trim: true)
    |> Enum.reduce([], fn
      word, [] ->
        [word]

      word, [line | rest] ->
        if String.length(line) + 1 + String.length(word) > width,
          do: [word, line | rest],
          else: [line <> " " <> word | rest]
    end)
    |> Enum.reverse()
  end

  @doc """
  Parses a map of variable names to strings. Returns `{:ok, config, warnings}` or
  `{:error, problems, warnings}`.

  Options: `:resolver` (host name to `{:ok, ip}` or `{:error, reason}`), `:ensure_dir`
  (path to `:ok` or `{:error, reason}`) and `:default_data_dir`.
  """
  def parse(vars, opts \\ []) do
    {vars, file_problems, file_warnings} = vars |> clean() |> read_secret_files()
    resolver = Keyword.get(opts, :resolver, &resolve_host/1)
    ensure_dir = Keyword.get(opts, :ensure_dir, &ensure_dir/1)
    default_dir = Keyword.get_lazy(opts, :default_data_dir, &Kotiko.DataDir.default_dir/0)
    {data_dir_var, data_dir_raw} = setting(vars, "KOTIKO_DATA_DIR")
    {log_sql_var, log_sql_raw} = setting(vars, "KOTIKO_LOG_SQL")
    llm_url = llm_url(vars["LLM_URL"])

    results = [
      port: port(vars["PORT"]),
      bind: bind(vars["BIND"], resolver),
      api_token: api_token(vars["API_TOKEN"]),
      allowed_hosts: allowed_hosts(vars["ALLOWED_HOSTS"]),
      public_url: optional_url("PUBLIC_URL", vars["PUBLIC_URL"]),
      telegram_token: telegram_token(vars["TELEGRAM_BOT_TOKEN"]),
      allowed_ids: telegram_ids(vars["ALLOWED_TELEGRAM_IDS"]),
      llm_url: llm_url,
      llm_models: llm_models(vars["LLM_MODEL"], llm_url),
      transcribe_url: optional_url("TRANSCRIBE_URL", vars["TRANSCRIBE_URL"]),
      data_dir: data_dir(data_dir_var, data_dir_raw, default_dir, ensure_dir),
      log_level: log_level(vars["LOG_LEVEL"]),
      log_lookups: boolean("LOG_LOOKUPS", vars["LOG_LOOKUPS"]),
      log_sql: boolean(log_sql_var, log_sql_raw),
      pronounce_enabled: boolean("KOTIKO_WIKTIONARY", vars["KOTIKO_WIKTIONARY"], true)
    ]

    problems = file_problems ++ for {_key, {:error, problem}} <- results, do: problem
    warnings = file_warnings ++ warnings(vars, llm_url)

    if problems == [] do
      {:ok, build(results, vars) ++ [data_dir_source: data_dir_source(data_dir_raw)], warnings}
    else
      {:error, problems, warnings}
    end
  end

  defp build(results, vars) do
    parsed = Map.new(results, fn {key, {:ok, value}} -> {key, value} end)
    {bind, ip} = parsed.bind
    {models, model_source} = parsed.llm_models

    [
      port: parsed.port,
      bind: bind,
      bind_ip: ip,
      api_token: parsed.api_token,
      allowed_hosts: parsed.allowed_hosts,
      public_url: parsed.public_url,
      telegram_token: parsed.telegram_token,
      allowed_ids: parsed.allowed_ids,
      llm_url: parsed.llm_url,
      llm_api_key: vars["LLM_API_KEY"],
      llm_models: models,
      llm_model_source: model_source,
      transcribe_url: parsed.transcribe_url,
      transcribe_model: vars["TRANSCRIBE_MODEL"] || "whisper-1",
      transcribe_api_key: vars["TRANSCRIBE_API_KEY"],
      data_dir: parsed.data_dir,
      log_level: parsed.log_level,
      log_lookups: parsed.log_lookups,
      log_sql: parsed.log_sql,
      pronounce_enabled: parsed.pronounce_enabled
    ]
  end

  @doc "Puts parsed settings into the app env, the Repo config and the Logger level."
  def apply_config(config) do
    for {key, value} <- config, do: Application.put_env(:kotiko, key, value)

    repo =
      :kotiko
      |> Application.get_env(Kotiko.Repo, [])
      |> Keyword.merge(
        database: Kotiko.DataDir.database(config[:data_dir]),
        log: if(config[:log_sql], do: :info, else: false)
      )

    Application.put_env(:kotiko, Kotiko.Repo, repo)
    Logger.configure(level: config[:log_level])
  end

  # Trimmed; blanks are unset (sourcing .env exports empty values).
  defp clean(vars) do
    for {k, v} <- vars, is_binary(v), v = String.trim(v), v != "", into: %{}, do: {k, v}
  end

  @doc """
  Reads each secret that's given as a file (`NAME_FILE=/path`) into `NAME`, for the
  secrets in `names` (default: all of them). `vars` must already be trimmed, with blanks
  removed. Returns `{vars, problems, warnings}`; the values never appear in either list.

  The file holds only the value. One line ending at its end is dropped (most editors and
  `echo` add one); anything else is kept as written. Setting both `NAME` and `NAME_FILE`,
  a file that can't be read, isn't a regular file, is empty, is over 64 KiB or has more
  than one line are problems. A file other users can read or change is a warning.
  """
  def read_secret_files(vars, names \\ @secret_vars) do
    Enum.reduce(names, {vars, [], []}, fn name, {vars, problems, warnings} ->
      file_var = name <> "_FILE"

      case {vars[name], vars[file_var]} do
        {_, nil} ->
          {vars, problems, warnings}

        {value, path} when is_binary(value) ->
          problem =
            {"#{name} and #{file_var}=#{path} (both set)",
             [
               "Set only one: #{name} holds the value itself, #{file_var} the path of a " <>
                 "file that holds it. Delete one of the two lines."
             ]}

          {vars, problems ++ [problem], warnings}

        {nil, path} ->
          case read_secret_file(path) do
            {:ok, value, mode} ->
              {Map.put(vars, name, value), problems,
               warnings ++ secret_file_warnings(file_var, path, mode)}

            {:error, reason} ->
              problem =
                {"#{file_var}=#{path}",
                 ["Can't use this file for #{name}: #{reason}. Put only the value in it."]}

              {vars, problems ++ [problem], warnings}
          end
      end
    end)
  end

  # {:ok, value, mode} or {:error, why}; `why` never contains the file's contents.
  # Sobelow: the path is a NAME_FILE setting the server's owner wrote in .env, never a request's.
  # sobelow_skip ["Traversal.FileModule"]
  defp read_secret_file(path) do
    path = Path.expand(path)

    with {:ok, %File.Stat{type: :regular, size: size, mode: mode}} <- File.stat(path),
         :ok <- secret_size(size),
         {:ok, contents} <- File.read(path),
         {:ok, value} <- secret_value(contents) do
      {:ok, value, mode}
    else
      {:ok, %File.Stat{}} ->
        {:error, "it isn't a regular file"}

      {:error, reason} when is_atom(reason) ->
        {:error, reason |> :file.format_error() |> to_string()}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp secret_size(size) when size > @max_secret_file_bytes,
    do: {:error, "it's #{size} bytes, too big for a key (at most #{@max_secret_file_bytes})"}

  defp secret_size(_size), do: :ok

  defp secret_value(contents) do
    value = contents |> String.replace_suffix("\n", "") |> String.replace_suffix("\r", "")

    cond do
      String.trim(value) == "" -> {:error, "it's empty"}
      value =~ ~r/[\r\n]/ -> {:error, "it has more than one line"}
      true -> {:ok, value}
    end
  end

  defp secret_file_warnings(file_var, path, mode) do
    if Bitwise.band(mode, 0o077) != 0 do
      [
        "#{file_var}: other users of this computer can read or change #{path}. Make it " <>
          "private: chmod 600 #{path}"
      ]
    else
      []
    end
  end

  # {name actually set, value}: the current name, else its old name, else {name, nil}.
  defp setting(vars, name) do
    old = @renamed[name]

    cond do
      vars[name] -> {name, vars[name]}
      vars[old] -> {old, vars[old]}
      true -> {name, nil}
    end
  end

  # :default lets Kotiko.DataDir look for words in the old default folder too; a folder
  # someone chose is only checked for an old database inside it.
  defp data_dir_source(nil), do: :default
  defp data_dir_source(_raw), do: :env

  # ── one function per variable: {:ok, value} or {:error, problem} ─────────

  defp port(nil), do: {:ok, @default_port}

  defp port(raw) do
    case Integer.parse(raw) do
      {n, ""} when n in 1..65_535 ->
        {:ok, n}

      _ ->
        error("PORT", raw, [
          "#{inspect(raw)} isn't a port number. Use a whole number from 1 to 65535, " <>
            "such as #{@default_port}."
        ])
    end
  end

  defp bind(nil, _resolver), do: {:ok, {@default_bind, {127, 0, 0, 1}}}

  defp bind(raw, resolver) do
    case parse_bind(raw, resolver) do
      {:ok, ip} ->
        {:ok, {raw, ip}}

      {:error, _} ->
        error("BIND", raw, [
          "Couldn't find an address for #{inspect(raw)}. Use an IP address such as " <>
            "127.0.0.1, 100.101.102.103 (Tailscale) or 0.0.0.0."
        ])
    end
  end

  @doc """
  An IP literal, or a name resolved to IPv4, then IPv6. `localhost` is always 127.0.0.1,
  whatever the hosts file says: `Kotiko.Listener` then listens on `::1` too, as browsers
  try both for `localhost`.
  """
  def parse_bind(raw, resolver \\ &resolve_host/1) do
    cond do
      raw |> String.downcase() |> String.trim_trailing(".") == "localhost" ->
        {:ok, {127, 0, 0, 1}}

      match?({:ok, _}, :inet.parse_strict_address(to_charlist(raw))) ->
        :inet.parse_strict_address(to_charlist(raw))

      true ->
        resolver.(raw)
    end
  end

  @doc false
  def resolve_host(name) do
    name = to_charlist(name)

    case :inet.getaddr(name, :inet) do
      {:ok, ip} -> {:ok, ip}
      {:error, _} -> :inet.getaddr(name, :inet6)
    end
  end

  # nil: use or make <data_dir>/api-token (Kotiko.Token).
  defp api_token(nil), do: {:ok, nil}

  defp api_token(raw) do
    min = Kotiko.Token.min_length()
    length = String.length(raw)

    if length >= min do
      {:ok, raw}
    else
      secret_error("API_TOKEN", [
        "It's too short (#{length} characters). Use at least #{min}, for example from " <>
          "`openssl rand -hex 24`, or delete the line and the server makes a strong one " <>
          "for you."
      ])
    end
  end

  # "*" turns the Host check off (unusual proxy setups); see Kotiko.Plug.HostCheck.
  defp allowed_hosts(nil), do: {:ok, []}
  defp allowed_hosts("*"), do: {:ok, :any}

  defp allowed_hosts(raw) do
    names =
      raw
      |> String.split(",")
      |> Enum.map(&(&1 |> String.trim() |> String.downcase() |> String.trim_trailing(".")))
      |> Enum.reject(&(&1 == ""))

    case Enum.reject(names, &host_name?/1) do
      [] ->
        {:ok, names}

      bad ->
        error(
          "ALLOWED_HOSTS",
          raw,
          Enum.map(bad, fn name ->
            "#{inspect(name)} isn't a host name. Write just the name, without http:// or a " <>
              "port, for example laptop.tail1234.ts.net."
          end)
        )
    end
  end

  defp host_name?(name) do
    name =~ ~r/\A[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)*\z/ or
      match?({:ok, _}, :inet.parse_strict_address(to_charlist(name)))
  end

  defp optional_url(_name, nil), do: {:ok, nil}

  # A user name or password in the address (slice 54, B-05) would reach the log with the
  # address, so it's refused, and the value is never echoed.
  defp optional_url(name, raw) do
    cond do
      userinfo?(raw) ->
        secret_error(name, [
          "It has a user name or password in it (before the @), which would end up in " <>
            "the log. Remove them from the address. A key for the model or transcription " <>
            "service goes in LLM_API_KEY or TRANSCRIBE_API_KEY (or LLM_API_KEY_FILE, " <>
            "TRANSCRIBE_API_KEY_FILE)."
        ])

      http_url?(raw) ->
        {:ok, String.trim_trailing(raw, "/")}

      # Not an address, but it may hold a password: don't echo it.
      String.contains?(raw, "@") ->
        secret_error(name, ["It isn't a web address. It should start with http:// or https://."])

      true ->
        error(name, raw, [
          "#{inspect(raw)} isn't a web address. It should start with http:// or https://."
        ])
    end
  end

  defp userinfo?(raw), do: match?({:ok, %URI{userinfo: info}} when is_binary(info), URI.new(raw))

  defp http_url?(raw) do
    case URI.new(raw) do
      {:ok, %URI{scheme: scheme, host: host}} when scheme in ["http", "https"] ->
        is_binary(host) and host != ""

      _ ->
        false
    end
  end

  defp telegram_token(nil), do: {:ok, nil}

  defp telegram_token(raw) do
    if raw =~ ~r/\A\d+:[A-Za-z0-9_-]{30,}\z/ do
      {:ok, raw}
    else
      secret_error("TELEGRAM_BOT_TOKEN", [
        "This doesn't look like a bot token. @BotFather gives you one shaped like " <>
          "123456789:AAH4xk... (digits, a colon, then about 35 letters and digits). " <>
          "Copy it again, or leave it empty to run without the bot."
      ])
    end
  end

  defp telegram_ids(nil), do: {:ok, []}

  defp telegram_ids(raw) do
    entries = raw |> String.split(",") |> Enum.map(&String.trim/1) |> Enum.reject(&(&1 == ""))
    {ids, bad} = Enum.split_with(entries, &(&1 =~ ~r/\A-?\d{1,20}\z/))

    if bad == [] do
      {:ok, Enum.map(ids, &String.to_integer/1)}
    else
      error(
        "ALLOWED_TELEGRAM_IDS",
        raw,
        Enum.map(
          bad,
          &"#{inspect(&1)} isn't a Telegram ID. IDs are numbers; the bot tells you yours."
        )
      )
    end
  end

  defp llm_url(nil), do: {:ok, @openrouter_url}
  defp llm_url(raw), do: optional_url("LLM_URL", raw)

  # {:ok, {models, source}}: source :env (LLM_MODEL) or :default (the built-in list).
  defp llm_models(raw, llm_url) do
    models =
      (raw || "") |> String.split(",") |> Enum.map(&String.trim/1) |> Enum.reject(&(&1 == ""))

    case {models, llm_url} do
      {[_ | _], _} ->
        {:ok, {models, :env}}

      {[], {:ok, url}} ->
        if openrouter?(url) do
          {:ok, {@default_models, :default}}
        else
          {:error,
           {"LLM_MODEL (not set)",
            [
              "LLM_URL points at #{URI.parse(url).host}, which doesn't serve the built-in " <>
                "list of free OpenRouter models. Set LLM_MODEL to a model it has (for " <>
                "Ollama, a name from `ollama list`)."
            ]}}
        end

      # LLM_URL itself is wrong; that problem is reported on its own.
      {[], {:error, _}} ->
        {:ok, {@default_models, :default}}
    end
  end

  @doc "Whether the model API is OpenRouter (it has the built-in free models)."
  def openrouter?(url) do
    case URI.parse(url).host do
      "openrouter.ai" -> true
      host when is_binary(host) -> String.ends_with?(host, ".openrouter.ai")
      _ -> false
    end
  end

  # `name` is the variable that was set (KOTIKO_DATA_DIR or its old name).
  defp data_dir(name, raw, default, ensure_dir) do
    dir = Path.expand(raw || default)

    case ensure_dir.(dir) do
      :ok ->
        {:ok, dir}

      {:error, reason} ->
        how =
          if raw,
            do: "Choose a folder you can write to, or leave #{name} empty to use #{default}.",
            else: "Set KOTIKO_DATA_DIR to a folder you can write to."

        {:error,
         {if(raw, do: "#{name}=#{raw}", else: "KOTIKO_DATA_DIR (not set)"),
          ["Can't keep the database in #{dir}: #{reason}. #{how}"]}}
    end
  end

  @doc false
  # A folder this makes is private (0700); Kotiko.DataDir.make_private/1 sees to one that
  # was already there.
  # Sobelow: the folder is KOTIKO_DATA_DIR or the default, never from a request.
  # sobelow_skip ["Traversal.FileModule"]
  def ensure_dir(dir) do
    with :ok <- Kotiko.Private.mkdir_p(dir),
         {:ok, %File.Stat{type: :directory, access: :read_write}} <- File.stat(dir) do
      :ok
    else
      {:ok, %File.Stat{type: :directory}} -> {:error, "it isn't writable"}
      {:ok, %File.Stat{}} -> {:error, "it isn't a folder"}
      {:error, reason} -> {:error, :file.format_error(reason) |> to_string()}
    end
  end

  defp log_level(nil), do: {:ok, :info}

  defp log_level(raw) do
    case String.downcase(raw) do
      level when level in @log_levels -> {:ok, String.to_existing_atom(level)}
      "warn" -> {:ok, :warning}
      _ -> error("LOG_LEVEL", raw, ["Use one of: #{Enum.join(@log_levels, ", ")}."])
    end
  end

  defp boolean(name, raw, default \\ false)
  defp boolean(_name, nil, default), do: {:ok, default}

  defp boolean(name, raw, _default) do
    case String.downcase(raw) do
      v when v in ~w(true yes on 1) -> {:ok, true}
      v when v in ~w(false no off 0) -> {:ok, false}
      _ -> error(name, raw, ["Use true or false."])
    end
  end

  defp error(name, raw, lines), do: {:error, {"#{name}=#{raw}", lines}}

  # Never echo a secret: the message goes to the terminal or the journal.
  defp secret_error(name, lines), do: {:error, {"#{name} (value hidden)", lines}}

  # ── warnings: the server still starts ────────────────────────────────

  defp warnings(vars, llm_url) do
    key_warning =
      case llm_url do
        {:ok, url} ->
          if is_nil(vars["LLM_API_KEY"]) and openrouter?(url),
            do: ["LLM_API_KEY is empty: adding words won't work until you set LLM_API_KEY."],
            else: []

        _ ->
          []
      end

    key_warning ++ weak_token(vars["API_TOKEN"]) ++ renamed(vars) ++ unknown_prefixed(vars)
  end

  @doc """
  A warning when a token the owner chose looks easy to guess (`Kotiko.Token.weakness/1`),
  else nothing. `what` names where it came from; the token itself is never in it.
  """
  def weak_token(token, what \\ "API_TOKEN")
  def weak_token(nil, _what), do: []

  def weak_token(token, what) do
    case Kotiko.Token.weakness(token) do
      nil ->
        []

      reason ->
        [
          "#{what} looks easy to guess: #{Kotiko.Token.weakness_text(reason)}. Anyone who " <>
            "can reach the server can try guesses, and one answer from POST " <>
            "/api/v1/proof lets them test guesses offline. Use a random token: delete it " <>
            "and the server makes one, or use the output of `openssl rand -hex 24`."
        ]
    end
  end

  defp renamed(vars) do
    for {name, old} <- Enum.sort(@renamed), vars[old] do
      if vars[name],
        do: "#{old} is ignored because #{name} is set. Delete #{old} from .env.",
        else:
          "#{old} is now #{name}. Rename it in .env; the old name stops working in a " <>
            "future release."
    end
  end

  # Typos are matched on the part after the prefix, so an old-style name with a typo
  # still gets the current name suggested.
  defp unknown_prefixed(vars) do
    known = @prefixed_vars ++ Map.values(@renamed)

    for name <- vars |> Map.keys() |> Enum.sort(),
        prefix = Enum.find(@prefixes, &String.starts_with?(name, &1)),
        name not in known do
      rest = String.replace_prefix(name, prefix, "")
      close = Enum.max_by(@prefixed_vars, &String.jaro_distance(suffix(&1), rest))

      if String.jaro_distance(suffix(close), rest) >= 0.85,
        do: "#{name}: did you mean #{close}? #{name} isn't a setting, so it's ignored.",
        else: "#{name} isn't a setting this server knows, so it's ignored."
    end
  end

  defp suffix("KOTIKO_" <> rest), do: rest
end
