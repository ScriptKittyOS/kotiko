# 48 · Multi-user and classroom

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P2 (later) |
| **Size** | L (several weeks) |
| **Depends on** | [07-word-model-v2](../07-word-model-v2/SPEC.md), [40-server-packaging-docker](../40-server-packaging-docker/SPEC.md); uses [13-bulk-add](../13-bulk-add/SPEC.md)'s parser and review table, [41](../41-telegram-improvements/SPEC.md)'s `profile`, and [50](../50-ui-localization-and-base-language/SPEC.md)'s base languages |
| **Unblocks** | None |
| **Sources** | [04 S9, S10, S11, S31](../../docs/research/04-architecture-release.md); [DECISIONS: Not a product; Local first; every word is one the learner chose](../DECISIONS.md) |

## Problem

One server has one word list. Every allowed Telegram ID writes into the same table
(`server/lib/slovo/bot.ex:83-95`; `server/lib/slovo/words.ex` has no owner column), there
is one API token for everything (`server/lib/slovo/router.ex:91-101`), and the "recent
languages" hint mixes everyone's words (`words.ex:34-43`). On a family server, a parent's
Japanese words show up on a child's pages ([04 S9](../../docs/research/04-architecture-release.md)).
A teacher can't give a class a set of words except by sending a file around for each student
to import ([04 S10](../../docs/research/04-architecture-release.md)).

Mira is a free self-hosted tool, not a hosted service ([DECISIONS](../DECISIONS.md)).
This slice is for people who run one server for a household or a classroom, on their own
machine.

## Goals

- Several people on one server, each with their own words, token(s) and Telegram link.
- A single-user server keeps working with no configuration change.
- A teacher can offer a word list to a class. Each student previews it and adds all of it,
  some words or none. **Nothing is added to a student's list until that student accepts
  it** ([DECISIONS](../DECISIONS.md)): no server or teacher action writes words into
  anyone's list.
- Nobody sees another person's words or activity except what a student explicitly shares
  with a teacher (aggregate only).
- One person can't spend the whole server's model quota.

## Non-goals

- A web admin UI: commands and API only at first; the dashboard (slice [21](../21-dashboard/SPEC.md))
  could add an admin page later.
- Passwords, email accounts or sign-up flows: identity is a token or a Telegram link
  created by the admin.
