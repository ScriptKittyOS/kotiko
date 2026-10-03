// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The extension's own lookup client (slice 11 section 4, slice 10's rules): calls any
// OpenAI-compatible chat API straight from the background with the learner's own key,
// through the presets of spec/providers.json, and checks every answer with slice 09's
// pipeline (lib/wordspec.js) before anything is saved. The JavaScript twin of
// Kotiko.LLM: cache -> quota gate -> chain -> attempts (lib/llm/policy.js) -> wordspec.
//
//   const client = KotikoLLMClient.createClient({ fetch, store, settings, key, now });
//   await client.lookup({text, base_langs, hint_lang, recent}, {signal, fresh})
//     -> {ok: true, result, model, cache} | {ok: false, error: {code, details}}
//   await client.respell(items)            the pronunciation refresh (slice 07 section 8)
//   await client.test()                    one small lookup for the settings' Test button
//   await client.status()                  {provider, quota, models, models_source, skipped}
//   await client.quotaLow()                 the reset time when 10 or fewer are left, else null
//
// `settings()` resolves to {provider, baseUrl, model, dataCollection}; `key(providerId)`
// to the stored key or null (the background reads it from the store's secrets; nothing
// here logs or keeps it). Failures carry slice 25's codes: lookup_not_set_up, key_rejected,
// quota_exhausted, rate_limited, model_unavailable, lookup_timeout, bad_lookup_result.
(() => {
  const S = () => globalThis.KOTIKO_SPEC;
  const Policy = () => globalThis.KotikoLLMPolicy;
  const Catalog = () => globalThis.KotikoLLMCatalog;
  const WordSpec = () => globalThis.KotikoWordSpec;

  const NO_WORD = new Set(["no_word_found", "rejected_same_as_gloss", "bad_lookup_result"]);
  const DAY = 86_400_000;

  const coded = (code, details = {}) => ({ code, details });
  const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });

  function preset(id) {
    const p = S().providers;
    return p.providers.find((x) => x.id === id) ?? p.providers.find((x) => x.id === p.default);
  }

  async function sha256(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  const nextMidnight = (ms) => {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  };

  function createClient({
    fetch = globalThis.fetch?.bind(globalThis),
    store = null,
    settings,
    key,
    now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    timeScale = 1,
    onQuota = () => {},
  }) {
    const policy = () => S().models.policy;
    const scaled = (ms) => Math.round(ms * timeScale);
    const unscaled = (ms) => Math.round(ms / timeScale);
    const health = Catalog().createHealth({ now });
    const catalogs = new Map(); // cache key -> {fetched_at, entries, caps} | {fetched_at, ids}
    const inflight = new Map(); // lookup cache key -> promise
    let quota = null; // {used, limit, remaining, is_free_tier, fetched_at, resets_at, estimated}
    let quotaLoaded = false;
    let promptHash = null;

    async function config() {
      const s = (await settings()) ?? {};
      const p = preset(s.provider);
      const baseUrl = String(s.baseUrl || p.baseUrl || "").trim().replace(/\/+$/, "");
      const k = await key(p.id);
      return {
        preset: p,
        baseUrl,
        model: typeof s.model === "string" && s.model.trim() ? s.model.trim() : null,
        key: typeof k === "string" && k ? k : null,
        openrouter: p.id === "openrouter",
        deny: s.dataCollection === "deny",
      };
    }

    function notSetUp(cfg) {
      if (!cfg.baseUrl) return coded("lookup_not_set_up", { reason: "no_url" });
      if (cfg.preset.keyRequired && !cfg.key) return coded("lookup_not_set_up", { reason: "no_key" });
      return null;
    }

    function headers(cfg, json = false) {
      const h = { ...(cfg.preset.extraHeaders ?? {}) };
      if (json) h["Content-Type"] = "application/json";
      if (cfg.key) h.Authorization = `Bearer ${cfg.key}`;
      return h;
    }

    // fetch with a timeout and an outer signal; transport failures become outcomes.
    async function call(url, init, timeoutMs, signal) {
      const ctl = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ctl.abort();
      }, Math.max(1, timeoutMs));
      const onAbort = () => ctl.abort();
      signal?.addEventListener?.("abort", onAbort, { once: true });
      try {
        if (signal?.aborted) throw abortError();
        const res = await fetch(url, { ...init, signal: ctl.signal, cache: "no-store", credentials: "omit" });
        const text = await res.text();
        let body = text;
        try {
          body = JSON.parse(text);
        } catch {
          // not JSON; kept as text for the classifier
        }
        return { status: res.status, headers: Object.fromEntries(res.headers?.entries?.() ?? []), body };
      } catch (e) {
        if (signal?.aborted) throw abortError();
        return { transport: timedOut ? "timeout" : "network", detail: String(e?.message ?? e) };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener?.("abort", onAbort);
      }
    }

    async function getJson(cfg, path, timeoutMs, signal) {
      const r = await call(`${cfg.baseUrl}${path}`, { method: "GET", headers: headers(cfg) }, timeoutMs, signal);
      if (r.transport) return { error: r.transport };
      if (r.status !== 200 || !r.body || typeof r.body !== "object") return { error: `answered ${r.status}`, status: r.status };
      return { body: r.body };
    }

    // ── models ───────────────────────────────────────────────────────

    async function remembered(name) {
      if (catalogs.has(name)) return catalogs.get(name);
      const saved = store ? await store.meta.get(name).catch(() => null) : null;
      if (saved) catalogs.set(name, saved);
      return saved;
    }

    async function remember(name, value) {
      catalogs.set(name, value);
      if (store) await store.meta.set(name, value).catch(() => {});
    }

    async function openrouterChain(cfg, kind, signal, budgetMs) {
      const name = `catalog:openrouter:${cfg.baseUrl}`;
      const rules = policy().catalog;
      let cat = await remembered(name);
      const fresh = cat && now() - cat.fetched_at < rules.refresh_ms;
      const tooOld = cat && now() - cat.fetched_at > rules.cache_max_age_ms;
      if (!fresh && !(cat?.failedAt && now() - cat.failedAt < 3_600_000)) {
        const r = await getJson(cfg, "/models", Math.min(scaled(rules.timeout_ms), budgetMs), signal);
        if (r.body && Array.isArray(r.body.data)) {
          const f = Catalog().filter(r.body.data, now());
          cat = { fetched_at: now(), entries: f.entries, caps: f.caps };
          await remember(name, cat);
        } else if (cat) {
          cat = { ...cat, failedAt: now() };
          catalogs.set(name, cat);
        } else catalogs.set(name, { fetched_at: 0, entries: [], caps: {}, failedAt: now() });
      }
      const usable = cat && !tooOld && cat.entries?.length ? Catalog().ordered(cat.entries, kind) : null;
      return { models: usable ?? Catalog().fallback(cat?.caps ?? {}), source: usable ? "live" : "fallback" };
    }

    async function endpointChain(cfg, signal, budgetMs) {
      const name = `catalog:${cfg.preset.id}:${cfg.baseUrl}`;
      let cat = await remembered(name);
      if (!cat || now() - cat.fetched_at > DAY) {
        const r = await getJson(cfg, "/models", Math.min(scaled(policy().catalog.timeout_ms), budgetMs), signal);
        if (r.body && Array.isArray(r.body.data)) {
          cat = { fetched_at: now(), ids: r.body.data.map((m) => m?.id).filter((id) => typeof id === "string") };
          await remember(name, cat);
        } else if (!cat) {
          return { models: [], source: "none", error: r.error };
        }
      }
      const prefer = cfg.preset.prefer ?? [];
      const ids = prefer.length ? (prefer.filter((id) => cat.ids.includes(id)).length ? prefer.filter((id) => cat.ids.includes(id)) : prefer) : cat.ids;
      return { models: ids.map((id) => ({ id, caps: modelCaps(cfg, id) })), source: "endpoint" };
    }

    const modelCaps = (cfg, id) => ({ ...Catalog().defaultCaps(id, { openrouter: cfg.openrouter, json: cfg.preset.jsonMode === "json_object" }), free: cfg.preset.free === true || String(id).endsWith(":free") });

    async function chain(cfg, kind, signal, budgetMs) {
      if (cfg.model) return { models: [{ id: cfg.model, caps: modelCaps(cfg, cfg.model) }], source: "settings", explicit: true };
      let c;
      if (cfg.preset.modelSource === "openrouter-free") c = await openrouterChain(cfg, kind, signal, budgetMs);
      else if (cfg.preset.modelSource === "models-endpoint") c = await endpointChain(cfg, signal, budgetMs);
      else c = { models: (cfg.preset.prefer ?? []).slice(0, 1).map((id) => ({ id, caps: modelCaps(cfg, id) })), source: "preset" };
      return { ...c, models: health.chain(c.models, kind) };
    }

    // ── quota (OpenRouter with a key: free lookups left today) ─────────────

    const quotaEnabled = (cfg) => cfg.openrouter && !!cfg.key;

    async function loadQuota() {
      if (quotaLoaded) return;
      quotaLoaded = true;
      const saved = store ? await store.meta.get("quota:openrouter").catch(() => null) : null;
      if (saved && !quota) quota = saved;
    }

    function snapshot() {
      if (!quota || (quota.resets_at && now() >= quota.resets_at)) return null;
      return quota;
    }

    async function setQuota(q) {
      quota = q;
      if (store) await store.meta.set("quota:openrouter", q).catch(() => {});
      onQuota(publicQuota());
    }

    async function refreshQuota(cfg, timeoutMs = scaled(policy().quota.timeout_ms), signal) {
      if (!quotaEnabled(cfg) || timeoutMs <= 0) return snapshot();
      const r = await getJson(cfg, "/key", timeoutMs, signal);
      const data = r.body?.data;
      if (!data || typeof data !== "object") return snapshot();
      const daily = data.free_model_daily_requests;
      const int = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.trunc(Number(v)) : null);
      const at = now();
      if (daily && typeof daily === "object") {
        await setQuota({ used: int(daily.used), limit: int(daily.limit), remaining: int(daily.remaining), is_free_tier: data.is_free_tier ?? null, fetched_at: at, resets_at: nextMidnight(at), estimated: false });
      } else {
        await setQuota(null);
      }
      return snapshot();
    }

    async function maybeRefreshQuota(cfg) {
      await loadQuota();
      if (!quotaEnabled(cfg)) return;
      const q = quota;
      const stale = !q || (q.resets_at && now() >= q.resets_at) || now() - q.fetched_at >= scaled(policy().quota.refresh_ms);
      if (stale) refreshQuota(cfg).catch(() => {});
    }

    function counted(cfg) {
      if (!quotaEnabled(cfg) || !quota || typeof quota.remaining !== "number" || (quota.resets_at && now() >= quota.resets_at)) return;
      setQuota({ ...quota, remaining: Math.max(quota.remaining - 1, 0), used: typeof quota.used === "number" ? quota.used + 1 : quota.used, estimated: true }).catch(() => {});
    }

    function publicQuota() {
      const q = snapshot();
      if (!q) return null;
      return { used: q.used, limit: q.limit, remaining: q.remaining, resets_at: q.resets_at ? new Date(q.resets_at).toISOString() : null, estimated: q.estimated };
    }

    // ── one attempt ─────────────────────────────────────────────────

    async function attempt(cfg, model, json, ctx, timeoutMs, signal) {
      const body = { model: model.id, temperature: S().rules.temperature, messages: ctx.messages, ...(cfg.preset.extraBody ?? {}) };
      if (json) body.response_format = { type: "json_object" };
      // Thinking takes 5-20 s longer and doesn't get these lookups more right.
      if (cfg.openrouter && model.caps.reasoning_toggle) body.reasoning = { enabled: false };
      if (model.caps.max_tokens && Number.isInteger(ctx.maxTokens)) body.max_tokens = ctx.maxTokens;
      if (cfg.openrouter && cfg.deny) body.provider = { data_collection: "deny" };
      const r = await call(`${cfg.baseUrl}/chat/completions`, { method: "POST", headers: headers(cfg, true), body: JSON.stringify(body) }, timeoutMs, signal);
      if (r.transport) return { kind: r.transport === "timeout" ? "timeout" : "network", status: null };
      if (r.status === 200) {
        const content = r.body?.choices?.[0]?.message?.content;
        if (typeof content === "string" && content) return { ...ctx.process(content), status: 200 };
        // OpenRouter can answer 200 with an error object (a provider failed mid-request).
        if (Number.isInteger(r.body?.error?.code)) return Policy().classify({ status: r.body.error.code, headers: r.headers, body: r.body, now_ms: now() });
        return { kind: "unparseable", status: 200 };
      }
      return Policy().classify({ status: r.status, headers: r.headers, body: r.body, now_ms: now() });
    }

    // Walks the chain under the policy (slice 10 section 2).
    async function attempts(cfg, kind, models, ctx, budget, deadline, signal) {
      const st = { chain: models, attempts: 0, noWordRetried: false, jsonRetried: false, json: null, noWord: null };
      if (!models.length) return { ok: false, error: coded("lookup_not_set_up", { reason: "no_model" }) };
      const minMs = policy().min_attempt_ms;
      let last = null;
      for (;;) {
        const [model, ...rest] = st.chain;
        if (!model) return { ok: false, error: coded("model_unavailable", {}), model: last };
        last = model.id;
        if (deadline - now() < scaled(minMs)) return { ok: false, error: coded("lookup_timeout", { reason: "deadline" }), model: last };
        const json = st.json === false ? false : model.caps.json_mode;
        const outcome = await attempt(cfg, model, json, ctx, Math.min(scaled(budget.attempt_ms), deadline - now()), signal);
        st.attempts++;
        // Every answer but a 429 counts against the free quota.
        if (outcome.status && outcome.status !== 429) counted(cfg);
        let quotaRemaining = snapshot()?.remaining ?? null;
        if ((outcome.kind === "platform_429" || outcome.kind === "upstream_429") && quotaEnabled(cfg)) {
          const room = deadline - now() - scaled(minMs);
          quotaRemaining = (await refreshQuota(cfg, Math.min(scaled(policy().quota.timeout_ms), room), signal).catch(() => null))?.remaining ?? null;
        }
        const action = Policy().next(outcome, {
          attempts: st.attempts,
          max_attempts: budget.max_attempts,
          remaining_ms: unscaled(deadline - now()),
          min_attempt_ms: minMs,
          daily_reset_min_ms: policy().daily_reset_min_ms,
          no_word_retried: st.noWordRetried,
          json_retried: st.jsonRetried,
          has_key: !!cfg.key,
          quota_remaining: quotaRemaining,
          last_model: rest.length === 0,
        });
        health.report(model.id, kind, action.health);
        if (outcome.kind === "no_word") st.noWord = outcome.result;
        if (action.action === "done") return { ok: true, result: outcome.result, model: model.id };
        if (action.action === "next_model") {
          st.chain = rest;
          st.noWordRetried ||= action.no_word === true;
          st.jsonRetried = false;
          st.json = null;
          continue;
        }
        if (action.action === "retry_same") {
          if (action.wait_ms > 0) await sleep(scaled(action.wait_ms));
          if (signal?.aborted) throw abortError();
          if (action.drop_json) st.json = false;
          st.jsonRetried ||= action.drop_json === true;
          continue;
        }
        // stop
        if (NO_WORD.has(action.code) && st.noWord) return { ok: true, result: st.noWord, model: model.id };
        const details = {};
        if (action.reason) details.reason = action.reason;
        if (outcome.status) details.status = outcome.status;
        if (action.code === "key_rejected" || action.code === "quota_exhausted") details.provider = cfg.preset.id;
        let retryAt = null;
        if (Number.isInteger(action.retry_in_ms)) retryAt = now() + action.retry_in_ms;
        else if (action.code === "quota_exhausted" && action.reason === "daily_limit") retryAt = snapshot()?.resets_at ?? nextMidnight(now());
        if (retryAt) details.retry_at = new Date(retryAt).toISOString();
        return { ok: false, error: coded(action.code, details), model: model.id };
      }
    }

    async function gate(cfg, models) {
      await maybeRefreshQuota(cfg);
      const q = snapshot();
      if (q && q.remaining === 0 && models.length && models.every((m) => m.caps.free)) {
        return coded("quota_exhausted", { reason: "daily_limit", provider: cfg.preset.id, retry_at: new Date(q.resets_at ?? nextMidnight(now())).toISOString() });
      }
      return null;
    }

    function processLookup(input) {
      return (content) => {
        const r = WordSpec().process(input, content);
        if (r.error) return { kind: "unparseable" };
        if (r.words.length) return { kind: "ok", result: r };
        if (NO_WORD.has(r.code)) return { kind: "no_word", code: r.code, result: r };
        return { kind: "ok", result: r };
      };
    }

    async function cacheKey(req) {
      promptHash ??= await sha256(S().prompt);
      const bases = req.base_langs;
      const text = WordSpec().fold(String(req.text).normalize("NFC").trim().replace(/\s+/gu, " "), bases[0]);
      return sha256(JSON.stringify([S().version, promptHash, req.mode, req.hint_lang ?? null, req.recent ?? [], bases, text]));
    }

    async function uncached(cfg, req, budget, deadline, signal) {
      const c = await chain(cfg, "lookup", signal, Math.max(deadline - now() - scaled(policy().min_attempt_ms), 0));
      if (c.error && !c.models.length) return { ok: false, error: coded("model_unavailable", { reason: c.error === "timeout" ? "timeout" : "network" }) };
      const blocked = await gate(cfg, c.models);
      if (blocked) return { ok: false, error: blocked };
      const ctx = {
        messages: [
          { role: "system", content: WordSpec().buildSystem({ base_langs: req.base_langs, mode: req.mode, recent: req.recent, hint_lang: req.hint_lang }) },
          { role: "user", content: req.text },
        ],
        process: processLookup({ text: req.text, mode: req.mode, base_langs: req.base_langs }),
        maxTokens: policy().max_tokens.lookup,
      };
      return attempts(cfg, "lookup", c.models, ctx, budget, deadline, signal);
    }

    // A lookup for an add (slice 24's job, the dashboard's preview): `req` is {text,
    // base_langs, hint_lang, recent}; mode is "add".
    async function lookup(input, { signal = null, fresh = false, budget: name = "extension" } = {}) {
      const cfg = await config();
      const missing = notSetUp(cfg);
      if (missing) return { ok: false, error: missing };
      const prepared = WordSpec().prepareInput(input.text);
      if (!prepared.ok) return { ok: false, error: coded(prepared.code) };
      const req = { text: prepared.text, mode: "add", hint_lang: input.hint_lang ?? null, recent: input.recent ?? [], base_langs: input.base_langs?.length ? input.base_langs : ["en"] };
      const budget = policy().budgets[name] ?? policy().budgets.extension;
      const deadline = now() + scaled(budget.deadline_ms);
      if (!store || fresh) return uncached(cfg, req, budget, deadline, signal);
      const k = `${cfg.preset.id} ${await cacheKey(req)}`;
      const hit = await store.cache.get(k).catch(() => null);
      if (hit) return { ok: true, result: hit, model: null, cache: "hit" };
      if (inflight.has(k)) return { ...(await inflight.get(k)), cache: "shared" };
      const p = uncached(cfg, req, budget, deadline, signal).then(async (r) => {
        // Only results with words are kept, never no-word results or errors.
        if (r.ok && r.result?.words?.length) await store.cache.put(k, r.result, r.model).catch(() => {});
        return r;
      });
      inflight.set(k, p);
      try {
        return { ...(await p), cache: "miss" };
      } finally {
        inflight.delete(k);
      }
    }

    // The pronunciation refresh's request (slice 07 section 8): items are {lang, native,
    // sense, base_langs}, at most 20; the bulk budget and the respell order.
    async function respell(items, { signal = null } = {}) {
      const cfg = await config();
      const missing = notSetUp(cfg);
      if (missing) return { ok: false, error: missing };
      const budget = policy().budgets.bulk;
      const deadline = now() + scaled(budget.deadline_ms);
      const c = await chain(cfg, "respell", signal, Math.max(deadline - now() - scaled(policy().min_attempt_ms), 0));
      const blocked = await gate(cfg, c.models);
      if (blocked) return { ok: false, error: blocked };
      const ctx = {
        messages: [
          { role: "system", content: WordSpec().buildRespellSystem(items) },
          { role: "user", content: JSON.stringify({ items }) },
        ],
        process: (content) => {
          const r = WordSpec().processRespell(items, content);
          return r.error ? { kind: "unparseable" } : { kind: "ok", result: r.items };
        },
        maxTokens: policy().max_tokens.respell,
      };
      return attempts(cfg, "respell", c.models, ctx, budget, deadline, signal);
    }

    // The settings page's Test: one small lookup, never cached, one attempt.
    async function test({ base_langs = ["en"], signal = null } = {}) {
      const started = now();
      const cfg = await config();
      const missing = notSetUp(cfg);
      if (missing) return { ok: false, error: missing };
      const budget = { deadline_ms: 20_000, attempt_ms: 15_000, max_attempts: 1 };
      const deadline = now() + scaled(budget.deadline_ms);
      const req = { text: "hello", mode: "add", hint_lang: null, recent: [], base_langs };
      const r = await uncached(cfg, req, budget, deadline, signal);
      await refreshQuota(cfg).catch(() => null);
      return r.ok ? { ok: true, model: r.model, ms: now() - started, quota: publicQuota() } : { ok: false, error: r.error, model: r.model ?? null };
    }

    async function status() {
      const cfg = await config();
      await loadQuota();
      if (quotaEnabled(cfg)) await maybeRefreshQuota(cfg);
      const name = cfg.openrouter ? `catalog:openrouter:${cfg.baseUrl}` : `catalog:${cfg.preset.id}:${cfg.baseUrl}`;
      const cat = await remembered(name);
      return {
        provider: cfg.preset.id,
        ready: !notSetUp(cfg),
        quota: quotaEnabled(cfg) ? publicQuota() : null,
        models_source: cfg.model ? "settings" : cat?.entries?.length || cat?.ids?.length ? "live" : "fallback",
        skipped: health.skipped(),
      };
    }

    // For background jobs: the reset time when `reserve` or fewer free lookups are left.
    async function quotaLow(reserve = policy().quota.reserve_for_learner) {
      const cfg = await config();
      await loadQuota();
      if (!quotaEnabled(cfg)) return null;
      const q = snapshot();
      return q && typeof q.remaining === "number" && q.remaining <= reserve ? q.resets_at : null;
    }

    return {
      lookup,
      respell,
      test,
      status,
      quotaLow,
      refreshQuota: async () => refreshQuota(await config()),
      cacheKey,
      // New settings: forget model health and the lists (the next lookup reads them again).
      reset() {
        health.reset();
        catalogs.clear();
        quota = null;
        quotaLoaded = true;
        if (store) store.meta.set("quota:openrouter", null).catch(() => {});
      },
    };
  }

  const api = { createClient, preset, sha256 };
  globalThis.KotikoLLMClient = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
