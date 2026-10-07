// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 25: plain-language errors (extension/lib/errors.js). One catalog for every code the
// extension and the server can produce, messages that say what still works and what to do,
// and "Copy details" without the learner's words.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { EXT_DIR, readExt } from "../helpers/load-script.mjs";
import { createI18n, LOCALES, readMessages } from "../helpers/fake-i18n.mjs";

const ROOT = path.resolve(EXT_DIR, "..");

// lib/lookup-status.js, lib/i18n.js and lib/errors.js in one context, as the pages load them.
function load({ locale = "en", online = true } = {}) {
  const ctx = vm.createContext({ chrome: { i18n: createI18n(locale) }, Intl, console, navigator: { onLine: online, userAgent: "TestBrowser/1.0", clipboard: null } });
  for (const rel of ["lib/i18n.js", "lib/lookup-status.js", "lib/errors.js"]) vm.runInContext(readExt(rel), ctx);
  return ctx;
}
const E = load().KotikoErrors;
const plain = (v) => JSON.parse(JSON.stringify(v));
const en = readMessages("en");

// Every context and detail that changes which key a code reads as.
const CTX = [{}, { n: 1 }, { n: 42 }, { local: true }, { text: "perro", base: "Spanish", language: "Russian" }, { surface: "banner" }, { surface: "line", n: 3, local: true, text: "x", base: "German" }];
const DETAILS = [{}, { provider: "openrouter" }, { reason: "payment_required" }, { reason: "payment_required", provider: "openrouter" }, { retry_at: "2026-10-06T00:00:00.000Z" }, { reason: "no_token" }, { reason: "host_not_allowed" }, { reason: "no_proof" }, { reason: "wrong_proof" }, { reason: "duplicate" }, { route: "lookup:openrouter" }, ...Object.keys(E.STORAGE).map((reason) => ({ reason }))];

function everyKey() {
  const keys = new Set();
  for (const code of Object.keys(E.CODES)) {
    for (const ctx of CTX) {
      for (const details of DETAILS) {
        const p = E.describe({ code, details }, ctx);
        if (p) keys.add(p.key);
      }
    }
  }
  return keys;
}

