---
title: Choosing the server's model
description: Which AI models the Kotiko server asks, and how to use another service or a local model.
---

`LLM_URL` takes any OpenAI-compatible API; it is OpenRouter unless you change it. Leave
`LLM_MODEL` empty to use OpenRouter's current free models: the server reads OpenRouter's model
list once a day, keeps the ones that can answer in JSON, and asks them in the order the last
evaluation found best (`spec/models.json`).

`LLM_MODEL` is a comma-separated list used exactly as given, in order: when one is busy or
finds nothing, the next one gets the word. An add answers within 25 seconds and asks at most 3
models; a word looked up before is answered from a 30-day cache. Each lookup is logged with
the model that answered, never with the words.

For [Ollama](/providers/ollama/) on the same machine:

```
LLM_URL=http://localhost:11434/v1
LLM_MODEL=<a model from `ollama list`>
LLM_API_KEY=
```

`GET /api/v1/llm/status` shows the models in use and, with OpenRouter, how many free lookups
are left today. See the [API reference](/server/api/).
