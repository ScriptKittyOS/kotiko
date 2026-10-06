---
title: OpenAI
description: Use an OpenAI API key to look words up in Kotiko.
---

OpenAI's API is paid per request; each word costs a fraction of a cent. It's separate
from a ChatGPT subscription.

## Get a key

1. Open [OpenAI's API keys page](https://platform.openai.com/api-keys) and sign in.
2. Add a payment method or credit if your account has none.
3. Select **Create new secret key**, name it "Kotiko", and copy it. It starts with `sk-`.

## Paste it into Kotiko

1. Open Kotiko's **Settings** (from the toolbar popup), then **Word lookups**.
2. Under **Look words up with**, choose **OpenAI**.
3. Paste the key into **OpenAI key** and select **Save key**.
4. Select **Test**. "It works" means Kotiko can look words up.

Your key stays in this browser, where web pages can't read it. It's never copied to other
devices or into backups. Kotiko sends it only to OpenAI, at `https://api.openai.com/v1`.

Kotiko picks a small, inexpensive model (`gpt-4.1-mini`, else `gpt-4o-mini`). You can type
another model's name in **Word lookups**.

[OpenAI's pricing](https://openai.com/api/pricing/) · [OpenAI's privacy policy](https://openai.com/policies/privacy-policy)
