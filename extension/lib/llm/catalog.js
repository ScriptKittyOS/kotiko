// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Which models a lookup asks, in what order, and what each supports (slice 10 section 1),
// the JavaScript twin of Kotiko.LLM.Catalog for the extension's own lookups (slice 11).
//
//   filter(list, nowMs)              OpenRouter's /models -> {entries, caps}: free, text out,
//                                    JSON mode, not expiring, no mandatory reasoning, a
//                                    context of 8,000 or more, not denied
//   ordered(entries, kind)           by models.json's prefer (or prefer_respell), then newest
//   defaultCaps(id, {openrouter})    what is assumed for a model the catalog doesn't know
//   createHealth({now, policy})      three failures skip a model for 10 minutes, "not found"
//                                    for an hour; a success moves it to the front of its
//                                    chain for an hour. In memory, like the server's.
//
// No I/O: lib/llm/client.js fetches the lists and keeps them in the store's meta.
(() => {
  const SPEC = () => globalThis.KOTIKO_SPEC.models;

  const glob = (pattern) => new RegExp(`^${pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "i");
  const zero = (p) => p === "0" || p === 0 || p === "0.0";
  const params = (m) => (Array.isArray(m.supported_parameters) ? m.supported_parameters : []);

  function caps(m) {
    const p = params(m);
    const pricing = m.pricing ?? {};
    return {
      json_mode: p.includes("response_format"),
      reasoning_toggle: p.includes("reasoning"),
      max_tokens: p.includes("max_tokens"),
      free: String(m.id).endsWith(":free") || (zero(pricing.prompt) && zero(pricing.completion)),
    };
  }

  function textOut(m) {
    const list = m.architecture?.output_modalities;
    return Array.isArray(list) ? list.includes("text") : true;
  }

  function expiring(date, nowMs, margin) {
    if (typeof date !== "string") return false;
    const at = Date.parse(date.length === 10 ? `${date}T00:00:00Z` : date);
    return Number.isFinite(at) && at - nowMs <= margin;
  }

  function filter(list, nowMs = Date.now()) {
    const rules = SPEC().policy.catalog;
    const deny = SPEC().deny.map(glob);
    const out = { entries: [], caps: {} };
    for (const m of Array.isArray(list) ? list : []) {
      if (!m || typeof m.id !== "string") continue;
      const c = caps(m);
      out.caps[m.id] = c;
      if (!c.free || !textOut(m)) continue;
      if (!c.json_mode && !params(m).includes("structured_outputs")) continue;
      if (expiring(m.expiration_date, nowMs, rules.expiry_margin_ms)) continue;
      if (m.reasoning?.mandatory === true) continue;
      if (!(Number.isInteger(m.context_length) && m.context_length >= rules.min_context_length)) continue;
      if (deny.some((re) => re.test(m.id))) continue;
      out.entries.push({ id: m.id, created: m.created ?? 0, caps: c });
    }
    return out;
  }

  function ordered(entries, kind = "lookup") {
    if (!Array.isArray(entries) || !entries.length) return null;
    const prefer = kind === "respell" ? SPEC().prefer_respell : SPEC().prefer;
    const rank = (id) => (prefer.includes(id) ? prefer.indexOf(id) : prefer.length);
    return [...entries]
      .sort((a, b) => rank(a.id) - rank(b.id) || (b.created ?? 0) - (a.created ?? 0) || (a.id < b.id ? -1 : 1))
      .map(({ id, caps: c }) => ({ id, caps: c }));
  }

  function defaultCaps(id, { openrouter = false, json = true } = {}) {
    return { json_mode: json, reasoning_toggle: openrouter, max_tokens: false, free: String(id).endsWith(":free") };
  }

  function fallback(knownCaps = {}) {
    return SPEC().fallback.map((id) => ({ id, caps: knownCaps[id] ?? defaultCaps(id, { openrouter: true }) }));
  }

  function createHealth({ now = () => Date.now() } = {}) {
    const health = new Map(); // id -> {failures, skipUntil}
    const promoted = new Map(); // `${kind} ${id}` -> until
    const rules = () => SPEC().policy.health;

    const skipped = (id) => (health.get(id)?.skipUntil ?? 0) > now();
    const unpromote = (id) => {
      for (const k of [...promoted.keys()]) if (k.endsWith(` ${id}`)) promoted.delete(k);
    };

    return {
      // Healthy models first-in-order, promoted ones in front; all of them when every one
      // is resting. An explicit list keeps its order (no promotion).
      chain(base, kind = "lookup", { explicit = false } = {}) {
        const healthy = base.filter((m) => !skipped(m.id));
        const chain = healthy.length ? healthy : base;
        if (explicit) return chain;
        const t = now();
        const until = (m) => promoted.get(`${kind} ${m.id}`) ?? 0;
        const front = chain.filter((m) => until(m) > t).sort((a, b) => until(b) - until(a));
        return [...front, ...chain.filter((m) => !(until(m) > t))];
      },
      report(id, kind, outcome) {
        const t = now();
        if (outcome === "success") {
          health.set(id, { failures: 0, skipUntil: 0 });
          promoted.set(`${kind} ${id}`, t + rules().promote_ms);
        } else if (outcome === "failure") {
          const h = health.get(id) ?? { failures: 0, skipUntil: 0 };
          const failures = h.failures + 1;
          health.set(id, failures >= rules().failures_to_skip ? { failures: 0, skipUntil: t + rules().skip_ms } : { ...h, failures });
          unpromote(id);
        } else if (outcome === "skip_long") {
          health.set(id, { failures: 0, skipUntil: t + rules().not_found_skip_ms });
          unpromote(id);
        }
      },
      skipped: () => [...health].filter(([, h]) => h.skipUntil > now()).map(([id, h]) => ({ id, for_s: Math.ceil((h.skipUntil - now()) / 1000) })),
      reset() {
        health.clear();
        promoted.clear();
      },
    };
  }

  const api = { filter, ordered, caps, defaultCaps, fallback, createHealth, glob };
  globalThis.KotikoLLMCatalog = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
