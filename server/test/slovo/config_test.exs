# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Slovo.ConfigTest do
  # Slovo.Config.parse/2 is pure apart from the resolver and the data folder check, both
  # replaced here, so nothing touches DNS or the real data folder.
  use ExUnit.Case, async: true
  alias Slovo.Config

  @bot_token "123456789:AAH4xkPq0123456789abcdefghijklmnopqrs"
  @token "a-token-of-at-least-24-characters"

  defp resolver("localhost"), do: {:ok, {127, 0, 0, 1}}
  defp resolver("laptop.tail1234.ts.net"), do: {:ok, {100, 101, 102, 103}}
  defp resolver(_), do: {:error, :nxdomain}

  defp parse(vars, opts \\ []) do
    defaults = [
      resolver: &resolver/1,
      ensure_dir: fn _ -> :ok end,
      default_data_dir: "/srv/slovo-default"
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
      assert config[:data_dir] == "/srv/slovo-default"
      assert config[:log_level] == :info
      assert config[:log_lookups] == false
      assert config[:log_sql] == false

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
          "SLOVO_DATA_DIR" => "/data/slovo",
          "LOG_LEVEL" => "DEBUG",
          "LOG_LOOKUPS" => "true",
          "SLOVO_LOG_SQL" => "yes"
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
      assert config[:data_dir] == "/data/slovo"
      assert config[:log_level] == :debug
      assert config[:log_lookups] == true
      assert config[:log_sql] == true
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
    {%{"BIND" => "mira.local"}, "BIND=mira.local",
     [
       "Couldn't find an address for \"mira.local\". Use an IP address such as 127.0.0.1, " <>
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
    {%{"SLOVO_LOG_SQL" => "2"}, "SLOVO_LOG_SQL=2", ["Use true or false."]}
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
    problems = problems!(%{"BIND" => "mira.local", "ALLOWED_TELEGRAM_IDS" => "123,abc"})

    assert Config.format_problems(problems, "/home/me/slovo/server/.env", false) == """
           The server can't start: 2 problems in your settings (/home/me/slovo/server/.env)

             BIND=mira.local
               Couldn't find an address for "mira.local". Use an IP address such as 127.0.0.1,
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

           Fix this and start the server again (systemctl --user restart slovo).
           """
  end

  describe "unknown SLOVO_ variables" do
    test "a near miss suggests the real name" do
      assert {:ok, _, warnings} = parse(%{"SLOVO_DATADIR" => "/x", "LLM_API_KEY" => "k"})

      assert warnings == [
               "SLOVO_DATADIR: did you mean SLOVO_DATA_DIR? SLOVO_DATADIR isn't a setting, " <>
                 "so it's ignored."
             ]
    end

    test "anything else is named as ignored" do
      assert {:ok, _, ["SLOVO_COLOUR isn't a setting this server knows, so it's ignored."]} =
               parse(%{"SLOVO_COLOUR" => "blue", "LLM_API_KEY" => "k"})
    end
  end

  describe "data folder" do
    setup do
      root =
        Path.join(System.tmp_dir!(), "slovo-config-test-#{System.unique_integer([:positive])}")

      on_exit(fn -> File.rm_rf(root) end)
      %{root: root}
    end

    test "a missing folder is created", %{root: root} do
      dir = Path.join(root, "a/b")

      assert {:ok, config, _} =
               Config.parse(%{"SLOVO_DATA_DIR" => dir}, resolver: &resolver/1)

      assert config[:data_dir] == dir
      assert File.dir?(dir)
    end

    test "a file in the way is an error", %{root: root} do
      File.mkdir_p!(root)
      file = Path.join(root, "not-a-folder")
      File.write!(file, "")

      assert {:error, [{label, [line]}], _} =
               Config.parse(%{"SLOVO_DATA_DIR" => file}, resolver: &resolver/1)

      assert label == "SLOVO_DATA_DIR=#{file}"
      assert line =~ "Can't keep the database in #{file}:"
      assert line =~ "or leave SLOVO_DATA_DIR empty"
    end

    test "a folder that can't be created is an error", %{root: root} do
      File.mkdir_p!(root)
      File.chmod!(root, 0o500)
      on_exit(fn -> File.chmod(root, 0o700) end)
      dir = Path.join(root, "inside")

      assert {:error, [{_label, [line]}], _} =
               Config.parse(%{"SLOVO_DATA_DIR" => dir}, resolver: &resolver/1)

      assert line =~ "Can't keep the database in #{dir}"
    end

    test "~ is expanded" do
      assert ok!(%{"SLOVO_DATA_DIR" => "~/words"})[:data_dir] == Path.expand("~/words")
    end
  end

  test "openrouter?/1" do
    assert Config.openrouter?("https://openrouter.ai/api/v1")
    assert Config.openrouter?("https://eu.openrouter.ai/api/v1")
    refute Config.openrouter?("http://localhost:11434/v1")
    refute Config.openrouter?("https://notopenrouter.ai/v1")
  end
end
