# Research 02: Linguistics and text-matching correctness

Scope: how Slovo decides which English text to replace, what it puts there, and how that holds up across writing systems. It covers English-side matching, the stored target word, language tags, fonts, and model risks. Code citations reflect the repository at the time of review. Casing and locale behaviour was checked in Node 22 and Elixir. No code was changed.

## 1. Summary

- **The matcher only knows ASCII.** The regex is `\b(?:forms)\b` with the `gi` flags and no `u` flag (`extension/content.js:51`). JavaScript's `\b` treats every non-ASCII letter as a boundary, so "résumé" becomes "ré[sum]é". Apostrophes split contractions: "can't" becomes "[мочь]'t", which reverses the meaning.
- **Case-insensitive matching swaps names and acronyms.** "Will Smith", "May 2026", "Bill Gates", "the US army" and "the IT team" all match common words, and `matchCase()` then capitalizes the replacement as if it were a name (`content.js:54-58`).
- **`matchCase()` applies English capitalization rules to every language.** Its `toUpperCase()` ignores locale, so it produces Turkish "Işçi" (should be "İşçi"), an invalid capital in Georgian "Წყალი", and German "STRASSE". It also carries over capitals that only English uses: "Monday" becomes "Lunes" and "I think" becomes "Yo think".
- **The data model can't say which meaning a form has.** There is no part of speech, no article or gender field, and no per-form controls. `(lang, native)` is unique (`words.ex:359-367`), so homographs such as замок (castle) and замок (lock) overwrite each other. English irregulars ("saw", "left") and plurals with their own meaning ("glasses", "customs") produce wrong swaps.
- **Language-tag normalization loses information.** It drops regions (`word.ex:273-283`), so pt-BR and pt-PT merge, and "zh-TW" turns into Simplified "zh". "rus" and "cmn" are not canonicalized. The first language name ever stored is locked in (`words.ex:371-381`), which can label a Cantonese word "Mandarin".
- **Model output is saved without verification.** It can contain invented words, the wrong language for phonetic input ("da", "ni", "sol"), or over-broad forms. The popup saves it immediately (`router.ex:39`). The forms that will be swapped are never shown (`bot.ex:284-290`) and nothing can be edited.
- **Pages in other languages get "translated" too.** German "die", French "pain" and Spanish "come" are swapped, because element and page `lang` are ignored.

## 2. Scenarios

Format: **Scenario.** Today, with a citation. Why it matters. *Recommendation.*

### A. Word boundaries

**A1. Accented letters next to a form.** Examples: "résumé" with the form "sum", "passé" with "pass". Without the `u` flag, `\b` treats "é" as a boundary, so "résumé" becomes "ré[sum]é" (tested). A form that ends in a non-ASCII letter, such as "café", never matches. *Use the `u` flag with `(?<![\p{L}\p{M}\p{N}_])` and `(?![\p{L}\p{M}\p{N}_])` instead of `\b`.*

**A2. Contractions and possessives.** "I can't go" becomes "I [can]'t go", and "we won't" becomes "we [won]'t", where "won" is the past tense of win (tested, with straight and curly apostrophes). "the house's roof" becomes "дом's roof". A negation turning into a positive is the worst outcome in this report. *Reject a match followed by `'t`, `'ll`, `'re`, `'ve` or `'d` unless the full contraction is a listed form. Allow `'s` and `s'`, keeping them as English inside the span.*

**A3. Hyphenated compounds.** "well-known" becomes "[well]-known" and "e-mail" becomes "e-[mail]" (tested). Half-swapped compounds are nonsense. *Don't match a form that touches a hyphen unless the form contains one. Ask the model for the spaced, hyphenated and closed spellings ("ice cream", "ice-cream").*

**A4. URLs, emails, handles and file names in visible text.** "www.house.com" becomes "www.[house].com" (tested). Only `CODE` and `PRE` are skipped (`content.js:7-10`), and this corrupts text people copy. *Skip tokens joined to `.`, `/`, `@`, `#` or `_` on either side.*

