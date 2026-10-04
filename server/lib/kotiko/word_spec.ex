# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.WordSpec do
  @moduledoc """
  The shared word spec's pipeline (slice 09 section 4): input checks, extraction of the
  model's JSON, normalisation, validation and the whole-answer rules, for lookups
  (`process/2`) and for the one-time pronunciation refresh (`process_respell/2`). Also
  checks structured words from clients (`validate_word/2`, `patch/1`).

  Every number is `spec/rules.json`'s and every per-language list is in `spec/lang/`.
  `extension/lib/wordspec.js` implements the same steps, and both produce the same output
  for every fixture in `spec/fixtures/normalize/` and `spec/fixtures/pronunciation/`.
  """
  alias Kotiko.{Lang, Pronunciation, Spec, Text, UUID7, Word}
  alias Kotiko.Word.Forms

  @rules Spec.rules()
  @folders Spec.lang_folders()
  @langs Spec.languages()["languages"]

  defp rule(name), do: Map.fetch!(@rules, Atom.to_string(name))

  # ── A. input checks ──────────────────────────────────────────────────

  @doc """
  The learner's text before any model call: NFC, control characters stripped, trimmed.
  `{:ok, text}`, `{:error, :empty_input}` or `{:error, :input_too_long}`.
  """
  def prepare_input(text) when is_binary(text) do
    if String.valid?(text) do
      t =
        text
        |> :unicode.characters_to_nfc_binary()
        |> String.replace(~r/[\t\n\r\v\f]/, " ")
        |> String.replace(~r/\p{Cc}/u, "")
        |> String.trim()

      cond do
        t == "" -> {:error, :empty_input}
        Text.length(t) > rule(:max_input_chars) -> {:error, :input_too_long}
        true -> {:ok, t}
      end
    else
      {:error, :empty_input}
    end
  end

  def prepare_input(_), do: {:error, :empty_input}

  # ── text ─────────────────────────────────────────────────────────────

  defp str(s) when is_binary(s), do: s
  defp str(n) when is_number(n), do: to_string(n)
  defp str(_), do: nil

  defp clean(v), do: Text.clean(str(v))

  @doc "Lowercase in the base's locale (Turkish dotless i), final sigma as σ."
  def fold(s, base \\ nil) do
    mode = if base && Lang.primary(base) in ["tr", "az"], do: :turkic, else: :default
    s |> String.downcase(mode) |> String.replace("ς", "σ")
  end

  @doc false
  # At most `max` code points, cut at a word boundary with "…".
  def truncate(nil, _max), do: nil

  def truncate(s, max) do
    if Text.length(s) <= max do
      s
    else
      cut = s |> String.to_charlist() |> Enum.take(max - 1) |> List.to_string()
      String.replace(cut, ~r/\s+\S*$/u, "") <> "…"
    end
  end

  defp romanian(nil), do: nil

  defp romanian(s),
    do:
      s
      |> String.replace("ş", "ș")
      |> String.replace("Ş", "Ș")
      |> String.replace("ţ", "ț")
      |> String.replace("Ţ", "Ț")

  defp strip_punct(nil), do: nil

  defp strip_punct(s) do
    s
    |> String.replace(~r/^[¿¡]+/u, "")
    |> String.replace(~r/[.,!?;:。、！？]+$/u, "")
    |> String.trim()
    |> case do
      "" -> nil
      t -> t
    end
  end

  defp graphemes(s), do: String.graphemes(s)

  defp tokens(s), do: String.split(s, ~r/[^\p{L}\p{M}\p{N}'’]+/u, trim: true)

  # ── base-language data (slice 09 section 1) ──────────────────────────

  @doc """
  The data for a base tag: each file from the base's folder, then its language's, then
  `_generic`; `respelling` has no fallback. `folders` says which folder each came from
  (`spec/fixtures/lang-data.json`).
  """
  def lang_data(base) do
    key = {__MODULE__, :lang_data, base}

    case :persistent_term.get(key, nil) do
      nil ->
        data = build_lang_data(base)
        :persistent_term.put(key, data)
        data

      data ->
        data
    end
  end

  defp build_lang_data(base) do
    candidates = Enum.uniq([base, Lang.primary(base)])

    find = fn kind, generic? ->
      Enum.find(if(generic?, do: candidates ++ ["_generic"], else: candidates), fn f ->
        Map.has_key?(Map.get(@folders, f, %{}), kind)
      end)
    end

    folders = %{
      stopwords: find.("stopwords", true),
      stem: find.("stem", true),
      variants: find.("variants", true),
      respelling: find.("respelling", false)
    }

    stem = @folders[folders.stem]["stem"]

    variants =
      for group <- @folders[folders.variants]["variants"]["groups"],
          v <- group,
          into: %{},
          do: {fold(v, base), fold(hd(group), base)}

    irregulars =
      for {form, lemmas} <- stem["irregulars"] || %{},
          into: %{},
          do: {fold(form, base), Enum.map(List.wrap(lemmas), &fold(&1, base))}

    %{
      folders: folders,
      stopwords: MapSet.new(@folders[folders.stopwords]["stopwords"], &fold(&1, base)),
      stem: stem,
      irregulars: irregulars,
      variants: variants,
      respelling: folders.respelling && @folders[folders.respelling]["respelling"]
    }
  end

  # ── relatedness (the как lesson) ─────────────────────────────────────

  @doc false
  # The stems a (folded) word may reduce to: itself, its irregular lemmas, its accent-free
  # form where the base strips accents, one suffix rule's results, and spelling variants.
  def candidates(word, data) do
    irregular = fn w -> Map.get(data.irregulars, w, []) end
    base = if data.stem["strip_accents"], do: strip_accents(word), else: word

    found = [word | irregular.(word)] ++ if(base != word, do: [base | irregular.(base)], else: [])
    found = found ++ suffix_candidates(base, data.stem["suffixes"] || [])
    found = found ++ Enum.flat_map(found, &List.wrap(Map.get(data.variants, &1)))
    MapSet.new(found)
  end

  defp suffix_candidates(base, rules) do
    len = length(graphemes(base))

    Enum.find_value(rules, [], fn rule ->
      suffix = rule["suffix"]

      if String.ends_with?(base, suffix) and
           len - length(graphemes(suffix)) >= (rule["min"] || rule(:min_stem_graphemes)) do
        root = binary_part(base, 0, byte_size(base) - byte_size(suffix))
        Enum.map(rule["add"], &(root <> &1)) ++ undouble(root, rule["undouble"])
      end
    end)
  end

  defp undouble(root, true) do
    case Enum.reverse(String.codepoints(root)) do
      [c, c | rest] -> if c in ~w(a e i o u), do: [], else: [Enum.join(Enum.reverse([c | rest]))]
      _ -> []
    end
  end

  defp undouble(_root, _), do: []

  defp strip_accents(s) do
    s
    |> :unicode.characters_to_nfd_binary()
    |> String.replace(["\u0301", "\u0308"], "")
    |> :unicode.characters_to_nfc_binary()
  end

  @doc false
  def related?(form, gloss, base, data) do
    f = fold(form, base)
    g = fold(gloss, base)

    cond do
      f == g ->
        true

      data.stem["kind"] != "suffix" ->
        gg = graphemes(g)
        String.starts_with?(f, gg |> Enum.take(rule(:generic_stem_graphemes)) |> Enum.join())

      true ->
        stems =
          g
          |> tokens()
          |> Enum.map(&candidates(&1, data))
          |> Enum.reduce(MapSet.new(), &MapSet.union/2)

        case tokens(f) do
          [] -> false
          ts -> Enum.all?(ts, &(not MapSet.disjoint?(candidates(&1, data), stems)))
        end
    end
  end

  # ── B. extraction ────────────────────────────────────────────────────

  @doc """
  The JSON object in a model's content: the whole of it, or the first balanced `{...}`
  with `key` or `"intent"`. Nil when there is none (unparseable).
  """
  def extract(content, key \\ "words")

  def extract(content, key) when is_binary(content) do
    text =
      content
      |> String.replace(~r/<think>.*?<\/think>/s, "")
      |> String.replace(~r/```[A-Za-z]*/, "")
      |> String.trim()

    case decode_object(text) do
      nil -> scan(text, key, first_brace(text, 0))
      obj -> obj
    end
  end

  def extract(_content, _key), do: nil

  defp decode_object(s) do
    case Jason.decode(s) do
      {:ok, obj} when is_map(obj) -> obj
      _ -> nil
    end
  end

  defp first_brace(text, from) do
    case :binary.match(text, "{", scope: {from, byte_size(text) - from}) do
      {i, _} -> i
      :nomatch -> nil
    end
  end

  defp scan(_text, _key, nil), do: nil

  defp scan(text, key, start) do
    case balanced_end(text, start, start, 0, false) do
      nil ->
        nil

      stop ->
        obj = decode_object(binary_part(text, start, stop - start + 1))

        cond do
          obj && (Map.has_key?(obj, key) or Map.has_key?(obj, "intent")) -> obj
          obj -> scan(text, key, first_brace(text, stop + 1))
          true -> scan(text, key, first_brace(text, start + 1))
        end
    end
  end

  # Byte index of the brace closing the one at `start`; braces inside JSON strings (with
  # \" escapes) don't count. Every byte compared is ASCII, so UTF-8 is safe to scan.
  defp balanced_end(text, _start, i, _depth, _in_string) when i >= byte_size(text), do: nil

  defp balanced_end(text, start, i, depth, true) do
    case :binary.at(text, i) do
      ?\\ -> balanced_end(text, start, i + 2, depth, true)
      ?" -> balanced_end(text, start, i + 1, depth, false)
      _ -> balanced_end(text, start, i + 1, depth, true)
    end
  end

  defp balanced_end(text, start, i, depth, false) do
    case :binary.at(text, i) do
      ?" -> balanced_end(text, start, i + 1, depth, true)
      ?{ -> balanced_end(text, start, i + 1, depth + 1, false)
      ?} when depth == 1 -> i
      ?} -> balanced_end(text, start, i + 1, depth - 1, false)
      _ -> balanced_end(text, start, i + 1, depth, false)
    end
  end

  defp word_list(v) when is_list(v), do: Enum.filter(v, &is_map/1)

  defp word_list(v) when is_map(v) do
    # base-neutral-ok: 09's legacy-key repair reads replies in the old shape
    if Enum.any?(~w(native lang gloss english), &Map.has_key?(v, &1)) do
      [v]
    else
      v |> Enum.sort_by(&elem(&1, 0)) |> Enum.map(&elem(&1, 1)) |> Enum.filter(&is_map/1)
    end
  end

  defp word_list(_), do: []

  # ── C and D. one entry ───────────────────────────────────────────────

  defp resolve_base(raw, requested) do
    case Lang.base_tag(raw) do
      nil -> nil
      b -> if b in requested, do: b, else: Enum.find(requested, &Lang.same_base?(&1, b))
    end
  end

  defp raw_forms(v) when is_binary(v), do: String.split(v, ~r/[,;、，；\n]/u)
  defp raw_forms(v) when is_list(v), do: v
  defp raw_forms(v) when is_number(v), do: [v]
  defp raw_forms(_), do: []

  defp form_of(v) when is_binary(v) or is_number(v), do: Forms.form(%{text: str(v)})
  defp form_of(v) when is_map(v), do: v |> Forms.form() |> Map.update!(:text, &str/1)
  defp form_of(_), do: nil

  defp base_script(base) do
    case Lang.parse(base) do
      %{lang: l, script: s} -> s || get_in(@langs, [l, "script"])
      _ -> nil
    end
  end

  defp group(lang, native), do: {lang, fold(native)}

  defp check_entry(w, ctx) do
    single = match?([_], ctx.bases)
    has = fn k -> not is_nil(w[k]) end

    entry = %{
      lang_raw: clean(w["lang"]),
      native: clean(w["native"]),
      # base-neutral-ok: 09's legacy-key repair
      gloss: strip_punct(clean(if(has.("gloss"), do: w["gloss"], else: single && w["english"]))),
      base_raw: clean(w["base_lang"]) || if(single, do: hd(ctx.bases)),
      # base-neutral-ok: 09's legacy-key repair
      forms_raw: if(has.("forms"), do: w["forms"], else: single && w["english_forms"]),
      base: nil
    }

    with :ok <- present(entry),
         {:ok, lang} <- canonical(entry.lang_raw),
         entry =
           if(Lang.primary(lang) == "ro",
             do: %{entry | native: romanian(entry.native)},
             else: entry
           ),
         {:ok, lang} <- script(lang, entry.native),
         entry = Map.put(entry, :group, group(lang, entry.native)),
         {:ok, entry} <- base(entry, lang, ctx) do
      validate_entry(entry, lang, w, ctx)
    else
      {:reject, reason, entry} -> reject(entry, reason)
      {:reject, reason} -> reject(entry, reason)
    end
  end

  defp present(e) do
    if Enum.any?([e.lang_raw, e.native, e.base_raw, e.gloss], &is_nil/1),
      do: {:reject, :missing_field},
      else: :ok
  end

  defp canonical(raw) do
    case Lang.canonical(raw) do
      {:ok, tag} -> {:ok, tag}
      {:error, code} -> {:reject, code}
    end
  end

  defp script(lang, native) do
    case Lang.check_script(lang, native) do
      {:ok, tag} -> {:ok, tag}
      {:error, code} -> {:reject, code}
    end
  end

  defp base(entry, lang, ctx) do
    case resolve_base(entry.base_raw, ctx.bases) do
      nil ->
        {:reject, :unrequested_base, entry}

      b ->
        entry = %{entry | base: b}

        cond do
          Lang.same_base?(lang, b) -> {:reject, :target_is_base, entry}
          Text.length(entry.native) > rule(:max_native_chars) -> {:reject, :too_long, entry}
          Text.length(entry.gloss) > rule(:max_gloss_chars) -> {:reject, :too_long, entry}
          true -> {:ok, entry}
        end
    end
  end

  defp reject(entry, reason, extra \\ %{}) do
    Map.merge(
      %{
        rejected: %{
          native: entry.native,
          gloss: entry.gloss,
          base_lang: entry.base || entry.base_raw,
          reason: to_string(reason)
        },
        group: if(reason == :target_is_base, do: Map.get(entry, :group)),
        dropped_forms: []
      },
      extra
    )
  end

  defp validate_entry(entry, lang, w, ctx) do
    base = entry.base
    ro = Lang.primary(base) == "ro"
    entry = if ro, do: %{entry | gloss: romanian(entry.gloss)}, else: entry
    note = if ro, do: romanian(clean(w["note"])), else: clean(w["note"])
    forms = forms(entry.forms_raw, entry.gloss, base, ro)
    nk = fold(entry.native, base)

    if nk == fold(entry.gloss, base) or Enum.any?(forms, &(fold(&1.text, base) == nk)) do
      reject(entry, :same_as_gloss)
    else
      {kept, dropped_forms} = form_rules(forms, entry, lang, ctx)

      if Enum.any?(kept, & &1.enabled) do
        word(entry, lang, w, kept, note, dropped_forms)
      else
        reject(entry, :no_usable_forms, %{dropped_forms: dropped_forms})
      end
    end
  end

  # Cleaned, punctuation stripped, deduplicated in the base's locale, gloss first.
  defp forms(raw, gloss, base, ro) do
    {forms, seen} =
      raw
      |> raw_forms()
      |> Enum.reduce({[], MapSet.new()}, fn r, {acc, seen} ->
        with %{} = f <- form_of(r),
             text when is_binary(text) <- strip_punct(clean(f.text)),
             text = if(ro, do: romanian(text), else: text),
             false <- MapSet.member?(seen, fold(text, base)) do
          {acc ++ [%{f | text: text}], MapSet.put(seen, fold(text, base))}
        else
          _ -> {acc, seen}
        end
      end)

    if MapSet.member?(seen, fold(gloss, base)),
      do: forms,
      else: [Forms.form(%{text: gloss}) | forms]
  end

  defp form_rules(forms, entry, lang, ctx) do
    base = entry.base
    data = lang_data(base)

    min =
      if base_script(base) in rule(:unspaced_scripts),
        do: rule(:min_form_graphemes_unspaced),
        else: rule(:min_form_graphemes)

    input = MapSet.new(tokens(fold(ctx.text, base)))

    # The learner named this very word: they typed its base-language word (checked per form)
    # or the target word itself ("это", "der", "犬"). Its gloss may then be a function word
    # ("it", "el"); extra function words the model adds still go.
    typed = fold(ctx.text, lang)
    native = fold(entry.native, lang)

    native_typed =
      if base_script(lang) in rule(:unspaced_scripts),
        do: String.contains?(typed, native),
        else: native in tokens(typed)

    drop = fn f, reason ->
      %{native: entry.native, base_lang: base, form: f.text, reason: reason}
    end

    {kept, dropped} =
      Enum.reduce(forms, {[], []}, fn f, {kept, dropped} ->
        case form_reason(f.text, entry.gloss, base, data, min, input, native_typed) do
          nil -> {kept ++ [f], dropped}
          reason -> {kept, dropped ++ [drop.(f, reason)]}
        end
      end)

    {kept, extra} = Enum.split(kept, rule(:max_forms))
    {kept, dropped ++ Enum.map(extra, &drop.(&1, "too_many_forms"))}
  end

  defp form_reason(text, gloss, base, data, min, input, native_typed) do
    n = length(graphemes(text))
    f = fold(text, base)

    cond do
      n < min or n > rule(:max_form_chars) or
          not Regex.match?(~r/^[\p{L}\p{M}\p{N} '’\-.+#·]+$/u, text) ->
        "bad_form"

      not related?(text, gloss, base, data) ->
        "unrelated_form"

      MapSet.member?(data.stopwords, f) and
          not ((MapSet.member?(input, f) or native_typed) and fold(gloss, base) == f) ->
        "stopword"

      true ->
        nil
    end
  end

  defp word(entry, lang, w, kept, note, dropped_forms) do
    vocalized = clean(w["native_vocalized"])

    word = %{
      lang: lang,
      native: entry.native,
      base_lang: entry.base,
      sense: "",
      gloss: entry.gloss,
      forms: kept,
      romanization: clean(w["romanization"]),
      native_vocalized: if(Lang.primary(lang) == "ro", do: romanian(vocalized), else: vocalized),
      pronunciation: clean(w["pronunciation"]),
      pronunciation_careful: clean(w["pronunciation_careful"]),
      pronunciation_source: nil,
      note: truncate(note, rule(:max_note_chars))
    }

    {word, fields} = Pronunciation.check_fields(word, Pronunciation.facts(lang))

    %{
      word: word,
      group: entry.group,
      dropped_forms: dropped_forms,
      dropped_fields:
        Enum.map(fields, &Map.merge(%{native: entry.native, base_lang: entry.base}, &1))
    }
  end

  # ── E. merge of duplicate entries (slice 07 section 4's rules) ───────

  defp merge_into(a, b) do
    a =
      Enum.reduce([:romanization, :native_vocalized, :note], a, fn f, a ->
        if is_nil(a[f]) and not is_nil(b[f]), do: Map.put(a, f, b[f]), else: a
      end)

    a =
      if is_nil(a.pronunciation) and not is_nil(b.pronunciation),
        do:
          Map.merge(
            a,
            Map.take(b, [:pronunciation, :pronunciation_careful, :pronunciation_source])
          ),
        else: a

    seen = MapSet.new(a.forms, &fold(&1.text, a.base_lang))

    incoming =
      if MapSet.member?(seen, fold(b.gloss, a.base_lang)),
        do: b.forms,
        else: b.forms ++ [Forms.form(%{text: b.gloss})]

    {forms, _} =
      Enum.reduce(incoming, {a.forms, seen}, fn f, {forms, seen} ->
        k = fold(f.text, a.base_lang)

        if MapSet.member?(seen, k) or length(forms) >= rule(:max_forms),
          do: {forms, seen},
          else: {forms ++ [f], MapSet.put(seen, k)}
      end)

    %{a | forms: forms}
  end

  # ── the whole answer ─────────────────────────────────────────────────

  @doc """
  Turns a model's raw content into checked words. `input` is `%{text, mode: "add" |
  "auto", base_langs: [tag]}`. Returns `{:ok, result}` with `intent`, `words`, `rejected`,
  `dropped_forms`, `dropped_fields`, `missing_bases`, `reply` and `code` (slice 25's code
  when no word survived, else nil), or `{:error, :unparseable}`.
  """
  def process(input, raw) do
    case extract(raw, "words") do
      nil -> {:error, :unparseable}
      obj -> {:ok, process_object(input, obj)}
    end
  end

  defp process_object(input, obj) do
    bases =
      input
      |> get(:base_langs)
      |> List.wrap()
      |> Enum.map(&Lang.base_tag/1)
      |> Enum.reject(&is_nil/1)

    text = get(input, :text) || ""
    ctx = %{bases: bases, text: text}

    checked =
      obj["words"]
      |> word_list()
      |> Enum.take(rule(:max_words) * max(length(bases), 1))
      |> Enum.map(&check_entry(&1, ctx))

    dropped_forms = Enum.flat_map(checked, &(&1[:dropped_forms] || []))
    {valid, invalid} = Enum.split_with(checked, &Map.has_key?(&1, :word))
    dropped_fields = Enum.flat_map(valid, & &1.dropped_fields)
    rejected = Enum.map(invalid, &Map.put(&1.rejected, :group, &1.group))

    {groups, words, too_many} = cap_and_merge(valid)
    rejected = rejected ++ too_many
    {words, mismatches} = share_target_fields(words, groups, bases)
    dropped_fields = dropped_fields ++ mismatches

    shown =
      rejected
      |> Enum.reject(&(&1.reason == "target_is_base" and &1.group in groups))
      |> Enum.map(&Map.delete(&1, :group))

    intent = intent(obj["intent"], get(input, :mode), words, text)

    %{
      intent: intent,
      words: Enum.map(words, & &1.word),
      rejected: shown,
      dropped_forms: dropped_forms,
      dropped_fields: dropped_fields,
      missing_bases: missing_bases(words, groups, bases),
      reply: if(intent == "chat", do: truncate(clean(obj["reply"]), rule(:max_reply_chars))),
      code: code(words, intent, shown)
    }
  end

  defp get(map, key), do: Map.get(map, key, Map.get(map, to_string(key)))

  # At most max_words distinct words (their entries for several bases count once), and
  # duplicate entries of one word and base merged.
  defp cap_and_merge(valid) do
    {groups, words, too_many} =
      Enum.reduce(valid, {[], [], []}, fn r, {groups, words, too_many} ->
        cond do
          r.group in groups ->
            {groups, add_entry(words, r), too_many}

          length(groups) >= rule(:max_words) ->
            w = r.word

            rej = %{
              native: w.native,
              gloss: w.gloss,
              base_lang: w.base_lang,
              reason: "too_many_words",
              group: r.group
            }

            {groups, words, too_many ++ [rej]}

          true ->
            {groups ++ [r.group], add_entry(words, r), too_many}
        end
      end)

    {groups, words, too_many}
  end

  defp add_entry(words, r) do
    case Enum.find_index(words, &(&1.group == r.group and &1.word.base_lang == r.word.base_lang)) do
      nil -> words ++ [%{group: r.group, word: r.word}]
      i -> List.update_at(words, i, &%{&1 | word: merge_into(&1.word, r.word)})
    end
  end

  # Target-side fields shared within a word: from the primary base's entry, or the first
  # non-null one in base order. Then the stress agreement check.
  defp share_target_fields(words, groups, bases) do
    Enum.reduce(groups, {words, []}, fn g, {words, mismatches} ->
      members = Enum.filter(words, &(&1.group == g))

      ordered =
        Enum.sort_by(members, &(Enum.find_index(bases, fn b -> b == &1.word.base_lang end) || -1))

      rom = Enum.find_value(ordered, & &1.word.romanization)
      voc = Enum.find_value(ordered, & &1.word.native_vocalized)
      shared = fn x -> %{x | word: %{x.word | romanization: rom, native_vocalized: voc}} end
      words = Enum.map(words, &if(&1.group == g, do: shared.(&1), else: &1))
      stress_check(words, g, voc, mismatches)
    end)
  end

  defp stress_check(words, _g, nil, mismatches), do: {words, mismatches}

  defp stress_check(words, g, _voc, mismatches) do
    members = Enum.filter(words, &(&1.group == g))
    facts = Pronunciation.facts(hd(members).word.lang)
    bad = Enum.reject(members, &Pronunciation.stress_agrees?(&1.word, facts))

    if bad == [] do
      {words, mismatches}
    else
      words =
        Enum.map(words, fn x ->
          if x.group == g, do: %{x | word: %{x.word | native_vocalized: nil}}, else: x
        end)

      {words,
       mismatches ++
         Enum.map(bad, fn x ->
           %{
             native: x.word.native,
             base_lang: x.word.base_lang,
             field: "native_vocalized",
             reason: "stress_mismatch"
           }
         end)}
    end
  end

  defp missing_bases(words, groups, bases) do
    for g <- groups,
        members = Enum.filter(words, &(&1.group == g)),
        %{lang: lang, native: native} = hd(members).word,
        b <- bases,
        not Lang.same_base?(lang, b),
        not Enum.any?(members, &(&1.word.base_lang == b)),
        do: %{native: native, base_lang: b}
  end

  defp intent(model_intent, mode, words, text) do
    intent = if model_intent in ~w(add lookup chat), do: model_intent, else: "lookup"

    cond do
      mode == "add" -> "add"
      intent == "chat" and words != [] -> "lookup"
      intent == "chat" and bare_word?(text) -> "lookup"
      true -> intent
    end
  end

  # A bare word or short phrase: a model that chats about it failed (the как lesson).
  defp bare_word?(text) do
    length(String.split(text, ~r/\s+/u, trim: true)) <= rule(:chat_max_words) and
      not Regex.match?(~r/[?¿？]/u, text)
  end

  defp code([_ | _], _intent, _shown), do: nil
  defp code([], "chat", _shown), do: nil
  defp code([], _intent, []), do: "no_word_found"

  defp code([], _intent, shown) do
    if Enum.all?(shown, &(&1.reason in ["same_as_gloss", "target_is_base"])),
      do: "rejected_same_as_gloss",
      else: "bad_lookup_result"
  end

  # ── respell (slice 07 section 8) ─────────────────────────────────────

  @doc """
  The answer to a respell request (slice 09 section 4): `items` are what was asked
  (`%{lang, native, sense, base_langs}`). Returns `{:ok, %{items, dropped_fields}}`, each
  item `%{lang, native, base_lang, pronunciation, pronunciation_careful,
  native_vocalized, pronunciation_source}` in the order asked, or `{:error, :unparseable}`.
  Answers for anything not asked are ignored.
  """
  def process_respell(items, raw) do
    case extract(raw, "items") do
      nil -> {:error, :unparseable}
      obj -> {:ok, respell_object(items, obj)}
    end
  end

  defp respell_object(items, obj) do
    requested =
      for it <- items,
          {:ok, lang} <- [Lang.canonical(get(it, :lang))],
          native = clean(get(it, :native)),
          native != nil,
          b <- List.wrap(get(it, :base_langs)),
          base = Lang.base_tag(b),
          base != nil,
          do: %{lang: lang, native: native, base_lang: base, key: {lang, fold(native), base}}

    # Answers by (lang, native, base), in order: homographs asked twice (замок, castle and
    # lock) get their answers in the order asked.
    answers =
      obj["items"]
      |> word_list()
      |> Enum.take(rule(:max_respell_items) * rule(:max_base_langs))
      |> Enum.reduce(%{}, fn a, acc ->
        with {:ok, lang} <- Lang.canonical(clean(a["lang"])),
             native when is_binary(native) <- clean(a["native"]),
             base when is_binary(base) <- Lang.base_tag(clean(a["base_lang"])) do
          Map.update(acc, {lang, fold(native), base}, [a], &(&1 ++ [a]))
        else
          _ -> acc
        end
      end)

    {out, dropped, _} =
      Enum.reduce(requested, {[], [], answers}, fn r, {out, dropped, answers} ->
        case Map.get(answers, r.key, []) do
          [] ->
            {out, dropped, answers}

          [a | rest] ->
            {out, dropped} = respell_item(r, a, out, dropped)
            {out, dropped, Map.put(answers, r.key, rest)}
        end
      end)

    %{items: out, dropped_fields: dropped}
  end

  defp respell_item(r, a, out, dropped) do
    word = %{
      lang: r.lang,
      native: r.native,
      base_lang: r.base_lang,
      romanization: nil,
      pronunciation: clean(a["pronunciation"]),
      pronunciation_careful: clean(a["pronunciation_careful"]),
      native_vocalized: clean(a["native_vocalized"]),
      pronunciation_source: nil
    }

    facts = Pronunciation.facts(r.lang)
    {word, fields} = Pronunciation.check_fields(word, facts)

    {word, fields} =
      if is_nil(word.native_vocalized) or Pronunciation.stress_agrees?(word, facts),
        do: {word, fields},
        else:
          {%{word | native_vocalized: nil},
           fields ++ [%{field: "native_vocalized", reason: "stress_mismatch"}]}

    {out ++ [Map.delete(word, :romanization)],
     dropped ++ Enum.map(fields, &Map.merge(%{native: r.native, base_lang: r.base_lang}, &1))}
  end

  # ── structured words from clients (slice 07 sections 4 and 5) ────────

  @doc """
  Checks a word a client sent (a structured add, a batch, an import): a map with string or
  atom keys. Not the model rules (forms against the gloss, stopwords): a learner's own
  words are theirs. Options:

    * `:base_langs` - when given, `base_lang` must be one of them (`unrequested_base`)
    * `:status`, `:origin` - defaults for words that don't say
    * `:source` - `:model` when the pronunciation came from the model

  Returns `{:ok, attrs, dropped_fields}` or `{:error, reason, summary}` where `summary` is
  `%{native, gloss, base_lang}` for the response's `rejected` list.
  """
  def validate_word(word, opts \\ []) when is_map(word) do
    g = &get(word, &1)
    native = clean(g.(:native))
    gloss = clean(g.(:gloss))
    base = Lang.base_tag(str(g.(:base_lang)) || "")
    summary = %{native: native, gloss: gloss, base_lang: base}

    with :ok <- required([g.(:lang), native, base, gloss]),
         {:ok, lang} <- tag(g.(:lang)),
         {:ok, lang} <- Lang.check_script(lang, native),
         :ok <-
           check(opts[:base_langs] in [nil, []] or base in opts[:base_langs], :unrequested_base),
         :ok <- check(not Lang.same_base?(lang, base), :target_is_base),
         :ok <- check(Text.length(native) <= rule(:max_native_chars), :too_long),
         :ok <- check(Text.length(gloss) <= rule(:max_gloss_chars), :too_long),
         {:ok, forms} <- structured_forms(g.(:forms), gloss) do
      attrs = %{
        lang: lang,
        native: native,
        base_lang: base,
        sense: sense(g.(:sense)),
        gloss: gloss,
        forms: forms,
        romanization: clean(g.(:romanization)),
        native_vocalized: clean(g.(:native_vocalized)),
        pronunciation: clean(g.(:pronunciation)),
        pronunciation_careful: clean(g.(:pronunciation_careful)),
        pronunciation_source: source(str(g.(:pronunciation_source)), opts[:source]),
        note: truncate(clean(g.(:note)), rule(:max_note_chars)),
        status: pick(str(g.(:status)), ~w(active paused), opts[:status] || "active"),
        origin: pick(str(g.(:origin)), Word.origins() -- ["migrated"], opts[:origin] || "add"),
        source_text: clean(g.(:source_text)),
        id: id(g.(:id))
      }

      {attrs, dropped} = Pronunciation.check(attrs)
      {:ok, attrs, dropped}
    else
      {:error, reason} -> {:error, reason, summary}
    end
  end

  defp tag(raw) do
    case Lang.canonical(str(raw)) do
      {:ok, tag} -> {:ok, tag}
      {:error, code} -> {:error, code}
    end
  end

  defp required(values),
    do: if(Enum.any?(values, &is_nil/1), do: {:error, :missing_field}, else: :ok)

  defp check(true, _reason), do: :ok
  defp check(_, reason), do: {:error, reason}

  defp sense(v),
    do: (clean(v) || "") |> String.downcase() |> String.slice(0, rule(:max_sense_chars))

  # Strings or Form objects. Invalid ones are dropped; the gloss goes first if missing; at
  # most max_forms; at least one enabled form must be left.
  defp structured_forms(raw, gloss) do
    given =
      raw
      |> List.wrap()
      |> Enum.flat_map(fn
        s when is_binary(s) -> [Forms.form(%{text: s})]
        m when is_map(m) -> [Forms.form(m)]
        _ -> []
      end)
      |> Enum.map(&%{&1 | text: clean(&1.text)})
      |> Enum.filter(&(is_binary(&1.text) and Text.length(&1.text) <= rule(:max_form_chars)))

    with_gloss =
      if is_binary(gloss) and Text.length(gloss) <= rule(:max_form_chars) and
           not Enum.any?(given, &(fold(&1.text) == fold(gloss))),
         do: [Forms.form(%{text: gloss}) | given],
         else: given

    forms = with_gloss |> Enum.uniq_by(&fold(&1.text)) |> Enum.take(rule(:max_forms))
    if Enum.any?(forms, & &1.enabled), do: {:ok, forms}, else: {:error, :no_usable_forms}
  end

  defp id(id) when is_binary(id) do
    id = id |> String.trim() |> String.downcase()
    if UUID7.valid?(id), do: id
  end

  defp id(_), do: nil

  defp source(_given, :model), do: "model"
  defp source(given, _) when given in ["model", "user", "wiktionary"], do: given
  defp source(_given, _), do: "user"

  defp pick(value, allowed, default), do: if(value in allowed, do: value, else: default)

  @doc """
  Checks a PATCH body (slice 07 section 4): only the fields present are returned, each
  cleaned. `null` clears a nullable field. Returns `{:ok, patch}` or
  `{:error, %{field, reason}}`.
  """
  def patch(body) when is_map(body) do
    Enum.reduce_while(patch_fields(), {:ok, %{}}, fn field, {:ok, acc} ->
      case Map.fetch(body, to_string(field)) do
        :error ->
          {:cont, {:ok, acc}}

        {:ok, value} ->
          case patch_field(field, value) do
            {:ok, v} -> {:cont, {:ok, Map.put(acc, field, v)}}
            {:error, reason} -> {:halt, {:error, %{field: to_string(field), reason: reason}}}
          end
      end
    end)
  end

  defp patch_fields,
    do: ~w(lang native sense romanization native_vocalized gloss forms pronunciation
           pronunciation_careful pronunciation_source note status)a

  defp patch_field(:lang, v) do
    case tag(v) do
      {:ok, lang} -> {:ok, lang}
      {:error, code} -> {:error, to_string(code)}
    end
  end

  defp patch_field(field, v) when field in [:native, :gloss] do
    max = if field == :native, do: rule(:max_native_chars), else: rule(:max_gloss_chars)

    case clean(v) do
      nil -> {:error, "missing_field"}
      s -> if Text.length(s) <= max, do: {:ok, s}, else: {:error, "too_long"}
    end
  end

  defp patch_field(:sense, v), do: {:ok, sense(v)}

  defp patch_field(:romanization, v) do
    case clean(v) do
      nil ->
        {:ok, nil}

      r ->
        cond do
          not Regex.match?(~r/^[\p{Latin}\p{M}0-9'’ʻʼ .·-]+$/u, r) -> {:error, "bad_romanization"}
          Text.length(r) > rule(:max_romanization_chars) -> {:error, "too_long"}
          true -> {:ok, r}
        end
    end
  end

  defp patch_field(:forms, v) do
    case structured_forms(v, nil) do
      {:ok, forms} -> {:ok, forms}
      {:error, reason} -> {:error, to_string(reason)}
    end
  end

  defp patch_field(:pronunciation_source, v) when v in [nil, "model", "user", "wiktionary"],
    do: {:ok, v}

  defp patch_field(:pronunciation_source, _), do: {:error, "bad_value"}

  defp patch_field(:status, v) when v in ["active", "paused"], do: {:ok, v}
  defp patch_field(:status, _), do: {:error, "bad_value"}

  defp patch_field(:note, v), do: {:ok, truncate(clean(v), rule(:max_note_chars))}

  defp patch_field(field, v)
       when field in [:native_vocalized, :pronunciation, :pronunciation_careful] do
    if is_nil(v) or is_binary(v), do: {:ok, clean(v)}, else: {:error, "bad_value"}
  end

  @doc """
  Checks the pronunciation fields of a word after a patch is applied, reporting only the
  `fields` the patch set. Returns `:ok` or `{:error, %{field, reason}}`: an edit is
  refused rather than saved without the field.
  """
  def check_pronunciation(word, fields) do
    names = Enum.map(fields, &to_string/1)
    {_, dropped} = Pronunciation.check(word)

    case Enum.filter(dropped, &(&1.field in names)) do
      [] -> :ok
      [%{field: f, reason: r} | _] -> {:error, %{field: f, reason: r}}
    end
  end

  @doc "The most forms one record keeps."
  def max_forms, do: rule(:max_forms)
end
