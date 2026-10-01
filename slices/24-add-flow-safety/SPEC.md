# 24 · Add flow safety

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P0 (before public release) |
| **Size** | M (about a week) |
| **Depends on** | [07-word-model-v2](../07-word-model-v2/SPEC.md) |
| **Unblocks** | [13-bulk-add](../13-bulk-add/SPEC.md), [20-popup-redesign](../20-popup-redesign/SPEC.md), [21-dashboard](../21-dashboard/SPEC.md), [22-first-run-onboarding](../22-first-run-onboarding/SPEC.md), [33-context-menu-and-shortcuts](../33-context-menu-and-shortcuts/SPEC.md) |
| **Sources** | [05 S7, S8, S9, S10, S13, S19](../../docs/research/05-learner-ux.md); [06 F05, F06, F09, F12, F30](../../docs/research/06-adversarial-qa.md); [01 S22](../../docs/research/01-language-mixing.md) |

## Problem

Adding a word is Mira's most frequent action, and today it can lose data, hide what
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

## Goals

- Every add reports, per word, whether it was **created**, **updated** or **unchanged**,
  using the result from [07](../07-word-model-v2/SPEC.md)'s upsert.
- Undo is per word and restores the previous state: created words are removed, updated words
  go back to their previous version, unchanged words have no Undo. Undo reports its own
  failure.
- No add ever blocks the UI. The input clears at once and accepts the next word; lookups run
  in a persistent background queue that survives the popup closing and the worker restarting.
- Adds are idempotent: a retry with the same client id never creates a duplicate or a 500.
- A learner can always add a word without the model, in one line ("gracias = thanks") or a
  small form.
- Inputs that produce four or more words ask before saving.

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

- As a learner who re-adds "gracias" by accident, I want Mira to tell me I already have it
  and to keep my note, so that nothing I wrote is lost.
- As a learner adding several words in a row, I want to type the next one while the first is
  still being looked up, so that I'm never waiting.
- As a learner who closed the popup too early, I want to see what was added when I reopen
  it, so that I don't add it twice.
- As a learner whose free lookups ran out, I want to type "gracias = thanks" and have it
  saved anyway.
