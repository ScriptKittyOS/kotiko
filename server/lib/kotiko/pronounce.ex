# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.Pronounce do
  @moduledoc """
  Pronunciations from Wiktionary (DECISIONS 2026-10-04, slice 49 section 4a). The free
  models get Russian stress wrong on a quarter of everyday words, and write wrong
  respellings even when told the stress; Wiktionary's IPA had it right for all forty words
  checked. So for a target language with lexical stress, the IPA on the word's Wiktionary
  page becomes the respelling, written with the base's table
  (`spec/lang/<base>/respelling.json` `ipa`), with the stress mark added for ru, uk and
  be. A word Wiktionary lacks, or whose pronunciations disagree (homographs), keeps the
  model's.

  The same algorithm as `extension/lib/pronounce.js`; both pass every case in
  `spec/fixtures/pronounce/`. Text is handled as code points, like the extension.
  """

  alias Kotiko.Spec

  @acute <<0x301::utf8>>
  @vowels MapSet.new(String.codepoints("aäɑɐæɒʌəɜeɛɘɪiɨɯɤoɔɵuʊʉyʏøœãẽĩõũ"))
  @glide_end MapSet.new(["j", "w"])
  @drop MapSet.new(["ˑ", "ʰ", "ʷ", "ˠ", "ˤ", "ʼ", "‿", "ʱ", "ⁿ", "ˀ"])
  @marks ["ˈ", "ˌ", ".", "-"]
  @obstruent MapSet.new(~w(p b t d k ɡ g f v s z ʃ ʒ x θ ð c ɟ q β ɣ))
  @second MapSet.new(~w(r ɾ ɹ ʁ l ɫ j w))
  @s_like MapSet.new(~w(s ʃ))
  @stop MapSet.new(~w(p t k))

  @cache :kotiko_pronounce

  defp w, do: Spec.wiktionary()
  defp primary(tag), do: tag |> to_string() |> String.split("-") |> hd()

  defp facts(lang) do
    targets = Spec.pronunciation()["targets"] || %{}
    targets[lang] || targets[primary(lang)]
  end

  @doc "The section heading of a language on English Wiktionary."
  def heading(lang) do
    headings = w()["headings"] || %{}
    langs = Spec.languages()["languages"] || %{}

    headings[lang] || headings[primary(lang)] || get_in(langs, [lang, "names", "en"]) ||
      get_in(langs, [primary(lang), "names", "en"])
  end

  # ── reading a page ───────────────────────────────────────────────────

  defp decode(s) do
    s
    |> String.replace(~r/<[^>]+>/u, "")
    |> String.replace(~r/&#(\d+);/u, fn m ->
      <<String.to_integer(String.slice(m, 2..-2//1))::utf8>>
    end)
    |> String.replace(~r/&#x([0-9a-fA-F]+);/u, fn m ->
      <<String.to_integer(String.slice(m, 3..-2//1), 16)::utf8>>
    end)
    |> String.replace("&lt;", "<")
    |> String.replace("&gt;", ">")
    |> String.replace("&quot;", "\"")
    |> String.replace(~r/&#39;|&apos;/u, "'")
    |> String.replace("&nbsp;", " ")
    |> String.replace("&amp;", "&")
    |> String.trim()
  end

  @doc "The IPA of each Pronunciation section in the language's part of a page, in order."
  def blocks_from_html(html, name) when is_binary(html) and is_binary(name) do
    h2 = Regex.scan(~r/<h2\b[^>]*>(.*?)<\/h2>/su, html, return: :index)

    case Enum.find_index(h2, fn [_, {s, l}] -> decode(binary_part(html, s, l)) == name end) do
      nil ->
        []

      at ->
        [{s0, l0}, _] = Enum.at(h2, at)
        start = s0 + l0

        stop =
          case Enum.at(h2, at + 1) do
            [{s1, _}, _] -> s1
            nil -> byte_size(html)
          end

        section = binary_part(html, start, stop - start)
        heads = Regex.scan(~r/<h([3-6])\b[^>]*>(.*?)<\/h\1>/su, section, return: :index)

        heads
        |> Enum.with_index()
        |> Enum.flat_map(fn {head, i} -> block(section, head, Enum.at(heads, i + 1)) end)
    end
  end

  def blocks_from_html(_, _), do: []

  # The IPA under one heading of a section, as a one-block list, when it's a Pronunciation
  # heading with any.
  defp block(section, [{hs, hl}, _, {ts, tl}], next) do
    if Regex.match?(~r/^Pronunciation\b/u, decode(binary_part(section, ts, tl))) do
      from = hs + hl
      to = if next, do: next |> hd() |> elem(0), else: byte_size(section)

      ipa =
        ~r/<span\b[^>]*class="IPA[^"]*"[^>]*>(.*?)<\/span>/su
        |> Regex.scan(binary_part(section, from, to - from), capture: :all_but_first)
        |> Enum.map(fn [x] -> decode(x) end)
        |> Enum.filter(&Regex.match?(~r/^[\[\/]/u, &1))

      if ipa == [], do: [], else: [ipa]
    else
      []
    end
  end

  # ── IPA to respelling ────────────────────────────────────────────────

  @doc ~S|The words of the first transcription in `raw`, cleaned: "[ˈɛtə]" -> ["ˈɛtə"].|
  def words(raw) do
    case Regex.run(~r/^[\[\/]([^\]\/]*)[\]\/]/u, String.trim(to_string(raw))) do
      [_, inner] ->
        s =
          inner
          |> String.split(~r/\s*[~,]\s*/u)
          |> hd()
          |> String.replace(~r/\([^)]*\)/u, "")
          |> String.trim()

        if s == "", do: nil, else: String.split(s, ~r/\s+/u)

      _ ->
        nil
    end
  end

  defp combining?(ch) do
    <<c::utf8>> = ch
    c >= 0x300 and c <= 0x36F and c != 0x361
  end

  defp keys(table) do
    table["map"]
    |> Map.keys()
    |> Enum.map(&String.codepoints/1)
    |> Enum.sort_by(&(-length(&1)))
  end

  defp starts_with?(cps, key), do: Enum.take(cps, length(key)) == key

  # One IPA word as units, or nil when it has a sound the table doesn't know.
  defp units(word, table, lang) do
    over = get_in(table, ["targets", lang]) || get_in(table, ["targets", primary(lang)]) || %{}
    take(String.codepoints(word), keys(table), table, over, [])
  end

  defp take([], _keys, _table, _over, acc), do: Enum.reverse(acc)

  defp take([ch | rest] = cps, keys, table, over, acc) do
    cond do
      ch in @marks ->
        take(rest, keys, table, over, [%{t: :mark, key: ch} | acc])

      ch == "ʲ" ->
        take(rest, keys, table, over, [%{t: :pal} | acc])

      ch == "ː" ->
        take(rest, keys, table, over, [%{t: :long} | acc])

      MapSet.member?(@drop, ch) or combining?(ch) ->
        take(rest, keys, table, over, acc)

      true ->
        hit =
          Enum.find(keys, fn k ->
            starts_with?(cps, k) and
              not (length(k) > 1 and MapSet.member?(@vowels, hd(k)) and
                     MapSet.member?(@glide_end, List.last(k)) and
                     MapSet.member?(@vowels, Enum.at(cps, length(k))))
          end)

        case hit do
          nil ->
            nil

          k ->
            key = Enum.join(k)
            t = if MapSet.member?(@vowels, hd(k)), do: :v, else: :c
            unit = %{t: t, key: key, s: Map.get(over, key, table["map"][key])}
            take(Enum.drop(cps, length(k)), keys, table, over, [unit | acc])
        end
    end
  end

  # Splits units into syllables: marks are boundaries and ˈ stresses the syllable after
  # it; between two vowels with no mark, one consonant, or an obstruent and a liquid or
  # glide (or s and a stop), starts the next syllable. A piece with no vowel joins the
  # syllable after it (or before it, at the end).
  defp syllables(us) do
    indexed = Enum.with_index(us)
    nuclei = for {u, i} <- indexed, u.t == :v, do: i

    cut =
      nuclei
      |> Enum.zip(Enum.drop(nuclei, 1))
      |> Enum.reduce(MapSet.new(), fn {a, b}, cut -> cut_between(cut, indexed, a, b) end)

    indexed |> group(cut) |> join_vowelless()
  end

  # Where the syllable after vowel `a` starts, before vowel `b`.
  defp cut_between(cut, indexed, a, b) do
    between = Enum.slice(indexed, (a + 1)..(b - 1)//1)
    cons = Enum.filter(between, fn {u, _} -> u.t == :c end)

    cond do
      Enum.any?(between, fn {u, _} -> u.t == :mark end) -> cut
      cons == [] -> MapSet.put(cut, b)
      true -> MapSet.put(cut, cons |> Enum.at(length(cons) - onset(cons)) |> elem(1))
    end
  end

  # How many of the consonants between two vowels start the next syllable: two for an
  # obstruent and a liquid or glide, or s and a stop; else one.
  defp onset(cons) when length(cons) >= 2 do
    [{x, _}, {y, _}] = Enum.take(cons, -2)

    if (MapSet.member?(@obstruent, x.key) and MapSet.member?(@second, y.key) and x.key != y.key) or
         (MapSet.member?(@s_like, x.key) and MapSet.member?(@stop, y.key)),
       do: 2,
       else: 1
  end

  defp onset(_cons), do: 1

  defp group(indexed, cut) do
    {raw, _pending} =
      Enum.reduce(indexed, {[%{units: [], stressed: false}], false}, fn {u, i}, acc ->
        place(u, i, cut, acc)
      end)

    Enum.reverse(raw)
  end

  defp place(%{t: :mark} = u, _i, _cut, {[cur | _] = raw, pending}) do
    raw = if cur.units == [], do: raw, else: [%{units: [], stressed: false} | raw]
    {raw, pending or u.key == "ˈ"}
  end

  defp place(u, i, cut, {[cur | _] = raw, pending}) do
    raw =
      if MapSet.member?(cut, i) and cur.units != [],
        do: [%{units: [], stressed: false} | raw],
        else: raw

    [now | rest] = raw
    {[%{now | units: now.units ++ [u], stressed: now.stressed or pending} | rest], false}
  end

  # A piece with no vowel joins the syllable after it, or the last one.
  defp join_vowelless(raw) do
    {out, carry} =
      raw
      |> Enum.reject(&(&1.units == []))
      |> Enum.reduce({[], nil}, fn s, {out, carry} ->
        s = if carry, do: absorb(s, carry, :before), else: s
        if Enum.any?(s.units, &(&1.t == :v)), do: {out ++ [s], nil}, else: {out, s}
      end)

    if carry && out != [],
      do: List.replace_at(out, -1, absorb(List.last(out), carry, :after)),
      else: out
  end

  defp absorb(s, c, :before),
    do: %{s | units: c.units ++ s.units, stressed: s.stressed or c.stressed}

  defp absorb(s, c, :after),
    do: %{s | units: s.units ++ c.units, stressed: s.stressed or c.stressed}

  defp spell(syl, table, lang) do
    syl
    |> Enum.with_index()
    |> Enum.map_join(fn {u, i} ->
      next = syl |> Enum.drop(i + 1) |> Enum.find(&(&1.t != :long))
      prev = if i > 0, do: Enum.at(syl, i - 1)
      spell_unit(u, prev, next, table, lang)
    end)
  end

  defp spell_unit(%{t: :pal}, _prev, next, table, _lang) do
    if vowel?(next) and
         not Enum.any?(table["palatal_before"] || [], &String.starts_with?(next.s, &1)),
       do: table["palatal"] || "",
       else: ""
  end

  defp spell_unit(%{t: :long}, prev, _next, table, lang) do
    if vowel?(prev) and primary(lang) in (table["long_double"] || []) and
         String.length(prev.s) == 1,
       do: prev.s,
       else: ""
  end

  defp spell_unit(%{t: :c, key: "j"} = u, _prev, next, table, _lang) do
    if vowel?(next), do: u.s, else: table["coda_y"] || u.s
  end

  defp spell_unit(%{t: :c, s: "g"} = u, _prev, next, table, _lang) do
    if is_binary(table["front_g"]) and vowel?(next) and Regex.match?(~r/^[ei]/u, next.s),
      do: table["front_g"],
      else: u.s
  end

  defp spell_unit(%{t: :v} = u, _prev, nil, table, _lang) do
    Map.get(table["open_syllable"] || %{}, u.key, u.s)
  end

  defp spell_unit(u, _prev, _next, _table, _lang), do: u.s

  defp vowel?(u), do: u != nil and u.t == :v

  defp respell_word(word, table, lang) do
    us = units(word, table, lang)
    if us != nil and Enum.any?(us, &(&1.t == :v)), do: written(syllables(us), table, lang)
  end

  defp written(syl, table, lang) do
    parts = Enum.map(syl, &spell(&1.units, table, lang))
    stressed = for {s, i} <- Enum.with_index(syl), s.stressed, do: i
    many = length(parts) > 1

    cond do
      Enum.any?(parts, &(&1 == "")) ->
        nil

      many and length(stressed) != 1 ->
        nil

      true ->
        %{
          text: capitals(parts, many, stressed),
          count: length(parts),
          stress: if(many, do: hd(stressed), else: 0)
        }
    end
  end

  defp capitals(parts, false, _stressed), do: Enum.join(parts, "-")

  defp capitals(parts, true, [at]) do
    parts
    |> Enum.with_index()
    |> Enum.map_join("-", fn {p, i} -> if i == at, do: String.upcase(p), else: p end)
  end

  defp table_for(base) do
    folders = Spec.lang_folders()

    get_in(folders, [base, "respelling", "ipa"]) ||
      get_in(folders, [primary(base), "respelling", "ipa"])
  end

  defp alphabet_ok?(text, base) do
    folders = Spec.lang_folders()

    alpha =
      get_in(folders, [base, "respelling", "alphabet"]) ||
        get_in(folders, [primary(base), "respelling", "alphabet"]) || ""

    text
    |> String.downcase()
    |> String.codepoints()
    |> Enum.all?(&(&1 in ["-", " "] or String.contains?(alpha, &1)))
  end

  @doc ~S|"[ˈɛtə]" for an English reader of Russian -> "EH-ta"; nil when it can't be written.|
  def respell(raw, base, lang) do
    table = table_for(base)
    ws = words(raw)

    with true <- table != nil and ws != nil,
         out = Enum.map(ws, &respell_word(&1, table, lang)),
         false <- Enum.any?(out, &is_nil/1),
         text = Enum.map_join(out, " ", & &1.text),
         true <- alphabet_ok?(text, base) do
      text
    else
      _ -> nil
    end
  end

  defp any_table,
    do: table_for("en") || Enum.find_value(Map.keys(Spec.lang_folders()), &table_for/1)

  @doc ~S|The stressed syllable of each word: "0,2"; nil when a word can't be read.|
  def stress_of(raw, lang) do
    ws = words(raw)
    table = any_table()

    with true <- ws != nil and table != nil,
         out = Enum.map(ws, &respell_word(&1, table, lang)),
         false <- Enum.any?(out, &is_nil/1) do
      Enum.map_join(out, ",", fn x -> if x.count > 1, do: x.stress, else: 0 end)
    else
      _ -> nil
    end
  end

  defp stress_of_respelling(text) do
    text
    |> to_string()
    |> String.split(" ")
    |> Enum.map_join(",", fn w ->
      s = String.split(w, "-")

      if length(s) > 1,
        do:
          Enum.find_index(s, &(Regex.match?(~r/\p{Lu}/u, &1) and &1 == String.upcase(&1))) || -1,
        else: 0
    end)
  end

  @doc """
  The transcription to use: in each section, the first whose stress can be read (passing
  over regional variants the target's data names, unless nothing else is there); the first
  section's when every section agrees on the stress; when they don't (homographs), the one
  the model's respelling agrees with, else nil.
  """
  def choose(blocks, lang, model_respelling) do
    variants = w()["variants"] || %{}
    avoid = get_in(variants, [lang, "avoid"]) || get_in(variants, [primary(lang), "avoid"]) || []
    plain? = fn x -> not Enum.any?(avoid, &String.contains?(x, &1)) end

    firsts =
      blocks
      |> Enum.map(fn block ->
        (Enum.filter(block, plain?) ++ Enum.reject(block, plain?))
        |> Enum.find(&(stress_of(&1, lang) != nil))
      end)
      |> Enum.reject(&is_nil/1)

    case firsts do
      [] ->
        nil

      [first | _] ->
        stresses = Enum.map(firsts, &stress_of(&1, lang))

        if Enum.all?(stresses, &(&1 == hd(stresses))) do
          first
        else
          model = if model_respelling, do: stress_of_respelling(model_respelling)

          case Enum.find_index(stresses, &(&1 == model)) do
            nil -> nil
            at -> Enum.at(firsts, at)
          end
        end
    end
  end

  @doc ~S|"это" with "[ˈɛtə]" -> "э́то" for targets that mark stress; nil when they don't line up.|
  def vocalize(native, raw, lang) do
    f = facts(lang)
    ws = words(raw)
    ns = String.split(to_string(native), ~r/\s+/u)
    table = any_table()

    if f && f["stress_marked"] && ws && table && length(ws) == length(ns) do
      letters = MapSet.new(String.codepoints(f["vowel_letters"] || ""))

      ns
      |> Enum.zip(ws)
      |> Enum.reduce_while([], fn {n, wd}, acc ->
        r = respell_word(wd, table, lang)
        vowels = n |> String.codepoints() |> Enum.count(&MapSet.member?(letters, &1))

        cond do
          r == nil or r.count != vowels -> {:halt, nil}
          vowels < 2 -> {:cont, acc ++ [n]}
          true -> {:cont, acc ++ [mark(n, r.stress, letters)]}
        end
      end)
      |> case do
        nil -> nil
        out -> Enum.join(out, " ")
      end
    end
  end

  defp mark(word, at, letters) do
    {out, _} =
      word
      |> String.codepoints()
      |> Enum.reduce({"", -1}, fn c, {out, n} ->
        if MapSet.member?(letters, c) do
          n = n + 1
          out = out <> c
          {if(n == at and c not in ["ё", "Ё"], do: out <> @acute, else: out), n}
        else
          {out <> c, n}
        end
      end)

    out
  end

  # ── applying it ──────────────────────────────────────────────────────

  @doc """
  Applies Wiktionary's pronunciation to one checked word (`Kotiko.WordSpec`'s shape, atom
  keys). The learner's own pronunciation is never replaced. `opts`: `:fetch_page` (a
  function of the title: `{:ok, html}`, `:none` for no page, or `{:error, _}`), `:cache`
  (`false` to skip it). Returns `{word, status}` with status "wiktionary", "no_data" (no
  pronunciation to use), "unavailable" (Wiktionary not reached; nothing remembered) or
  "skipped".
  """
  def enrich(word, opts \\ []) do
    f = facts(word[:lang])
    stress = w()["stress"] || []

    cond do
      word[:pronunciation_source] == "user" ->
        {word, "skipped"}

      f == nil or f["stress"] not in stress or table_for(word[:base_lang]) == nil or
          heading(word[:lang]) == nil ->
        {word, "skipped"}

      true ->
        case page_blocks(word, opts) do
          :error -> {word, "unavailable"}
          blocks -> apply_blocks(word, blocks, f)
        end
    end
  end

  defp apply_blocks(word, blocks, f) do
    ipa = choose(blocks, word[:lang], word[:pronunciation])
    text = ipa && respell(ipa, word[:base_lang], word[:lang])

    if text do
      word =
        Map.merge(word, %{
          pronunciation: text,
          pronunciation_careful: nil,
          pronunciation_source: "wiktionary"
        })

      word =
        if f["stress_marked"],
          do: Map.put(word, :native_vocalized, vocalize(word[:native], ipa, word[:lang])),
          else: word

      {word, "wiktionary"}
    else
      {word, "no_data"}
    end
  end

  defp page_blocks(word, opts) do
    key = {word[:lang], word[:native]}
    use_cache = Keyword.get(opts, :cache, true)

    case use_cache && cache_get(key) do
      blocks when is_list(blocks) ->
        blocks

      _ ->
        fetch = Keyword.get(opts, :fetch_page, &fetch_page/1)

        case fetch.(word[:native]) do
          {:ok, html} -> remember(use_cache, key, blocks_from_html(html, heading(word[:lang])))
          :none -> remember(use_cache, key, [])
          _ -> :error
        end
    end
  end

  defp remember(false, _key, blocks), do: blocks

  defp remember(_, key, blocks) do
    ensure_cache()
    :ets.insert(@cache, {key, blocks, System.monotonic_time(:second)})
    blocks
  end

  defp cache_get(key) do
    ensure_cache()
    max = (w()["cache_days"] || 30) * 86_400

    case :ets.lookup(@cache, key) do
      [{^key, blocks, at}] -> if System.monotonic_time(:second) - at < max, do: blocks
      _ -> nil
    end
  end

  defp ensure_cache do
    if :ets.whereis(@cache) == :undefined do
      :ets.new(@cache, [:named_table, :public, :set, read_concurrency: true])
    end
  rescue
    ArgumentError -> :ok
  end

  @doc false
  def clear_cache do
    ensure_cache()
    :ets.delete_all_objects(@cache)
  end

  @doc """
  Fetches a word's page from Wiktionary: `{:ok, html}`, `:none` when there is no page, or
  `{:error, reason}`. Waits once when Wikimedia asks for at most `:max_wait_ms` (default 5
  seconds) before trying again.
  """
  def fetch_page(title, opts \\ []) do
    url = String.replace(w()["endpoint"], "{title}", URI.encode(title, &URI.char_unreserved?/1))

    req =
      [
        headers: [{"user-agent", w()["agent"]}],
        receive_timeout: w()["timeout_ms"] || 5000,
        retry: false
      ] ++ Application.get_env(:kotiko, :pronounce_req_options, [])

    case Req.get(url, req) do
      {:ok, %{status: 200, body: body}} when is_binary(body) ->
        {:ok, body}

      {:ok, %{status: 404}} ->
        :none

      {:ok, %{status: 429} = res} ->
        wait = retry_after_ms(res)

        if Keyword.get(opts, :retried, false) or wait > Keyword.get(opts, :max_wait_ms, 5000) do
          {:error, :rate_limited}
        else
          Process.sleep(wait)
          fetch_page(title, Keyword.put(opts, :retried, true))
        end

      {:ok, %{status: status}} ->
        {:error, {:http, status}}

      {:error, e} ->
        {:error, e}
    end
  end

  defp retry_after_ms(res) do
    case Req.Response.get_header(res, "retry-after") do
      [v | _] ->
        case Integer.parse(v) do
          {s, _} -> s * 1000
          :error -> 10_000
        end

      _ ->
        10_000
    end
  end
end
