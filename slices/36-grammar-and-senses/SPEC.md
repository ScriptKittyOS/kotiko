# 36 · Grammar and senses

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P1 (soon after release) |
| **Size** | L (several weeks) |
| **Depends on** | [07-word-model-v2](../07-word-model-v2/SPEC.md), [09-shared-word-spec-and-prompt](../09-shared-word-spec-and-prompt/SPEC.md) |
| **Unblocks** | [37](../37-language-colors-and-reading-aids/SPEC.md) (readings and vowel marks to display), [49](../49-dictionary-verification/SPEC.md) (fields to verify) |
| **Sources** | [02 C1-C3, C6, D1-D5, E1, E3, E4, G2, G3, section 3](../../docs/research/02-linguistics.md), [01 S9, S18, S21](../../docs/research/01-language-mixing.md), [05 S11, S25](../../docs/research/05-learner-ux.md) |

## Problem

A word today is a native string, an English headword, a romanization, a note and a list of bare
English forms (`server/lib/slovo/word.ex:5-16`). Research 02 found what that can't express:

- **Homographs overwrite each other.** `(lang, native)` is unique, so Russian замок "castle" and
  замок "lock", or Spanish banco "bank" and banco "bench", can't both exist; the second add
  replaces the first, and the bot answers "Already in your list" with the old meaning
  (02 D3).
- **English homographs swap the wrong sense.** Forms are bare strings, so a word for "like"
  (to like) also swaps the "like" in "looks like rain", and "I love you" can become
  "I любовь you" when a noun claims "love" (02 C1, C2; 05 S25). This is the largest source of
  wrong swaps.
- **Inflections that are other words.** "saw", "left", "glasses", "customs", "building" are
  listed as forms of unrelated words (02 C3).
- **No grammar.** Whether `native` includes an article is up to the model, so "the dog" can
  become "the der Hund"; gender lands in free-text notes (02 D2). Japanese beginners get kanji
  they can't read, with no kana (02 D4). Arabic and Hebrew drop vowel marks and Russian drops
  stress, with only the romanization to disambiguate (02 D5).
- **Variants drift.** Brazilian and European Portuguese, Serbian Cyrillic and Latin, Mandarin
  and Cantonese mix from word to word, because the user can't state a preference (02 E1, E3, E4).
- **Ambiguous input is saved without asking.** "da", "ni", "sol", "pan" are saved in whichever
  language the model guessed (02 G2, G3).

## Goals

- Homographs coexist as separate senses, and a form is never silently claimed by the wrong one.
- Each word can carry part of speech, article, gender, reading, vocalised form and IPA, and the
  popover shows them.
- A cheap context check chooses between noun and verb senses where it can, and Mira skips the
  swap where it can't decide and the user hasn't.
- The user can state variant preferences that the model and the matcher respect.
- Low-confidence or ambiguous adds ask "Did you mean" before saving.
- Agglutinative and article-less languages are handled honestly in matching and coverage.

## Non-goals

- Storage, migrations and the unique key mechanics: [07](../07-word-model-v2/SPEC.md) (this slice
  activates `sense` in the key 07 prepared).
- The prompt text and JSON schema files: [09](../09-shared-word-spec-and-prompt/SPEC.md) (this
  slice lists the fields and rules 09 must add).
- Display modes (ruby, kana mode, vowel-mark mode, gender colors):
  [37](../37-language-colors-and-reading-aids/SPEC.md).
- Add-flow screens: [24](../24-add-flow-safety/SPEC.md), [20](../20-popup-redesign/SPEC.md).
- Dictionary checks: [49](../49-dictionary-verification/SPEC.md).

## User stories

- As a Russian learner, I keep замок "castle" and замок "lock" as two words, each with its own
  stress (за́мок, замо́к) and its own English forms.
- As a learner with "любить" (to love) and "любовь" (love, noun), "I love you" shows любить and
  "my love" shows любовь.
