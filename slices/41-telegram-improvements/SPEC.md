# 41 · Telegram improvements

| | |
|---|---|
| **Status** | Section 9 built (2026-10-05), English only; see Implementation notes. Sections 1 to 8: Proposed |
| **Priority** | P1 (soon after release), except section 9 (the bot speaks the learner's language), which is P0 and ships with [50](../50-ui-localization-and-base-language/SPEC.md) |
| **Size** | M (about a week) |
| **Depends on** | [07-word-model-v2](../07-word-model-v2/SPEC.md) (including the pronunciation fields of its section 7); section 9 on [50-ui-localization-and-base-language](../50-ui-localization-and-base-language/SPEC.md), [08](../08-language-tags/SPEC.md) (names per locale) and [09](../09-shared-word-spec-and-prompt/SPEC.md) (`base_langs` in the request) |
| **Unblocks** | [48-multi-user-and-classroom](../48-multi-user-and-classroom/SPEC.md) (Telegram identities) |
| **Sources** | [DECISIONS 2026-10-02, pronunciation](../DECISIONS.md); [DECISIONS 2026-10-01, "English is not the base language"](../DECISIONS.md); [06 F17, F18, F33, F38](../../docs/research/06-adversarial-qa.md); [04 S27, S28](../../docs/research/04-architecture-release.md); [05 S18, S22](../../docs/research/05-learner-ux.md) |

## Problem

The Telegram bot is the maintainer's daily way to add words from the phone and the best
mobile story Kotiko has ([05 S18](../../docs/research/05-learner-ux.md)). Its edges are rough:

- **Setup needs two restarts.** With `ALLOWED_TELEGRAM_IDS` empty the bot tells anyone
  who writes to it their ID and asks them to edit `.env` and restart
  (`server/lib/slovo/bot.ex:83-91`, [04 S27](../../docs/research/04-architecture-release.md)).
  A non-numeric ID crashes boot (slice 29 fixes the crash).
- **`/remove` is a bulk delete.** `/remove thanks` deletes every word whose native,
  romanization or English matches, in every language, including pending ones, with no
  confirmation or undo (`bot.ex:159-168`, `server/lib/slovo/words.ex:92-99`). Reproduced:
  "thanks" matched three words, "да" two ([06 F18](../../docs/research/06-adversarial-qa.md)).
- **Invalid languages crash the handler.** `{:ok, w} = Words.upsert(...)` (`bot.ex:232`,
  `bot.ex:239`) raises on a changeset error; `safe_handle` then sends "Error: no match of
  right hand side value: ..." and the remaining words in the message are dropped
  ([06 F17](../../docs/research/06-adversarial-qa.md)). Echoing exception text to the chat
  (`bot.ex:75`) can also leak internals.
- **Pending rows pile up.** Every lookup saves a `pending` row (`bot.ex:239`) that is
  removed only if Skip is tapped ([06 F38](../../docs/research/06-adversarial-qa.md)).
- **Long messages fail silently.** Telegram rejects text over 4,096 characters; a long
  note, a long transcript echo (`bot.ex:188`) or `/languages` with many languages fails,
  and the error is ignored, so the word is saved but no card or Undo appears
  ([06 F33](../../docs/research/06-adversarial-qa.md)).
- **Buttons carry integer ids** (`bot.ex:228`, `bot.ex:242`), which slice 07 replaces
  with UUIDs; "del" deletes outright, so Undo can't restore.
- **The bot only speaks English, and assumes the learner does.** Every reply is a
  hard-coded English string (`bot.ex:28`: "Tap Add on a card and that word starts
  replacing its English on web pages"); cards show `native = english`
  (`bot.ex:145`, `bot.ex:291`); "Removed … Pages show the English again." (`bot.ex:171`).
  A Spanish speaker who writes "¿cómo se dice perro en japonés?" gets an English card with
  an English gloss that never matches their Spanish pages.
- **Polling errors**: a fixed 3 s sleep on any error (`bot.ex:58-61`); a 409 (another
  copy polling with the same token) loops forever with a generic log line.

## Goals

- Linking the bot to a server takes one message, no `.env` edit and no restart.
- No command deletes more than the user confirmed, and every delete can be undone.
- No model answer or Telegram error can crash a handler or leak internals into the chat.
- Every reply fits Telegram's limits.
- Pending lookups clean themselves up.
- The bot speaks the learner's language: every fixed string comes from
  `server/priv/locales/<locale>/messages.json` (English and Spanish at launch), lookups use
  the learner's base languages, and cards show glosses in those languages.

## Non-goals

- Several users with separate word lists: slice [48](../48-multi-user-and-classroom/SPEC.md).
  Members added here share the owner's list, as `ALLOWED_TELEGRAM_IDS` does today.
- Voice transcription changes.
- Model behaviour and error wording: slices [09](../09-shared-word-spec-and-prompt/SPEC.md), [10](../10-llm-client-resilience/SPEC.md), [25](../25-plain-language-errors/SPEC.md).

## User stories

- As a new self-hoster, I want to send the bot a code from my server log and be done.
- As a learner who sent `/remove thanks`, I want to pick which "thanks" to remove.
- As a learner who tapped Remove by mistake, I want Undo to bring the word back.
- As a learner adding by voice, I want a long transcript not to swallow my word card.
- As a learner in Puerto Rico whose Telegram is in Spanish, I want to write "¿cómo se dice
  perro en japonés?" and get a Spanish card (犬 · japonés, said "i-nu", = perro) with
  Spanish buttons.
- As a Spanish speaker learning Russian on my phone, I want the bot's card to tell me how
  to say спасибо the way Spanish is read ("spa-SI-ba"), like the extension does.
- As a bilingual reader of Spanish and English, I want one message to add a word for both
  my Spanish and my English pages.

## Specification

### 1. Pairing

- New table `telegram_users (telegram_id INTEGER PRIMARY KEY, role TEXT NOT NULL CHECK
  (role IN ('owner','member')), display_name TEXT, added_at TEXT NOT NULL)`. Slice 48 adds
  a `user_id` column.
- **Who is allowed**: anyone in `telegram_users`, plus `ALLOWED_TELEGRAM_IDS` (kept for
  existing installs; on boot, listed IDs are inserted as `owner` if the table is empty,
  else `member`, so the env var can later be removed).
- **Unclaimed bot** (no owner): at boot, generate a pairing code: 8 characters from an
  unambiguous alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`), shown as `ABCD-2345`, valid
  30 minutes, regenerated when it expires. Shown in:
  - the server log at info: "Telegram: send /start ABCD-2345 to your bot to link it";
  - `<data_dir>/telegram-pairing.txt` (mode 0600);
  - `GET /api/v1/telegram/pairing` (authenticated) → `{"code": "ABCD-2345",
    "expires_at": "...", "bot_username": "..."}`, so the extension's settings (slices 11
    and 21) can show it with a "Open in Telegram" link (`https://t.me/<bot>?start=ABCD2345`);
  - `mix kotiko.telegram pair` (and `Kotiko.Release.telegram_pair/0`, slice 40).
- `/start ABCD-2345` (also accepted without the hyphen and in lowercase, and as the deep
  link payload) from any user, if the code matches and hasn't expired: insert them as
  owner, invalidate the code, reply "Linked. Send me a word in any language." Wrong code:
  "That code didn't work. Check the server log for a fresh one." At most 5 wrong attempts
  per Telegram user per hour; after that, silence until the hour passes.
- **Strangers**: messages from anyone not allowed and not sending a valid `/start <code>`
  are ignored silently (no more "your ID is ..." replies to the world).
- **Inviting others** (owner only): `/invite` replies with a one-time member code, valid
  24 hours, and the deep link. `/members` lists members with a Remove button each (owner
  can't remove themselves).

### 2. Safe `/remove`

- Matching uses slice 07's `native_key` normalisation for native, plus case-folded
  romanization and `gloss` (in any base language; case-folded with the record's
  `base_lang` locale), against live words with status `active` or `paused` only
  (never pending or deleted).
- **No match**: "No saved word matches "<arg>"." (unchanged).
- **One match**: a card "Remove спасибо (spasibo) = thanks · Russian?" with [Remove]
  [Cancel] (Spanish: "¿Quitar спасибо (spasibo) = gracias · ruso?" [Quitar] [Cancelar]).
  A target word with records in several bases (slice 50) is one match, shown with every
  gloss ("犬 (inu) = perro · dog · Japanese"); Remove tombstones all of them and Undo
  restores all of them.
- **Several**: "Which one?" with one button per word (up to 10, then "and 4 more: be more
  specific"), each labelled `спасибо · Russian`.
- After removing: the card is edited to "Removed спасибо · Russian." with [Undo], which
  calls slice 07's `restore/1`. If the restore conflicts or the tombstone was scrubbed,
  the button answers "Can't undo any more".
- The card buttons' "Remove" on existing words (`bot.ex:227-229`) and "Undo" after add
  (`bot.ex:234-236`) use the same tombstone and restore path.

### 3. Callback data

`<action>:<uuid>` (`add`, `skip`, `del`, `undo`, `rm`, `cancel`, `member-rm`), at most
43 bytes, within Telegram's 64-byte limit. Callbacks from old messages with integer ids
are still resolved through the internal row id for one release. A callback for a word
that no longer exists answers "That word is already gone." (as today, `bot.ex:275-276`).

### 4. Robust handling (F17)

- Every save goes through slice 07's `Words.add/2`, which returns
  `{:ok, %{result: :created | :updated | :unchanged, word: w}}` or `{:error, reason}`.
  Each word in a message is handled independently; one rejection never drops the others.
- Cards reflect the result: created → "Added. It shows up on pages now." [Undo];
  unchanged → "Already in your list." [Remove]; updated → "Already in your list; added
  'thank you' to the forms." [Undo] (restores `previous`).
- Rejected words (slice 09's `rejected`) get one line each: "Skipped "spasibo": that looks
  like a spelling in Latin letters; try спасибо or say the language." (wording: slice 25).
- `safe_handle` replies with a generic message and a short reference, never the
  exception text: "Something went wrong on my side (ref 7F3A). The details are in the
  server log." The log line carries the same reference.

### 5. Message limits (F33)

- `Kotiko.Telegram.send_message/3` splits text over 4,000 characters at line breaks
  (falling back to a hard cut) into several messages; buttons attach to the last one.
  Errors from `sendMessage` are logged at warning with the method name and status
  (slice 29 redacts the token).
- Notes are already capped at 200 characters by slice 09. The voice transcript echo is
  truncated to 300 characters with "…".
- `/list` and `/languages` page at 20 lines with [Next] [Previous] buttons.

### 6. Pending cleanup (F38)

- Pending rows are server-local and never synced (slice 07). The janitor (slice 07's
  `Kotiko.Janitor`) hard-deletes pending rows older than 7 days.
- A tap on Add or Skip for an expired card: "That card expired. Send the word again."

### 7. Polling

- Backoff on errors: 3 s, doubling to 60 s, reset on success.
- `409 Conflict`: log once at error "Another copy of the bot is running with this token
  (409). Stop it, or this server won't receive messages.", then back off 60 s.
- `401` from Telegram (token revoked): log at error, stop polling, and keep the API
  running; `/health` stays ok, and slice 29's startup summary says "Telegram: token
  rejected".
- Unexpected response shapes are logged and skipped; the poller never crashes on them
  (slice 29's `start_permanent` would otherwise restart the whole server).

### 8. Copy

`/help` gains a first line naming Kotiko (slice 04) and lists `/invite` and `/members` for
the owner. `/start` without a code from an allowed user shows `/help`. Every string in this
spec is a key in `server/priv/locales/<locale>/messages.json` (section 9); the English
wording above is the `en` text, and the Spanish text ships with it.

### 9. The bot speaks the learner's language

Implements [50](../50-ui-localization-and-base-language/SPEC.md) for the bot. This section
is P0.

**Strings.** All bot text goes through `Kotiko.I18n.t(key, params, locale)` (50 section 8),
with keys prefixed `bot_` (`bot_help_intro`, `bot_card_added`, `bot_remove_confirm`,
`bot_rejected_latin_spelling`). Plurals use the same CLDR suffixes as the extension.
Language names come from `Kotiko.Lang.name(tag, locale)` (08), so a Spanish user sees
"japonés". Error lines use slice 25's codes mapped to bot keys.

**Which locale.** Per Telegram user, the first that applies:

1. An explicit choice: `/language es` (alias `/idioma`), stored in a new column
   `telegram_users.locale`; `/language auto` clears it.
2. The `language_code` Telegram sends with each update (`from.language_code`, an IETF tag
   from the user's Telegram app, sometimes absent), if a shipped locale matches it by
   primary subtag (`es-419` → `es`).
3. The learner's primary base language (below), if it is a shipped locale.
4. `en`, the source locale, with a one-line note in that locale's place once: "Kotiko isn't
   translated into <language> yet."

**Base languages on the server.** The server needs the learner's bases to ask the model
for the right glosses. A new single-row table `profile (id INTEGER PRIMARY KEY CHECK
(id = 1), base_langs TEXT NOT NULL, updated_at TEXT NOT NULL)` holds them, exposed as
`GET /api/v1/profile` and `PUT /api/v1/profile` (`{"base_langs": ["es", "en"]}`, each
through 08's `baseTagOf`, at most 4; 400 otherwise). The extension writes it whenever
`s:ui.baseLangs` changes while connected to a server (slice 11's connection, slice 39's
settings). Slice 48 moves the row to per-user. If the server has no profile yet, the bot
uses `baseTagOf(language_code)` from the first message and says so on the first card:
"Meanings in español. Change with /bases." `/bases es en` (alias `/idiomas_que_leo`) sets
the profile from Telegram.

**Lookups.** Each lookup sends the learner's text verbatim plus `base_langs` from the
profile (09's request contract). The model's reply language follows the language the
learner wrote in (09); cards show the word the way the popover does
([19](../19-word-popover/SPEC.md) section 1a), then one meaning line per base record:

```
犬 · japonés
i-nu
inu · Generado por IA
= perro
= dog
[Agregar] [Omitir]
```

```
пожа́луйста · ruso
pa-ZHAL-sta
Despacio: pa-ZHA-lu-sta
pozhaluysta · Generado por IA
= por favor
[Agregar] [Omitir]
```

- **Line 1** is `native_vocalized` for Russian, Ukrainian and Belarusian when present (the
  stress mark), else `native`, then the language name in the bot's locale.
- **Pronunciation in the learner's base language.** Line 2 is the `pronunciation` of one
  record: the one whose `base_lang` is the bot's locale when the learner reads that
  language, else the primary base's (the first in the profile). A Spanish-speaking learner
  reads the Spanish-key respelling (07 section 7), never the English one; other records'
  pronunciations are not shown, as in the popover. The capitals carry the stress (plain
  text, no formatting needed); Mandarin and Cantonese tone digits stay plain digits
  ("shie4-shie"), since Telegram has no raised text. The careful form follows as
  `bot_card_careful` ("Slowly: {pronunciation}" / "Despacio: {pronunciation}") when present.
- **Romanization and label.** Line 3 is the romanization, when present, followed by the
  source label in the bot's locale (`bot_pron_ai`: "AI-generated" / "Generado por IA",
  the same wording as 19; the "Checked" and "Differs" states once 49 runs on the server;
  none for the learner's own). With no romanization the label follows the pronunciation.
- With no pronunciation (a base without a respelling key), lines 2 and 3 shrink to the
  romanization alone, as in the popover. The bot has no audio.
- `/list` and `/remove` keep the compact `native (romanization)` form.
Tapping Add saves every base record of the card (slice 07's one record per base); pending
rows are per record and cleaned up together (section 6).

**Commands.** Telegram command names must be ASCII lowercase, so the canonical names stay
(`/remove`, `/list`, `/languages`, `/help`), with Spanish aliases (`/quitar`, `/lista`,
`/idiomas`, `/ayuda`). `setMyCommands` is called at boot once per shipped locale with
`language_code` set, so the command menu in a Spanish Telegram app shows Spanish
descriptions ("quitar — quitar una palabra de tu lista").

## Acceptance criteria

- [ ] On a fresh server with a bot token and no IDs configured, `/start <code>` from the
      log links the user without a restart; a wrong code is refused; a stranger's
      message gets no reply.
- [ ] The pairing code is available from `GET /api/v1/telegram/pairing` with the token
      and refused without it.
- [ ] `/remove thanks` with three matches shows three buttons and deletes only the chosen
      one; Undo restores it with the same id and note.
- [ ] A model answer with one invalid and one valid word saves the valid one and explains
      the other; no exception text reaches the chat.
- [ ] A 5,000-character reply arrives as two messages with buttons on the last.
- [ ] A pending row older than 7 days is gone after the janitor runs.
- [ ] A 409 from `getUpdates` produces the specific log line and a 60 s backoff.
- [ ] Existing `ALLOWED_TELEGRAM_IDS` users keep working after the update.
- [ ] A Telegram user whose updates carry `language_code: "es"` gets every reply, card,
      button and command description in Spanish; `/language en` switches to English.
- [ ] With profile `base_langs: ["es"]`, "¿cómo se dice perro en japonés?" yields a card
      "犬 · japonés / i-nu / inu · Generado por IA / = perro", and Add saves `{lang: "ja",
      base_lang: "es", gloss: "perro", pronunciation: "i-nu", pronunciation_source:
      "model"}`.
- [ ] With profile `["es", "en"]` and a Spanish Telegram app, a card for пожалуйста shows
      пожа́луйста, the Spanish-key pronunciation, "Despacio: …" and "pozhaluysta · Generado
      por IA", and no English-key respelling; with an English Telegram app it shows the
      `en` record's respelling.
- [ ] With profile `["es", "en"]`, one message yields one card with both glosses and Add
      saves two records; `/remove perro` finds the group and Undo restores both.
- [ ] No string literal in `server/lib/kotiko/bot.ex` reaches the chat outside
      `Kotiko.I18n.t/3` (slice 50's literal check, server variant).

## Test plan

- ExUnit with slice 02's `Req.Test` Telegram stub recording outgoing calls: locale
  resolution (each of the four steps), Spanish and English replies, `setMyCommands` per
  locale, profile routes, bilingual cards (including which record's pronunciation is
  shown for each locale and the careful and label lines); pairing
  (valid, expired, wrong, rate limit, deep-link payload), stranger silence, `/invite`,
  `/members`; `/remove` with 0, 1, 3 and 12 matches; callbacks with UUID and legacy
  integer data; per-word error handling; message splitting; polling backoff with a fake clock.
- Manual: link a real bot on a test server, remove and undo from a phone, send a long
  voice note.

## Rollout and migration

- Migration creates `telegram_users` (with `locale`) and `profile`, and seeds
  `telegram_users` from `ALLOWED_TELEGRAM_IDS`. `profile` starts empty; the extension
  fills it on its next sync, and the existing owner's words keep their `base_lang: "en"`
  from slice 07's migration.
- `.env.example`: `ALLOWED_TELEGRAM_IDS` becomes optional ("Leave empty and link the bot
  with the code from the server log").
- Changelog: "Link the Telegram bot by sending it a code from your server; no more
  editing .env. /remove now asks which word and can be undone. Long replies no longer
  get lost. The bot now speaks Spanish too, and gives meanings in the languages you read."

## Implementation notes

### Section 9 (built 2026-10-05)

English only ([DECISIONS 2026-10-05](../DECISIONS.md)): no Spanish catalog, no Spanish
command aliases (`/quitar`, `/lista`, `/idiomas`, `/ayuda`, `/idiomas_que_leo`). The
mechanism works for any locale a translator adds as `server/priv/locales/<locale>/`.
Sections 1 to 8 are not built; where section 9 needed a piece of one, it says so below.

**What was built**

- **Profile** (`server/lib/kotiko/profile.ex`, migration
  `20261030000000_bot_language.exs`): the single-row `profile` table as specified, plus a
  `ui_lang` column (below). `GET /api/v1/profile` answers `{"base_langs": [], "ui_lang":
  null, "updated_at": null}` while none is set (not a 404, which the extension would read
  as an outdated server). `PUT` takes 1 to 4 tags, each through `Kotiko.Lang.base_tag/1`
  (08's `baseTagOf`), duplicates dropped; anything else is `400 invalid_request` with
  `details.field` (`base_langs`, with `details.max`, or `ui_lang`) and the new messages
  `error_invalid_request_base_langs` and `error_invalid_request_ui_lang`. Documented in
  `docs/reference/http-api.md` and the README.
- **Per Telegram user** (`server/lib/kotiko/bot/prefs.ex`): a `telegram_prefs` table
  (`telegram_id`, `locale`, `noted`, `updated_at`) instead of a `locale` column on
  section 1's `telegram_users` (below).
- **Who the learner is** (`server/lib/kotiko/bot/learner.ex`): the learner's language is
  the first of `/language`, the profile's `ui_lang`, the update's `from.language_code` as a
  base tag, the primary base. The bot's locale is the first of those with a shipped catalog
  (`Kotiko.I18n.shipped/2`: the tag, then its primary subtag, `es-419` → `es`), else `en`.
  Base languages: the profile; without one `baseTagOf(language_code)`; without that the
  bases of the saved words, most words first (an existing install's `en`); without any,
  `en`. Every case but the profile is named once on the first card ("Meanings in español.
  Change with /bases.").
- **The bot** (`server/lib/kotiko/bot.ex`): every text from `Kotiko.I18n.t/3` with `bot_`
  keys (52 new English messages); language names from `Kotiko.Lang.name(tag, locale)`;
  lookups send `base_langs` from the learner; one card per target word with a meaning line
  per base record, primary first, laid out as in the spec (headword with
  `native_vocalized` where `spec/pronunciation.json` says `stress_marked`, the chosen
  record's pronunciation, `bot_card_careful`, romanization · `bot_pron_ai` or
  `bot_pron_checked` "Checked in Wiktionary" for `pronunciation_source: "wiktionary"`, as
  the popover does; nothing for the learner's own). Add activates every pending record of
  the card in the learner's bases; Skip deletes the pending ones; Remove and Undo
  tombstone every live record of the word. `/bases` (codes or names in any shipped
  locale) and `/language` (`auto` clears it) are new. `setMyCommands` runs at boot once per
  shipped locale (the default without `language_code`). The "isn't translated into
  <language> yet" note is shown once per Telegram user and language.
- **Errors in the chat**: a crash answers `error_internal_ref` with an 8-character
  reference that the error log line also carries, never the exception text; a word that
  can't be saved is logged the same way and the others on the card still go through; a
  failed voice note says so without the transcriber's reason (which goes to the log);
  lookup errors were already slice 25's catalog lines and now come in the learner's locale.
- **Section 3's callback data**, pulled in because the task asked for it: buttons carry
  `<action>:<uuid>` (at most 41 bytes); old cards' integer ids still resolve.
- **The extension** (`extension/background.js` `pushProfile()`/`sendProfile()`): `PUT
  /api/v1/profile` with `currentBases()` and `ui.uiLang` (null for `"auto"`), through
  `connection()` and `apiV1()`. Sent when an extension page asks with the new page-only
  message `profile.sync` (the dashboard after "Languages you read in" or "Kotiko's
  language" changes, the welcome page after its base chips change), after `server.connect`,
  and after each successful sync when what the server last got (IndexedDB `meta`
  `profileSent`, keyed by the server address) differs. The last one is how an existing
  install fills the profile without the learner doing anything, and how a failed send is
  tried again. A server without the route (404) is not asked again until the languages
  change. The popup is untouched.

**Decisions and deviations**

- **`ui_lang` in the profile.** The spec's profile has only `base_langs`; the task asked
  the bot to follow the interface language chosen in the extension too. It ranks after
  `/language` (an explicit choice in the chat) and before the Telegram app's language;
  "automatic" in the extension sends `null`, so the app's language decides.
- **`telegram_prefs`, not `telegram_users.locale`.** `telegram_users` has `role NOT NULL`
  and section 1's seeding rule (owner if the table is empty); creating rows from
  `/language` would have decided roles before pairing exists, and could have made a
  member the owner. Section 1 can fold the columns in, or keep the table.
- **The pronunciation follows the learner's language, not the bot's locale.** With only
  English shipped, a Spanish app gets English text; picking the record by the locale would
  have shown a Spanish reader the English-key respelling, which the spec forbids. The rule
  is the spec's with "the learner's language" (`wanted`) in place of "the bot's locale";
  they are the same whenever the learner's language is shipped.
- **The no-profile, no-`language_code` fallback** uses the saved words' bases before `en`,
  so an existing install behaves as before, and the card says which languages it used.
- **The guessed bases aren't stored** as the profile: the profile stays what the learner
  set (extension or `/bases`), and the extension's next sync fills it.
- **No plural keys**: the texts are worded around counts ("Your words: 12."); the server
  has no CLDR plural rules, and adding them is a translator-facing change for when a
  locale needs one.
- **`/list` and `/remove`** are unchanged in behaviour (section 2 owns the safe remove);
  their texts are catalog lines. `/remove` still removes every match.
- **The literal check** is an ExUnit test over `bot.ex`'s AST rather than a script: string
  literals outside log calls, docs and regexes must be identifier-like (keys, commands,
  Telegram field names) or have no letters; "Wiktionary" is allow-listed as a name.

**Acceptance criteria (section 9's)**

| Criterion | Status | Test (`server/test/kotiko/…` unless noted) |
|---|---|---|
| `language_code: "es"` gets every reply, card, button and command description in Spanish; `/language en` switches | Out of scope (English only). Mechanism met: the locale order with a shipped `es` (`["en", "es"]` passed in), `setMyCommands` per locale, `/language` | `bot_test.exs` "the locale: /language, then the extension's choice…", "the command menu is set once per shipped locale…", "/language chooses, /language auto follows the app again" |
| Profile `["es"]`: 犬 card `i-nu / inu · AI-generated / = perro`; Add saves `{ja, es, perro, i-nu, model}` | Met (English text: "Japanese", "AI-generated") | golden "a Spanish reader asks for a Japanese word" (`test/fixtures/bot/cards.json`) |
| Profile `["es","en"]`, Spanish app: пожа́луйста, the Spanish-key pronunciation, "Slowly: …", "pozhaluysta · AI-generated", no English-key respelling; English app: the `en` record's | Met | golden "…with a Spanish Telegram app sees the Spanish-key pronunciation", "…with an English Telegram app sees the English-key pronunciation" |
| Profile `["es","en"]`: one card with both glosses, Add saves two records | Met | the same two golden cases |
| `/remove perro` finds the group and Undo restores both | Not built: section 2 (safe `/remove`, Undo through `restore/1`) | — |
| No string literal in `bot.ex` reaches the chat outside `Kotiko.I18n.t/3` | Met | "no string literal in bot.ex could reach the chat outside Kotiko.I18n.t/3", "every bot_ key it uses has an English message" |
| (task) Errors in the chat are catalog lines with a reference, never exception text | Met | "a crash answers with a reference, never the exception's text", "a voice note that can't be transcribed says so, without the reason", "a model failure is reported in the chat" |
| (task) Buttons carry UUIDs | Met | "a lookup saves a pending word…", golden cases, "a button from a card sent before UUIDs (the row id) still works" |
| (task) A Japanese-base learner | Met | golden "a Japanese reader with no profile asks for a Spanish word" |
| (task) Existing installs: no profile behaves as before, except `language_code` | Met | `migration_bot_language_test.exs`; `bot_test.exs` "without a profile, the Telegram app's language, never an assumed English", "…an existing install keeps its words' bases" |
| (task) Profile routes, authenticated | Met | `profile_test.exs` |
| (task) The extension keeps the profile current | Met | `test/bg/background.test.mjs` "the learner's languages on the server (slice 41 §9)" (4 tests), `test/dom/dashboard.test.mjs` (two assertions), `test/dom/welcome.test.mjs` "with a server connected, its Telegram bot follows the change" |

## Open questions

1. **Should members be able to delete words?** They share the owner's list until slice 48.
   Recommendation: yes for now (today any allowed ID can), with Undo making it safe.
2. **Pairing code lifetime.** Recommendation: 30 minutes for the owner code, 24 hours for
   member invites.
3. **Spanish command aliases.** They make the bot friendlier but double the command
   surface. Recommendation: ship the four aliases above and show only the canonical names
   plus localized descriptions in the command menu.

## Future work

- Per-person word lists for members: slice 48.
- A daily "word of the day" message, opt-in, tied to slice 35's review.
- Inline mode (`@bot word` in any chat) for quick lookups.
