// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 10: the lookup policy's shared fixtures (spec/fixtures/llm-policy.json), which
// server/test/kotiko/llm/policy_test.exs runs against Kotiko.LLM.Policy, and the numbers
// in spec/models.json that both runtimes read.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, requireExt } from "../helpers/load-script.mjs";

const Policy = requireExt("lib/llm/policy.js");
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const fixture = read("spec/fixtures/llm-policy.json");
const models = read("spec/models.json");

for (const c of fixture.classify) {
  test(`classify: ${c.name}`, () => {
    const out = Policy.classify(c.input);
    for (const [k, v] of Object.entries(c.expect)) assert.deepEqual(out[k] ?? null, v, k);
  });
}

for (const c of fixture.next) {
  test(`next: ${c.name}`, () => {
    const out = Policy.next(c.outcome, { ...fixture.defaults.state, ...c.state });
    for (const [k, v] of Object.entries(c.expect)) assert.deepEqual(out[k] ?? null, v, k);
  });
}

test("the fixture covers every outcome kind and every stop code", () => {
  const kinds = new Set(fixture.next.map((c) => c.outcome.kind));
  for (const k of ["ok", "no_word", "unparseable", "json_unsupported", "not_found", "unauthorized", "payment_required", "forbidden", "platform_429", "upstream_429", "server_error", "timeout", "network"]) {
    assert.ok(kinds.has(k), k);
  }
  const codes = new Set(fixture.next.map((c) => c.expect.code).filter(Boolean));
  for (const code of ["no_word_found", "rejected_same_as_gloss", "bad_lookup_result", "lookup_not_set_up", "key_rejected", "quota_exhausted", "rate_limited", "model_unavailable", "lookup_timeout"]) {
    assert.ok(codes.has(code), code);
  }
});

test("models.json: the evaluated order, budgets and a fallback for every preferred model", () => {
  assert.deepEqual(models.prefer, ["nvidia/nemotron-3-super-120b-a12b:free", "dots-studio/dots-3-note-preview:free", "apodex/apodex-1.1-mini:free"]);
  assert.deepEqual(models.prefer_respell, ["dots-studio/dots-3-note-preview:free", "apodex/apodex-1.1-mini:free", "nvidia/nemotron-3-super-120b-a12b:free"]);
  for (const id of [...models.prefer, ...models.prefer_respell]) {
    assert.ok(models.fallback.includes(id), id);
    assert.ok(models.evidence.models[id], `evidence for ${id}`);
  }
  const b = models.policy.budgets;
  assert.deepEqual(b.add, { deadline_ms: 25000, attempt_ms: 15000, max_attempts: 3 });
  assert.deepEqual(b.telegram, { deadline_ms: 40000, attempt_ms: 20000, max_attempts: 3 });
  assert.deepEqual(b.bulk, { deadline_ms: 45000, attempt_ms: 30000, max_attempts: 2 });
  // The add deadline keeps the server's answer inside Chrome's 30 s fetch limit.
  assert.ok(b.add.deadline_ms < 28000);
  assert.equal(models.policy.min_attempt_ms, Policy.DEFAULT_STATE.min_attempt_ms);
  assert.equal(models.policy.quota.reserve_for_learner, 10);
  assert.equal(models.policy.cache.ttl_days, 30);
});
