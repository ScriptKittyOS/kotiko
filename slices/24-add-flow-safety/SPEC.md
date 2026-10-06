# 24 · Add flow safety

| | |
|---|---|
| **Status** | Built (2026-10-05); see Implementation notes |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [07-word-model-v2](../07-word-model-v2/SPEC.md), [50-ui-localization-and-base-language](../50-ui-localization-and-base-language/SPEC.md) (base languages, `t()`) |
| **Unblocks** | [13-bulk-add](../13-bulk-add/SPEC.md), [20-popup-redesign](../20-popup-redesign/SPEC.md), [21-dashboard](../21-dashboard/SPEC.md), [22-first-run-onboarding](../22-first-run-onboarding/SPEC.md), [33-context-menu-and-shortcuts](../33-context-menu-and-shortcuts/SPEC.md) |
| **Sources** | [DECISIONS 2026-10-01, base language](../DECISIONS.md); [05 S7, S8, S9, S10, S13, S19](../../docs/research/05-learner-ux.md); [06 F05, F06, F09, F12, F30](../../docs/research/06-adversarial-qa.md); [01 S22](../../docs/research/01-language-mixing.md) |

## Problem

Adding a word is Kotiko's most frequent action, and today it can lose data, hide what
happened, and block the learner for minutes:

- **Re-adding a word you have says "Added", and Undo deletes your original.** The server
  upserts by (lang, native) and reports every row as new (`server/lib/slovo/router.ex:40`,
  `server/lib/slovo/words.ex:61-68`); nil fields from the model overwrite your note,
  romanization and forms. The popup's Undo then calls DELETE on the original id
  (`extension/popup.js:166-173`). Reproduced in [06 F05](../../docs/research/06-adversarial-qa.md).
- **Undo lies when it fails.** It prints "Removed." without checking the response
  (`popup.js:171-172`; [06 F30](../../docs/research/06-adversarial-qa.md)).
- **Several words share one Undo.** "thank you and goodbye in arabic" saves every word the
  model returns and offers one Undo for all (`popup.js:153-174`).
- **The popup blocks while the model thinks.** The Add button is disabled and reads "…"
  until the request returns (`popup.js:189-202`), which can take up to 60 s per model and
  300 s in total (`server/lib/slovo/llm.ex:124`; [06 F09](../../docs/research/06-adversarial-qa.md)).
  Chrome may kill the service worker after 30 s waiting on a fetch; the popup then shows "No
  answer from the extension" (`popup.js:196`) while the word may still be saved.
- **Closing the popup loses the result and the draft.** The background finishes the request
  (`background.js:64-66` comment, handler `background.js:74-82`) but the result lives only
  in popup DOM, and the typed text is gone.
- **Retrying is unsafe.** A retry after a long wait is a new request; with two in flight the
  server can 500 on the unique index ([06 F06](../../docs/research/06-adversarial-qa.md)).
- **No way to add a word without the model.** When lookups fail, are rate limited or
  offline, the learner is stuck ([05 S19](../../docs/research/05-learner-ux.md)).
- **A pasted sentence saves many words with no confirmation**
  ([05 S9](../../docs/research/05-learner-ux.md), [06 F12](../../docs/research/06-adversarial-qa.md)).
- **Every result assumes English.** The popup prints "native = english"
  (`extension/popup.js:165`) and the model is asked for the English meaning
  (`server/lib/slovo/llm.ex:28-29`). A learner reading Spanish pages needs the meaning in
  Spanish, and one reading Spanish and English needs both
  ([50](../50-ui-localization-and-base-language/SPEC.md)).

## Goals

- Every add reports, per word, whether it was **created**, **updated** or **unchanged**,
  using the result from [07](../07-word-model-v2/SPEC.md)'s upsert.
- Undo is per word and restores the previous state: created words are removed, updated words
  go back to their previous version, unchanged words have no Undo. Undo reports its own
  failure.
- No add ever blocks the UI. The input clears at once and accepts the next word; lookups run
  in a persistent background queue that survives the popup closing and the worker restarting.
- Adds are idempotent: a retry with the same client id never creates a duplicate or a 500.
- A learner can always add a word without the model, in one line ("gracias = thanks";
  for a Spanish reader, "thanks = gracias") or a small form, with the meaning in their own
  language.
