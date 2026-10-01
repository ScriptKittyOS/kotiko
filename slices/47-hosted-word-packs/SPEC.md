# 47 · Hosted word packs

| | |
|---|---|
| **Status** | **Dropped** (2026-10-01, maintainer decision) |
| **Priority** | None |
| **Size** | None |
| **Depends on** | None |
| **Unblocks** | None |
| **Sources** | [DECISIONS: no starter packs or word packs](../DECISIONS.md#2026-10-01) |

## Why dropped

This slice planned word lists hosted on the docs site that learners could import or
subscribe to by URL, and remove as a unit. The maintainer decided against word lists of any
kind:

> "That would never be helpful for real people. I only know certain words. I want to have
> full control and add either one at a time or bulk, no one wants to have to somehow delete
> words or have to find them."

Kotiko never adds a word the learner didn't explicitly choose: no bundled lists, no hosted or
subscribed lists, nothing pushed by a server or a teacher without the learner accepting it.
See [DECISIONS.md](../DECISIONS.md#2026-10-01).

## What replaces it

- **Bulk add, [13](../13-bulk-add/SPEC.md):** anyone with a list, including one a teacher
  handed out, pastes it or drops the file, reviews every row, and saves only what they keep.
- **First run, [22](../22-first-run-onboarding/SPEC.md):** the welcome tab starts from the
  learner's own first word.
- **Import, [12](../12-export-import-and-delete/SPEC.md):** a learner's own backup or export
  file, never a list published by someone else.
- **Classrooms, [48](../48-multi-user-and-classroom/SPEC.md):** a teacher can offer a list;
  each student previews it and accepts words one by one or all at once. Nothing is added
  until the student accepts.