describe("the catalog", () => {
  test("every key a code can read as exists in en (plural keys as _one and _other)", () => {
    const keys = everyKey();
    assert.ok(keys.size > Object.keys(E.CODES).length, "variants are covered");
    for (const key of keys) assert.ok(key in en || (`${key}_one` in en && `${key}_other` in en), key);
    for (const code of Object.keys(E.CODES)) assert.ok([...keys].some((k) => k === `error_${code}` || k.startsWith(`error_${code}_`)), `${code} has a message of its own`);
  });

  // 25 §2 rules: no internals, no status numbers, no assumed language, in every locale.
  test("no error line says token, API, LLM, model, .env, an HTTP status or a language's name", () => {
    for (const l of LOCALES) {
      for (const [key, entry] of Object.entries(readMessages(l))) {
        if (!key.startsWith("error_")) continue;
        assert.doesNotMatch(entry.message, /token|\bAPI\b|\bLLM\b|\bmodel|modelo|\.env|\b[45]\d\d\b/i, `${l}/${key}`);
        assert.doesNotMatch(entry.message, /English|inglés|Spanish|español/i, `${l}/${key}: languages are placeholders`);
      }
    }
  });

  test("outages and lookup problems say what still works or what to do next", () => {
    const say = (code, details = {}, ctx = {}) => E.message({ code, details }, { n: 42, ...ctx });
    assert.match(say("server_unreachable"), /Your 42 words still work on pages/);
    assert.match(say("offline"), /^You're offline\. Your 42 words still work on pages/);
    assert.match(say("server_unreachable", {}, { n: 1 }), /Your word still works on pages/);
    assert.equal(say("offline", {}, { n: 0 }), "You're offline. Words you add will be looked up when you're back.");
    for (const code of ["rate_limited", "model_unavailable", "lookup_timeout", "bad_lookup_result", "quota_exhausted"]) assert.match(say(code), /add (the word |words )?yourself/i, code);
    assert.match(say("lookup_not_set_up", {}, { local: true }), /“word = meaning”/);
    assert.match(say("lookup_not_set_up"), /“word = meaning”/);
    assert.match(say("storage_full", { reason: "QuotaExceededError" }), /still work on pages/);
  });

  test("placeholders are filled: the word count, a local time, the provider, the text and the base", () => {
    const at = "2026-10-06T00:00:00.000Z";
    assert.equal(E.message({ code: "quota_exhausted", details: { retry_at: at } }), `You've used today's free lookups. Add words yourself, or try again after ${new Intl.DateTimeFormat("en", { timeStyle: "short" }).format(new Date(at))}.`);
    assert.equal(E.message({ code: "quota_exhausted", details: {} }), "You've used today's free lookups. Add words yourself, or try again tomorrow.");
    assert.match(E.message({ code: "quota_exhausted", details: { reason: "payment_required", provider: "openrouter" } }), /^OpenRouter needs credit/);
    assert.match(E.message({ code: "key_rejected", details: { provider: "openrouter" } }, { local: true }), /^OpenRouter didn't accept your key/);
    assert.equal(E.message({ code: "rejected_same_as_gloss" }, { text: "perro", base: "español" }), "“perro” is already a word in español. Try naming the language you want it in.");
    assert.equal(E.message({ code: "rejected_same_as_gloss" }, { text: "perro" }), "Couldn't find a word in “perro”. Try the word on its own, or add it yourself.", "no base named: never a guessed one");
    assert.equal(E.message({ code: "word_conflict", details: { reason: "duplicate" } }, { language: "Russian" }), "Another Russian word is already spelled like that.");
    assert.equal(E.message({ code: "server_unreachable" }, { n: 3, online: false }), "You're offline. Your 3 words still work on pages; new words will be looked up when you're back.");
  });

  test("a stored or sent code no catalog entry names reads as internal; aliases read as what they mean", () => {
    assert.equal(E.toError({ code: "brand_new_code" }).code, "internal");
    assert.equal(E.toError({ code: "brand_new_code" }).details.code, "brand_new_code", "the original stays in the details");
    assert.equal(E.toError({ error: { code: "not_found", message: "No such route." } }).code, "server_outdated");
    assert.equal(E.toError({ error: { code: "invalid_request" } }).code, "internal");
    assert.equal(E.toError({ code: "script_mismatch" }).code, "invalid_word");
    assert.equal(E.describe({ code: "cancelled" }), null, "a cancelled job says nothing");
  });

  test("severity (25 §3): outages are states, never red; key and address problems block; banners never say failed", () => {
    const sev = (code, details = {}, ctx = {}) => E.describe({ code, details }, ctx).severity;
    assert.equal(sev("server_unreachable"), "state");
    assert.equal(sev("offline"), "state");
    assert.equal(sev("server_key_rejected"), "blocking");
    assert.equal(sev("server_address_invalid"), "blocking");
    assert.equal(sev("rate_limited"), "waiting");
    assert.equal(sev("bad_lookup_result"), "failed");
    assert.equal(sev("internal", {}, { surface: "banner" }), "state");
    assert.equal(E.describe({ code: "server_key_rejected", details: { reason: "no_token" } }, { surface: "banner" }), null, "no key saved yet is not an error");
    assert.ok(E.isTransient("rate_limited") && !E.isTransient("key_rejected"));
  });

  test("actions: the next step for each problem", () => {
    const actions = (code, details = {}, ctx = {}) => plain(E.describe({ code, details }, ctx).actions);
    assert.deepEqual(actions("server_unreachable"), ["retry", "settings"]);
    assert.deepEqual(actions("server_key_rejected"), ["settings"]);
    assert.deepEqual(actions("address_changed", { route: "lookup:openrouter" }), ["setupLookups"]);
    assert.deepEqual(actions("address_changed", { route: "server" }), ["settings"]);
    assert.deepEqual(actions("key_rejected", {}, { local: true }), ["setupLookups"]);
    assert.deepEqual(actions("key_rejected", {}, { local: false }), [], "the server's key is fixed on the server");
    assert.deepEqual(actions("input_too_long"), ["bulk"]);
  });
});

describe("toError: anything a failure can be", () => {
  test("a fetch that failed: unreachable online, offline offline", () => {
    const err = Object.assign(new TypeError("Failed to fetch"));
    assert.deepEqual(plain(E.toError(err)), { code: "server_unreachable", details: { reason: "network", text: "Failed to fetch" } });
    assert.equal(load({ online: false }).KotikoErrors.toError(err).code, "offline");
  });

  test("HTTP statuses that came without a code", () => {
    const cases = [[401, "server_key_rejected"], [404, "server_outdated"], [405, "server_outdated"], [408, "server_unreachable"], [421, "server_address_invalid"], [429, "rate_limited"], [500, "internal"], [502, "server_unreachable"], [503, "server_unreachable"], [504, "server_unreachable"], [409, "internal"], [413, "internal"]];
    for (const [status, code] of cases) {
      assert.equal(E.fromStatus(status), code, String(status));
      assert.equal(E.toError({ status, ok: false }).code, code, `a response with ${status}`);
      assert.equal(E.toError({ code: "http_error", details: { status } }).code, code, `an old http_error with ${status}`);
    }
  });

  test("replies, stored sync errors, old strings and storage failures", () => {
    assert.deepEqual(plain(E.toError({ error: "The server rejected that API token.", code: "server_key_rejected", details: { status: 401 } })), { code: "server_key_rejected", details: { status: 401, text: "The server rejected that API token." } });
    assert.deepEqual(plain(E.toError({ error: { code: "word_conflict", message: "This word changed since.", details: { reason: "stale" } } })), { code: "word_conflict", details: { reason: "stale", text: "This word changed since." } });
    assert.deepEqual(plain(E.toError({ code: "server_unreachable", message: "Can't reach x.", details: { reason: "timeout" }, at: 1 })), { code: "server_unreachable", details: { reason: "timeout", text: "Can't reach x." } });
    // 25's rollout: a syncError stored as a string by an older version.
    assert.deepEqual(plain(E.toError("The server answered 500.")), { code: "internal", details: { text: "The server answered 500." } });
    assert.equal(E.toError(null), null);
    const quota = Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" });
    assert.deepEqual(plain(E.toError(quota)), { code: "storage_full", details: { reason: "QuotaExceededError", text: "The quota has been exceeded." } });
    assert.equal(E.message(quota), "Kotiko couldn't save in this browser because the disk is full. Your words still work on pages; free some disk space, then try again.");
    assert.match(E.message({ code: "storage_full", details: { reason: "blocked" } }), /Close Kotiko's other tabs/);
    assert.match(E.message({ code: "storage_full", details: { reason: "deleted" } }), /was just deleted/);
  });
});

describe("Copy details (25 §3)", () => {
  test("has the code, the technical details, Kotiko's version and the browser, and no word data", () => {
    const err = { code: "no_word_found", details: { reply: "I couldn't find a word in perro", native: "perro", word: { native: "perro", gloss: "dog" }, status: 200, provider: "openrouter" } };
    const text = E.copyText(err, { version: "0.5.0", browser: "TestBrowser/1.0" });
    assert.equal(text, "Kotiko 0.5.0\nTestBrowser/1.0\ncode: no_word_found\nHTTP 200\nprovider: openrouter");
    assert.doesNotMatch(text, /perro|dog/);
    const stale = E.copyText({ code: "word_conflict", details: { reason: "stale", word: { native: "дом", gloss: "house" }, other_id: "x" } }, {});
    assert.doesNotMatch(stale, /дом|house/);
  });

  test("copy() writes it to the clipboard with the manifest's version", async () => {
    const ctx = load();
    const written = [];
    ctx.navigator.clipboard = { writeText: async (t) => void written.push(t) };
    ctx.chrome.runtime = { getManifest: () => ({ version: "9.9.9" }) };
    await ctx.KotikoErrors.copy({ code: "server_unreachable", details: { reason: "network" } });
    assert.equal(written[0], "Kotiko 9.9.9\nTestBrowser/1.0\ncode: server_unreachable\nreason: network");
    ctx.navigator.clipboard = null;
    await assert.rejects(ctx.KotikoErrors.copy({ code: "internal" }), "no clipboard rejects, it never throws");
  });
});

// Acceptance (25): "every throw and error response in extension/ and server/ produces a
// code from the catalog; a test fails on an unmapped code". The code sites are read from
// the sources, so a new code fails here until the catalog (or a surface's own mapping,
// listed below) says what the learner reads.
describe("every code the code base produces is mapped", () => {
  const walk = (dir, exts) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return ["deps", "_build", "node_modules", "_locales", "vendor"].includes(e.name) ? [] : walk(p, exts);
      return exts.some((x) => e.name.endsWith(x)) ? [p] : [];
    });
  const SITES = {
    js: [/\bcodedError\(\s*"([a-z_]+)"/g, /\bcoded\(\s*"([a-z_]+)"/g, /\bcode:\s*"([a-z_]+)"/g, /\bstop\(\s*"([a-z_]+)"/g, /\bcode = "([a-z_]+)"/g, /\breturn error\(\s*"([a-z_]+)"/g],
    ex: [/\berror\(conn,\s*(?:v1\?,\s*)?\d+,\s*"([a-z_]+)"/g, /\bcode:\s*"([a-z_]+)"/g, /\bstop\(\s*"([a-z_]+)"/g, /\berror\(\s*"([a-z_]+)"/g, /\bdefp code\([^)]*\),\s*do:\s*"([a-z_]+)"/g, /do: "((?:no_word_found|rejected_same_as_gloss|bad_lookup_result))"/g],
  };
  // Codes a surface words itself, next to the action that caused them (the restore dialog,
  // bulk add's file reader), with the key it uses.
  const LOCAL = {
    backup_newer: "data-tools.js: data_restore_newer",
    not_backup: "data-tools.js: data_restore_unreadable",
    too_big: "data-tools.js: data_restore_too_big; bulk/sheet.js: bulk_too_big",
    too_many: "data-tools.js: data_restore_over_cap",
    unreadable: "data-tools.js: data_restore_unreadable; bulk/sheet.js: bulk_unreadable",
    nothing_to_undo: "data-tools.js: data_undo_none",
  };
  // Not error codes: the reasons and outcomes that the patterns above also match.
  const NOT_CODES = new Set(["unparseable"]);

  function produced() {
    const found = new Map();
    const scan = (files, patterns) => {
      for (const f of files) {
        if (f.endsWith(path.join("lib", "errors.js"))) continue;
        const src = fs.readFileSync(f, "utf8");
        for (const re of patterns) for (const m of src.matchAll(re)) (found.get(m[1]) ?? found.set(m[1], new Set()).get(m[1])).add(path.relative(ROOT, f));
      }
    };
    scan(walk(path.join(ROOT, "extension"), [".js"]), SITES.js);
    scan(walk(path.join(ROOT, "server", "lib"), [".ex"]), SITES.ex);
    return found;
  }

  test("the scan finds the codes it should (sanity check on the patterns)", () => {
    const found = produced();
    for (const code of ["server_unreachable", "quota_exhausted", "word_conflict", "request_too_large", "no_word_found", "address_changed", "storage_full", "input_too_long", "empty_input"]) assert.ok(found.has(code), code);
    assert.ok(found.get("word_conflict").has(path.join("server", "lib", "kotiko", "router_v1.ex")));
  });

  test("each is in the catalog, an alias, silent, or worded by its own surface", () => {
    const unmapped = [...produced()].filter(([code]) => !NOT_CODES.has(code) && !(code in E.CODES) && !(code in E.ALIASES) && !E.SILENT.has(code) && !(code in LOCAL));
    assert.deepEqual(unmapped.map(([code, files]) => `${code} (${[...files].join(", ")})`), []);
  });

  // The server words its own codes for curl and the bot (server/priv/locales), and the HTTP
  // reference names each one.
  test("every code the server produces has a server message and is in the HTTP reference", () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "priv", "locales", "en", "messages.json"), "utf8"));
    const doc = fs.readFileSync(path.join(ROOT, "docs", "reference", "http-api.md"), "utf8");
    // A lookup that found no word answers 200 with this `code`; it isn't an error answer.
    const OUTCOMES = new Set(["no_word_found", "rejected_same_as_gloss"]);
    const server = [...produced()].filter(([, files]) => [...files].some((f) => f.startsWith(path.join("server", "lib"))));
    assert.ok(server.length > 15, "the scan reads the server");
    for (const [code] of server) {
      if (!OUTCOMES.has(code)) assert.ok(`error_${code}` in catalog, `server/priv/locales/en: error_${code}`);
      assert.ok(doc.includes(`\`${code}\``), `docs/reference/http-api.md names ${code}`);
    }
  });

  test("codes the add queue waits on are in the catalog", () => {
    const src = readExt("lib/add-queue.js");
    const wait = JSON.parse(src.match(/const WAIT = new Set\((\[[^\]]+\])\)/)[1]);
    // user_quota_exhausted is slice 48's (per-user server limits), not built yet.
    for (const code of wait.filter((c) => c !== "user_quota_exhausted")) assert.ok(code in E.CODES, code);
  });

  test("the surfaces' own codes have the keys they name", () => {
    for (const where of Object.values(LOCAL)) for (const [, key] of where.matchAll(/: ([a-z_]+)/g)) assert.ok(key in en, key);
  });
});
