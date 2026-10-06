---
title: Troubleshooting
description: Common problems with Kotiko and how to fix them.
---

Most problems have a message in Kotiko. Find yours in [Messages and what to do](/help/errors/).
The answers below cover what has no message.

## Kotiko swaps no words on a page

- **Is the page in a language you read?** Kotiko only swaps words on pages written in your
  languages. The toolbar popup says when a page is in another one, with **I read … too** to add
  it.
- **Is it paused here?** The toolbar popup shows **Paused on** the site, with **Resume**.
- **Is it on?** **Swap words on pages** in the toolbar popup turns it on and off everywhere.
- **Does the page have your words?** Kotiko swaps a word only where the page uses it. Try a
  page you know has one, like a Wikipedia article.
- **Is it a browser page?** Kotiko can't run on the browser's own pages (settings, the new tab
  page, extension stores).
- **Is it a bank, payment, health, government or email page?** Kotiko leaves those alone on
  purpose. The popup says so and offers **Swap words here anyway**.

## A site acts strangely

Some sites don't like their text being changed. Select **Pause on this site** in the toolbar
popup. If the page keeps undoing Kotiko's changes, Kotiko steps back on its own and says so.

## Find on page doesn't find a swapped word

Find on page searches the words the page is written with. Turn Kotiko off for a moment from
the toolbar popup when you need to search.

## The wrong language was picked

Undo the word, then add it again naming the language: `da in Serbian`.

## Starting over, backups and deleting

See [Your data](/use/your-data/).

## Still stuck?

[Open an issue](https://github.com/ScriptKittyOS/kotiko/issues) and say what you did and what
you saw. If Kotiko showed a message, select **Details**, then **Copy details**, and paste them
in: they never contain your words. To report a security problem, follow the [security
policy](https://github.com/ScriptKittyOS/kotiko/security/policy) instead.
