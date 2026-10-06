---
title: Another service
description: Use any OpenAI-compatible AI service to look words up in Kotiko.
---

Any service that speaks OpenAI's chat completions API works: a company not listed, a
model server on your network, or a proxy you run.

## Set it up

1. In Kotiko's **Settings**, **Word lookups**, choose **Custom** under **Look words up with**.
2. Enter the service's address, the part before `/chat/completions`, for example
   `https://api.example.com/v1`.
3. If it needs a key, paste it into **Key, if the service needs one** and select **Save key**.
4. Choose or type a model, then select **Test**.

Kotiko asks for JSON answers and, if the service refuses that option, asks again without it.
Your key is sent only to the address you entered. The service's own privacy policy applies to
what it receives.