- As a learner who got the wrong language, I want to fix it from the result line in one
  click.

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
  manual: null,           // {native, english, lang, romanization?, note?} for manual adds
  state: "queued",        // queued | looking_up | waiting | needs_choice | done | failed | cancelled
  createdAt: 1727771234567,
  startedAt: null,
  attempts: 0,
  error: null,            // {code, details: {reason?, retry_at?, ...}} per 25
  candidates: null,       // words found, before saving, in needs_choice
  results: [              // after saving
    { wordId, result: "created" | "updated" | "unchanged",
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
  [11](../11-local-first-mode/SPEC.md)'s client with the job's `hintLang` (or `pageLang`)
  and the learner's recent languages, under [10](../10-llm-client-resilience/SPEC.md)'s
  overall deadline. In server mode it calls `POST /api/v1/words` with
  `{text, client_request_id: job.id, hint_lang}` ([07 §5](../07-word-model-v2/SPEC.md)).
- **Saving:** words are written through [07](../07-word-model-v2/SPEC.md)'s merge-not-overwrite
  `add`, which returns `created | updated | unchanged` and, for `updated`, `previous` (the
  full word before the merge). In server mode the response's `results` carry both; in local
  mode [11](../11-local-first-mode/SPEC.md)'s store returns the same shape. Words the
  validator rejects ([09](../09-shared-word-spec-and-prompt/SPEC.md) `rejected`) are listed
  in the job with their reason.
- **Four or more words:** if the lookup returns 4+ words (09 caps an add at 5), nothing is
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
- **failed:** for `no_word_found`, `rejected_english`, `input_too_long`, `key_rejected`,
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
words are in `<bdi lang="…">`. Exact copy:

| State / result | Line | Actions |
|---|---|---|
| queued, looking_up | "Looking up {text}…" | "Cancel" |
| created | "Added {native} ({romanization}) = {english} · {Language}" | "Undo", language chip |
| updated | "Updated {native} = {english} · {Language}: {what changed}" where what changed is e.g. "new forms: thank you" | "Undo" |
| unchanged | "Already in your list: {native} = {english} · {Language}" | "Open" (dashboard at that word) |
| needs_choice | "Found {n} words in “{text}”." then a checklist | "Add {k} words", "Cancel" |
| waiting | "Waiting to look up {text}: {short reason from 25}" | "Add it yourself", "Cancel" |
| failed | "{message from 25}" | "Add it yourself", "Try again" where it can help |
| undo done (created) | "Removed {native}." | "Add it back" |
| undo done (updated) | "Put {native} back as it was." | none |
| undo failed | "Couldn't undo: {message from 25}" | "Try again" |

Romanization in parentheses is omitted when null. `{Language}` is the display name from
[08](../08-language-tags/SPEC.md).

```
Popup, three jobs in different states (360 px wide):

  ┌────────────────────────────────────────────┐
  │ [ Add a word, any language        ] [Auto▾]│
  │                                            │
  │  Looking up xie xie…               Cancel  │
  │  Added شكرا (shukran) = thanks             │
  │        [Arabic ▾]                   Undo   │
  │  Already in your list: gracias = thanks    │
  │        Spanish                      Open   │
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

The language on a created result is a chip ("Arabic ▾"). Choosing another language from its
menu (the learner's languages first, then "Other language…" with search) runs a new job with
`hintLang` set to that language and the original `text`. When it succeeds, the previous
created words from that job are removed in the same step, and the line shows the new result
with Undo that restores the previous pair. Two clicks, no retyping.

### 7. Adding without the model

**Inline syntax.** The add box recognizes `native = english` (also `—`, `–`, ` - ` with
spaces, and a tab), the same rules [13](../13-bulk-add/SPEC.md) uses for one line. Optional
romanization in parentheses after the native word: `спасибо (spasibo) = thanks`. The
language comes from the language hint; if the hint is Auto, from Focus
([18](../18-language-precedence-and-mixing/SPEC.md)), then from the most recently added
language, and the result line names it with the chip so it can be changed. If the learner has
no languages yet, the hint opens with "Choose a language" and Enter opens the picker. Such
adds never call the model and work offline.

**Manual form.** "Add it yourself" (from a waiting or failed job, from the add box's menu, or
from the dashboard) opens a small form: native (required, `dir="auto"`), English (required;
more forms separated by commas), language (required, picker), romanization (optional), note
(optional). Enter saves. Prefilled from the job's text: if the text is not Latin script it
goes into native; otherwise into native too, and the learner fills English.

Validation (shared with [09](../09-shared-word-spec-and-prompt/SPEC.md)): native 1-64
characters, no newlines; English forms at least 2 letters; language not `en`; native not equal
to English unless the learner confirms ("This is spelled the same as the English. Save
anyway?").

### 8. Language hint

A compact chip beside the add box: "Auto" by default; a menu of the learner's languages and
"Other language…". The choice persists for the session (`storage.session`) and resets to Auto
on browser restart. When Focus is on, the chip shows the focus language instead of Auto.

### 9. Drafts and unseen results

- The add box's text is saved to `storage.session` (`addDraft`) 300 ms after typing stops, and
  restored when the popup reopens; cleared on submit.
- Jobs that finished while no surface showed them have `seen: false`; the popup shows them
  first with a subtle "While you were away" label, then marks them seen.

### 10. Messages

Background message types (sender checks per [26](../26-background-sync-correctness/SPEC.md)):

| Type | Payload | Reply (immediate) |
|---|---|---|
| `add` | `{id, text, hintLang, pageLang?, surface}` | `{ok: true}` once persisted |
| `addManual` | `{id, native, english, lang, romanization?, note?, surface}` | `{ok: true}`; saved as 07 `origin: "manual"` via the structured add `{word, client_request_id}` |
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

## Acceptance criteria

- [ ] Re-adding an existing word shows "Already in your list" and no Undo; its note,
      romanization and forms are unchanged (regression test for 06 F05).
- [ ] Re-adding with new forms shows "Updated … new forms: …"; Undo restores the exact
      previous forms.
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
- [ ] "gracias = thanks" with the hint set to Spanish saves with no model call, offline.
- [ ] A lookup returning five words saves nothing until "Add 3 words" is pressed, and then
      saves exactly the three ticked.
- [ ] Changing the language chip on a result replaces the word in two clicks.
- [ ] A job in `waiting` because of `offline` completes on its own after the network returns.

## Test plan

- **Unit (Node):** the job state machine with a fake clock and fake backend: every transition
  in §2, backoff schedule, the 3-day expiry, the 4-word threshold, the inline parser (shared
  fixtures with 13), validation rules.
- **Server (ExUnit):** `client_request_id` idempotency including concurrent requests; created /
  updated / unchanged reporting; restore with `if_updated_at` conflict.
- **End-to-end (Playwright, unpacked extension, mock model server):** add, close popup, reopen;
  slow model (40 s) with worker termination via the DevTools protocol; offline toggling;
  Undo of each result type; relang.
- **Manual:** Firefox and Chrome, a real free model, with the popup closed mid-add.

## Rollout and migration

- Ships with [07](../07-word-model-v2/SPEC.md) and the popup rewrite
  ([20](../20-popup-redesign/SPEC.md)). An old server without `/api/v1` is detected by a 404
  on that route and spoken to through the legacy `POST /api/words`, whose response has no
  per-word result; the extension then treats every word as
  `created` and hides Undo for words whose `created_at` is older than the request, so it never
  deletes an existing word.
- No stored data migrates; `addJobs` starts empty.
- Changelog: "Adding words never blocks: keep typing while Mira looks words up, see what was
  already in your list, and undo any single word."

## Open questions

1. **Confirm threshold.** Recommendation: confirm at 4 or more words; 1-3 save immediately
   with per-word Undo. This keeps the common case at one keystroke.
2. **Preview adds on the server.** Decided (follows from the full-control decision in
   DECISIONS.md): slice 07's `POST /api/v1/words` takes `"preview": true` (interpret and
   validate, save nothing, return candidates), so server-lookup mode confirms before saving
   exactly like local mode.
3. **How long Undo stays available.** Recommendation: as long as the job is listed (7 days),
   because wrong words are often noticed later.

## Future work

- An opt-in system notification ("Added perro · Spanish") when a job finishes with no Mira
  surface open (`notifications` as an optional permission).
- "Did you mean" alternatives on the result line ([36](../36-grammar-and-senses/SPEC.md)).
