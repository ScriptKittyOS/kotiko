# 36 · Grammar and senses

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P1 (soon after release) |
| **Size** | L (several weeks) |
| **Depends on** | [07-word-model-v2](../07-word-model-v2/SPEC.md), [09-shared-word-spec-and-prompt](../09-shared-word-spec-and-prompt/SPEC.md), [14-matcher-engine](../14-matcher-engine/SPEC.md), [50-ui-localization-and-base-language](../50-ui-localization-and-base-language/SPEC.md) (base languages and `spec/lang/<base>/`) |
| **Unblocks** | [37](../37-language-colors-and-reading-aids/SPEC.md) (readings and vowel marks to display), [49](../49-dictionary-verification/SPEC.md) (fields to verify), [32](../32-page-coverage-and-celebrations/SPEC.md) (`no-standalone.json` per base) |
| **Sources** | [DECISIONS 2026-10-01: English is not the base language](../DECISIONS.md); [02 C1-C3, C6, D1-D5, E1, E3, E4, G2, G3, section 3](../../docs/research/02-linguistics.md), [01 S9, S18, S21](../../docs/research/01-language-mixing.md), [05 S11, S25](../../docs/research/05-learner-ux.md) |

## Problem

A word today is a native string, an English headword, a romanization, a note and a list of bare
English forms (`server/lib/slovo/word.ex:5-16`). Slice 07 turns the headword into a `gloss` and
the forms into surface forms in the record's `base_lang`
([50](../50-ui-localization-and-base-language/SPEC.md)), so everything below about "the base
side" applies to whatever language the learner reads: English, Spanish, German, Japanese.
Research 02 found what the record can't express (its examples are English-base; the Spanish
ones are added here):

- **Homographs overwrite each other.** `(lang, native)` is unique, so Russian замок "castle" and
  замок "lock", or Spanish banco "bank" and banco "bench", can't both exist; the second add
  replaces the first, and the bot answers "Already in your list" with the old meaning
  (02 D3).
- **Base-side homographs swap the wrong sense.** Forms are bare strings, so a word for "like"
  (to like) also swaps the "like" in "looks like rain", and "I love you" can become
  "I любовь you" when a noun claims "love" (02 C1, C2; 05 S25). Spanish has the same trap:
  English "wine" claiming "vino" also swaps "vino" in "él vino ayer" (he came), and "I eat"
  claiming "como" swaps "como" in "como siempre" (as always). This is the largest source of
  wrong swaps in every base.
- **Inflections that are other words.** "saw", "left", "glasses", "customs", "building" are
  listed as forms of unrelated words (02 C3); in Spanish, "fui" is a form of both "ir" (go)
  and "ser" (be), and "sal" is "salt" and the command "leave".
- **Base-side grammar is invisible.** Which forms of a base word should be swapped depends on
  that language's grammar: English adds -s and -ed; Spanish nouns and adjectives agree in
  gender and number (perro, perros; gato, gata; alto, alta, altos, altas) and verbs have
  dozens of forms; German capitalises every noun and inflects by case (Hund, Hunde, Hunden,
  Hundes); Japanese nouns never inflect but verbs do (食べる, 食べた, 食べます). Nothing tells the
  model or the validator which forms to expect for a base.
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
- Each Full- and Good-level base language (50 §5) has a `spec/lang/<base>/grammar.json` that
  tells the prompt which base-side forms to produce and tells the sense filter how to read
  context, so English is one base among several, not the only one with grammar.

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
  stress (за́мок, замо́к) and its own forms in my language (castle, castles / castillo,
  castillos).
- As a learner with "любить" (to love) and "любовь" (love, noun), "I love you" shows любить and
  "my love" shows любовь.
- As a German learner, I see "Hund" inline and "der Hund (m), die Hunde" in the popover.
- As a Japanese beginner, the popover shows 猫 with ねこ.
- As a Brazilian Portuguese learner, new words come back as "trem", not "comboio".
- As a learner who types "sol", Mira asks "Spanish or Portuguese 'sun', or Russian соль 'salt'?".
- As a Spanish reader learning English, I add "cat" and Mira swaps "gato", "gata", "gatos" and
  "gatas", but "wine" never replaces the "vino" in "él vino ayer".