- Inputs that produce four or more words ask before saving.
- Each add looks up meanings for the learner's base languages (all of them by default,
  narrowable per add) and reports results per base, in the interface language
  ([50 §3](../50-ui-localization-and-base-language/SPEC.md)).

## Non-goals

- Bulk paste and file import: [13](../13-bulk-add/SPEC.md), which reuses this queue and
  result model.
- The popup layout around these states: [20](../20-popup-redesign/SPEC.md).
- The wording and codes of errors: [25](../25-plain-language-errors/SPEC.md).
- Model deadlines, retries and quota: [10](../10-llm-client-resilience/SPEC.md).
- "Did you mean" alternatives from the model: [36](../36-grammar-and-senses/SPEC.md); this
  slice leaves a slot for them.
- System notifications when an add finishes in the background: Future work.

## User stories

- As a learner who re-adds "gracias" by accident, I want Kotiko to tell me I already have it
  and to keep my note, so that nothing I wrote is lost.
- As a learner adding several words in a row, I want to type the next one while the first is
  still being looked up, so that I'm never waiting.
- As a learner who closed the popup too early, I want to see what was added when I reopen
  it, so that I don't add it twice.
- As a learner whose free lookups ran out, I want to type "gracias = thanks" and have it
  saved anyway.
- As a learner who got the wrong language, I want to fix it from the result line in one
  click.
- As a reader of Spanish and English, I want one add of 犬 to give me "perro" for my Spanish
  pages and "dog" for my English ones, and to skip English for a word I only want on Spanish
  pages.
- As a Spanish reader learning English, I want to type "dog" and get it with the meaning
  "perro".

## Specification

### 1. The add job

Every add, from any surface (popup, context menu [33](../33-context-menu-and-shortcuts/SPEC.md),
popover, onboarding, dashboard), becomes an **add job** owned by the background worker and
persisted in `storage.local` under `addJobs` before any network call:

```js
{
  id: "5f0c…",            // UUID, created by the caller (slice 33 calls it clientId); sent as
                          // client_request_id, so it is also the idempotency key
  surface: "popup",       // popup | context_menu | popover | dashboard | welcome (UI only;
                          // the saved word's 07 origin is "add" or "manual")
  text: "shukran",        // what the learner typed, trimmed; capped by 09's
                          // rules.max_input_chars (200), else input_too_long
  hintLang: null,         // BCP 47 tag from the language hint chip or 33's "Learn in", or null
  pageLang: null,         // 33: language of a selected foreign word's page, or null
  baseLangs: ["es", "en"],// bases to look meanings up for: s:ui.baseLangs at submit time,
                          // narrowed by the "For pages in" chips (§8)
  manual: null,           // {native, gloss, base_lang, lang, romanization?, note?} for manual adds
  state: "queued",        // queued | looking_up | waiting | needs_choice | done | failed | cancelled
  createdAt: 1727771234567,
  startedAt: null,
  attempts: 0,
  error: null,            // {code, details: {reason?, retry_at?, ...}} per 25
  candidates: null,       // words found, before saving, in needs_choice
  results: [              // after saving; one entry per saved record (one per base)
    { wordId, baseLang: "es", result: "created" | "updated" | "unchanged",
      word: {...word}, previous: {...word} | null, undo: null | "done" | "failed" }
  ],
  seen: false             // set true once any surface has shown the finished job
}
```

The list keeps the 20 most recent jobs and drops finished jobs older than 7 days.
Unfinished jobs are never dropped automatically.

### 2. Lifecycle

```
queued ──> looking_up ──> done
   ^            │  └────> needs_choice ──(learner picks)──> done
   │            ├──> waiting (offline, rate limited, quota) ──(retry_at / online)─┐
   │            └──> failed (no word, bad input, key rejected)                     │
   └───────────────────────────────────────────────────────────────────────────────┘
```

- **queued → looking_up:** the background takes at most two jobs at a time (protects free
  quota; [10](../10-llm-client-resilience/SPEC.md) owns the quota math). It writes
  `state` and `startedAt` before calling the backend.
