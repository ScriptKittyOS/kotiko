# 23 · Starter packs

| | |
|---|---|
| **Status** | **Dropped** (2026-10-01, maintainer decision) |
| **Priority** | None |
| **Size** | None |
| **Depends on** | None |
| **Unblocks** | None |
| **Sources** | [DECISIONS: no starter packs or word packs](../DECISIONS.md#2026-10-01) |

## Why dropped

This slice planned curated word lists bundled in the extension ("40 Spanish starter words")
so a new learner would see swaps before adding anything. The maintainer decided against it:

> "That would never be helpful for real people. I only know certain words. I want to have
> full control and add either one at a time or bulk, no one wants to have to somehow delete
> words or have to find them."

Mira never adds a word the learner didn't explicitly choose: no bundled lists, no hosted or
subscribed lists, nothing added on the learner's behalf. See
[DECISIONS.md](../DECISIONS.md#2026-10-01).

## What replaces it

- **Bulk add, [13](../13-bulk-add/SPEC.md):** a learner who already has a list (a textbook
  page, a teacher's handout, an Anki deck) pastes it or drops the file, reviews every row,
  and saves only what they keep.
- **First run, [22](../22-first-run-onboarding/SPEC.md):** the welcome tab starts from the
  learner's own first word, typed or pasted, and shows it swapping in a live preview. Words
  typed as "gracias = thanks" need no key and no network.
- **Import, [12](../12-export-import-and-delete/SPEC.md):** a learner's own backup or export
  file brings back their own words on a new browser.
