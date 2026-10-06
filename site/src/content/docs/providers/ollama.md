---
title: Ollama
description: Look words up with a model running on your own computer, through Ollama.
---

[Ollama](https://ollama.com) runs AI models on your own computer. Nothing you type leaves it,
and there is no key and no daily limit. You need a computer that can run a model well; small
models make more mistakes with rare words.

## Set it up

1. Install Ollama and download a model, for example `ollama pull llama3.1`.
2. Ollama only answers web pages and extensions it trusts. Start it with Kotiko allowed:

   ```sh
   OLLAMA_ORIGINS=chrome-extension://*,moz-extension://* ollama serve
   ```

   If Ollama runs as a background service, set `OLLAMA_ORIGINS` in that service's settings
   instead ([Ollama's FAQ](https://docs.ollama.com/faq) explains
   how on each system), then restart it.
3. In Kotiko's **Settings**, **Word lookups**, choose **Ollama** under **Look words up with**.
   The address is `http://localhost:11434/v1`.
4. Choose your model, then select **Test**.

If **Test** can't reach Ollama, it is either not running or not started with
`OLLAMA_ORIGINS` as above.