- **Lookup:** in local mode the background calls the model through
  [11](../11-local-first-mode/SPEC.md)'s client with the job's `hintLang` (or `pageLang`),
  the learner's recent languages and the job's `baseLangs`, under
  [10](../10-llm-client-resilience/SPEC.md)'s overall deadline. In server mode it calls
  `POST /api/v1/words` with `{text, client_request_id: job.id, hint_lang, base_langs}`
  ([07 §5](../07-word-model-v2/SPEC.md)). The model returns one entry per base
  ([09](../09-shared-word-spec-and-prompt/SPEC.md)); a base equal to the word's own
  language is dropped ([50 §1](../50-ui-localization-and-base-language/SPEC.md)).
- **Saving:** words are written through [07](../07-word-model-v2/SPEC.md)'s merge-not-overwrite
  `add`, which returns `created | updated | unchanged` and, for `updated`, `previous` (the
  full word before the merge). In server mode the response's `results` carry both; in local
  mode [11](../11-local-first-mode/SPEC.md)'s store returns the same shape. Words the
  validator rejects ([09](../09-shared-word-spec-and-prompt/SPEC.md) `rejected`) are listed
  in the job with their reason. Each base's record is saved and reported on its own (one
  base can be `created` while another is `unchanged`); if a base's entry is missing or
  rejected while another succeeded, the job is `done` and its line notes "No meaning in
  {base} yet" with "Add it" (a manual meaning, §7).
- **Four or more words:** counted as target words, not records (犬 for two bases is one
  word). If the lookup returns 4+ words (09 caps an add at 5), nothing is
  saved; the job moves to `needs_choice` with `candidates`, all ticked by default. One to
  three words are saved immediately, each with its own Undo. The threshold is a constant
  (`CONFIRM_AT = 4`). Exception: when the server does the lookup (`lookup.kind = "server"`,
  [11](../11-local-first-mode/SPEC.md)), `POST /api/v1/words` saves before answering and 07
  has no preview mode, so the job shows the same checklist titled "Added {n} words from
  “{text}”. Untick any you don't want." and its button "Keep {k} words" tombstones the
  unticked ones. (A `preview` flag on 07's route would remove this exception; see Open
  questions.)
- **waiting:** for `offline`, `server_unreachable`, `rate_limited`, `model_unavailable`,
  `lookup_timeout`, `quota_exhausted`, `user_quota_exhausted` and `lookup_not_set_up` (codes
  from [25](../25-plain-language-errors/SPEC.md)). Retry at `details.retry_at` when the error
  has one (else backoff 30 s, 2 min, 10 min, then every 30 min), on the `online` event, when a
  lookup key or provider is saved ([11](../11-local-first-mode/SPEC.md)), and on the next alarm
  tick ([26](../26-background-sync-correctness/SPEC.md)). A job waiting on
  `lookup_not_set_up` is looked up as soon as a key is saved; its line offers "Set up lookups"
  and "Add it yourself".
  A job waits at most 3 days, then becomes `failed` with its text kept so the learner can
  add it by hand.