**A5. Phrases split across elements, and separable verbs.** Text nodes are matched one at a time (`content.js:73-104`). In "<b>thank</b> you" the phrase misses, and "you" alone may be swapped. `\s+` joins only adjacent words (`content.js:49`), so "give it up" misses "give up", while "look up the street" falsely matches "look up". Soft hyphens (U+00AD) inside words also defeat matching. *Have the model mark idiomatic phrases so their parts aren't swapped literally. Later, match across inline siblings and strip invisible characters with an offset map.*

### B. Capitalization, names and acronyms

**B1. Names and brands that are also common words.** Will, May, Bill, Rose, Mark, Hope, Apple, Turkey, China (porcelain), Polish. The `i` flag matches all of them (`content.js:51`), and `matchCase` gives "Воля Smith". The reverse also happens: the prompt forces `english` to lowercase (`llm.ex:25`), so a word for the country Japan is stored as "japan". These are the most visible errors. *Treat a capitalized match that isn't at the start of a sentence as a likely proper noun and skip it. Add a per-form case rule (Section 3).*

**B2. Acronyms.** US/us, IT/it, WHO, AM, OR. "the US army" becomes "the НАС army", because the all-caps branch uppercases the replacement. *Skip all-caps tokens of four letters or fewer unless the surrounding text is also all caps.*

**B3. Capitals that only English uses.** `matchCase` capitalizes whenever the source starts with a capital (`content.js:56`). Days, months, the pronoun "I", nationalities and Title Case headlines then pass their capitals into Spanish, French, Russian, Polish and others: "Lunes", "Inglés", "Yo think". This teaches wrong spelling. *Copy a capital only when the match starts a sentence or is all caps, and never when the English word is always capitalized. Detect Title Case runs and keep dictionary capitalization there.*

**B4. German nouns.** Mid-sentence "Hund" stays capitalized only because the model obeyed "normal capitalization" (`llm.ex:44`), and `matchCase` never lowercases. If the model returns "hund", the error shows on every page. *On the server, check that German (de) nouns start with a capital.*

**B5. Locale-specific casing.** Tested:
- Turkish: "işçi" becomes "Işçi" and "IŞÇI". The correct forms are "İşçi" and "İŞÇİ" (`toLocaleUpperCase("tr")`).
- Georgian: "წყალი" becomes "Წყალი", a Mtavruli capital. Georgian has no title case, and many fonts lack Mtavruli.
- Dutch: "ijs" becomes "Ijs"; it should be "IJs".
- Greek: all caps keeps the tonos ("ΛΌΓΟΣ"), which Greek typography drops.
- German: "straße" becomes "STRASSE".

On the server, `find/1` uses plain `String.downcase` (`words.ex:391-397`), which turns "ΛΟΓΟΣ" into "λογοσ" and "İ" into "i̇", so `/remove` misses words typed in capitals. Caseless scripts (Arabic, CJK, Indic, Thai) are not harmed, but only by accident. *Write a per-script casing function: `toLocaleUpperCase(lang)`; no title case for Georgian; special cases for Dutch "ij" and Greek; an explicit early return for caseless scripts. Use the Elixir `:greek` and `:turkic` modes.*

### C. English meaning, part of speech and inflection

**C1. Homographs.** bank, like, can, may, will, right, light, fly, watch, date, fine, kind, mean. Forms are bare strings (`word.ex:261-267`), so the prompt's "main meaning only" rule (`llm.ex:47-49`) can't help: "like" is the same string in every sense. A word for "like" meaning нравиться swaps the "like" in "looks like rain". This is the largest source of wrong swaps. *Have the model flag ambiguous forms. Default to "swap unambiguous forms only" and let users turn forms off one at a time.*

**C2. Noun or verb.** love (любовь or любить), run, work, drink. When two words share a form, the newest wins (`content.js:42-43`), so "I love you" can become "I любовь you". *Store `pos`. A cheap context check works for many cases: a preceding determiner or possessive suggests a noun; a preceding "to", pronoun or modal suggests a verb. Use it to choose a candidate or to skip. A JavaScript tagger (for example, the open-source "compromise" library) is an option to evaluate for size.*

