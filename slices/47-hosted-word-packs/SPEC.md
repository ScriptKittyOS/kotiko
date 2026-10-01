# 47 · Hosted word packs

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P2 (later) |
| **Size** | M (about a week) |
| **Depends on** | [23-starter-packs](../23-starter-packs/SPEC.md); uses [44-docs-site](../44-docs-site/SPEC.md) for hosting, [09-shared-word-spec-and-prompt](../09-shared-word-spec-and-prompt/SPEC.md) for validation, [12-export-import-and-delete](../12-export-import-and-delete/SPEC.md) for the server path |
| **Unblocks** | Teacher workflows before [48-multi-user-and-classroom](../48-multi-user-and-classroom/SPEC.md) |
| **Sources** | [04 S10, S11, S18, S31](../../docs/research/04-architecture-release.md); [05 S4, open question 6](../../docs/research/05-learner-ux.md) |

## Problem

Slice 23 bundles a few curated packs inside the extension. That is the right first-run
experience, but it means:

- adding or fixing a pack waits for an extension release and store review;
- a teacher can't hand a class a list of words without every student typing them, which
  also burns the free model quota (50 requests a day without credit,
  [04 S18](../../docs/research/04-architecture-release.md));
- a learner can't remove a pack's words as a unit once they're mixed with their own.

Static files on GitHub Pages cost nothing, need no accounts and carry no model calls
([04 S11, S31](../../docs/research/04-architecture-release.md)).

## Goals

- The org publishes packs as static JSON on the docs site, updated without an extension
  release.
- Anyone can share a pack as an https link; learners preview it before anything is added.
- A learner can subscribe to a pack and receive its updates without losing their own edits.
- Removing a pack removes exactly the words that came only from it and that the learner
  hasn't changed.
- Two devices importing the same pack never create duplicates.

## Non-goals

- The pack format, curation rules, licensing and the preview UI: slice
  [23](../23-starter-packs/SPEC.md). This slice adds hosting, URLs, subscriptions and
  removal.
- Per-student assignment and tracking: slice [48](../48-multi-user-and-classroom/SPEC.md).
- A pack marketplace with ratings or uploads through a website.

## User stories

- As a beginner, I want to browse the org's packs on the website and add one with a click.
- As a teacher, I want to publish this week's 20 words as a link my students open.
- As a learner subscribed to "Spanish basics", I want the fix to a wrong word to reach me,
  without undoing my own note on another word.
- As a learner done with a pack, I want to remove it without touching words I added myself.

## Specification

### 1. Pack files

A hosted pack is exactly slice 23's pack document (`schemaVersion`, `id`, `version`,
`lang`, `title`, `license`, `authors`, `reviewers`, `words[]` with a stable `key` per
word), validated by slice 23's `spec/pack.schema.json`. This slice adds three optional
top-level fields to that schema:

| Field | Meaning |
|---|---|
| `publisher` | Who publishes it, for example `scriptkittyos` or a teacher's name; with `id` it forms the pack's identity, so two publishers can both have an `es-starter` |
| `updatedAt` | ISO date of this version |
| `homepage` | Optional page describing the pack |

Org packs use slice 23's content licence (CC0 1.0 recommended there); third-party packs
may use any licence, which the preview shows.

**Hosting** (org packs): source files in `packs/` in the main repo; slice 44's site build
validates them and publishes `/<site>/packs/v1/<id>.json` plus `/packs/v1/index.json`
(id, title, languages, word count, version, license, URL). The `/packs/` page renders
the index with an "Add to Mira" button per pack. Third-party packs live anywhere that
serves https, such as a GitHub Gist's raw URL.

**Limits**: 2 MB per file, 2,000 entries per pack, https only (plus `http://localhost` for
authors testing locally), JSON content.

### 2. Adding a pack by link

The dashboard's Packs view (slice 21) has "Add a pack from a link":

1. Fetch from the background with `credentials: "omit"`, a 10 s timeout and the size cap.
2. Validate with the pack schema, then each entry with slice 09's word validator.
   Invalid entries are listed and left out.
3. Show slice 23's preview, with the source: "From scriptkittyos.github.io · reviewed by
   ScriptKittyOS" for the org's site, or "From gist.githubusercontent.com · Mira hasn't
   reviewed this pack" for anything else. Every word can be unticked.
4. Commit in one transaction. No model calls.

**One-click from the docs site.** The content script already runs on every page. Only on
the docs site's origin and `/packs/` path, it handles clicks on `a[data-mira-pack]` by
sending `{type: "pack.preview", url}` to the background, which opens the preview page.
The page still requires the learner to confirm. Other sites can only link to the pack
file; the learner pastes the link.

### 3. Pack membership and ids