- **failed:** for `no_word_found`, `rejected_same_as_gloss` (the word is already in one of
  the learner's base languages, [09](../09-shared-word-spec-and-prompt/SPEC.md)),
  `input_too_long`, `key_rejected`,
  `vocabulary_full`, and `bad_lookup_result` after one retry. Failed jobs offer "Add it yourself"
  with the text prefilled.
- **Worker restarts:** on every worker start the background scans `addJobs`. A job in
  `looking_up` whose `startedAt` is older than the overall deadline plus 5 s is retried with
  the **same id**, so the server (or local store) returns the stored result instead of saving
  twice.

### 3. Idempotency

- The caller creates `job.id` once; every retry reuses it.
- **Server:** `POST /api/v1/words` (and the legacy `POST /api/words`) accept
  `client_request_id`; the server keeps `client_request_id → response` for 24 hours in
  `add_requests` and returns the stored response for a repeat, with no model call and no
  write ([07 §4](../07-word-model-v2/SPEC.md)). Immediate transactions serialize concurrent
  repeats. Requests without it behave as before for old extensions.
- **Local:** [11](../11-local-first-mode/SPEC.md)'s store applies an add job's results in one
  IndexedDB transaction keyed by the job id, and ignores a second application of the same
  job. The `storage.local` `words` projection updates once afterwards.
- Concurrent upserts of the same word from different jobs are safe because 07's upsert is
  atomic ([06 F06](../../docs/research/06-adversarial-qa.md)).

### 4. Per-word results and copy

The popup ([20](../20-popup-redesign/SPEC.md)) shows the three most recent jobs, newest first;
the dashboard ([21](../21-dashboard/SPEC.md)) shows pending jobs at the top of the list. Native
words are in `<bdi lang="…">`, glosses in `<bdi lang="{base_lang}">`. Every line is a key in
`_locales` read with `KotikoI18n.t()` ([50 §8](../50-ui-localization-and-base-language/SPEC.md));
English and Spanish are complete at launch:

| Key | en | es | Actions |
|---|---|---|---|
| `add_looking_up` | Looking up {text}… | Buscando {text}… | "Cancel" / "Cancelar" |
| `add_created` | Added {native} ({pronunciation}) = {gloss} · {lang} | Agregada {native} ({pronunciation}) = {gloss} · {lang} | "Undo" / "Deshacer", language chip, speak button ([34](../34-pronunciation-audio/SPEC.md)) |
| `add_updated` | Updated {native} = {gloss} · {lang}: {what changed} | Actualizada {native} = {gloss} · {lang}: {what changed} | "Undo" |
| `add_updated_forms` (what changed) | new forms: {forms} | formas nuevas: {forms} | |
| `add_unchanged` | Already in your list: {native} = {gloss} · {lang} | Ya está en tu lista: {native} = {gloss} · {lang} | "Open" / "Abrir" |
| `add_needs_choice` | Found {n} words in “{text}”. | Encontré {n} palabras en “{text}”. | "Add {k} words" / "Agregar {k} palabras", "Cancel" |
| `add_waiting` | Waiting to look up {text}: {reason} | Esperando para buscar {text}: {reason} | "Add it yourself" / "Agrégala tú", "Cancel" |
| failed | {message from 25} | {mensaje de 25} | "Add it yourself", "Try again" / "Reintentar" where it can help |
| `add_missing_base` | No meaning in {base} yet. | Aún sin significado en {base}. | "Add it" / "Agregarlo" |
| `undo_done_created` | Removed {native}. | Se quitó {native}. | "Add it back" / "Volver a agregarla" |
| `undo_done_updated` | Put {native} back as it was. | {native} volvió a como estaba. | none |
| `undo_failed` | Couldn't undo: {message from 25} | No se pudo deshacer: {mensaje de 25} | "Try again" |

`{pronunciation}` is how to say the word, so the learner can say it the moment it is
saved: the `pronunciation` of the primary base's record ([07](../07-word-model-v2/SPEC.md)
section 7, written for that base: "Added спасибо (spa-SEE-ba) = thanks", "Agregada спасибо
(spa-SI-ba) = gracias"), with the stressed syllable also in semibold and tone digits raised,
as in the popover ([19](../19-word-popover/SPEC.md) section 1a); its accessible text is 19's
`popover_pron_a11y`. When the record has no pronunciation (a base without a respelling key),
the romanization takes its place; the parentheses are omitted when both are null. The
source label ("AI-generated") is not repeated on this one-line confirmation; the popover
and the dashboard's inspector (21) show it. `{lang}` and `{base}` are names from
`Intl.DisplayNames([uiLocale], {type: "language"})` on [08](../08-language-tags/SPEC.md)'s
canonical tag, never the model's `language` field. `{n}`, `{k}` use plural keys
(`_one`/`_other`, 50 §8). "Agregada" agrees with "palabra", not with the learner.

**Several bases.** With more than one base, `{gloss}` is the glosses in base order, joined
with " · " ("perro · dog"), and the result is the record-level summary: `created` if any
record was created, else `updated` if any was updated, else `unchanged`. Undo on the line
undoes every record of that word in the job; per-base detail ("Already had the English
meaning; added the Spanish one") appears under the line when results differ.

```
Popup, three jobs in different states (360 px wide):

  ┌────────────────────────────────────────────┐
  │ [ Add a word, any language        ] [Auto▾]│
  │                                            │
  │  Looking up xie xie…               Cancel  │
  │  Added شكرا (SHUK-ran) = thanks            │
  │        [Arabic ▾]                   Undo   │
  │  Already in your list: gracias = thanks    │
  │        Spanish                      Open   │
  └────────────────────────────────────────────┘

The same popup for a reader of Spanish and English (interface in Spanish):

  ┌────────────────────────────────────────────┐
  │ [ Agrega una palabra, en cualq… ] [Auto▾]  │
  │  Para páginas en: [✓ español] [✓ inglés]   │  §8
  │                                            │
  │  Buscando こんにちは…              Cancelar  │
  │  Agregada 犬 (i-nu) = perro · dog          │
  │        [japonés ▾]               Deshacer  │
  │  Ya está en tu lista: dog = perro          │
  │        inglés                       Abrir  │
  └────────────────────────────────────────────┘

needs_choice:

  │  Found 5 words in “the cat sat on my mat”. │
  │   [x] gato = cat · Spanish                 │
  │   [x] sentarse = sat · Spanish             │
  │   [x] estera = mat · Spanish               │
  │   [ ] en = on · Spanish                    │
  │   [ ] mi = my · Spanish                    │
  │   [ Add 3 words ]   Cancel                 │
```

In `needs_choice`, function-word candidates the shared spec flags
([09](../09-shared-word-spec-and-prompt/SPEC.md) stopword list) start unticked.

### 5. Undo

- Undo applies to every record the job saved for that word (one per base), each with its
  own rule below; the line reports the combined outcome.
- **created:** removes the word with a tombstone (`DELETE /api/v1/words/:id`, or the local
  store's delete; [07](../07-word-model-v2/SPEC.md)). "Add it back" calls restore
  (`POST /api/v1/words/:id/restore`); if that returns `word_conflict` or `word_gone`, it
  re-adds `word` as a structured add, without the model.
- **updated:** restores `previous` with 07's `PATCH`, sending `if_updated_at: word.updated_at`.
  If the word changed since (another device, the dashboard), the server answers
  `word_conflict` (`details.reason: "stale"`) and the line says "This word changed since.
  Open it to fix." with "Open".
- **unchanged:** no Undo.
- Each word in a multi-word job has its own Undo. There is no "undo all".
- The result of an Undo is written to the job (`undo: "done" | "failed"`) so it survives the
  popup closing.
- Undo is available while the job is in the list (up to 7 days), not only for a few seconds:
  learners often notice a wrong word the next day.

### 6. Wrong language, in one click

The language on a created result is a chip ("Arabic ▾" / "árabe ▾"). Choosing another
language from its menu (the learner's languages first, then "Other language…" with search) runs a new job with
`hintLang` set to that language and the original `text`. When it succeeds, the previous
created words from that job are removed in the same step, and the line shows the new result
with Undo that restores the previous pair. Two clicks, no retyping.

### 7. Adding without the model

**Inline syntax.** The add box recognizes `native = meaning` (also `—`, `–`, ` - ` with
spaces, and a tab), the same rules [13](../13-bulk-add/SPEC.md) uses for one line, in any
base language. Optional romanization in parentheses after the native word: `спасибо
(spasibo) = thanks` or `спасибо (spasibo) = gracias`; text in parentheses shaped like a
respelling (`спасибо (spa-SEE-ba) = thanks`) is the pronunciation instead, by 13's rule. The meaning is the gloss in the
**primary base** (the first ticked "For pages in" chip, §8), so a Spanish reader types
"thanks = gracias" or "犬 = perro"; one record is saved. The word's language comes from
the language hint; if the hint is Auto, from Focus
([18](../18-language-precedence-and-mixing/SPEC.md)), then from the most recently added
language, and the result line names it with the chip so it can be changed. It can never be
the meaning's base ([50 §1](../50-ui-localization-and-base-language/SPEC.md)); when the
fallbacks would pick it, the picker opens instead. If the learner has no languages yet, the
hint opens with "Choose a language" and Enter opens the picker. Such adds never call the
model and work offline.

**Manual form.** "Add it yourself" (from a waiting or failed job, from the add box's menu, or
from the dashboard) opens a small form: native (required, `dir="auto"`), **Meaning in
{base}** (required; more forms separated by commas, or `、`/`，` for Japanese and Chinese
bases; one field per ticked base, only the first required), language (required, picker),
romanization (optional), pronunciation for readers of the primary base (optional,
checked with 09's rules for that base's respelling key; hidden when the base has none),
note (optional). Labels in Spanish: "Palabra", "Significado en español", "Idioma",
"Romanización", "Pronunciación", "Nota". Enter saves one record per filled meaning; a typed
pronunciation is saved on the primary base's record with `pronunciation_source: "user"`.
Records saved without a pronunciation get one later through 09's `respell` request, as a
background job when a provider is reachable (the same follow-up as
[13](../13-bulk-add/SPEC.md) section 5), so the manual add itself still never waits on the
model.
Prefilled from the job's text: the text goes into native, and the learner fills the
meaning.

Validation (shared with [09](../09-shared-word-spec-and-prompt/SPEC.md), using each base's
`spec/lang/<base>/` rules): native 1-64 characters, no newlines; forms at least 2
characters, or 1 for Chinese and Japanese bases; language not equal to the meaning's base;
native not equal to the meaning unless the learner confirms ("This is spelled the same as
the {base} word. Save anyway?" / "Se escribe igual que en {base}. ¿Guardar de todos
modos?").

### 8. Language hint and "For pages in"

A compact chip beside the add box: "Auto" by default; a menu of the learner's languages and
"Other language…". The choice persists for the session (`storage.session`) and resets to Auto
on browser restart. When Focus is on, the chip shows the focus language instead of Auto.

**For pages in** ("Para páginas en"): shown under the add box only when the learner has
two or more base languages. One checkbox chip per base, all ticked by default
([50 §3](../50-ui-localization-and-base-language/SPEC.md), open question 1), names in the
interface language. Unticking narrows the next add only and resets after it, so the
default stays "all my languages". At least one stays ticked. The job carries the result as
`baseLangs`. The welcome tab ([22](../22-first-run-onboarding/SPEC.md)) uses its own base
chips instead.

### 9. Drafts and unseen results

- The add box's text is saved to `storage.session` (`addDraft`) 300 ms after typing stops, and
  restored when the popup reopens; cleared on submit.
- Jobs that finished while no surface showed them have `seen: false`; the popup shows them
  first with a subtle "While you were away" label, then marks them seen.

### 10. Messages

Background message types (sender checks per [26](../26-background-sync-correctness/SPEC.md)):

| Type | Payload | Reply (immediate) |
|---|---|---|
| `add` | `{id, text, hintLang, pageLang?, baseLangs, surface}` | `{ok: true}` once persisted |
| `addManual` | `{id, native, lang, meanings: [{base_lang, gloss, forms?, pronunciation?}], romanization?, note?, surface}` | `{ok: true}`; one 07 record per meaning, `origin: "manual"`, via the structured add `{word, client_request_id}` (batch route for several) |
| `chooseWords` | `{id, keep: [index]}` | `{ok: true}` |
| `undo` | `{id, wordId}` | `{ok: true}` |
| `relang` | `{id, lang}` | `{ok: true, newId}` |
| `cancelJob`, `retryJob` | `{id}` | `{ok: true}` |

All UI renders from `addJobs` via `storage.onChanged`; replies never carry results. This is
what makes the popup closing harmless.

### 11. Privacy

`addJobs` holds the text the learner typed, locally, for at most 7 days; it is included in
"Delete all my data" ([12](../12-export-import-and-delete/SPEC.md)). The server's
`add_requests` table stores responses for 24 hours and is purged by 07's daily janitor.

## Implementation notes

Built 2026-10-05 (§§1-5, from slice 11's queue):

- **Every add is a job.** That includes a server that looks words up and keeps them, which
  until now went straight to the 0.2 `POST /api/words` and lost its result when the popup
  closed. The job uses the server's preview (`POST /api/v1/words` with `preview: true`),
  then saves through `/api/v1/words/batch` with the job's id as `client_request_id`. So
  §2's "Keep {k} words" exception isn't needed: nothing is saved before the learner picks.
  The saved words reach open pages at once, through the sync controller's `update` (06
  F10), checked like any server answer (03 E2).
- **needs_choice.** `CONFIRM_AT = 4` target words (a word with a record per base counts
  once). Candidates in the word's language's common-words list start unticked. The
  `jobs.choose` message carries the kept words' keys (language and spelling).
- **Undo** (`jobs.undo`) and "Add it back" (`jobs.redo`) run in the background through the
  dashboard's `words.write`, so both homes and the v1 ids are covered. Before this, Undo in
  server mode called `DELETE /api/words/:id` with a v1 UUID, which that route always
  refuses. An updated word is patched back to `previous` with
  `if_updated_at: word.updated_at`. A conflict reads "This word changed since. Open it to
  fix." The outcome (`undo`, `undoError`) is written on the job's records. "Add it back"
  restores the tombstone, or saves the word again on `word_gone` / `word_conflict`.
- **offline.** A network failure while the browser is offline is `offline`. It waits for
  the `online` event, with a 10-minute backstop picked up by the alarm, not a short timer.
- **Popup.** Lines are per target word:
  - created, with the primary base's pronunciation, else romanization;
  - updated, with "new forms: …";
  - unchanged, with Open;
  - several bases on one line ("perro · dog") with one Undo;
  - "No meaning in {base} yet." when a base is missing;
  - "While you were away" above jobs that finished with the popup closed;
  - Cancel on a lookup.

  The direct path (`state.jobs`, `runJob`) is gone.
`addJobs` lives in the background's IndexedDB store since SCR-448 (2026-10-06), with a
copy in `storage.local` that the popup renders from and that content scripts can no longer
change: a job written there is put back and never run (slice 28's notes).

Built 2026-10-05 (§§6-9):

- **Wrong language (§6).** The language on a created line is a chip. It opens the picker:
  the learner's languages first, then every language in `spec/languages.json` by name,
  own name or code. `jobs.relang {id, key, lang}` makes a new job with that hint
  (`replaces: {id, key}`). Once it's done, the old word is undone and its job marked
  `replacedBy`, so the popup shows only the new line. Undoing the new word brings the old
  one back.
- **Manual form (§7).** "Add it yourself" on waiting and failed lines opens the form in the
  line. `jobs.addManual` makes one record per filled meaning, through the queue with the
  words already made, so the model is never asked:
  - several forms separated by `,`, `、` or `，`;
  - the pronunciation only on the primary base's record, and the field shown only when
    that base has a respelling key;
  - the same checks in the form and in the background;
  - the same-spelling question asked once.

  The add box's own menu entry and the dashboard's entry for the form aren't built.
- **Inline syntax.** Focus on a single language is now the fallback after the hint. When
  the fallbacks would pick the base, the model is asked instead of opening the picker;
  the language chip then fixes it in two clicks.
- **Hint and "For pages in" (§8)** as specified, in `storage.session` (`addHint`).
  Unticking narrows the next add only.
- **Draft (§9)** in `storage.session` (`addDraft`), 300 ms after typing stops.
- **Speak button** on created lines when the device has a voice (34).
- **Loading (decided 2026-10-05, from research).** The popup starts from scratch on every
  open, so it loads only what the first view needs:
  - the voice library after the first frame;
  - `popup-more.js` (the picker and the form) on first use.

  Sources for this: Chrome's and V8's guidance on popups and script cost, web.dev on
  budgets, and Lighthouse's 4× CPU standard for mid-tier devices. First paint is the
  guard, with byte caps as a backstop:
  - 100 ms at 4× CPU locally, and 200 ms on CI's runners, which are about that slow;
  - a low-end guard at 6×, 150 ms;
  - caps: own files 80 KB, everything at open 128 KB, `popup-more` 32 KB.

  Measured: 34 ms at 1×, 80 ms at 4×, 120-124 ms at 6×, about the same as before this
  slice. A trace at 6× shows the popup's scripts are about 17 ms of the 120. The rest is
  the page's own start-up: navigation about 40 ms, HTML 25, styles 19, storage reads 14.
  Getting a low-end device under 100 ms is a separate change to that start-up: paint a
  shell before the scripts, merge the stylesheets.
- **Not yet:**
  - the dashboard showing pending jobs and offering "Add it yourself";
  - the add box's own menu.

## Acceptance criteria

- [ ] Re-adding an existing word shows "Already in your list" and no Undo; its note,
      romanization and forms are unchanged (regression test for 06 F05).
- [ ] Re-adding with new forms shows "Updated … new forms: …"; Undo restores the exact
      previous forms.
- [ ] Adding спасибо with base `en` shows "Added спасибо (spa-SEE-ba) = thanks" with a speak
      button when a Russian voice exists; with base `es`, "Agregada спасибо (spa-SI-ba) =
      gracias"; a word whose record has no pronunciation shows its romanization in the
      parentheses, and a Latin-script word with neither shows none.
- [ ] A job returning two words shows two lines with independent Undo buttons.
- [ ] After pressing Enter, the input is empty and focusable within 50 ms, before any network
      response.
- [ ] Closing the popup during a lookup and reopening it shows the finished result marked
      "While you were away".
- [ ] Killing the service worker mid-lookup and waking it retries the job with the same id,
      and exactly one word exists afterwards (server and local modes).
- [ ] Six parallel POSTs with the same `client_request_id` return six identical 200 responses and
      create one row.
- [ ] Undo against a server that returns an error shows "Couldn't undo" and keeps the Undo
      button (regression for 06 F30).
- [ ] "gracias = thanks" with the hint set to Spanish (base `en`) saves with no model call,
      offline; for a Spanish-base learner, "thanks = gracias" with the hint set to English
      saves `{lang: "en", native: "thanks", base_lang: "es", gloss: "gracias"}` the same way.
- [ ] With bases `es` and `en`, adding 犬 saves two records and shows one line "perro · dog"
      whose Undo removes both; unticking "inglés" before adding saves only the Spanish one.
- [ ] Adding "dog" for a Spanish-base learner saves `lang: "en"` with gloss "perro"; no
      record ever has `lang` equal to its own `base_lang`.
- [ ] A lookup whose words are all in the learner's base language fails with
      `rejected_same_as_gloss` and the 25 message in the interface language.
- [ ] With the browser in Spanish, every line, chip and action in §4 is Spanish.
- [ ] A lookup returning five words saves nothing until "Add 3 words" is pressed, and then
      saves exactly the three ticked.
- [ ] Changing the language chip on a result replaces the word in two clicks.
- [ ] A job in `waiting` because of `offline` completes on its own after the network returns.

## Test plan

- **Unit (Node):** the job state machine with a fake clock and fake backend: every transition
  in §2, backoff schedule, the 3-day expiry, the 4-word threshold (counted per target word,
  not per base record), per-base results and combined summary, the inline parser in `en`,
  `es` and `ja` bases (shared fixtures with 13), validation rules per base.
- **Server (ExUnit):** `client_request_id` idempotency including concurrent requests; created /
  updated / unchanged reporting; restore with `if_updated_at` conflict.
- **End-to-end (Playwright, unpacked extension, mock model server):** add, close popup, reopen;
  slow model (40 s) with worker termination via the DevTools protocol; offline toggling;
  Undo of each result type; relang; a two-base learner; the browser launched with
  `--lang=es`.
- **Manual:** Firefox and Chrome, a real free model, with the popup closed mid-add.

## Rollout and migration

- Ships with [07](../07-word-model-v2/SPEC.md) and the popup rewrite
  ([20](../20-popup-redesign/SPEC.md)). An old server without `/api/v1` is detected by a 404
  on that route and spoken to through the legacy `POST /api/words`, whose response has no
  per-word result; the extension then treats every word as
  `created` and hides Undo for words whose `created_at` is older than the request, so it never
  deletes an existing word.
- No stored data migrates; `addJobs` starts empty.
- Changelog: "Adding words never blocks: keep typing while Kotiko looks words up, see what was
  already in your list, and undo any single word."

## Open questions

1. **Confirm threshold.** Recommendation: confirm at 4 or more words; 1-3 save immediately
   with per-word Undo. This keeps the common case at one keystroke.
2. **Preview adds on the server.** Decided (follows from the full-control decision in
   DECISIONS.md): slice 07's `POST /api/v1/words` takes `"preview": true` (interpret and
   validate, save nothing, return candidates), so server-lookup mode confirms before saving
   exactly like local mode.
3. **Show "For pages in" chips on every add, or only in a menu?** Recommendation: show them
   under the add box for learners with two or more bases (everyone else never sees them);
   narrowing is rare but should be one tap, and seeing them explains why one add gives two
   meanings.
4. **How long Undo stays available.** Recommendation: as long as the job is listed (7 days),
   because wrong words are often noticed later.

## Future work

- An opt-in system notification ("Added perro · Spanish") when a job finishes with no Kotiko
  surface open (`notifications` as an optional permission).
- "Did you mean" alternatives on the result line ([36](../36-grammar-and-senses/SPEC.md)).