**C3. Inflections that are other words.** The irregulars saw (see, or the tool), left, found, felt, rose, ground, wound. Plurals and -ing forms with their own meaning: glasses (очки), customs (таможня), arms, goods, building (здание), meeting. The prompt asks only for "-s, -ed, -ing" (`llm.ex:48`). *Have the prompt list irregular forms and flag any form that is also a word in its own right. Flagged forms are off by default.*

**C4. Function words, the copula and numbers.** Nothing stops a user from saving в (in), быть (to be), ты (you) or один (one). Then "is" becomes "быть" everywhere, "World War I" becomes "World War я", and "no one" becomes "no один". Prepositions and the copula rarely map one to one, and these words are everywhere. *Classify these as function words, warn the user when they add one, and rate-limit them per page. Never match digits unless the form is digits.*

**C5. British and American spelling.** colour/color, grey/gray, centre/center, realise/realize. The prompt doesn't mention spelling variants. *Add a rule: "include British and American spellings of every form."*

**C6. Over-broad forms.** The known case is как mapped to how, what, as and like. Only the prompt prevents it (`llm.ex:49`). The forms aren't shown on the bot card (`bot.ex:284-290`) or in the popup (`popup.js:156-162`), and there is no edit endpoint. *Show the forms when a word is added, with one-tap removal. On the server, reject forms that aren't inflections or spellings of `english`.*

**C7. Two words in one language for the same English.** собака and пёс for "dog". The newest wins silently and the older word never appears for that form (`content.js:42-43`). *Rotate between them within the language, or list them in the tooltip.*

### D. Target-language form

**D1. Dictionary form against the form the sentence needs.** This is deliberate (README:86, `llm.ex:43-44`), and it is fine for recognition. Agglutinative languages, though, sit far from the citation form: Turkish evlerimizden ("from our houses"), Finnish talossa, Korean 먹다 against everyday 먹어요. *Keep the dictionary form inline, and optionally store a few common forms (plural; Korean polite present) for the tooltip.*

**D2. Articles and gender.** German der Hund, Spanish el perro, Arabic البيت against بيت. Whether `native` includes the article is up to the model. If it does, "the dog" becomes "the der Hund". Gender sometimes lands in `note` (`llm.ex:27`). *Add `article` and `gender` fields, keep the bare noun inline, show the article in the tooltip, and offer an optional gender colour cue.*

**D3. Homographs in the target language.** замок (castle) and замок (lock); banco (bank) and banco (bench); Japanese はし in kana; Chinese 行 (xíng and háng).
- Popup: `upsert` on `(lang, native)` silently replaces the first meaning (`words.ex:359-367`).
- Bot: an existing active word answers "Already in your list" with the old meaning (`bot.ex:225-229`), so the second sense can never be saved.

*Key words on `(lang, native, sense)`.*

**D4. Japanese script choice.** 猫 or ねこ; 有難う or ありがとう. The model picks "as normally written" (`llm.ex:45`), and a beginner can't read a kanji they haven't learned. *Store a kana `reading`, and offer per-language display modes: kanji, kana, or furigana.*

**D5. Vowel marks and stress.** Arabic and Hebrew marks are stripped by design (`llm.ex:46`), so كتب could be kataba, kutub or kutiba, and only the romanization tells you which. Russian stress (zámok against zamók) and ё against е are not specified. Persian needs its zero-width non-joiners (می‌خواهم) preserved. *Add a `native_vocalized` field (harakat, niqqud, or a Russian stress mark, U+0301) with a beginner display mode. Require ё in `native` and stress in the romanization.*

**D6. Unicode normalization.** Nothing normalizes text; `clean/1` only trims (`llm.ex:226`). Decomposed (NFD) Vietnamese gets past the unique index as a duplicate. Romanian ș (comma below, U+0219) and ş (cedilla, U+015F) look alike but are different code points. *NFC-normalize every field, and map ş and ţ to ș and ț for Romanian (ro).*

### E. Language tags, variants and scripts

