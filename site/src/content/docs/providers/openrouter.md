---
title: OpenRouter
description: Get a free OpenRouter key and use it to look words up in Kotiko.
---

OpenRouter gives one key for many AI models, several of them free. It's Kotiko's default
and the easiest way to start: Kotiko uses only free models unless you choose another.

## Connect OpenRouter

The quickest way: Kotiko asks OpenRouter for a key for you, with nothing to copy.

1. On Kotiko's welcome page, select **Connect OpenRouter (free)**. Or open Kotiko's
   **Settings**, then **Word lookups**, choose **OpenRouter** and select **Connect
   OpenRouter**.
2. OpenRouter opens in a new tab. Sign in or create an account, and allow Kotiko's
   request.
3. OpenRouter sends you back to [kotiko.org/connect/](/connect/), which says "Connected"
   once Kotiko has the key. You can close that tab.

The page on kotiko.org has no scripts. Kotiko reads the one-time code in its address and
trades it with OpenRouter for your key; the code works only for the Kotiko that started
the sign-in, for 10 minutes. If the page says the sign-in expired, select **Connect
OpenRouter** again.

## Get a key

Or make a key yourself and paste it:


1. Open [OpenRouter's keys page](https://openrouter.ai/settings/keys) and sign in or create an
   account.
2. Select **Create API Key**. Give it a name you'll recognise, like "Kotiko".
3. Optional but wise: give the key a **credit limit**, so it can never spend more than you
   choose.
4. Copy the key. It starts with `sk-or-`. OpenRouter shows it only once.

## Paste it into Kotiko

1. Open Kotiko's **Settings** (from the toolbar popup), then **Word lookups**.
2. Under **Look words up with**, choose **OpenRouter**.
3. Paste the key into **OpenRouter key** and select **Save key**.
4. Select **Test**. "It works" means Kotiko can look words up.

Your key stays in this browser, where web pages can't read it. It's never copied to other
devices or into backups. Kotiko sends it only to OpenRouter, at `https://openrouter.ai/api/v1`.

## What the free tier allows

Checked on 6 October 2026, from [OpenRouter's limits](https://openrouter.ai/docs/api-reference/limits):

- 20 lookups a minute;
- 50 lookups a day, or 1,000 a day once you have bought at least $10 of credit (the free
  models stay free);
- the daily count resets at midnight UTC.

Kotiko's toolbar popup shows how many lookups are left once 20 or fewer remain, and a word
you add after that waits until the next day. Adding words as `word = meaning` never uses a
lookup.

## Your text and OpenRouter

OpenRouter passes the text you type to the company running the model, and some free models
are run by companies that may keep or train on it. **Only use services that don't keep my
text** in **Word lookups** asks OpenRouter for those that don't (fewer free models may be
available). See [OpenRouter's privacy policy](https://openrouter.ai/privacy) and
[Kotiko's privacy policy](/privacy/).
