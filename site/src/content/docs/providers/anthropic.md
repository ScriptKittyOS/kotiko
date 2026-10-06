---
title: Anthropic
description: Use an Anthropic API key to look words up in Kotiko (beta).
---

Anthropic's API is paid per request. Kotiko reaches it through Anthropic's OpenAI
compatibility layer, which Anthropic describes as meant for testing, so this choice is marked
**beta**.

## Get a key

1. Open [the Anthropic Console's keys page](https://console.anthropic.com/settings/keys) and
   sign in.
2. Add credit if your account has none.
3. Select **Create Key**, name it "Kotiko", and copy it. It starts with `sk-ant-`.

## Paste it into Kotiko

1. Open Kotiko's **Settings** (from the toolbar popup), then **Word lookups**.
2. Under **Look words up with**, choose **Anthropic**.
3. Paste the key into **Anthropic key** and select **Save key**.
4. Select **Test**. "It works" means Kotiko can look words up.

Your key stays in this browser, where web pages can't read it. It's never copied to other
devices or into backups. Kotiko sends it only to Anthropic, at `https://api.anthropic.com/v1`.

Kotiko uses `claude-haiku-4-5` unless you type another model's name in **Word lookups**.

[Anthropic's pricing](https://www.anthropic.com/pricing) · [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy)
