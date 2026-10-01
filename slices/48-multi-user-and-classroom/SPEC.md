# 48 · Multi-user and classroom

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P2 (later) |
| **Size** | L (several weeks) |
| **Depends on** | [07-word-model-v2](../07-word-model-v2/SPEC.md), [40-server-packaging-docker](../40-server-packaging-docker/SPEC.md) |
| **Unblocks** | None |
| **Sources** | [04 S9, S10, S11, S31](../../docs/research/04-architecture-release.md); [DECISIONS: Not a product; Local first](../DECISIONS.md) |

## Problem

One server has one word list. Every allowed Telegram ID writes into the same table
(`server/lib/slovo/bot.ex:83-95`; `server/lib/slovo/words.ex` has no owner column), there
is one API token for everything (`server/lib/slovo/router.ex:91-101`), and the "recent
languages" hint mixes everyone's words (`words.ex:34-43`). On a family server, a parent's
Japanese words show up on a child's pages ([04 S9](../../docs/research/04-architecture-release.md)).
A teacher can't give a class a set of words except by sending a pack file around
([04 S10](../../docs/research/04-architecture-release.md)).

Mira is a free self-hosted tool, not a hosted service ([DECISIONS](../DECISIONS.md)).
This slice is for people who run one server for a household or a classroom, on their own
machine.

## Goals

- Several people on one server, each with their own words, token(s) and Telegram link.
- A single-user server keeps working with no configuration change.
- A teacher can assign word sets to a class; students get them on their next sync and
  keep control of their own lists.
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
- As a teacher, I want to give my class "Unit 3 animals" and have it appear in their
  extensions tomorrow.
- As a student, I want to remove an assigned word I already know without my teacher seeing
  my whole list.
- As the server owner, I want to stop one person from using up the free lookups.

## Specification

### 1. Data model

```
users        (id UUID PK, name TEXT, role TEXT CHECK (role IN ('admin','member','teacher','student')),
              daily_lookup_limit INTEGER NULL, created_at, disabled_at NULL)
tokens       (id UUID PK, user_id FK, token_hash TEXT UNIQUE, prefix TEXT, label TEXT,
              created_at, last_used_at, revoked_at NULL)
words        + user_id FK NOT NULL; natural key becomes (user_id, lang, native_key, sense)
               WHERE deleted_at IS NULL; seq stays global (cursors are per user, filtered)
telegram_users + user_id FK (slice 41's table)
lookup_cache + user_id (no cross-user cache hits; avoids revealing what others looked up)
classes      (id UUID PK, name, teacher_id FK users, join_code TEXT UNIQUE, created_at, archived_at)
class_members (class_id, user_id, joined_at, share_progress BOOLEAN DEFAULT false)
assignments  (id UUID PK, class_id, title, words JSON (slice 07 word objects, as in a pack),
              created_at, withdrawn_at NULL)
```

- **Tokens** are 32 random bytes, Base64url (slice 01's format); stored as SHA-256 hashes
  (high-entropy tokens need no slow hash). `prefix` (first 6 characters) is shown in lists
  so people can tell tokens apart. Lookup is by hash, then `Plug.Crypto.secure_compare`
  on the hash.
- **Migration**: create user "Owner" (role `admin`), assign every word and every
  `telegram_users` row to it; the existing `API_TOKEN` / token file keeps working as the
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
  (slice 25 wording: "You've used today's 30 lookups on this server. Packs and adding
  words yourself still work.").
- Slice 10's server-wide quota and concurrency limits still apply on top.

### 5. Classes and assignments

- A teacher creates a class (`mira class add "7B" --teacher "Ms Ortiz"` or the admin
  API); it gets a join code. Students are added by the admin (`mira user add "Sam"
  --role student --class 7B`) or join with the code from the extension's server settings
  (`POST /api/v1/classes/join {code}`).
- A teacher creates an assignment from a pack file (slice 23/47's format) or a list of
  words: `POST /api/v1/classes/:id/assignments {title, words}` (teacher of that class only).
  Words are validated with slice 09's rules; no model calls.
- **Delivery**: on each student's next request (sync or add), assignments not yet
  materialised for that student are added with slice 07's `add/2`, `origin: "assignment"`
  and `pack_id: "assignment:<id>"`, so merge rules apply: a student's existing word keeps
  their note and edits. Materialisation is recorded per (assignment, student) so it
  happens once; a word the student deleted is not re-added.
- **Withdrawing** an assignment removes its words from students who haven't edited them
  (same as removing a pack, slice 47); edited words stay.
- **What the teacher sees**: per assignment, counts only: how many students received it,
  and, for students who turned on `share_progress`, how many of the words are still
  active versus paused or removed. Never which pages students read, never their other
  words. Students see exactly what is shared, and can turn it off any time.

### 6. Privacy and safety

- The admin can see users and counts, not word contents, through the admin API. (The
  admin has the database file, so this is a courtesy boundary, stated plainly in the docs.)
- For schools, the docs (slice 44) say: run the server on the school's own machine, the
  data never leaves it except typed words going to the configured model provider; check
  local rules for minors' data; prefer a provider with no prompt retention, or packs only
  (lookup kind "none", slice 11).
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
- [ ] An assignment appears in every class member's list after their next sync, once,
      without overwriting a student's existing note, and isn't re-added after the student
      deletes it.
- [ ] A teacher sees aggregate counts only, and only for students who opted in.

## Test plan

- ExUnit: scoping tests generated over every route × two users; migration test from a
  slice 07 database; token hashing, revocation, prefixes; quota counter with a fake clock;
  assignment materialisation, idempotency, withdrawal, opt-in reporting.
- A static test that fails if any `Mira.Words` query lacks a `user_id` condition.
- Manual: a two-person household on the Docker image; a mock class of five students with
  the extension pointed at one server.

## Rollout and migration

- Ships behind no flag; the migration is automatic and invisible to single-user servers.
- New commands documented in the server guide (slice 44). Changelog: "One Mira server can
  now host several people with separate word lists, and teachers can assign word sets to
  a class."

## Open questions

1. **Default daily lookups per user.** Recommendation: 30, which lets about 30 people
   share a key with $10 of credit (1,000 a day) without one person starving the rest.
2. **Should a student's assigned words be removable?** Recommendation: yes; the learner
   owns their list, and the teacher sees only opt-in counts.
3. **Admin visibility of word contents.** Recommendation: none through the API, with the
   docs being honest that the database owner can read the file.

## Future work

- An admin page in the dashboard.
- Shared family lists (a list several users subscribe to), built on assignments.
- Class word packs published to GitHub Pages (slice 47) and subscribed to by URL.