- A word created from a pack gets slice 07's `pack_id` and a new optional field this
  slice adds to `spec/word.schema.json`: `pack_ref: {version, key, base_hash}`, where
  `base_hash` is a hash of the entry's fields as imported. The server stores `pack_ref`
  as a JSON column (a small migration in this slice), so server mode keeps it.
- Word ids for pack entries are deterministic: UUIDv5 of `"<publisher>/<pack id>/<word key>"` in a
  fixed Mira namespace. Two devices that add the same pack create the same ids, so slice
  39's sync sees one word, not a natural-key conflict.
- If the learner already has the word (same natural key), it keeps its id and has no
  `pack_id`; fields merge by slice 07's rules. The installed pack's record (in the store's
  `meta`) maps each entry `key` to the word id it landed on, so updates and removal know
  which words are the pack's.

### 4. Subscriptions and updates

A "Keep up to date" checkbox in the preview (default on for org packs, off for others).

- A daily alarm checks subscribed packs with `If-None-Match` / `If-Modified-Since`. Only
  one check per pack per day, jittered by up to an hour.
- On a new `version`, compare entries by `key`:
  - **New entry**: added, unless the learner had removed that key before (remembered in
    the subscription's `removedKeys`).
  - **Changed entry**: applied if the word has this `pack_id` and its fields still hash
    to `base_hash` (the learner hasn't edited it); otherwise left alone and listed as
    "kept your edit".
  - **Removed entry**: the word is deleted if it has this `pack_id` and is untouched;
    otherwise only the entry mapping is dropped and the word stays.
- The popup shows one quiet line: "Spanish basics updated: 4 new words, 2 fixes. Review".
  Review opens the dashboard filtered to those words, with Undo for 24 hours.

### 5. Removing a pack

The Packs view lists installed packs with word counts. "Remove pack" explains:

```
Remove "Spanish basics"?
  48 words will be removed.
   2 words you edited will stay, no longer linked to this pack.
   5 words you also have from elsewhere will stay.
                                     [Cancel]  [Remove 48 words]
```

Removal is one transaction with slice 21's Undo toast.

### 6. Server mode

With words on a server (slices 11 and 39), pack words are written through the server's
batch route (slice 07, as slice 12 uses it) with their deterministic ids, `pack_id` and `pack_ref`, so Telegram and
other devices see them. Subscription checks run in the extension; with slice 39 several
devices may check the same pack, and deterministic ids make their updates idempotent.

### 7. Safety

Packs are data only, rendered as text everywhere (no HTML). Slice 09's validator caps
lengths and rejects stopword forms, so a malicious pack can't rewrite "the" on every page.
Fetching a pack reveals the learner's IP address to its host, which slice 28's policy
already states.

## Acceptance criteria

- [ ] A pack published under `packs/` appears on `/packs/` and in `index.json` after the
      site deploys, without an extension release.
- [ ] Adding a pack by link shows the source and review status, and nothing is written
      before confirmation.
- [ ] A pack with a stopword form ("the") or a 500-character native has those entries
      rejected and listed.
- [ ] Adding the same pack on two synced devices yields one copy of each word.
- [ ] An update fixes an untouched word, leaves an edited word as edited, and adds new
      entries except ones the learner removed.
- [ ] Removing a pack leaves edited words and words also added elsewhere, and Undo
      restores everything removed.
- [ ] Clicking "Add to Mira" on `/packs/` opens the preview; the same markup on another
      origin does nothing.

## Test plan

- **Unit** (slice 02): schema validation; deterministic ids; `pack_ref` round trip
  through the server; update diffing for every
  case in section 4; removal accounting in section 5.
- **CI**: validation of every file in `packs/` with the schema and slice 09's validator,
  unique `id`s and `key`s, required license fields.
- **End-to-end** (Playwright): a local static server hosting a pack at two versions;
  add, subscribe, update, edit, update again, remove, undo; the docs-site click handler on
  an allowlisted and a non-allowlisted origin.

## Rollout and migration

- Bundled starter packs (slice 23) gain `id`s and `key`s and become "installed packs" on
  update, so they can be removed as a unit and, if the learner opts in, updated from the
  site.
- Changelog: "Add word packs from the Mira website or any link, keep them up to date, and
  remove a whole pack in one step."

## Open questions

1. **Subscribe by default for org packs?** Recommendation: yes, because fixes to curated
   packs should reach people, and edited words are never overwritten.
2. **Packs in the main repo or a separate `mira-packs` repo?** Recommendation: the main
   repo while packs are org-authored under CC0; move to a separate repo if
   share-alike sources (for example Wiktionary-derived lists) are ever added, to keep
   licences apart.

## Future work

- A small pack editor page that exports the JSON for teachers.
- Packs with audio or images.
- Assignment and per-student progress (slice 48).