- As a German learner, I see "Hund" inline and "der Hund (m), die Hunde" in the popover.
- As a Japanese beginner, the popover shows 猫 with ねこ.
- As a Brazilian Portuguese learner, new words come back as "trem", not "comboio".
- As a learner who types "sol", Mira asks "Spanish or Portuguese 'sun', or Russian соль 'salt'?".

## Specification

### Fields

Added to the word (07 stores them; 09 validates and prompts for them; all optional):

| Field | Type | Example | Shown | Used by matching |
|---|---|---|---|---|
| `sense` | short English gloss, max 40 chars | "castle", "lock (of a door)" | popover, dashboard | part of the unique key `(lang, native, sense)` |
| `pos` | UPOS tag: NOUN, VERB, ADJ, ADV, PRON, DET, ADP, NUM, CCONJ, SCONJ, PART, INTJ, PROPN, or PHRASE | NOUN | popover ("noun") | sense filter below |
| `article` | definite article or marker | "der", "el", "la", "l'", "het" | popover | experimental absorption |
| `article_indefinite` | | "ein", "un", "une" | popover | experimental absorption |
| `gender` | m, f, n, c | m | popover, 37 color cue | none |
| `plural` | target plural | "Hunde", "evler" | popover | optional plural display |
| `reading` | phonetic script reading | ねこ (ja) | popover, 37 ruby and kana mode, 34 audio | none |
| `native_vocalized` | native with vowel or stress marks | за́мок, كَتَبَ, שָׁלוֹם | popover, 37 vowel-mark mode | none |
| `ipa` | IPA | /wa.zo/ | popover | none |
| `inflections` | up to 4 labelled forms | `{ "locative": "evde", "polite": "먹어요" }` | popover | none |

Per form (09's structured form object): `ambiguous: boolean` (the form is also another common
word: "saw", "left", "like", "can", "may", "will", "glasses"; **off by default**), `pos` (when
the form only fits one: "loves" is a verb form of "love" but a noun plural too, so none), and
`case` (slice 16).

### Homographs as senses

- **Target side** (замок, banco, 行): separate words with the same `(lang, native)` and different
  `sense`. Adding one never overwrites the other. Precedence (18) treats them as separate
  candidates; their English forms rarely overlap.
- **English side** (one form, several meanings: "bank" for banco and orilla; "love" for
  любовь and любить; "like" for gustar and como): the matcher returns all candidates (14).
  Two mechanisms keep the wrong meaning off the page, applied by the **sense filter** before
  precedence (18):
  1. **Ambiguous forms are off by default.** 09's prompt flags a form as `ambiguous` when the
     English string has another common meaning ("bank", "like", "saw", "left"). Such a form is
     not swapped until the user enables it or pins a meaning for it.
  2. **Part of speech decides between noun and verb candidates** where context allows.

```
senseFilter(match, candidates):
  pinned = settings.formSense[match.key]                      // the user's choice, if any
  candidates = candidates where not form.ambiguous, or form enabled by the user,
               or word.id is in pinned
  posSet = distinct non-null pos among candidates             // null pos fits any context
  if posSet.size <= 1: return candidates
  hint = contextPos(match)                                    // below
  if hint: return candidates whose pos is hint or null       // may be empty: skip
  if pinned: return candidates in pinned
  return []                                                   // skip: precision over coverage
```

Synonyms (casa and hogar for "home", both nouns) pass untouched and are rotated by 18.
Ambiguous or noun/verb forms that end up skipped are listed in the dashboard (21) under "Words
with two meanings": "'bank' could be banco (Spanish, money) or orilla (Spanish, river). Which
should Mira show?" with "Show banco", "Show orilla", "Decide from context only". The popover (19)
action "Wrong meaning here" offers the same choice and can also turn the form off for that word.
The choice is stored as `formSense: Record<formKey, WordId[]>` in the `s:matching` settings group
(39; slice 16 defines the group for its never-swap list).