**E1. Regions dropped.** Portuguese: Brazil has trem and ônibus where Portugal has comboio and autocarro. Spanish: coche against carro, ordenador against computadora. Both varieties are stored as `pt` or `es` (`word.ex:270-283`), and the variety the model picks can change from word to word. Dialects tagged by region ("ar-EG") collapse into the standard language, while three-letter dialect codes ("arz", "gsw") stay separate, so the behaviour is inconsistent. *Keep the region as data, add a per-language variant preference to the prompt, and map region tags for dialects to their dialect codes.*

**E2. Codes that are not canonical.** "zh-TW" becomes Simplified "zh", although `Intl.Locale("zh-TW").maximize()` gives zh-Hant-TW. "cmn", "rus", "iw", "tl" and "no" each start a new group. "zh-min-nan" (Hokkien) becomes "zh". *Canonicalize: deprecated codes (iw to he, in to id, mo to ro, tl to fil), macrolanguage members (cmn to zh, arb to ar), three-letter codes to two-letter ones, and Chinese regions to a script (TW, HK and MO to Hant).*

**E3. Cantonese and Mandarin.** 係 (hai6) against 是 (shì). If the model returns "zh-HK", the word merges with Mandarin, and `keep_language_name` (`words.ex:371-381`) labels it with whatever name the group got first. The romanization should be Jyutping, not pinyin. *In the prompt, Cantonese is `yue` with Traditional characters. Derive language names from the code: `Intl.DisplayNames` already returns "Cantonese" for yue.*

**E4. Languages written in two scripts.** Serbian, Uzbek, Kazakh, Azerbaijani, Punjabi (Gurmukhi and Shahmukhi), Kurdish (Latin Kurmanji and Arabic-script Sorani, ckb), Mongolian. The prompt adds a script only for a "non-default script" (`llm.ex:41-42`) but never says what the default is. A model can return Latin "hvala" tagged `sr`, and then хвала and hvala sit side by side as unrelated words. *Add a per-language script preference, and detect the script of `native` on the server so it can set or check the subtag.*

**E5. Conlangs and sign languages.** Klingon (tlh) and Esperanto (eo) pass the tag format. Private-use tags fail `@lang_format` (`word.ex:251`) with a raw changeset error (`router.ex:43-45`). Sign languages (ase) pass the format, but writing them as text makes no sense. *Allow `x-` tags. For sign languages, decline or store a gloss with a dictionary link.*

**E6. Pages not in English.** Matching ignores `<html lang>` and element `lang` (`content.js:115-132`). A German page has "die", "Gift" (poison) and "Kind" (child); a French page has "pain"; a Spanish page has "come" and "red". Multilingual readers are the core audience. *Skip subtrees whose nearest `lang` isn't `en`. When no language is declared, apply a stopword heuristic. Allow a per-site override.*

### F. Display and fonts

**F1. Romanization standards.** Only pinyin is specified (`llm.ex:24`). The options differ a lot by language:
- Russian: BGN/PCGN, ISO 9, or a learner respelling.
- Japanese: Hepburn with or without macrons, or wāpuro.
- Korean: Revised Romanization or McCune-Reischauer.
- Thai: RTGS (no tones) or Paiboon (with tones).
- Arabic: ALA-LC or Arabizi.
- Hindi: IAST or popular spellings.

*Set a default per language (pinyin with tone marks, Hepburn with macrons, Revised Romanization, BGN/PCGN with stress, a light ALA-LC for Arabic, Thai with tones), with a per-language override.*

**F2. No pronunciation for Latin-script languages.** `romanization` is null for Latin scripts (`llm.ex:24`), which leaves French oiseau, Polish chrząszcz and Vietnamese tones without help. *Add an `ipa` field.*

**F3. Missing glyphs (tofu) and line height.** `content.css` only underlines. Minimal Linux installs may lack CJK fonts. Older systems may lack Adlam, N'Ko, Tifinagh or Georgian Mtavruli. Legacy Zawgyi fonts garble Unicode Burmese. Tall fallback fonts (CJK, Devanagari, Thai) make lines grow taller. *Detect tofu by comparing canvas measurements, then show a hint naming a Noto font to install. Optionally bundle per-script Noto subsets as extension resources, which page CSP doesn't block. Set a line-height on the span and test it. Keep `span.lang` accurate (`content.js:94`), because browsers choose Han glyph shapes by language.*

