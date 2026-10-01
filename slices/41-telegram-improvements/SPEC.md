# 41 · Telegram improvements

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P1 (soon after release) |
| **Size** | S (a day or two) |
| **Depends on** | [07-word-model-v2](../07-word-model-v2/SPEC.md) |
| **Unblocks** | [48-multi-user-and-classroom](../48-multi-user-and-classroom/SPEC.md) (Telegram identities) |
| **Sources** | [06 F17, F18, F33, F38](../../docs/research/06-adversarial-qa.md); [04 S27, S28](../../docs/research/04-architecture-release.md); [05 S18, S22](../../docs/research/05-learner-ux.md) |

## Problem

The Telegram bot is the maintainer's daily way to add words from the phone and the best
mobile story Mira has ([05 S18](../../docs/research/05-learner-ux.md)). Its edges are rough:

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
- **Polling errors**: a fixed 3 s sleep on any error (`bot.ex:58-61`); a 409 (another
  copy polling with the same token) loops forever with a generic log line.

## Goals

- Linking the bot to a server takes one message, no `.env` edit and no restart.
- No command deletes more than the user confirmed, and every delete can be undone.
- No model answer or Telegram error can crash a handler or leak internals into the chat.
- Every reply fits Telegram's limits.
- Pending lookups clean themselves up.

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
  - `mix mira.telegram pair` (and `Mira.Release.telegram_pair/0`, slice 40).
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
  romanization and English, against live words with status `active` or `paused` only
  (never pending or deleted).
- **No match**: "No saved word matches "<arg>"." (unchanged).
- **One match**: a card "Remove спасибо (spasibo) = thanks · Russian?" with [Remove] [Cancel].
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

- `Mira.Telegram.send_message/3` splits text over 4,000 characters at line breaks
  (falling back to a hard cut) into several messages; buttons attach to the last one.
  Errors from `sendMessage` are logged at warning with the method name and status
  (slice 29 redacts the token).
- Notes are already capped at 200 characters by slice 09. The voice transcript echo is
  truncated to 300 characters with "…".
- `/list` and `/languages` page at 20 lines with [Next] [Previous] buttons.

### 6. Pending cleanup (F38)

- Pending rows are server-local and never synced (slice 07). The janitor (slice 07's
  `Mira.Janitor`) hard-deletes pending rows older than 7 days.
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

`/help` gains a first line naming Mira (slice 04) and lists `/invite` and `/members` for
the owner. `/start` without a code from an allowed user shows `/help`.

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

## Test plan

- ExUnit with slice 02's `Req.Test` Telegram stub recording outgoing calls: pairing
  (valid, expired, wrong, rate limit, deep-link payload), stranger silence, `/invite`,
  `/members`; `/remove` with 0, 1, 3 and 12 matches; callbacks with UUID and legacy
  integer data; per-word error handling; message splitting; polling backoff with a fake clock.
- Manual: link a real bot on a test server, remove and undo from a phone, send a long
  voice note.

## Rollout and migration

- Migration creates `telegram_users` and seeds it from `ALLOWED_TELEGRAM_IDS`.
- `.env.example`: `ALLOWED_TELEGRAM_IDS` becomes optional ("Leave empty and link the bot
  with the code from the server log").
- Changelog: "Link the Telegram bot by sending it a code from your server; no more
  editing .env. /remove now asks which word and can be undone. Long replies no longer
  get lost."

## Open questions

1. **Should members be able to delete words?** They share the owner's list until slice 48.
   Recommendation: yes for now (today any allowed ID can), with Undo making it safe.
2. **Pairing code lifetime.** Recommendation: 30 minutes for the owner code, 24 hours for
   member invites.

## Future work

- Per-person word lists for members: slice 48.
- A daily "word of the day" message, opt-in, tied to slice 35's review.
- Inline mode (`@bot word` in any chat) for quick lookups.