- As a German reader learning Spanish, "perro" replaces "Hund", "Hunde" and "Hunden", and keeps
  working when the noun starts a sentence or not.

## Specification

### Fields

Added to the word (07 stores them; 09 validates and prompts for them; all optional):

| Field | Type | Example | Shown | Used by matching |
|---|---|---|---|---|
| `sense` | short gloss in the record's `base_lang`, max 40 chars | "castle", "lock (of a door)" (en); "castillo", "cerradura" (es) | popover, dashboard | part of the unique key `(lang, native_key, sense, base_lang)` (07) |
| `pos` | UPOS tag: NOUN, VERB, ADJ, ADV, PRON, DET, ADP, NUM, CCONJ, SCONJ, PART, INTJ, PROPN, or PHRASE | NOUN | popover ("noun") | sense filter below |
| `article` | definite article or marker | "der", "el", "la", "l'", "het" | popover | experimental absorption |
| `article_indefinite` | | "ein", "un", "une" | popover | experimental absorption |
| `gender` | m, f, n, c | m | popover, 37 color cue | none |
| `plural` | target plural | "Hunde", "evler" | popover | optional plural display |
| `reading` | phonetic script reading | ねこ (ja) | popover, 37 ruby and kana mode, 34 audio | none |
| `native_vocalized` | native with vowel or stress marks | за́мок, كَتَبَ, שָׁלוֹם | popover, 37 vowel-mark mode | none |
| `ipa` | IPA | /wa.zo/ | popover | none |
| `inflections` | up to 4 labelled forms | `{ "locative": "evde", "polite": "먹어요" }` | popover | none |