**F4. Ruby and RTL in the tooltip.** There is no option to show a reading above the word. The tooltip is a plain `title` string (`content.js:60-71`), where RTL words, parentheses and "·" can reorder. `dir="auto"` on the span is already correct (`content.js:95`). *Offer optional `<ruby>` (furigana, pinyin, Jyutping) per language, but not for RTL scripts. Use `<bdi>` in a custom tooltip, as the popup already does (`popup.js:156`).*

### G. Model correctness

**G1. Invented words.** These are most likely in low-resource languages and conlangs. Output is accepted whenever lang, native and english are non-blank (`llm.ex:196`). *Check the word against open dictionaries where they exist (Wiktionary extracts via Wiktextract and kaikki.org, CC-CEDICT, JMdict; check each license), and otherwise show a "not verified" badge.*

**G2. Ambiguous input and many translations.** "da" could be Russian, Serbian or Romanian. "ni" could be Mandarin 你 or Spanish ni. "sol" could be Spanish or Portuguese "sun", or Russian соль ("salt"). "pan" could be Spanish "bread" or Polish "Mr". "you" could be ты or вы. The recent-languages hint picks one (`llm.ex:165-173`), and the popup saves it without asking. *Return `alternatives` and a `confidence`, and show "Did you mean" before saving when confidence is low.*

**G3. The model "corrects" input into another word, and false friends.** "kot" can become кот (cat) when the user meant код (code). "gift" may be meant as German Gift (poison). *Return `source_reading` so the card can say "I read 'kot' as кот", and require a note when the word is a known false friend.*

**G4. No editing.** `router.ex` has only GET, POST and DELETE. Fixing anything means deleting the word and re-adding it, which may repeat the same mistake. *Add `PATCH /api/words/:id` with an edit UI for every field and each form.*

## 3. Design recommendations

**Data model.** New nullable columns:
- `pos`
- `article` and `gender`
- `reading` (kana or Jyutping)
- `native_vocalized`
- `ipa`
- `region` and `script`, kept instead of dropped
- `sense`, a short gloss that becomes part of the unique key `(lang, native, sense)`
- `verified`

Replace newline-separated `english_forms` with JSON objects `{text, case, enabled, ambiguous}`. `case` takes one of these values:
- `any` (the default)
- `lower`: skip capitalized matches mid-sentence (will, may, bill)
- `exact`: US
- `proper`: Japan, Monday; only capitalized matches count, and the capital is never copied to the target

Add a global "never swap" list.

**Language tags.**
1. Canonicalize deprecated, three-letter and macrolanguage codes, and map Chinese regions to scripts.
2. Detect the script of `native` and set or check the subtag.
3. Group by language plus any non-default script, and store the region separately.
4. Derive display names from CLDR data (`Intl.DisplayNames` in the extension; the ex_cldr library on the server).

**Prompt.**
- Define per-language defaults for script and romanization, and pass in the user's variant preferences.
- Forms must include irregulars, British and American spellings, and compound spellings. Flag forms that are also other words, mark proper nouns, and exclude function-word senses.
- Return `pos`, `article`, `gender`, `reading`, `native_vocalized`, `ipa`, `alternatives`, `source_reading` and `confidence`.
- Add few-shot examples: like, saw, glasses, US, Monday (es), Hund, замок, da.

**Matching engine.**
1. Use Unicode lookaround boundaries, and reject matches next to hyphens, apostrophes or URL characters.
2. After the regex matches, apply a filter:
   - sentence-start detection
   - the proper-noun and acronym rules
   - Title Case detection
   - per-form `case`
   - an optional noun/verb heuristic
   - a function-word rate limit
3. Skip text whose `lang` isn't English.
4. Use a per-script casing function.
5. Optional ruby, gender class, line-height guard and `<bdi>` tooltip.

