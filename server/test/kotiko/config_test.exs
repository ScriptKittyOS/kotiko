# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.ConfigTest do
  # Kotiko.Config.parse/2 is pure apart from the resolver and the data folder check, both
  # replaced here, so nothing touches DNS or the real data folder.
  use ExUnit.Case, async: true
  alias Kotiko.Config

  @bot_token "123456789:AAH4xkPq0123456789abcdefghijklmnopqrs"
  # The prefix the variables had before the rename. legacy-name-ok
  @old "SLOVO_"
  @token "a-token-of-at-least-24-characters"

  defp resolver("localhost"), do: {:ok, {127, 0, 0, 1}}
  defp resolver("laptop.tail1234.ts.net"), do: {:ok, {100, 101, 102, 103}}
  defp resolver(_), do: {:error, :nxdomain}

  defp parse(vars, opts \\ []) do
    defaults = [
      resolver: &resolver/1,
      ensure_dir: fn _ -> :ok end,
      default_data_dir: "/srv/kotiko-default"
    ]

    Config.parse(vars, Keyword.merge(defaults, opts))
  end

  defp ok!(vars) do
    assert {:ok, config, _warnings} = parse(vars)
    config
  end

  defp problems!(vars) do
    assert {:error, problems, _warnings} = parse(vars)
    problems
  end

  describe "defaults" do
    test "an empty environment starts with the documented defaults" do
      assert {:ok, config, warnings} = parse(%{})

      assert config[:port] == 4747
      assert config[:bind] == "127.0.0.1"
      assert config[:bind_ip] == {127, 0, 0, 1}
      assert config[:api_token] == nil
      assert config[:allowed_hosts] == []
      assert config[:public_url] == nil
      assert config[:telegram_token] == nil
      assert config[:allowed_ids] == []
      assert config[:llm_url] == "https://openrouter.ai/api/v1"
      assert config[:llm_models] == Config.default_models()
      assert config[:llm_model_source] == :default
      assert config[:transcribe_url] == nil
      assert config[:transcribe_model] == "whisper-1"
      assert config[:data_dir] == "/srv/kotiko-default"
      assert config[:data_dir_source] == :default
      assert config[:log_level] == :info
      assert config[:log_lookups] == false
      assert config[:log_sql] == false
      assert config[:pronounce_enabled] == true

      assert warnings == [
               "LLM_API_KEY is empty: adding words won't work until you set LLM_API_KEY."
             ]
    end

    test "blank and whitespace-only values count as unset" do
      config = ok!(%{"PORT" => "", "BIND" => "  ", "API_TOKEN" => "   ", "LOG_LEVEL" => "\t"})
      assert config[:port] == 4747
      assert config[:bind] == "127.0.0.1"
      assert config[:api_token] == nil
      assert config[:log_level] == :info
    end
  end

  describe "valid settings" do
    test "everything set" do
      config =
        ok!(%{
          "PORT" => " 8080 ",
          "BIND" => "100.101.102.103",
          "API_TOKEN" => @token,
          "ALLOWED_HOSTS" => "Laptop.tail1234.ts.net., 192.168.1.5,,proxy_host",
          "PUBLIC_URL" => "https://words.example.com/",
          "TELEGRAM_BOT_TOKEN" => @bot_token,
          "ALLOWED_TELEGRAM_IDS" => " 123, 456 ,",
          "LLM_URL" => "http://localhost:11434/v1/",
          "LLM_MODEL" => "llama3.2, qwen3",
          "LLM_API_KEY" => "key",
          "TRANSCRIBE_URL" => "http://localhost:8178/inference",
          "TRANSCRIBE_MODEL" => "large-v3",
          "KOTIKO_DATA_DIR" => "/data/kotiko",
          "LOG_LEVEL" => "DEBUG",
          "LOG_LOOKUPS" => "true",
          "KOTIKO_LOG_SQL" => "yes",
          "KOTIKO_WIKTIONARY" => "off"
        })

      assert config[:port] == 8080
      assert config[:bind_ip] == {100, 101, 102, 103}
      assert config[:api_token] == @token
      assert config[:allowed_hosts] == ["laptop.tail1234.ts.net", "192.168.1.5", "proxy_host"]
      assert config[:public_url] == "https://words.example.com"
      assert config[:telegram_token] == @bot_token
      assert config[:allowed_ids] == [123, 456]
      assert config[:llm_url] == "http://localhost:11434/v1"
      assert config[:llm_models] == ["llama3.2", "qwen3"]
      assert config[:llm_model_source] == :env
      assert config[:transcribe_model] == "large-v3"
      assert config[:data_dir] == "/data/kotiko"
      assert config[:data_dir_source] == :env
      assert config[:log_level] == :debug
      assert config[:log_lookups] == true
      assert config[:log_sql] == true
      assert config[:pronounce_enabled] == false
    end

    # KOTIKO_WIKTIONARY=false used to work but also logged that it was ignored.
    test "every documented setting is known: none is warned about as unknown" do
      vars =
        Map.new(Config.documented_vars(), fn
          "KOTIKO_WIKTIONARY" -> {"KOTIKO_WIKTIONARY", "false"}
          name -> {name, "x"}
        end)

      assert {_, _, warnings} = parse(vars)
      assert Enum.filter(warnings, &(&1 =~ "isn't a setting")) == []
      assert {:ok, config, []} = parse(%{"KOTIKO_WIKTIONARY" => "false", "LLM_API_KEY" => "k"})
      assert config[:pronounce_enabled] == false
    end

    test "BIND takes IP literals and names" do
      assert ok!(%{"BIND" => "localhost"})[:bind_ip] == {127, 0, 0, 1}
      assert ok!(%{"BIND" => "laptop.tail1234.ts.net"})[:bind_ip] == {100, 101, 102, 103}
      assert ok!(%{"BIND" => "0.0.0.0"})[:bind_ip] == {0, 0, 0, 0}
      assert ok!(%{"BIND" => "::1"})[:bind_ip] == {0, 0, 0, 0, 0, 0, 0, 1}
      assert ok!(%{"BIND" => "localhost"})[:bind] == "localhost"
    end

    test "ALLOWED_HOSTS=* turns the Host check off" do
      assert ok!(%{"ALLOWED_HOSTS" => "*"})[:allowed_hosts] == :any
    end

    test "LLM_MODEL isn't needed for OpenRouter, and overrides the built-in list" do
      assert ok!(%{"LLM_URL" => "https://openrouter.ai/api/v1"})[:llm_model_source] == :default
      assert ok!(%{"LLM_MODEL" => "a/b:free"})[:llm_models] == ["a/b:free"]
    end

    test "the LLM key warning is only for OpenRouter" do
      assert {:ok, _, []} = parse(%{"LLM_URL" => "http://localhost:11434/v1", "LLM_MODEL" => "x"})
      assert {:ok, _, []} = parse(%{"LLM_API_KEY" => "sk-or-v1-abc"})
    end

    test "LOG_LEVEL accepts warn as warning" do
      assert ok!(%{"LOG_LEVEL" => "warn"})[:log_level] == :warning
      assert ok!(%{"LOG_LEVEL" => "Warning"})[:log_level] == :warning
    end
  end

  # {variables, label, lines}: each mistake alone gives exactly this problem.
  @mistakes [
    {%{"PORT" => "abc"}, "PORT=abc",
     ["\"abc\" isn't a port number. Use a whole number from 1 to 65535, such as 4747."]},
    {%{"PORT" => "0"}, "PORT=0",
     ["\"0\" isn't a port number. Use a whole number from 1 to 65535, such as 4747."]},
    {%{"PORT" => "70000"}, "PORT=70000",
     ["\"70000\" isn't a port number. Use a whole number from 1 to 65535, such as 4747."]},
    {%{"PORT" => "47 47"}, "PORT=47 47",
     ["\"47 47\" isn't a port number. Use a whole number from 1 to 65535, such as 4747."]},
    {%{"BIND" => "kotiko.local"}, "BIND=kotiko.local",
     [
       "Couldn't find an address for \"kotiko.local\". Use an IP address such as 127.0.0.1, " <>
         "100.101.102.103 (Tailscale) or 0.0.0.0."
     ]},
    {%{"BIND" => "127.0.0.256"}, "BIND=127.0.0.256",
     [
       "Couldn't find an address for \"127.0.0.256\". Use an IP address such as 127.0.0.1, " <>
         "100.101.102.103 (Tailscale) or 0.0.0.0."
     ]},
    {%{"ALLOWED_TELEGRAM_IDS" => "123,abc"}, "ALLOWED_TELEGRAM_IDS=123,abc",
     ["\"abc\" isn't a Telegram ID. IDs are numbers; the bot tells you yours."]},
    {%{"ALLOWED_TELEGRAM_IDS" => "1, x ,2,@me"}, "ALLOWED_TELEGRAM_IDS=1, x ,2,@me",
     [
       "\"x\" isn't a Telegram ID. IDs are numbers; the bot tells you yours.",
       "\"@me\" isn't a Telegram ID. IDs are numbers; the bot tells you yours."
     ]},
    {%{"ALLOWED_HOSTS" => "http://laptop.ts.net,ok.example,laptop:4747"},
     "ALLOWED_HOSTS=http://laptop.ts.net,ok.example,laptop:4747",
     [
       "\"http://laptop.ts.net\" isn't a host name. Write just the name, without http:// or " <>
         "a port, for example laptop.tail1234.ts.net.",
       "\"laptop:4747\" isn't a host name. Write just the name, without http:// or a port, " <>
         "for example laptop.tail1234.ts.net."
     ]},
    {%{"PUBLIC_URL" => "words.example.com"}, "PUBLIC_URL=words.example.com",
     ["\"words.example.com\" isn't a web address. It should start with http:// or https://."]},
    {%{"LLM_URL" => "localhost:11434"}, "LLM_URL=localhost:11434",
     ["\"localhost:11434\" isn't a web address. It should start with http:// or https://."]},
    {%{"TRANSCRIBE_URL" => "ftp://x"}, "TRANSCRIBE_URL=ftp://x",
     ["\"ftp://x\" isn't a web address. It should start with http:// or https://."]},
    {%{"LLM_URL" => "http://localhost:11434/v1"}, "LLM_MODEL (not set)",
     [
       "LLM_URL points at localhost, which doesn't serve the built-in list of free " <>
         "OpenRouter models. Set LLM_MODEL to a model it has (for Ollama, a name from " <>
         "`ollama list`)."
     ]},
    {%{"LOG_LEVEL" => "verbose"}, "LOG_LEVEL=verbose",
     ["Use one of: debug, info, warning, error."]},
    {%{"LOG_LOOKUPS" => "maybe"}, "LOG_LOOKUPS=maybe", ["Use true or false."]},
    {%{"KOTIKO_LOG_SQL" => "2"}, "KOTIKO_LOG_SQL=2", ["Use true or false."]},
    {%{"KOTIKO_WIKTIONARY" => "sometimes"}, "KOTIKO_WIKTIONARY=sometimes", ["Use true or false."]}
  ]

  for {{vars, label, lines}, i} <- Enum.with_index(@mistakes) do
    @vars vars
    @label label
    @lines lines
    test "mistake #{i}: #{label}" do
      assert problems!(@vars) == [{@label, @lines}]
    end
  end

  describe "secrets" do
    test "a short API_TOKEN is refused without echoing it" do
      assert [{"API_TOKEN (value hidden)", [line]}] = problems!(%{"API_TOKEN" => "short-secret"})
      assert line =~ "too short (12 characters). Use at least 24"

      refute Config.format_problems(problems!(%{"API_TOKEN" => "short-secret"}), nil) =~
               "short-secret"
    end

    test "a malformed TELEGRAM_BOT_TOKEN is refused without echoing it" do
      for bad <- ["123:short", "AAH4xkPq0123456789abcdefghijklmnopqrs", "bot123:" <> @bot_token] do
        problems = problems!(%{"TELEGRAM_BOT_TOKEN" => bad})
        assert [{"TELEGRAM_BOT_TOKEN (value hidden)", [_]}] = problems
        refute Config.format_problems(problems, nil) =~ bad
      end
    end
  end

  describe "secrets in files (NAME_FILE)" do
    @describetag :tmp_dir

    defp secret_file(dir, name, contents, mode \\ 0o600) do
      path = Path.join(dir, name)
      File.write!(path, contents)
      File.chmod!(path, mode)
      path
    end

    test "every secret can come from a file; one line ending is dropped", %{tmp_dir: dir} do
      vars = %{
        "API_TOKEN_FILE" => secret_file(dir, "api", @token <> "\n"),
        "LLM_API_KEY_FILE" => secret_file(dir, "llm", "sk-or-v1-abc\r\n"),
        "TELEGRAM_BOT_TOKEN_FILE" => secret_file(dir, "bot", @bot_token),
        "TRANSCRIBE_API_KEY_FILE" => secret_file(dir, "voice", "voice key\n")
      }

      assert {:ok, config, []} = parse(vars)
      assert config[:api_token] == @token
      assert config[:llm_api_key] == "sk-or-v1-abc"
      assert config[:telegram_token] == @bot_token
      # Only the line ending goes: the rest is the value as written.
      assert config[:transcribe_api_key] == "voice key"
    end

    test "a value from a file is checked like one in .env, without echoing it",
         %{tmp_dir: dir} do
      vars = %{"API_TOKEN_FILE" => secret_file(dir, "api", "short-secret\n")}

      assert {:error, [{"API_TOKEN (value hidden)", [line]}], _} = parse(vars)
      assert line =~ "too short (12 characters)"
    end

    test "setting both forms is one readable problem naming both", %{tmp_dir: dir} do
      path = secret_file(dir, "llm", "from-the-file")
      vars = %{"LLM_API_KEY" => "from-env", "LLM_API_KEY_FILE" => path}

      assert {:error, [{label, [line]}], _} = parse(vars)
      assert label == "LLM_API_KEY and LLM_API_KEY_FILE=#{path} (both set)"
      assert line =~ "Set only one"
      message = Config.format_problems([{label, [line]}], nil, false)
      refute message =~ "from-env"
      refute message =~ "from-the-file"
    end

    test "a missing, empty, blank, multi-line or huge file is refused", %{tmp_dir: dir} do
      cases = [
        {Path.join(dir, "missing"), "no such file or directory"},
        {secret_file(dir, "empty", ""), "it's empty"},
        {secret_file(dir, "newline", "\n"), "it's empty"},
        {secret_file(dir, "blank", "  \t \n"), "it's empty"},
        {secret_file(dir, "two-lines", "secret-one\nsecret-two\n"), "more than one line"},
        {secret_file(dir, "huge", String.duplicate("k", 64 * 1024 + 1)), "too big for a key"},
        {dir, "it isn't a regular file"}
      ]

      for {path, reason} <- cases do
        assert {:error, [{label, [line]}], _} = parse(%{"TRANSCRIBE_API_KEY_FILE" => path})
        assert label == "TRANSCRIBE_API_KEY_FILE=#{path}"
        assert line =~ "Can't use this file for TRANSCRIBE_API_KEY: "
        assert line =~ reason
        refute line =~ "secret-one"
      end
    end

    test "an unreadable file is refused", %{tmp_dir: dir} do
      path = secret_file(dir, "locked", "sk-or-v1-abc", 0o000)

      # root reads any file; the check only means something for other users.
      unless match?({:ok, _}, File.read(path)) do
        assert {:error, [{_, [line]}], _} = parse(%{"LLM_API_KEY_FILE" => path})
        assert line =~ "permission denied"
      end
    end

    test "a file other users can read is a warning, not a problem", %{tmp_dir: dir} do
      path = secret_file(dir, "llm", "sk-or-v1-abc\n", 0o644)

      assert {:ok, config, [warning]} = parse(%{"LLM_API_KEY_FILE" => path})
      assert config[:llm_api_key] == "sk-or-v1-abc"
      assert warning =~ "LLM_API_KEY_FILE: other users of this computer can read"
      assert warning =~ "chmod 600 #{path}"
      refute warning =~ "sk-or-v1-abc"
    end

    test "read_secret_files/2 reads only the secrets it's asked for", %{tmp_dir: dir} do
      vars = %{
        "API_TOKEN_FILE" => secret_file(dir, "api", @token),
        "LLM_API_KEY_FILE" => Path.join(dir, "missing")
      }

      assert {%{"API_TOKEN" => @token}, [], []} = Config.read_secret_files(vars, ["API_TOKEN"])
    end
  end

  test "every problem is reported at once, in a stable order" do
    labels =
      %{
        "PORT" => "abc",
        "BIND" => "nonexistent.invalid",
        "ALLOWED_TELEGRAM_IDS" => "1,x",
        "LOG_LEVEL" => "loud"
      }
      |> problems!()
      |> Enum.map(&elem(&1, 0))

    assert labels == [
             "PORT=abc",
             "BIND=nonexistent.invalid",
             "ALLOWED_TELEGRAM_IDS=1,x",
             "LOG_LEVEL=loud"
           ]
  end

  test "a wrong LLM_URL is one problem, not also a missing LLM_MODEL" do
    assert [{"LLM_URL=nope", _}] = problems!(%{"LLM_URL" => "nope"})
  end

  test "the message block, as printed on stderr" do
    problems = problems!(%{"BIND" => "kotiko.local", "ALLOWED_TELEGRAM_IDS" => "123,abc"})

    assert Config.format_problems(problems, "/home/me/kotiko/server/.env", false) == """
           The server can't start: 2 problems in your settings (/home/me/kotiko/server/.env)

             BIND=kotiko.local
               Couldn't find an address for "kotiko.local". Use an IP address such as 127.0.0.1,
               100.101.102.103 (Tailscale) or 0.0.0.0.

             ALLOWED_TELEGRAM_IDS=123,abc
               "abc" isn't a Telegram ID. IDs are numbers; the bot tells you yours.

           Fix these and start the server again.
           """
  end

  test "one problem, settings from the environment, running under systemd" do
    assert Config.format_problems([{"PORT=abc", ["Bad."]}], nil, true) == """
           The server can't start: 1 problem in your settings

             PORT=abc
               Bad.

           Fix this and start the server again (systemctl --user restart kotiko).
           """
  end

  describe "unknown KOTIKO_ variables" do
    test "a near miss suggests the real name" do
      assert {:ok, _, warnings} = parse(%{"KOTIKO_DATADIR" => "/x", "LLM_API_KEY" => "k"})

      assert warnings == [
               "KOTIKO_DATADIR: did you mean KOTIKO_DATA_DIR? KOTIKO_DATADIR isn't a setting, " <>
                 "so it's ignored."
             ]
    end

    test "anything else is named as ignored" do
      assert {:ok, _, ["KOTIKO_COLOUR isn't a setting this server knows, so it's ignored."]} =
               parse(%{"KOTIKO_COLOUR" => "blue", "LLM_API_KEY" => "k"})
    end

    test "a near miss of an old name suggests the current name" do
      assert {:ok, _, [warning]} = parse(%{(@old <> "DATADIR") => "/x", "LLM_API_KEY" => "k"})

      assert warning ==
               "#{@old}DATADIR: did you mean KOTIKO_DATA_DIR? #{@old}DATADIR isn't a setting, " <>
                 "so it's ignored."

      assert {:ok, _, warnings} = parse(%{(@old <> "COLOUR") => "blue", "LLM_API_KEY" => "k"})
      assert warnings == ["#{@old}COLOUR isn't a setting this server knows, so it's ignored."]
    end
  end

  describe "variables from before the rename" do
    test "still work, with a warning to rename them" do
      assert {:ok, config, warnings} =
               parse(%{
                 (@old <> "DATA_DIR") => "/data/old",
                 (@old <> "LOG_SQL") => "true",
                 "LLM_API_KEY" => "k"
               })

      assert config[:data_dir] == "/data/old"
      assert config[:data_dir_source] == :env
      assert config[:log_sql] == true

      assert warnings == [
               "#{@old}DATA_DIR is now KOTIKO_DATA_DIR. Rename it in .env; the old name stops " <>
                 "working in a future release.",
               "#{@old}LOG_SQL is now KOTIKO_LOG_SQL. Rename it in .env; the old name stops " <>
                 "working in a future release."
             ]
    end

    test "the new name wins when both are set" do
      assert {:ok, config, warnings} =
               parse(%{
                 "KOTIKO_DATA_DIR" => "/data/new",
                 (@old <> "DATA_DIR") => "/data/old",
                 "LLM_API_KEY" => "k"
               })

      assert config[:data_dir] == "/data/new"

      assert warnings == [
               "#{@old}DATA_DIR is ignored because KOTIKO_DATA_DIR is set. Delete " <>
                 "#{@old}DATA_DIR from .env."
             ]
    end

    test "a mistake is reported under the name that was set" do
      assert {:error, problems, _} = parse(%{(@old <> "LOG_SQL") => "maybe"})
      assert problems == [{"#{@old}LOG_SQL=maybe", ["Use true or false."]}]

      assert {:error, [{label, [line]}], _} =
               parse(%{(@old <> "DATA_DIR") => "/nope"},
                 ensure_dir: fn _ -> {:error, "it isn't a folder"} end
               )

      assert label == "#{@old}DATA_DIR=/nope"
      assert line =~ "or leave #{@old}DATA_DIR empty"
    end
  end

  describe "data folder" do
    setup do
      root =
        Path.join(System.tmp_dir!(), "kotiko-config-test-#{System.unique_integer([:positive])}")

      on_exit(fn -> File.rm_rf(root) end)
      %{root: root}
    end

    test "a missing folder is created, private", %{root: root} do
      dir = Path.join(root, "a/b")

      assert {:ok, config, _} =
               Config.parse(%{"KOTIKO_DATA_DIR" => dir}, resolver: &resolver/1)

      assert config[:data_dir] == dir
      assert File.dir?(dir)
      assert Bitwise.band(File.stat!(dir).mode, 0o777) == 0o700
    end

    test "a folder that's already there keeps its permissions here", %{root: root} do
      File.mkdir_p!(root)
      File.chmod!(root, 0o755)

      assert {:ok, _config, _} =
               Config.parse(%{"KOTIKO_DATA_DIR" => root}, resolver: &resolver/1)

      assert Bitwise.band(File.stat!(root).mode, 0o777) == 0o755
    end

    test "a file in the way is an error", %{root: root} do
      File.mkdir_p!(root)
      file = Path.join(root, "not-a-folder")
      File.write!(file, "")

      assert {:error, [{label, [line]}], _} =
               Config.parse(%{"KOTIKO_DATA_DIR" => file}, resolver: &resolver/1)

      assert label == "KOTIKO_DATA_DIR=#{file}"
      assert line =~ "Can't keep the database in #{file}:"
      assert line =~ "or leave KOTIKO_DATA_DIR empty"
    end

    test "a folder that can't be created is an error", %{root: root} do
      File.mkdir_p!(root)
      File.chmod!(root, 0o500)
      on_exit(fn -> File.chmod(root, 0o700) end)
      dir = Path.join(root, "inside")

      assert {:error, [{_label, [line]}], _} =
               Config.parse(%{"KOTIKO_DATA_DIR" => dir}, resolver: &resolver/1)

      assert line =~ "Can't keep the database in #{dir}"
    end

    test "~ is expanded" do
      assert ok!(%{"KOTIKO_DATA_DIR" => "~/words"})[:data_dir] == Path.expand("~/words")
    end
  end

  test "openrouter?/1" do
    assert Config.openrouter?("https://openrouter.ai/api/v1")
    assert Config.openrouter?("https://eu.openrouter.ai/api/v1")
    refute Config.openrouter?("http://localhost:11434/v1")
    refute Config.openrouter?("https://notopenrouter.ai/v1")
    # A host name is case-insensitive too (security review D-04's neighbour).
    assert Config.openrouter?("HTTPS://OpenRouter.ai/api/v1")
    assert Config.openrouter?("https://EU.OPENROUTER.AI/api/v1")
  end

  # B-09 (slice 54): any 24 characters were accepted, even 24 a's.
  describe "a weak API_TOKEN" do
    test "starts, with a warning that never shows the token" do
      for weak <- [String.duplicate("a", 24), String.duplicate("password", 3)] do
        assert {:ok, config, warnings} = parse(%{"API_TOKEN" => weak, "LLM_API_KEY" => "k"})
        assert config[:api_token] == weak
        assert [warning] = Enum.filter(warnings, &(&1 =~ "API_TOKEN"))
        assert warning =~ "easy to guess"
        assert warning =~ "openssl rand -hex 24"
        refute warning =~ weak
      end
    end

    test "a random token gets no warning" do
      for token <- [@token, Base.encode16(:crypto.strong_rand_bytes(24), case: :lower)] do
        assert {:ok, _, warnings} = parse(%{"API_TOKEN" => token, "LLM_API_KEY" => "k"})
        assert Enum.filter(warnings, &(&1 =~ "API_TOKEN")) == []
      end
    end
  end

  # B-05 (slice 54): a user name and password in these URLs reached the log at info.
  describe "a URL with a user name or password in it" do
    test "is refused for LLM_URL, TRANSCRIBE_URL and PUBLIC_URL, never echoing it" do
      for name <- ~w(LLM_URL TRANSCRIBE_URL PUBLIC_URL),
          url <- [
            "https://proxyuser:Pr0xy-Pa55-SECRET@llm.example/v1",
            "http://Pr0xy-Pa55-SECRET@127.0.0.1:8080/v1"
          ] do
        assert {:error, problems, _} = parse(%{name => url, "LLM_MODEL" => "m"})
        assert [{label, [line]}] = Enum.filter(problems, fn {l, _} -> l =~ name end)
        assert label == "#{name} (value hidden)"
        assert line =~ "user name or password"
        assert line =~ "_API_KEY"
        refute inspect(problems) =~ "SECRET"
      end
    end

    test "something that isn't an address but has an @ isn't echoed either" do
      assert {:error, [{"LLM_URL (value hidden)", [line]}], _} =
               parse(%{
                 "LLM_URL" => "proxyuser:Pr0xy-Pa55-SECRET@llm.example",
                 "LLM_MODEL" => "m"
               })

      assert line =~ "isn't a web address"
    end

    test "an @ elsewhere in the URL is fine" do
      assert ok!(%{"LLM_URL" => "https://llm.example/v1/@team", "LLM_MODEL" => "m"})[:llm_url] ==
               "https://llm.example/v1/@team"
    end
  end

  # B-06 (slice 54): a key sent over plain HTTP to another machine gave no warning.
  describe "a key sent over plain HTTP" do
    defp plain_http_warnings(vars) do
      assert {:ok, _, warnings} = parse(vars)
      Enum.filter(warnings, &(&1 =~ "plain HTTP"))
    end

    test "to another machine gets a warning naming the key and the host" do
      key = "sk-secret-key-0123456789abcdef"

      assert [warning] =
               plain_http_warnings(%{
                 "LLM_URL" => "http://203.0.113.7/v1",
                 "LLM_MODEL" => "m",
                 "LLM_API_KEY" => key
               })

      assert warning =~ "LLM_API_KEY is sent over plain HTTP to 203.0.113.7"
      refute warning =~ key

      assert [warning] =
               plain_http_warnings(%{
                 "TRANSCRIBE_URL" => "http://whisper.lan:8178/inference",
                 "TRANSCRIBE_API_KEY" => key,
                 "LLM_API_KEY" => "k"
               })

      assert warning =~ "TRANSCRIBE_API_KEY is sent over plain HTTP to whisper.lan"
    end

    # D-04 (slice 54): a scheme is case-insensitive (RFC 3986 section 3.1) and Req sends
    # HTTP://... in the clear, but only a lowercase http:// got the warning.
    test "whatever the scheme's case" do
      for url <- ~w(HTTP://203.0.113.7/v1 Http://203.0.113.7/v1 hTtP://203.0.113.7/v1) do
        assert [warning] =
                 plain_http_warnings(%{
                   "LLM_URL" => url,
                   "LLM_MODEL" => "m",
                   "LLM_API_KEY" => "k"
                 }),
               url

        assert warning =~ "LLM_API_KEY is sent over plain HTTP to 203.0.113.7"
      end

      assert [_] =
               plain_http_warnings(%{
                 "TRANSCRIBE_URL" => "HTTP://whisper.lan:8178/inference",
                 "TRANSCRIBE_API_KEY" => "k",
                 "LLM_API_KEY" => "k"
               })

      assert plain_http_warnings(%{
               "LLM_URL" => "HTTPS://203.0.113.7/v1",
               "LLM_MODEL" => "m",
               "LLM_API_KEY" => "k"
             }) == []

      assert plain_http_warnings(%{
               "LLM_URL" => "HTTP://LOCALHOST:11434/v1",
               "LLM_MODEL" => "m",
               "LLM_API_KEY" => "k"
             }) == []
    end

    test "not to this machine, over Tailscale, over HTTPS, or without a key" do
      for url <- ~w(http://127.0.0.1:11434/v1 http://localhost:11434/v1 http://[::1]:1/v1
                    http://ollama.localhost/v1 http://100.101.102.103/v1
                    http://gpu.tail1234.ts.net/v1 https://203.0.113.7/v1) do
        assert plain_http_warnings(%{"LLM_URL" => url, "LLM_MODEL" => "m", "LLM_API_KEY" => "k"}) ==
                 [],
               url
      end

      assert plain_http_warnings(%{"LLM_URL" => "http://203.0.113.7/v1", "LLM_MODEL" => "m"}) ==
               []
    end
  end
end
