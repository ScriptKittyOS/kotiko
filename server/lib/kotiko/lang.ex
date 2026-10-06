# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Lang do
  @moduledoc """
  Language tags (slice 08): one canonical tag per language group (`canonical/1`), the base
  tag of a language a learner reads (`base_tag/1`, slice 50 section 2), the script check
  of a word's `native` (`check_script/2`) and names derived from the tag, never from the
  model (`name/2`, `endonym/1`).

  The data is `spec/languages.json` and `spec/lang-aliases.json` (generated from CLDR).
  `extension/lib/lang.js` implements the same rules, and both pass
  `spec/fixtures/lang-tags.json` and `spec/fixtures/base-tags.json`.

      iex> Kotiko.Lang.canonical("zh-TW")
      {:ok, "zh-Hant"}
      iex> Kotiko.Lang.base_tag("es-PR")
      "es"
      iex> Kotiko.Lang.check_script("sr", "hvala")
      {:ok, "sr-Latn"}
  """
  alias Kotiko.Spec

  @max_tag 35
  @data Spec.languages()
  @langs @data["languages"]
  @aliases Spec.aliases()
  @invalid MapSet.new(@aliases["invalid"])
  @sign MapSet.new(@aliases["sign"])
  @scripts Enum.map(@data["unicode_scripts"], fn {name, isos} -> {name, isos} end)

  @doc """
  The canonical tag (slice 08 section 2): `{:ok, tag}` or `{:error, code}` with
  `:invalid_lang` or `:sign_language_unsupported`.
  """
  def canonical(input) do
    case parse(input) do
      {:error, code} -> {:error, code}
      %{private: p} -> {:ok, "x-" <> p}
      p -> {:ok, join([p.lang, p.script, p.region])}
    end
  end

  @doc "True for a tag in `spec/languages.json` (unknown codes and `x-` tags are accepted, not known)."
  def known?(tag) do
    case parse(tag) do
      %{known: true} -> true
      _ -> false
    end
  end

  @doc """
  The base tag of a browser, page or learner language (slice 08 section 6), or nil:
  `es-PR` -> `es`, `zh-TW` -> `zh-Hant`, `zh` -> `zh-Hans`, `sr` -> `sr-Cyrl`,
  `pt-BR` -> `pt-BR`, `en-US` -> `en`.
  """
  def base_tag(input) do
    case parse(input) do
      {:error, _} ->
        nil

      %{private: _} ->
        nil

      %{known: false} = p ->
        join([p.lang, p.script])

      p ->
        entry = @langs[p.lang]
        script = p.script || if length(entry["scripts"]) > 1, do: entry["script"]
        region = if p.region in entry["base_regions"], do: p.region
        join([p.lang, script, region])
    end
  end

  @doc """
  True when two tags are the same base (slice 50 section 2): the same primary language and,
  when both name a script, the same script. `zh` matches `zh-Hans`; `pt-BR` matches `pt-PT`.
  """
  def same_base?(a, b) do
    case {parse(a), parse(b)} do
      {{:error, _}, _} -> false
      {_, {:error, _}} -> false
      {%{private: x}, %{private: y}} -> x == y
      {%{private: _}, _} -> false
      {_, %{private: _}} -> false
      {%{lang: l}, %{lang: l2}} when l != l2 -> false
      {%{named: sa}, %{named: sb}} -> is_nil(sa) or is_nil(sb) or sa == sb
    end
  end

  @doc """
  Checks `native` against the language of a canonical tag (slice 08 section 3):
  `{:ok, tag}`, rewritten when `native` is in another normal script of the language
  (`sr` with "hvala" is `sr-Latn`), or `{:error, :script_mismatch}` (Russian "spasibo").
  Unknown languages and `x-` tags are not checked.
  """
  def check_script(tag, native) do
    with p when is_map(p) <- parse(tag),
         true <- Map.get(p, :known, false) and is_binary(native),
         %{"script" => default} = entry when is_binary(default) <- @langs[p.lang] do
      current = p.script || entry["script"]
      counts = script_counts(native, current)
      # Loanwords keep their Latin letters (COVID-19 вирус, iPhone 手机).
      counts =
        if current != "Latn" and List.keymember?(counts, current, 0),
          do: List.keydelete(counts, "Latn", 0),
          else: counts

      case dominant(counts, current) do
        nil -> {:ok, tag}
        ^current -> {:ok, tag}
        script -> rewrite(p, entry, script)
      end
    else
      {:error, _} = e -> e
      _ -> {:ok, tag}
    end
  end

  defp rewrite(p, entry, script) do
    if script in entry["scripts"] do
      {:ok, join([p.lang, if(script != entry["script"], do: script), p.region])}
    else
      {:error, :script_mismatch}
    end
  end

  # Code points per ISO 15924 script, in the order of spec/languages.json's
  # unicode_scripts, as a keyword-like list of {iso, count}.
  defp script_counts(native, current) do
    Enum.reduce(@scripts, [], fn {name, isos}, acc ->
      n =
        case script_regex(name) do
          :unsupported -> 0
          re -> length(Regex.scan(re, native))
        end

      if n == 0 do
        acc
      else
        iso = if current in isos, do: current, else: hd(isos)

        case List.keyfind(acc, iso, 0) do
          nil -> acc ++ [{iso, n}]
          {_, m} -> List.keyreplace(acc, iso, 0, {iso, m + n})
        end
      end
    end)
  end

  # Older Erlang/OTP releases (26, with Elixir 1.15) bundle a PCRE that doesn't know
  # every Unicode script name in the CLDR data. Those scripts are skipped there rather
  # than crashing every add; only detection of that script is lost on that OTP.
  defp script_regex(name) do
    key = {__MODULE__, :script, name}

    case :persistent_term.get(key, nil) do
      nil ->
        re =
          case Regex.compile("\\p{#{name}}", "u") do
            {:ok, re} -> re
            {:error, _} -> :unsupported
          end

        :persistent_term.put(key, re)
        re

      re ->
        re
    end
  end

  defp dominant(counts, current) do
    {best, _} =
      Enum.reduce(counts, {nil, 0}, fn {iso, n}, {b, bn} ->
        if n > bn or (n == bn and iso == current), do: {iso, n}, else: {b, bn}
      end)

    best
  end

  @doc """
  The language's name in itself ("español", "日本語", "粵語"): the API's `language` field.
  Falls back to the English name, then the code.
  """
  def endonym(tag) do
    case parse(tag) do
      {:error, _} -> nil
      %{private: p} -> capitalize(p)
      p -> (@langs[p.lang] || %{})["endonym"] || get_in(@langs, [p.lang, "names", "en"]) || p.lang
    end
  end

  @doc """
  The name of a tag in an interface locale, from the data: "Cantonese", "cantonés",
  "Portuguese (Brazil)", "serbio (latino)". Locales without names fall back to English.
  """
  def name(tag, locale \\ "en") do
    case parse(tag) do
      {:error, _} ->
        to_string(tag)

      %{private: p} ->
        capitalize(p)

      %{known: false} = p ->
        join([p.lang, p.script, p.region])

      p ->
        loc = if locale in @data["locales"], do: locale, else: "en"
        entry = @langs[p.lang]
        base = entry["names"][loc] || entry["endonym"] || entry["names"]["en"] || p.lang

        extra =
          [
            p.script && get_in(@data, ["scriptNames", loc, p.script]),
            p.region && get_in(@data, ["regionNames", loc, p.region])
          ]
          |> Enum.filter(& &1)

        if extra == [], do: base, else: "#{base} (#{Enum.join(extra, ", ")})"
    end
  end

  @doc """
  Primary language codes whose code, endonym or name in any shipped locale is `term`
  (case-insensitive): "cantonese", "cantonés", "粵語" and "yue" all give `["yue"]`.
  """
  def find(term) when is_binary(term) do
    t = term |> String.trim() |> String.downcase()

    code =
      case canonical(t) do
        {:ok, tag} -> [tag |> String.split("-") |> hd()]
        _ -> []
      end

    named =
      for {lang, e} <- @langs,
          names = [e["endonym"] | Map.values(e["names"])],
          Enum.any?(names, &(is_binary(&1) and String.downcase(&1) == t)),
          do: lang

    Enum.uniq(Enum.filter(code, &Map.has_key?(@langs, &1)) ++ Enum.sort(named))
  end

  @doc ~s(The primary language subtag of a tag: "pt-BR" -> "pt".)
  def primary(tag) when is_binary(tag), do: tag |> String.split("-") |> hd()

  # ── parsing (slice 08 section 2, steps 1-10) ─────────────────────────

  @doc false
  # The parts of a tag: %{lang, script, region, named, known} (`named` is the script the
  # input named or implied, before the default script is dropped), %{private: subtag},
  # or {:error, code}.
  def parse(input) when is_binary(input) do
    s = input |> String.trim() |> String.replace("_", "-")

    if s == "" or String.length(s) > @max_tag or not Regex.match?(~r/^[A-Za-z0-9-]+$/, s) or
         Regex.match?(~r/^-|-$|--/, s) do
      {:error, :invalid_lang}
    else
      lower = String.downcase(s)

      if String.starts_with?(lower, "x-") do
        case Regex.run(~r/^x-([a-z]{2,8})$/, lower) do
          [_, p] -> %{private: p}
          nil -> {:error, :invalid_lang}
        end
      else
        lower = Map.get(@aliases["legacy"], lower, lower) |> String.downcase()
        parse_subtags(String.split(lower, "-"))
      end
    end
  end

  def parse(_), do: {:error, :invalid_lang}

  defp parse_subtags([lang | rest]) do
    if Regex.match?(~r/^[a-z]{2,3}$/, lang) do
      {lang, rest} = extlang(lang, rest)
      {script, region} = script_region(rest, nil, nil)

      if MapSet.member?(@invalid, lang),
        do: {:error, :invalid_lang},
        else: alias_lang(lang, script, region)
    else
      {:error, :invalid_lang}
    end
  end

  # An extended language subtag names the language itself: zh-yue is yue.
  defp extlang(lang, [ext | rest]) do
    if Regex.match?(~r/^[a-z]{3}$/, ext),
      do: {ext, drop_extlangs(rest)},
      else: {lang, [ext | rest]}
  end

  defp extlang(lang, []), do: {lang, []}

  defp drop_extlangs([t | rest]) do
    if Regex.match?(~r/^[a-z]{3}$/, t), do: drop_extlangs(rest), else: [t | rest]
  end

  defp drop_extlangs([]), do: []

  defp script_region([], script, region), do: {script, region}

  # A singleton starts an extension (-u-, -t-) or private use: dropped with what follows.
  defp script_region([t | _], script, region) when byte_size(t) == 1, do: {script, region}

  defp script_region([t | rest], script, region) do
    cond do
      is_nil(script) and is_nil(region) and Regex.match?(~r/^[a-z]{4}$/, t) ->
        script_region(rest, capitalize(t), region)

      is_nil(region) and Regex.match?(~r/^([a-z]{2}|\d{3})$/, t) ->
        script_region(rest, script, String.upcase(t))

      true ->
        script_region(rest, script, region)
    end
  end

  defp alias_lang(lang, script, region) do
    {lang, script, region} =
      case @aliases["language"][lang] do
        nil ->
          {lang, script, region}

        replacement ->
          [l | more] = String.split(replacement, "-")

          Enum.reduce(more, {l, script, region}, fn t, {l, s, r} ->
            if Regex.match?(~r/^[A-Za-z]{4}$/, t),
              do: {l, s || capitalize(t), r},
              else: {l, s, r || String.upcase(t)}
          end)
      end

    script = Map.get(@aliases["script"], script, script)
    region = Map.get(@aliases["territory"], region, region)
    entry = @langs[lang]

    cond do
      MapSet.member?(@sign, lang) or (entry && entry["sign"]) ->
        {:error, :sign_language_unsupported}

      is_nil(entry) ->
        unknown(lang, script, region)

      true ->
        regions(lang, entry, script, region)
    end
  end

  defp unknown(lang, script, region),
    do: %{lang: lang, script: script, region: region, named: script, known: false}

  defp regions(lang, entry, script, nil), do: scripts(lang, entry, script, nil)

  defp regions(lang, entry, script, region) do
    cond do
      s = get_in(entry, ["region_scripts", region]) ->
        scripts(lang, entry, script || s, nil)

      l = get_in(entry, ["region_languages", region]) ->
        case @langs[l] do
          nil -> unknown(l, script, nil)
          e -> scripts(l, e, script, nil)
        end

      r = get_in(entry, ["region_aliases", region]) ->
        scripts(lang, entry, script, keep_region(entry, r))

      true ->
        scripts(lang, entry, script, keep_region(entry, region))
    end
  end

  defp keep_region(entry, region), do: if(region in entry["regions"], do: region)

  defp scripts(lang, _entry, nil, region),
    do: %{lang: lang, script: nil, region: region, named: nil, known: true}

  defp scripts(lang, entry, script, region) do
    cond do
      l = get_in(entry, ["script_languages", script]) ->
        if @langs[l],
          do: %{lang: l, script: nil, region: region, named: script, known: true},
          else: %{lang: l, script: nil, region: region, named: nil, known: false}

      script == entry["script"] or script not in entry["scripts"] ->
        %{lang: lang, script: nil, region: region, named: script, known: true}

      true ->
        %{lang: lang, script: script, region: region, named: script, known: true}
    end
  end

  defp join(parts), do: parts |> Enum.reject(&is_nil/1) |> Enum.join("-")

  defp capitalize(s), do: String.capitalize(s)
end