Per form (09's structured form object; the form text is in `base_lang`): `ambiguous: boolean`
(the form is also another common word in the base: "saw", "left", "like", "can", "may", "will",
"glasses" in English; "vino", "como", "sobre", "llama", "sal", "fui" in Spanish; "Kiefer", "Bank"
in German; **off by default**), `pos` (when the form only fits one: "loves" is a verb form of
"love" but a noun plural too, so none), and `case` (slice 17).

Target-side fields (`pos`, `article`, `gender`, `plural`, `reading`, `native_vocalized`, `ipa`,
`inflections`) describe `native` and are the same in every base record of a word: a bilingual
reader's 犬 for Spanish pages and 犬 for English pages share them, and 07 copies them across the
group on save (50 §3). `sense` and the forms' flags are base-side and differ per record.

### Homographs as senses

- **Target side** (замок, banco, 行): separate words with the same `(lang, native)` and different
  `sense`. Adding one never overwrites the other. Precedence (18) treats them as separate
  candidates; their base-side forms rarely overlap.
- **Base side** (one form, several meanings). English: "bank" for banco and orilla; "love" for
  любовь and любить; "like" for gustar and como. Spanish: "banco" for bank and bench; "vino" for
  wine (noun) and came (verb, a form of "venir"); "como" for I eat and as. The matcher returns
  all candidates from the page's base index (14). Two mechanisms keep the wrong meaning off the
  page, applied by the **sense filter** before precedence (18):
  1. **Ambiguous forms are off by default.** 09's prompt flags a form as `ambiguous` when the
     base-language string has another common meaning ("bank", "like", "saw", "left"; "vino",
     "como", "sobre"). Such a form is not swapped until the user enables it or pins a meaning
     for it.
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
should Mira show?" with "Show banco", "Show orilla", "Decide from context only" (Spanish
interface, base `es`: "'banco' puede ser bank (inglés, dinero) o bench (inglés, asiento). ¿Cuál
debería mostrar Mira?"). All copy comes from `_locales` (50). The popover (19)
action "Wrong meaning here" offers the same choice and can also turn the form off for that word.
The choice is stored as `formSense: Record<baseLang + U+001F + formKey, WordId[]>` in the
`s:matching` settings group (39; slice 16 defines the group for its never-swap list), so a pin
for a form in one base never affects the same letters in another base (English and Spanish
both have "once", for example).

**Context POS hint** (`contextPos`), per base and deliberately small. The tables live in
`spec/lang/<base>/grammar.json` under `context_pos`, keyed by which neighbour to look at (14's
`prevToken.key` or `nextToken.key`). A base without a table gets no hint, so its noun/verb
clashes are skipped (precision first) until someone contributes one.

English (`en`):

| Previous token | Hint |
|---|---|
| a, an, the, my, your, his, her, its, our, their, this, that, these, those, some, any, no, every, each, another, much, many, one's, or a possessive `'s` | NOUN |
| to (when the next token isn't a determiner), will, would, can, could, shall, should, may, might, must, do, does, did, don't, didn't, I, you, we, they, he, she, it, let's | VERB |
| very, too, so, quite, rather, more, most | ADJ or ADV |
| anything else | none |

Spanish (`es`):

| Previous token | Hint |
|---|---|
| el, la, los, las, un, una, unos, unas, mi, mis, tu, tus, su, sus, este, esta, ese, esa, aquel, del, al | NOUN |
| yo, tú, él, ella, usted, nosotros, ellos, ellas, no, me, te, se, lo, le, nos, les, ya, ayer | VERB |
| muy, tan, más, menos, bastante | ADJ or ADV |
| anything else | none |

Japanese (`ja`), where the particle follows the word:

| Next token | Hint |
|---|---|
| が, を, は, に, で, の, と, も | NOUN |
| ます, ました, ない, た, て | VERB |

Examples: "my love" gives NOUN, so любовь; "I love you" gives VERB, so любить. "el vino" gives
NOUN, so "wine"; "él vino ayer" gives VERB, so the noun is skipped. "looks like rain" gives no
hint; "like" is an ambiguous form, so it stays as the page wrote it unless the user pinned a
meaning, and then the pinned word is shown (the user accepted that trade-off). A tagger library (02 C2 suggests evaluating "compromise") is Future work if this
table proves too weak.

### Articles and gender

- Inline shows the bare word (`native` never includes the article; 09 enforces this). The popover
  shows "der Hund · m · pl. die Hunde".
- **Experimental, off by default** ("Include articles", 02 open question 3): when the match is
  directly preceded by one of the base's articles (`spec/lang/<base>/grammar.json`'s
  `articles.definite` and `articles.indefinite`: "the", "a", "an" in English; "el", "la", "los",
  "las", "un", "una" in Spanish; none in Japanese) and the chosen word has `article` (or
  `article_indefinite`), the swap covers "the dog" or "el perro" and shows "der Hund".
  Nominative only, which is wrong in many German sentences; that is why it is off.
- **Experimental, off by default** ("Drop the page's articles"): for target languages without
  articles (data file below), "the dog" or "el perro" becomes "собака" with the article absorbed
  (01 S21).

### Base-side grammar (`spec/lang/<base>/grammar.json`)

What forms of a base word should be swapped is a fact about the base language, so it is data
per base (50 §5), read by 09's prompt builder and validator. Shape (Spanish shown):

```json
{
  "articles": { "definite": ["el", "la", "los", "las", "lo"], "indefinite": ["un", "una", "unos", "unas"] },
  "form_slots": {
    "NOUN": ["singular", "plural"],
    "ADJ":  ["m.sg", "f.sg", "m.pl", "f.pl"],
    "VERB": ["infinitive", "pres.3sg", "pres.3pl", "pret.3sg", "participle", "gerund"]
  },
  "gendered_nouns": true,
  "capitalise_nouns": false,
  "context_pos": { "prev": { "NOUN": ["el", "la", "…"], "VERB": ["yo", "no", "…"] } },
  "notes_for_prompt": "Nouns and adjectives agree in gender and number; give both genders when the word has them."
}
```

`form_slots` tells the prompt which forms to ask for, per part of speech, within 09's cap of 10
forms. Launch values:

| Base | Nouns | Adjectives | Verbs | Notes |
|---|---|---|---|---|
| `en` | dog, dogs | (no agreement) | see, sees, saw, seen, seeing | irregulars and variants in `stem.json`, `variants.json` |
| `es` | perro, perros; gato, gata, gatos, gatas (both genders when the noun has them); lápiz, lápices | alto, alta, altos, altas | comer, come, comen, comió, comido, comiendo | the most frequent forms on pages; the full paradigm (about 50 forms) is never requested |
| `fr` | chat, chats, chatte, chattes; eau (elided "l'eau" is split by 14, so the form is bare) | grand, grande, grands, grandes | manger, mange, mangent, mangé, mangeait | |
| `de` | Hund, Hunde, Hunden, Hundes (capitalised; `capitalise_nouns: true` tells 16 and 17 not to treat the capital as a proper noun) | gut, gute, guten, guter, gutes | essen, isst, aß, gegessen | compounds (Hundefutter) are not forms; 14's compound rule decides whether a part matches |
| `ja` | 犬 (no inflection) | 高い, 高く, 高かった | 食べる, 食べた, 食べます, 食べて | verb forms are matched as 14's token sequences; nouns are the reliable case at launch |
| `zh-Hans`, `zh-Hant` | 狗 (no inflection) | | | |

09's validator uses the same file to check that forms look like forms of the gloss in that
base; the golden set tracks gender coverage (a Spanish animal noun with only one gender is not
rejected, but it is counted). Bases at the Basic level (50 §5) have no `grammar.json`; the prompt
then asks only for "the common inflected forms of the gloss in {{base_name}}", and the sense
filter gets no context hints.

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
lang, native, gloss in the base), `confidence` (0-1) and `source_reading` ("I read 'kot' as кот"). The add
flow (24) shows a "Did you mean" step before saving when `confidence < 0.7`, when alternatives are
in different languages, or when `source_reading` differs from the input after normalization.

### Agglutinative languages and nearly-all-swapped pages

Matching is always on the base side, so Turkish, Finnish, Hungarian, Korean or Japanese target
morphology doesn't change what the matcher finds; their dictionary forms are what appears
inline (README decision; 02 D1). Three consequences are handled explicitly:

1. **Bound morphemes aren't words.** A Turkish learner may save "-de" for "in" or "-ler" for a
   plural. A `native` that starts or ends with a hyphen is kept as a grammar note in the
   dashboard but never swapped (18's cleanup drops it), and 09's prompt avoids producing them.
2. **Coverage must be honest.** One data file per base, `spec/lang/<base>/no-standalone.json`,
   lists base words that have no standalone equivalent in a target language. Spanish (`es`):

   ```json
   { "always": ["el", "la", "los", "las", "lo", "un", "una", "unos", "unas"],
     "by_target": {
       "tr": ["en", "de", "desde", "con", "mi", "mis", "tu", "tus"],
       "fi": ["en", "de", "desde", "con", "mi", "mis", "tu", "tus"],
       "hu": ["en", "de", "desde", "con", "mi", "mis", "tu", "tus"],
       "ko": ["en", "de", "desde", "con", "mi", "mis", "tu", "tus"]
     } }
   ```

   `always` is the base's articles, excluded from every count because many target languages
   (ru, uk, pl, cs, zh, ja, ko, tr, fi, hi, and others) have none (32). `by_target` adds, for
   Turkish, Finnish, Hungarian and Korean targets, the base's common prepositions realised as
   suffixes there and its possessive determiners. English (`en`): `always` "the", "a", "an";
   `by_target.tr` "in", "at", "on", "from", "of", "with", "my", "your". Japanese (`ja`): `always`
   empty (no articles); `by_target.ko` and `by_target.tr` the particles に, で, から, の, which
   are suffixes there too. Slice 32 excludes these from that target language's coverage
   denominator on pages in that base, so 100 % is reachable but "the" and "in", or "el" and
   "en", never count against Turkish. The file replaces the earlier
   `extension/data/no-standalone.json` and reaches the extension through 09's
   `sync-extension.mjs`.
3. **"Nearly all swapped" is not "reading Turkish."** A page that is 90 % Turkish dictionary
   forms in the base language's word order is a vocabulary achievement, not Turkish text. Density caps (31)
   keep everyday pages readable; when coverage passes 90 % for an agglutinative or verb-final
   language, slice 32's milestone copy says so honestly: "You know 90 % of these words in
   Turkish. Real Turkish puts them together differently; try a Turkish article next." The
   optional `plural` and `inflections` fields let the popover show the forms the learner will
   actually meet. Spanish copy: "Conoces el 90 % de estas palabras en turco. El turco de verdad
   las combina de otra forma; prueba un artículo en turco."

### Prompt hardening (requirements for 09)

09 owns the prompt and golden set; this slice requires, for every base the request names:

- the fields above, with `native` bare (no article) and NFC;
- `sense`, gloss and forms written in that base, with `sense` whenever the native word has
  another common meaning;
- forms from the base's `grammar.json` `form_slots` (both genders for Spanish and French
  nouns and adjectives that have them; German nouns capitalised with their case forms), plus,
  for `en`, irregular inflections and British and American spellings, and closed, spaced and
  hyphenated compounds; each form with `ambiguous` set when it is also another common word
  in that base;
- the base's `notes_for_prompt` line, when present;
- the user's variant preferences;
- few-shot examples per base (09's `examples.<base>`): for `en`, like, saw, glasses, US,
  Monday (es), Hund, замок (both senses), da, banco (both senses), 猫, sol; for `es`, the same
  targets with Spanish glosses plus English targets whose Spanish forms are ambiguous: "wine"
  (vino), "envelope" (sobre), "salt" (sal), "cat" (gato, gata, gatos, gatas);
- golden-set cases for each of these in both `en` and `es`, checked for the fields as well as
  the words, and a smaller set for `de` and `ja` (Hund's case forms; 犬 with no inflected forms).

## Acceptance criteria

- [ ] замок "castle" and замок "lock" can both be saved, edited and deleted independently.
- [ ] A form claimed by noun and verb candidates is skipped unless the context hint or a pinned
      meaning picks one; "my love" and "I love you" choose the noun and verb senses (unit tests).
- [ ] Forms flagged `ambiguous` are not swapped until enabled in the dashboard.
- [ ] With base `es`, "el vino" swaps an English "wine" record's form "vino" and "él vino ayer"
      does not (Spanish `context_pos` table, unit test); "fui" claimed by two verbs is skipped.
- [ ] With base `es`, adding "cat" produces forms covering gato, gata, gatos and gatas (golden
      set), and with base `de`, adding "perro" produces Hund, Hunde, Hunden with capitals kept.
- [ ] A base with no `grammar.json` gets no context hints: a noun/verb clash on its pages is
      skipped.
- [ ] The popover shows article, gender, plural, reading, vocalised form and IPA when present.
- [ ] Natives starting or ending with a hyphen are never swapped.
- [ ] Turkish coverage on a fixture page excludes articles and suffix prepositions from the
      denominator, on an English page (en list) and on a Spanish page (es list).
- [ ] Variant preferences reach the prompt (09's contract test) and new words follow them in
      the golden evaluation.
- [ ] The add flow shows "Did you mean" for the low-confidence golden cases.

## Test plan

- **Unit (slice 02):** sense filter and `contextPos` tables for `en`, `es` and `ja`; candidate
  grouping; hyphen-affix rule; per-base `no-standalone.json` and `grammar.json` loading and
  schema validation (`spec/lang/schema/`).
- **Server (ExUnit):** unique key with `sense`; homograph adds don't overwrite (with 07's upsert).
- **Golden evaluation (09):** the few-shot words as cases in `en` and `es` bases, checked for
  fields, forms per `form_slots` and flags.
- **Playwright:** popover content for a fully populated German noun, Japanese word and Russian
  homograph, in English and Spanish bases; dashboard "two meanings" resolution flow on a
  Spanish page ("vino").

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
4. **How many Spanish verb forms to swap?** A Spanish verb has about 50 forms; 09 caps forms at
   10. Recommendation: the six `form_slots` above (the forms most frequent in running text), and
   revisit with the golden set; raising the cap for verbs only is the alternative if Spanish
   readers report missed swaps.
5. **Who writes `grammar.json` for bases beyond `en` and `es`?** Recommendation: ship `fr`,
   `de` and `ja` tables written by the team from public grammars, each reviewed by a native
   speaker before it moves a base from Good to Full (50 §5); everything else via contributors.

## Future work

- Small POS taggers per base (English and Spanish first) evaluated for size and accuracy
  against the context tables.
- Target-language form display matched to the base form (houses or casas shown as evler), once
  the golden set shows the model gives reliable plurals.
