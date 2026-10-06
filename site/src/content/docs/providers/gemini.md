---
title: Google Gemini
description: Use a Google Gemini API key to look words up in Kotiko.
---

Google's Gemini API has a free tier with its own daily limits, and a paid tier.

## Get a key

1. Open [Google AI Studio's API key page](https://aistudio.google.com/apikey) and sign in with a
   Google account.
2. Select **Create API key** and copy it.

## Paste it into Kotiko

1. Open Kotiko's **Settings** (from the toolbar popup), then **Word lookups**.
2. Under **Look words up with**, choose **Google Gemini**.
3. Paste the key into **Google Gemini key** and select **Save key**.
4. Select **Test**. "It works" means Kotiko can look words up.

Your key stays in this browser, where web pages can't read it. It's never copied to other
devices or into backups. Kotiko sends it only to Google Gemini, at `https://generativelanguage.googleapis.com/v1beta/openai`.

On Google's free tier, Google may use what you send to improve its products, and people may
read it. See [the Gemini API terms](https://ai.google.dev/gemini-api/terms) and
[Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing).
