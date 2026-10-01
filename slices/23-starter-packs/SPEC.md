# 23 · Starter packs

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week of engineering, plus reviewer time per language) |
| **Depends on** | [09-shared-word-spec-and-prompt](../09-shared-word-spec-and-prompt/SPEC.md); imports through [07](../07-word-model-v2/SPEC.md) and [24](../24-add-flow-safety/SPEC.md) |
| **Unblocks** | [22-first-run-onboarding](../22-first-run-onboarding/SPEC.md), [47-hosted-word-packs](../47-hosted-word-packs/SPEC.md) |
| **Sources** | [05 S4, S25, §4 Q6](../../docs/research/05-learner-ux.md); [04 S11 packs, licensing](../../docs/research/04-architecture-release.md); [01 S7, S9, S16](../../docs/research/01-language-mixing.md); [02 F1 romanization](../../docs/research/02-linguistics.md); [DECISIONS: license](../DECISIONS.md) |

## Problem

A new learner starts with an empty list: "No words yet. Add one above, in any language."
(`extension/popup.js:62`). Nothing swaps until they add words one by one, and each costs a
model call against a free quota of about 50 a day ([05 S4](../../docs/research/05-learner-ux.md)).
Building a 40-word start through the model would use most of a day's quota, and model output
for common words is exactly where ambiguity bites ("like", "right", "can";
[01 S9](../../docs/research/01-language-mixing.md)). Curated, human-reviewed packs bundled in
the extension give an instant, correct start with no network and no key.

## Goals

- Bundled packs for at least six languages at launch (target twelve), each 30-50 everyday
  words chosen to appear often in English web text and to swap unambiguously.
- A pack format validated by the shared word schema, so packs, imports and hosted packs
  ([47](../47-hosted-word-packs/SPEC.md)) are one format.
- A preview where the learner can untick words before importing; import in one step, with
  no model calls.
- A clear content license compatible with the Apache-2.0 code, and a review process that
  requires a fluent reviewer for every pack.

## Non-goals

- Hosted packs, subscribing by URL and removing a pack as a unit: [47](../47-hosted-word-packs/SPEC.md).
  This slice tags words with their pack so 47 can do that.
- Packs for levels beyond a start (themed or graded packs): Future work.
- Dictionary verification of model output: [49](../49-dictionary-verification/SPEC.md).

## User stories

- As a beginner in Japanese, I want 40 common words with readings, checked by a fluent
  speaker, so that my first swaps are right.
- As a learner who already knows some Spanish words, I want to untick those I don't need
  before importing.
- As a contributor who speaks Turkish, I want a clear template and checklist to submit a
  Turkish pack.

## Specification

### 1. Format

One JSON file per pack at `extension/packs/{id}.json`, plus `extension/packs/index.json`
listing `{id, lang, title, count, version}` for fast menus. Schema in `spec/pack.schema.json`
(owned here, referencing [09](../09-shared-word-spec-and-prompt/SPEC.md)'s word schema for
each entry).

```json
{
  "schemaVersion": 1,
  "id": "es-starter",
  "version": 3,
  "lang": "es",
  "variant": "Neutral, understood in Spain and Latin America",
  "title": "Spanish starter words",
  "description": "40 everyday words you'll meet often in English text.",
  "license": "CC0-1.0",
  "authors": [{ "name": "…", "github": "…" }],
  "reviewers": [{ "name": "…", "github": "…", "fluency": "native" }],
  "romanizationSystem": null,
  "sample": "Thanks for the coffee. See you tomorrow, my friend.",
  "tryUrl": "https://simple.wikipedia.org/wiki/Coffee",
  "words": [
    {
      "key": "thanks",
      "native": "gracias",
      "romanization": null,
      "english": "thanks",
      "forms": ["thanks", "thank you"],
      "note": null,
      "pos": "interjection",
      "topic": "greetings"
    }
  ]
}
```

- `key` is the core concept id (§3), stable across versions; it is stored in each imported
  word's `pack_ref.key` and used to offer updates.
- `romanizationSystem` names the scheme for non-Latin packs (`"pinyin-tones"`,
  `"hepburn-macrons"`, `"revised-romanization"`, `"bgn-pcgn-stress"`, `"ala-lc-light"`,
  `"hindi-learner"`), following [02 F1](../../docs/research/02-linguistics.md)'s defaults.
- Every word entry must validate as a word under 09's schema, with `romanization` required
  when the native script isn't Latin.
- Files are loaded with `fetch(runtime.getURL(...))` from extension pages only; they are not
  web-accessible.

### 2. Content license

**Recommendation: CC0 1.0** for all org-authored pack content, with `license: "CC0-1.0"` in
every file and `packs/LICENSE` containing the CC0 text.

Why: packs ship inside an Apache-2.0 extension, are copied into learners' lists, exported to
Anki and CSV ([12](../12-export-import-and-delete/SPEC.md)), and remixed into other packs.
CC0 has no conditions to track through any of that and is compatible with Apache-2.0 in
both directions. CC BY 4.0 is also compatible but requires attribution on every
redistribution, which is impractical for word lists copied into personal decks, and gives
little in return since word-meaning pairs are close to facts. Contributors are credited in
the pack's `authors` and `reviewers` and in the dashboard's pack page anyway.

