# SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
# SPDX-License-Identifier: Apache-2.0

defmodule Kotiko.WordInput do
  @moduledoc """
  Turns a word from the model or a client into attributes `Kotiko.Words` can save, or a
  rejection with a reason (slice 07 section 1's fields and section 7's pronunciation rules).

  Minimal stand-in for slice 09's validator (`Kotiko.WordSpec`): it checks the record's
  shape, lengths and the pronunciation fields, but not forms against the gloss, stopwords
  or scripts. Slice 09 replaces it and moves the numbers below to `spec/rules.json`.
  """
  alias Kotiko.{Pronunciation, Text, Word}
  alias Kotiko.Word.Forms

  @max_native 64
  @max_gloss 64
  @max_romanization 64
  @max_note 200
  @max_form 40
  @max_forms 10
  @max_sense 64

  @doc "The most forms one record keeps."
  def max_forms, do: @max_forms

  @doc """
  Checks one word. `word` is a map with string or atom keys. Options:

    * `:base_langs` - when given, `base_lang` must be one of them (`unrequested_base`)
    * `:default_base` - the base when the word names none (the model's single base)
    * `:status`, `:origin` - defaults for words that don't say
    * `:source` - `:model` for model answers (their pronunciation is the model's whatever
      they claim), else a pronunciation without `pronunciation_source` counts as the user's

  Returns `{:ok, attrs, dropped_fields}` or `{:error, reason, summary}` where `summary`
  is `%{native, gloss, base_lang}` for the response's `rejected` list.
  """
  def validate(word, opts \\ []) when is_map(word) do
    get = fn key -> Map.get(word, key, Map.get(word, to_string(key))) end
    base = Word.normalize_base(string(get.(:base_lang))) || opts[:default_base]
    lang = Word.normalize_lang(string(get.(:lang)))
    native = Text.clean(string(get.(:native)))
    gloss = Text.clean(string(get.(:gloss)))
    summary = %{native: native, gloss: gloss, base_lang: base}

    with :ok <- required([lang, native, base, gloss]),
         :ok <- check(Word.lang?(lang), :bad_lang),
         :ok <-
           check(opts[:base_langs] in [nil, []] or base in opts[:base_langs], :unrequested_base),
         :ok <- check(not Word.same_language?(lang, base), :target_is_base),
         :ok <- check(Text.length(native) <= @max_native, :too_long),
         :ok <- check(Text.length(gloss) <= @max_gloss, :too_long),
         {:ok, forms} <- forms(get.(:forms), gloss) do
      {romanization, dropped} = romanization(Text.clean(string(get.(:romanization))))

      attrs = %{
        lang: lang,
        native: native,
        base_lang: base,
        sense: (Text.clean(string(get.(:sense))) || "") |> String.downcase() |> cap(@max_sense),
        gloss: gloss,
        forms: forms,
        romanization: romanization,
        native_vocalized: Text.clean(string(get.(:native_vocalized))),
        pronunciation: Text.clean(string(get.(:pronunciation))),
        pronunciation_careful: Text.clean(string(get.(:pronunciation_careful))),
        pronunciation_source: source(string(get.(:pronunciation_source)), opts[:source]),
        note: note(Text.clean(string(get.(:note)))),
        language: Text.clean(string(get.(:language))),
        status: pick(string(get.(:status)), ~w(active paused), opts[:status] || "active"),
        origin:
          pick(string(get.(:origin)), Word.origins() -- ["migrated"], opts[:origin] || "add"),
        source_text: Text.clean(string(get.(:source_text))),
        id: id(get.(:id))
      }

      {attrs, more} = Pronunciation.check(attrs)
      {:ok, attrs, dropped ++ more}
    else
      {:error, reason} -> {:error, reason, summary}
    end
  end

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
    lang = Word.normalize_lang(string(v))
    if Word.lang?(lang), do: {:ok, lang}, else: {:error, "bad_lang"}
  end

  defp patch_field(field, v) when field in [:native, :gloss] do
    max = if field == :native, do: @max_native, else: @max_gloss

    case Text.clean(string(v)) do
      nil -> {:error, "missing_field"}
      s -> if Text.length(s) <= max, do: {:ok, s}, else: {:error, "too_long"}
    end
  end

  defp patch_field(:sense, v),
    do: {:ok, (Text.clean(string(v)) || "") |> String.downcase() |> cap(@max_sense)}

  defp patch_field(:romanization, v) do
    case romanization(Text.clean(string(v))) do
      {r, []} -> {:ok, r}
      {_, [%{reason: reason}]} -> {:error, reason}
    end
  end

  defp patch_field(:forms, v) do
    case forms(v, nil) do
      {:ok, forms} -> {:ok, forms}
      {:error, reason} -> {:error, to_string(reason)}
    end
  end

  defp patch_field(:pronunciation_source, v) when v in [nil, "model", "user"], do: {:ok, v}
  defp patch_field(:pronunciation_source, _), do: {:error, "bad_value"}

  defp patch_field(:status, v) when v in ["active", "paused"], do: {:ok, v}
  defp patch_field(:status, _), do: {:error, "bad_value"}

  defp patch_field(:note, v), do: {:ok, note(Text.clean(string(v)))}

  defp patch_field(field, v)
       when field in [:native_vocalized, :pronunciation, :pronunciation_careful] do
    if is_nil(v) or is_binary(v), do: {:ok, Text.clean(v)}, else: {:error, "bad_value"}
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

  # ── fields ───────────────────────────────────────────────────────────

  defp required(values),
    do: if(Enum.any?(values, &is_nil/1), do: {:error, :missing_field}, else: :ok)

  defp check(true, _reason), do: :ok
  defp check(_, reason), do: {:error, reason}

  # Forms as strings or Form objects. Invalid ones are dropped; the gloss goes first if
  # missing; at most @max_forms; at least one enabled form must be left.
  defp forms(raw, gloss) do
    given =
      raw
      |> List.wrap()
      |> Enum.flat_map(fn
        s when is_binary(s) -> [Forms.form(%{text: s})]
        m when is_map(m) -> [Forms.form(m)]
        _ -> []
      end)
      |> Enum.map(&%{&1 | text: Text.clean(string(&1.text))})
      |> Enum.filter(&(is_binary(&1.text) and Text.length(&1.text) <= @max_form))

    with_gloss =
      if is_binary(gloss) and Text.length(gloss) <= @max_form and
           not Enum.any?(given, &(Text.fold(&1.text) == Text.fold(gloss))),
         do: [Forms.form(%{text: gloss}) | given],
         else: given

    forms = with_gloss |> Enum.uniq_by(&Text.fold(&1.text)) |> Enum.take(@max_forms)

    if Enum.any?(forms, & &1.enabled), do: {:ok, forms}, else: {:error, :no_usable_forms}
  end

  defp romanization(nil), do: {nil, []}

  defp romanization(r) do
    cond do
      Text.length(r) > @max_romanization ->
        {nil, [%{field: "romanization", reason: "too_long"}]}

      not Regex.match?(~r/^[\p{Latin}\p{M}0-9'’ʻʼ .·-]+$/u, r) ->
        {nil, [%{field: "romanization", reason: "bad_romanization"}]}

      true ->
        {r, []}
    end
  end

  # At most @max_note characters, cut at a word boundary with "…".
  defp note(nil), do: nil

  defp note(s) do
    if Text.length(s) <= @max_note do
      s
    else
      cut = s |> String.slice(0, @max_note - 1) |> String.replace(~r/\s+\S*$/u, "")
      cut <> "…"
    end
  end

  defp id(id) when is_binary(id) do
    id = id |> String.trim() |> String.downcase()
    if Kotiko.UUID7.valid?(id), do: id
  end

  defp id(_), do: nil

  defp source(_given, :model), do: "model"
  defp source(given, _) when given in ["model", "user"], do: given
  defp source(_given, _), do: "user"

  defp pick(value, allowed, default), do: if(value in allowed, do: value, else: default)

  defp cap(s, max), do: String.slice(s, 0, max)

  defp string(s) when is_binary(s), do: s
  defp string(n) when is_number(n), do: to_string(n)
  defp string(_), do: nil
end