**Context POS hint** (`contextPos`), English-only and deliberately small:

| Previous token (from 14's `prevToken.key`) | Hint |
|---|---|
| a, an, the, my, your, his, her, its, our, their, this, that, these, those, some, any, no, every, each, another, much, many, one's, or a possessive `'s` | NOUN |
| to (when the next token isn't a determiner), will, would, can, could, shall, should, may, might, must, do, does, did, don't, didn't, I, you, we, they, he, she, it, let's | VERB |
| very, too, so, quite, rather, more, most | ADJ or ADV |
| anything else | none |

Examples: "my love" gives NOUN, so любовь; "I love you" gives VERB, so любить. "looks like
rain" gives no hint; "like" is an ambiguous form, so it stays English unless the user pinned a
meaning, and then the pinned word is shown (the user accepted that trade-off). A tagger library (02 C2 suggests evaluating "compromise") is Future work if this
table proves too weak.

### Articles and gender

- Inline shows the bare word (`native` never includes the article; 09 enforces this). The popover
  shows "der Hund · m · pl. die Hunde".
- **Experimental, off by default** ("Include articles", 02 open question 3): when the match is
  directly preceded by "the" (or "a"/"an") and the chosen word has `article`
  (or `article_indefinite`), the swap covers "the dog" and shows "der Hund". Nominative only,
  which is wrong in many German sentences; that is why it is off.
- **Experimental, off by default** ("Drop English articles"): for languages without articles
  (data file below), "the dog" becomes "собака" with the article absorbed (01 S21).

### Readings and vocalised forms

09's prompt asks for `reading` for Japanese words that contain kanji, `native_vocalized` for
Arabic, Hebrew, Persian (where marks help), and Russian, Ukrainian and Belarusian stress (U+0301,
with ё always written in `native`). Russian homographs that differ only in stress are the
clearest case for `sense` plus `native_vocalized` (за́мок / замо́к). Display modes are 37's; audio
uses `reading` (34).

### Variant preferences

Setting `variants: Record<primary lang, tag>` in the `s:matching` group, edited per language in
the dashboard's language overview (21):

| Language | Choices | Default |
|---|---|---|
| Portuguese | pt-BR, pt-PT | none (model decides; prompt asks for consistency) |
| Spanish | es-ES, es-419 | none |
| Chinese | zh-Hans, zh-Hant | zh-Hans |
| Serbian | sr-Cyrl, sr-Latn | sr-Cyrl |
| Cantonese | always `yue`, Traditional, Jyutping | fixed |
| Others with two scripts (uz, kk, az, pa, ku, mn) | per 08's script table | per 08 |

The preference is passed to the prompt (09) and to tag canonicalization (08). Existing words in
another variant aren't converted; the dashboard can filter by variant.

### "Did you mean" (data contract for 24)

The model's answer may include, per word, `alternatives` (other readings of the input, each with
lang, native, english), `confidence` (0-1) and `source_reading` ("I read 'kot' as кот"). The add
flow (24) shows a "Did you mean" step before saving when `confidence < 0.7`, when alternatives are
in different languages, or when `source_reading` differs from the input after normalization.

### Agglutinative languages and nearly-all-swapped pages

Matching is always on the English side, so Turkish, Finnish, Hungarian, Korean or Japanese
morphology doesn't change what the matcher finds; their dictionary forms are what appears
inline (README decision; 02 D1). Three consequences are handled explicitly:

1. **Bound morphemes aren't words.** A Turkish learner may save "-de" for "in" or "-ler" for a
   plural. A `native` that starts or ends with a hyphen is kept as a grammar note in the
   dashboard but never swapped (18's cleanup drops it), and 09's prompt avoids producing them.
2. **Coverage must be honest.** A data file `extension/data/no-standalone.json` lists, per
   language, English words that have no standalone equivalent: articles for every article-less
   language (ru, uk, pl, cs, zh, ja, ko, tr, fi, hi, and others); for Turkish, Finnish, Hungarian
   and Korean also the common prepositions realised as suffixes (in, at, on, from, of, with) and
   possessive determiners (my, your). Slice 32 excludes these from that language's coverage
   denominator, so 100 % is reachable but "the" and "in" never count against Turkish.
3. **"Nearly all swapped" is not "reading Turkish."** A page that is 90 % Turkish dictionary
   forms in English word order is a vocabulary achievement, not Turkish text. Density caps (31)
   keep everyday pages readable; when coverage passes 90 % for an agglutinative or verb-final
   language, slice 32's milestone copy says so honestly: "You know 90 % of these words in
   Turkish. Real Turkish puts them together differently; try a Turkish article next." The
   optional `plural` and `inflections` fields let the popover show the forms the learner will
   actually meet.

### Prompt hardening (requirements for 09)

09 owns the prompt and golden set; this slice requires:

- the fields above, with `native` bare (no article) and NFC;
- forms that include irregular inflections and British and American spellings, closed, spaced and
  hyphenated compounds, each with `ambiguous` set when the form is also another common word;
- `sense` whenever the native word has another common meaning;
- the user's variant preferences;
- few-shot examples covering like, saw, glasses, US, Monday (es), Hund, замок (both senses), da,
  banco (both senses), 猫, sol;
- golden-set cases for each of these, checked for the fields as well as the words.

## Acceptance criteria

- [ ] замок "castle" and замок "lock" can both be saved, edited and deleted independently.
- [ ] A form claimed by noun and verb candidates is skipped unless the context hint or a pinned
      meaning picks one; "my love" and "I love you" choose the noun and verb senses (unit tests).
- [ ] Forms flagged `ambiguous` are not swapped until enabled in the dashboard.
- [ ] The popover shows article, gender, plural, reading, vocalised form and IPA when present.
- [ ] Natives starting or ending with a hyphen are never swapped.
- [ ] Turkish coverage on a fixture page excludes articles and suffix prepositions from the
      denominator.
- [ ] Variant preferences reach the prompt (09's contract test) and new words follow them in
      the golden evaluation.
- [ ] The add flow shows "Did you mean" for the low-confidence golden cases.

## Test plan

- **Unit (slice 02):** sense filter and `contextPos` tables; candidate grouping; hyphen-affix rule;
  `no-standalone.json` loading.
- **Server (ExUnit):** unique key with `sense`; homograph adds don't overwrite (with 07's upsert).
- **Golden evaluation (09):** the few-shot words as cases, checked for fields and flags.
- **Playwright:** popover content for a fully populated German noun, Japanese word and Russian
  homograph; dashboard "two meanings" resolution flow.

## Rollout and migration

New fields are nullable; existing words keep working. Forms without `ambiguous` are treated as
unambiguous, so existing behaviour doesn't change until words are re-checked. An optional
"Improve my words" action in the dashboard re-asks the model for missing fields in small,
quota-aware batches (10). Changelog: "Words can now have more than one meaning, plus grammar:
articles, gender, readings and stress. Mira skips words when it can't tell which meaning a
sentence uses."

## Open questions

1. **Homographs: two cards or one card with senses?** (02 open question 7.) Recommendation: two
   words that share a native string, shown grouped in the dashboard; simpler for sync, export and
   precedence.
2. **Default for unresolved multi-meaning forms: skip or oldest meaning?** Recommendation: skip,
   matching the precision-first default in 16, with the dashboard prompt to pin one.
3. **Include articles inline?** (02 open question 3.) Recommendation: popover only by default;
   keep inline absorption experimental.

## Future work

- A small English POS tagger evaluated for size and accuracy against the context table.
- Target-language form display matched to the English form (houses shown as evler), once the
  golden set shows the model gives reliable plurals.