- Grades, due dates, progress tracking per student, or any browsing data.
- Hosting for schools: they run their own server (slice 40's Docker image).

## User stories

- As a parent running Mira at home, I want my children to have their own lists.
- As a teacher, I want to offer my class "Unit 3 animals" and have it waiting in their
  extensions tomorrow, ready to add with one or two clicks.
- As a student, I want to look at the list my teacher offered and add only the words I don't
  know yet, without my teacher seeing my whole list.
- As an English teacher in Puerto Rico, I want to offer "Unit 3 animals" as English words with
  Spanish meanings, so they appear in my students' Spanish pages.
- As a student in that class who reads Portuguese at home, I want the meanings in my own
  language, not the class's.
- As the server owner, I want to stop one person from using up the free lookups.

## Specification

### 1. Data model

```
users        (id UUID PK, name TEXT, role TEXT CHECK (role IN ('admin','member','teacher','student')),
              daily_lookup_limit INTEGER NULL, base_langs TEXT NOT NULL DEFAULT '[]',
              locale TEXT NULL, created_at, disabled_at NULL)
tokens       (id UUID PK, user_id FK, token_hash TEXT UNIQUE, prefix TEXT, label TEXT,
              created_at, last_used_at, revoked_at NULL)
words        + user_id FK NOT NULL; natural key becomes (user_id, lang, native_key, sense, base_lang)
               WHERE deleted_at IS NULL; seq stays global (cursors are per user, filtered)
telegram_users + user_id FK (slice 41's table)
lookup_cache + user_id (no cross-user cache hits; avoids revealing what others looked up)
classes      (id UUID PK, name, teacher_id FK users, join_code TEXT UNIQUE, created_at, archived_at)
class_members (class_id, user_id, joined_at, share_progress BOOLEAN DEFAULT false)
offers       (id UUID PK, class_id, title, base_lang TEXT NOT NULL,
              words JSON (slice 07 word objects, all with this base_lang),
              created_at, withdrawn_at NULL)
offer_views  (offer_id, user_id, opened_at NULL, dismissed_at NULL, added_count INTEGER
              DEFAULT 0)
```

- **Tokens** are 32 random bytes, Base64url (slice 01's format); stored as SHA-256 hashes
  (high-entropy tokens need no slow hash). `prefix` (first 6 characters) is shown in lists
  so people can tell tokens apart. Lookup is by hash, then `Plug.Crypto.secure_compare`
  on the hash.
- **Base languages and interface locale are per user**: slice 41's single-row `profile`
  moves into `users.base_langs`, and `telegram_users.locale` stays per Telegram account.
  `GET/PUT /api/v1/profile` reads and writes the current user's row.
- **Migration**: create user "Owner" (role `admin`), copy `profile.base_langs` into it,
  assign every word and every `telegram_users` row to it; the existing `API_TOKEN` / token file keeps working as the
  owner's token (compared as today, not stored in `tokens`). A server that never adds a
  second user behaves exactly as before.

### 2. Authentication and scoping

- `authorize` (slice 01) resolves the token to a user and puts `current_user` on the
  connection; disabled users and revoked tokens get 401.
- Every query in `Mira.Words` takes the user; there is no unscoped word function left
  (enforced by a test that greps for `Repo.all(Word)` and similar outside the scoped
  module). The recent-languages hint (slice 09) is per user.
- `GET /api/v1/me` → `{id, name, role, classes: [...]}` so the extension can show "Signed
  in as Ana".
- Telegram: a message is handled as the user linked to that Telegram ID. Slice 41's
  pairing and `/invite` codes now carry the target user; `mira user add` creates one.

### 3. Admin commands

Mix tasks with release equivalents (`Mira.Release.user_*`, slice 40):

```
mira user add "Ana" [--role member|teacher|student]   prints a pairing string (slice 01)
                                                     and a Telegram link code (slice 41)
mira user list                                       name, role, words, tokens, last used
mira user token "Ana" [--label laptop]               new token + pairing string
mira user revoke <token-prefix>
mira user disable "Ana" | enable "Ana"
mira user remove "Ana" --delete-words | --move-words-to "Owner"
mira user limit "Ana" 20                             daily model lookups
```

An admin API under `/api/v1/admin/users` (admin role only) exposes the same operations
for a future UI.

### 4. Quota fairness

- Each user has a daily lookup limit (`daily_lookup_limit`, default from
  `MIRA_USER_DAILY_LOOKUPS`, default 30; admins unlimited). Counted per UTC day in a small
  table; cache hits don't count. Over the limit: `user_quota_exhausted` with `retry_at`
  (slice 25 wording: "You've used today's 30 lookups on this server. Adding words
  yourself still works.").
- Slice 10's server-wide quota and concurrency limits still apply on top.

### 5. Classes and offered lists

- A teacher creates a class (`mira class add "7B" --teacher "Ms Ortiz"` or the admin
  API); it gets a join code. Students are added by the admin (`mira user add "Sam"
  --role student --class 7B`) or join with the code from the extension's server settings
  (`POST /api/v1/classes/join {code}`).
- A teacher offers a list from a file or a pasted list, parsed by slice
  [13](../13-bulk-add/SPEC.md)'s `parse.js`: `POST /api/v1/classes/:id/offers {title, words}`
  (teacher of that class only). Words are validated with slice 09's rules, using the
  offer's `base_lang` data; no model calls. The offer's `base_lang` is the language of its
  meanings, chosen by the teacher (default: the teacher's primary base language), so an
  English teacher in Puerto Rico offers `lang: "en"` words with `base_lang: "es"`
  ("dog = perro").
- **Offering never adds.** The server stores the offer and nothing else. No server code
  path writes an offered word into a student's word list; only the student's own accept
  does, through the same routes as any add. A test enforces this (Test plan).
- **What the student sees**: on their next sync, `GET /api/v1/classes/offers` returns open
  offers they haven't dismissed. The popup shows one quiet card, and the dashboard lists
  every open offer:

  ```
  ┌──────────────────────────────────────────┐
  │ Ms Ortiz offered “Unit 3 animals”        │
  │ 24 English words, meanings in Spanish    │
  │ [ Look at the list ]          Not now    │
  └──────────────────────────────────────────┘
  ```

  "Look at the list" opens slice 13's review table in the dashboard with every row
  **unticked**, the statuses 13 defines ("Already in your list" and so on), and "Tick all"
  in the header. The student ticks the words they want, or Tick all, then "Add {n} words":
  accepting the whole list is 3 steps (Look at the list, Tick all, Add), and any subset is
  one tick per word. Saving goes through 13's batch path with `origin: "bulk"`, so 07's merge
  rules apply (a student's existing word keeps their note and edits) and 13's Undo works.
  "Not now" hides the card; the offer stays in the dashboard's list until withdrawn.
- **When the offer's meanings aren't in a language the student reads** (offer `base_lang`
  `es`, student bases `["pt-BR"]`): the review table says so in its header ("Meanings in
  Spanish. You read Portuguese.") and offers two paths: "Look up meanings in Portuguese"
  runs slice 13's batched lookup for the ticked rows (under the student's quota, previewed
  before saving), or "Add with Spanish meanings", which saves them with `base_lang: "es"`
  and points to settings to add Spanish as a language the student reads (until they do,
  those words don't swap, per slice 50). Nothing is converted silently.
- **Withdrawing** an offer removes the card from students who haven't opened it. Words a
  student already added stay: they are the student's.
- **What the teacher sees**: per offer, counts only: how many students opened it, and, for
  students who turned on `share_progress`, how many of the offered words they added. Never
  which words, which pages students read, or their other words. Students see exactly what is
  shared, and can turn it off any time.

### 6. Privacy and safety

- The admin can see users and counts, not word contents, through the admin API. (The
  admin has the database file, so this is a courtesy boundary, stated plainly in the docs.)
- For schools, the docs (slice 44) say: run the server on the school's own machine, the
  data never leaves it except typed words going to the configured model provider; check
  local rules for minors' data; prefer a provider with no prompt retention, or no lookups at
  all (lookup kind "none", slice 11), where students add words with their meanings or from
  lists their teacher offers.
- Export and delete-all (slice 12) work per user; the admin can delete a user's data.

## Acceptance criteria

- [ ] An existing single-user database migrates to one admin user owning every word, and
      the existing token keeps working with identical API responses.
- [ ] With two users, neither can read, edit, delete or restore the other's words through
      any route, including by guessing a word id (404, not 403, to avoid confirming ids).
- [ ] Two users can each have "спасибо" in Russian.
- [ ] Revoking a token makes it fail immediately; other tokens of the same user keep working.
- [ ] A Telegram user linked to Ana adds words to Ana's list only.
- [ ] A user over their daily limit gets `user_quota_exhausted`; cache hits still work.
- [ ] An offer appears as a card for every class member after their next sync, and **no
      word is added to any student's list until that student accepts** (word lists compared
      before and after delivery).
- [ ] The review table opens with every row unticked; adding 3 of 24 words adds exactly
      those 3, without overwriting a student's existing note.
- [ ] An offer with `base_lang: "es"` shown to a student whose only base is `pt-BR` says the
      meanings are in Spanish, and saves nothing until the student chooses a lookup or
      "Add with Spanish meanings".
- [ ] Two users on one server keep separate base languages; each one's lookups ask the
      model for glosses in their own bases.
- [ ] Withdrawing an offer removes unopened cards and never removes words a student added.
- [ ] A teacher sees aggregate counts only, and only for students who opted in.

## Test plan

- ExUnit: scoping tests generated over every route × two users; migration test from a
  slice 07 database; token hashing, revocation, prefixes; quota counter with a fake clock;
  offer delivery, acceptance (all, some, none), withdrawal, opt-in reporting; a test that
  fails if any server code path other than the student's own add and batch routes writes
  to that student's words.
- A static test that fails if any `Mira.Words` query lacks a `user_id` condition.
- Manual: a two-person household on the Docker image; a mock class of five students with
  the extension pointed at one server.

## Rollout and migration

- Ships behind no flag; the migration is automatic and invisible to single-user servers.
- New commands documented in the server guide (slice 44). Changelog: "One Mira server can
  now host several people with separate word lists, and teachers can offer word lists to a
  class, which each student reviews and adds."

## Open questions

1. **Default daily lookups per user.** Recommendation: 30, which lets about 30 people
   share a key with $10 of credit (1,000 a day) without one person starving the rest.
2. **Can a teacher see which offered words a student added?** Recommendation: no; only the
   opt-in count. The learner owns their list.
3. **Admin visibility of word contents.** Recommendation: none through the API, with the
   docs being honest that the database owner can read the file.

## Future work

- An admin page in the dashboard.
- Family members offering lists to each other, built on the same offers (each one previewed
  and accepted by the person who receives it).
