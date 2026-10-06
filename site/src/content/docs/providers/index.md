---
title: Choosing a service
description: Which AI service Kotiko can use to look words up, and how to choose.
---

Kotiko looks up the words you ask for with an AI service you choose, using your own key, or
with a model on your own computer. You don't need one: words typed as `word = meaning` work
without any.

| Service | Cost | Your text goes to | Guide |
|---|---|---|---|
| OpenRouter (recommended) | Free models, with daily limits | OpenRouter and the model's company | [Set up](/providers/openrouter/) |
| OpenAI | Paid per word, a fraction of a cent | OpenAI | [Set up](/providers/openai/) |
| Anthropic (beta) | Paid per word | Anthropic | [Set up](/providers/anthropic/) |
| Google Gemini | Free tier with limits, or paid | Google | [Set up](/providers/gemini/) |
| Groq | Free tier with limits, or paid | Groq | [Set up](/providers/groq/) |
| Ollama | Free | Nowhere: your own computer | [Set up](/providers/ollama/) |
| LM Studio | Free | Nowhere: your own computer | [Set up](/providers/lmstudio/) |
| Another service | Depends on it | That service | [Set up](/providers/custom/) |

If you run [your own Kotiko server](/server/), it can look words up for you instead: choose
**My Kotiko server**.

Whichever you choose, Kotiko sends only the text you typed to add a word, the languages you
read, and the names of up to five languages you recently added words in. It never sends the
page you were on. The [privacy policy](/privacy/) has the details.