Constraints that follow:

- No content copied from Wiktionary (CC BY-SA), CC-CEDICT (CC BY-SA), JMdict (CC BY-SA),
  commercial dictionaries or textbooks. Authors write from their own knowledge; dictionaries
  may be consulted to check, not copied as compilations.
- Contributors confirm in the PR template: "I wrote this pack myself and dedicate it to the
  public domain under CC0 1.0."
- Hosted third-party packs ([47](../47-hosted-word-packs/SPEC.md)) may use other licenses; the
  importer shows the license.

### 3. Choosing words

All packs translate one shared **core list** of English concepts, `packs/core.json`, so
reviewers translate rather than invent, previews work across languages, and coverage is
comparable. Each concept has an English headword, its forms, and a sense gloss for the
translator:

```json
{ "key": "water", "english": "water", "forms": ["water"], "gloss": "the drink; noun only", "topic": "food" }
```

The core list has about 60 concepts; a pack uses 30-50 of them and may substitute up to 10
language-specific concepts when a core concept doesn't translate cleanly (documented in the
PR). Rules for core concepts, checked by CI where marked:

1. **Frequent in English web text:** the English headword is in the top 3,000 of a public
   frequency list (recorded in `core.json` with the list's name and rank). (CI)
2. **One clear sense:** no noun-verb or adjective-verb homographs common in web text (book,
   play, run, set, light, close, show, change, point, order, watch, park, match) and none of
   the ambiguous words in 09's list (like, right, left, can, may, will, bill, fine, kind,
   mean, well, just, still, fair). (CI against 09's list)
3. **No function words** (and, the, of, to, is, in, it): they swap everywhere and are better
   added deliberately later ([01 S16](../../docs/research/01-language-mixing.md)). (CI)
4. **No proper-noun collisions** (days, months, names, "May", "US") and no capitalized
   headwords. (CI)
5. **Not equal to the English** in the target language (hotel, taxi, pizza): the pack drops or
   substitutes those ([01 S7](../../docs/research/01-language-mixing.md)). (CI: native folded
   ≠ any form)
6. **Neutral topics:** greetings and courtesy, food and drink, home, people and family, time,
   nature and weather, city and travel, everyday feelings and qualities. No religion,
   politics, body, alcohol, money terms with cultural weight, or slang.
7. **Variant stated:** each pack names its variant (pt-BR or pt-PT, zh-Hans, neutral Spanish)
   in `variant`, and words follow it.
8. **English forms include common inflections** (dog, dogs; friend, friends) per 09's forms
   rules, and nothing else.

Illustrative core concepts: thanks, hello, goodbye, please, sorry, water, coffee, tea,
bread, food, house, home, family, friend, mother, father, child, dog, cat, tree, sun, moon,
sea, city, street, car, today, tomorrow, yesterday, night, morning, week, year, good, new,
big, small, beautiful, happy, music, school, word, language, world, question. Candidates such
as "love", "work", "book" and "rain" fail rule 2 (common as verbs too) and stay out.

### 4. Launch languages

Target twelve; ship each only when it has a fluent reviewer: Spanish (`es`), French (`fr`),
German (`de`), Italian (`it`), Portuguese (`pt-BR`), Russian (`ru`), Japanese (`ja`),
Chinese (`zh-Hans`), Korean (`ko`), Arabic (`ar`, Modern Standard), Hindi (`hi`), Turkish
(`tr`). Launch is not blocked on all twelve; it is blocked on at least six, including at
least two non-Latin scripts and one right-to-left language.

### 5. Preview and import UI

A component `extension/packs/picker.js`, used in the welcome page
([22](../22-first-run-onboarding/SPEC.md)), the dashboard's `#packs` view and the language
shelf menu ([21](../21-dashboard/SPEC.md)).

```
┌──────────────────────────────────────────────────────────────┐
│ Spanish starter words                     40 words · v3      │
│ 40 everyday words you'll meet often in English text.         │
│ Checked by Ana P. (native speaker). Free to use (CC0).       │
│ [ Search ]                                Untick all         │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│ Greetings                                                    │
│ [x] gracias            thanks, thank you                     │
│ [x] hola               hello                                 │
│ [ ] adiós              goodbye          In your list         │
│ Food and drink                                               │
│ [x] agua               water                                 │
│ …                                                            │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  │
│                                  [ Add 38 words ]  Cancel    │
└──────────────────────────────────────────────────────────────┘
```

- Grouped by topic; every word ticked except those already in the learner's list ("In your
  list", unticked and disabled).
- Each row: native (`<bdi lang>`, `--t-word`), romanization (`--ink-3`), English forms.
- "Add {n} words" imports at once through [07](../07-word-model-v2/SPEC.md)'s batch add
  (locally one store transaction; with a server, `POST /api/v1/words/batch`). Each word carries
  [07](../07-word-model-v2/SPEC.md)'s provenance, `origin: "pack"` and `pack_id: "<id>"`, plus
  `pack_ref: {version, key, base_hash}` and a deterministic id (UUIDv5 of
  `"scriptkittyos/<pack id>/<key>"`) as [47](../47-hosted-word-packs/SPEC.md) defines them, so
  bundled and hosted packs are one model; if 23 ships first it adds `pack_ref` to
  `spec/word.schema.json` and 47 extends it with `publisher`. The import reports with
  [24](../24-add-flow-safety/SPEC.md)'s summary ("Added 38 Spanish words. Undo"). Words already
  in the list are excluded from the import, so a pack never modifies them.
- In the welcome page the picker is collapsed to its one-line summary with "Preview ▸".
- Steps: from the dashboard, 2 (Starter packs, Add); from onboarding, 0 extra (ticked by
  default).

### 6. Pack updates

When an extension update ships a higher pack `version`, nothing changes in anyone's list. The
dashboard's `#packs` view shows "Spanish starter words has 3 new words" and, for corrected
entries, "2 corrections" with before and after. New words are ticked. A correction is ticked
when the learner's word still matches its `pack_ref.base_hash` (unedited) and unticked when the
learner changed it. Matching uses `pack_ref.key`; accepted corrections go through 07's `PATCH`
and update `pack_ref`. A small dot on the dashboard's
Starter packs menu item is the only notice; no popups.

### 7. Review process

1. **Template:** `packs/TEMPLATE.json` (copy of the core list with empty natives) and
   `.github/PULL_REQUEST_TEMPLATE/pack.md`.
2. **CI checks** (in [02](../02-test-harness-and-ci/SPEC.md)'s pipeline): schema validation;
   rules 1-5 and 8 from §3; 30-50 words; no duplicate natives or keys; script of `native`
   matches `lang` ([08](../08-language-tags/SPEC.md)); romanization present for non-Latin
   scripts and matching the declared system's character set (for example pinyin with tone
   marks only uses Latin letters with the four tone diacritics and ü); the sample sentence
   contains at least four of the pack's English forms (so the welcome preview shows swaps);
   `license` is `CC0-1.0`; at least one author and one reviewer who is not an author; file
   under 20 KB.
3. **Human review checklist,** signed off in the PR by the fluent reviewer: every translation
   correct for the gloss; natural, everyday register; variant consistent; romanization
   correct; nothing offensive or culturally loaded in the target culture; the note field used
   where a learner would otherwise go wrong.
4. **Maintainer merge** and a CHANGELOG line: "Packs: Turkish starter words v1."
5. **Mistake reports:** the pack view has "Report a mistake", which opens a prefilled GitHub
   issue (pack id, version, word key); nothing is sent automatically.

### 8. Edge cases

- **Learner already has the pack's language under another tag** (`cmn` vs `zh`): imports use
  [08](../08-language-tags/SPEC.md)'s canonical tags, so they merge.
- **Re-importing the same pack:** every word shows "In your list"; the button reads "All 40
  words are in your list".
- **A pack word the learner deleted:** it shows as available again, ticked; deliberate.
- **Several packs selected in onboarding:** one combined import, one summary, one Undo.

## Acceptance criteria

- [ ] At least six packs ship, each passing CI and with a recorded reviewer sign-off; at least
      two non-Latin scripts and one RTL language among them.
- [ ] Importing a pack makes zero network requests.
- [ ] Unticked words are not imported; words already in the list are not modified (fixture
      with an edited note survives import).
- [ ] Every imported word has `origin === "pack"`, the pack's `pack_id`, and `pack_ref` with
      the pack version and key.
- [ ] CI rejects a pack containing "like", a function word, a native equal to its English, a
      missing romanization for `ja`, or a reviewer who is also the author (negative
      fixtures).
- [ ] The welcome preview shows at least four swaps for every shipped pack's sample.
- [ ] A pack version bump shows new words and corrections in `#packs` and changes nothing
      until the learner accepts.

## Test plan

- **Unit:** pack schema and lint rules with positive and negative fixtures; update diffing by
  `key`.
- **End-to-end:** onboarding import; dashboard picker with partial selection; re-import;
  version bump fixture.
- **Manual:** each shipped pack viewed in the picker and swapped on its `tryUrl` page by its
  reviewer.

## Rollout and migration

Bundled from the first Mira release. Existing users see "Starter packs" in the dashboard menu;
nothing is imported automatically. Changelog: "Starter words for {languages}, checked by
fluent speakers, free to use (CC0)."

## Open questions

1. **Content license.** Recommendation: CC0 1.0 (see §2), compatible with the Apache-2.0
   code; CC BY 4.0 is the alternative if the maintainer wants attribution required.
2. **Who are packs for?** Recommendation: complete beginners first (everyday nouns,
   greetings, time words); "returning learner" packs later as themed packs.

## Future work

- Themed and graded packs (travel, food, 200-word level 2) once the review process has run
  for a few months.
- Hosted pack catalog and subscriptions ([47](../47-hosted-word-packs/SPEC.md)).
- Audio-checked packs once [34](../34-pronunciation-audio/SPEC.md) can verify voices.