**Verification UX.** On add, show the forms to be swapped, the alternatives, "I read X as Y", and the verified status. Each form can be removed with one tap.

**Tests.** A fixture page covering every scenario above, matcher and casing unit tests that run without a browser, and a golden set of about 50 hard model inputs, rechecked whenever the prompt or model changes.

## 4. Open questions for the owner

1. Should the defaults favour precision (skip ambiguous, capitalized and short all-caps matches) over coverage? This report recommends yes.
2. Function words and the copula: allow them with a warning, rate-limit them, or block them?
3. Should "the dog" ever become "der Hund" by absorbing the English article, or should articles live only in the tooltip?
4. Variant and script: an explicit per-language setting, or inferred from the first words a user adds?
5. Is shipping or querying third-party dictionary data acceptable, given licensing (for example CC BY-SA for CC-CEDICT and JMdict) and size?
6. Should non-English pages only be skipped, or is a later "reverse mode" (glossing target-language words) in scope?
7. Homographs: two cards, or one card with several senses?
8. Is bundling Noto subsets worth the larger extension, or should Slovo only detect missing fonts and advise?

## 5. Proposed slices

| Slice | Goal | Size | Priority | Depends on |
|---|---|---|---|---|
| `unicode-word-boundaries` | Unicode lookaround boundaries; reject matches touching hyphens, apostrophes and URL characters | S | P0 | none |
| `proper-noun-acronym-skip` | Skip capitalized mid-sentence matches and short all-caps tokens; detect Title Case | S | P0 | none |
| `locale-aware-casing` | Per-script casing (Turkish, Georgian, Dutch, Greek, caseless scripts); never copy English-only capitals | S | P0 | none |
| `skip-non-english-text` | Skip subtrees whose `lang` isn't English; heuristic for pages with no declared language; per-site override | S | P0 | none |
| `lang-tag-canonicalization` | Canonicalize codes, map zh regions to scripts, verify script against `native`, derive names from the code | M | P0 | none |
| `nfc-and-char-fixes` | NFC-normalize all fields; fix Romanian comma-below characters | S | P0 | none |
| `edit-word-and-forms` | `PATCH /api/words/:id`; show forms on add; remove or toggle individual forms | M | P0 | none |
| `structured-forms` | Forms with `case`, `enabled` and `ambiguous`; flagged forms off by default | M | P1 | `edit-word-and-forms` |
| `prompt-hardening` | Romanization standards, spelling variants, compounds, irregular flags, few-shot examples, golden evaluation set | M | P1 | `structured-forms` |
| `word-sense-key` | Add `sense`; unique key `(lang, native, sense)` so homographs coexist | M | P1 | none |
| `grammar-fields` | `pos`, `article`, `gender`, `reading`, `native_vocalized`, `ipa`, shown in the tooltip | M | P1 | `prompt-hardening` |
| `disambiguation-ux` | Alternatives, `source_reading` and confidence; "Did you mean" before saving | M | P1 | `prompt-hardening` |
| `variant-preferences` | Per-language region and script preference sent to the prompt (pt-BR, sr-Latn, yue) | S | P1 | `lang-tag-canonicalization` |
| `matcher-test-corpus` | Fixture page and unit tests for every scenario here | M | P1 | none |
| `pos-context-heuristic` | Noun/verb choice from context; function-word rate limit | M | P2 | `grammar-fields` |
| `ruby-and-display-modes` | Optional furigana or pinyin ruby, vowel-mark mode, gender colours, line-height guard | M | P2 | `grammar-fields` |
| `font-coverage` | Tofu detection with install hints; optional bundled Noto subsets | M | P2 | none |
| `dictionary-verification` | Check words against open dictionaries; show a verified badge | L | P2 | `grammar-fields` |
| `cross-node-phrases` | Multi-word forms across inline elements; gaps for separable phrasal verbs | L | P2 | `unicode-word-boundaries` |
| `same-language-rotation` | Rotate or list several words in one language for the same English form | S | P2 | none |
