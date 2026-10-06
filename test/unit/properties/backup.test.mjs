// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Properties of the JSON backup (lib/backup.js, slice 12) on generated files and word
// lists: reading any file is safe, a backup reads back as it was written, restoring the
// same backup twice changes nothing the second time, and no secret reaches a backup.
// Assertion mode checks every restore plan's own invariants as well.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fc } from "../../helpers/properties.mjs";
import { loadLocalLibs } from "../../helpers/local-libs.mjs";
import { requireExt } from "../../helpers/load-script.mjs";

const L = loadLocalLibs();
globalThis.KotikoStore = L.Store;
const B = requireExt("lib/backup.js");
const T0 = Date.parse("2026-10-01T12:00:00.000Z");
const CODES = new Set(["unreadable", "not_backup", "backup_newer", "too_big", "too_many"]);
const byId = (list) => [...list].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));

// Words as a backup holds them: a language and a native word in its script, an English
// meaning, forms, and the optional fields, some of them odd.
const NATIVE = { es: /^[a-zñáéíóú]{1,12}$/, fr: /^[a-zàâçéèêëîïôûù]{1,12}$/, ru: /^[а-яё]{1,12}$/, el: /^[α-ω]{1,10}$/, ja: /^[ぁ-ゖ]{1,6}$/ };
const iso = fc.integer({ min: T0 - 400 * 86_400_000, max: T0 }).map((ms) => new Date(ms).toISOString());
const text = fc.stringMatching(/^[a-z][a-z ]{0,14}$/);
const rawWord = fc
  .constantFrom(...Object.keys(NATIVE))
  .chain((lang) =>
    fc.record(
      {
        id: fc.oneof(fc.uuid(), fc.constant(null), fc.constant("not-a-uuid")),
        lang: fc.constant(lang),
        native: fc.stringMatching(NATIVE[lang]),
        base_lang: fc.constant("en"),
        sense: fc.oneof(fc.constant(""), text),
        gloss: text.filter((s) => s.trim()),
        forms: fc.array(fc.oneof(text, fc.record({ text, enabled: fc.boolean(), case: fc.constantFrom("any", "lower", "exact", "proper", "weird") })), { maxLength: 4 }),
        note: fc.oneof(fc.constant(null), text, fc.string({ minLength: 201, maxLength: 210 })),
        status: fc.constantFrom("active", "well_known", "paused"),
        origin: fc.constantFrom("add", "bulk", "import", "somewhere"),
        created_at: fc.oneof(iso, fc.constant(null), fc.constant("yesterday")),
        updated_at: fc.oneof(iso, fc.constant(null)),
        future_field: fc.oneof(fc.constant(undefined), fc.string({ maxLength: 5 })),
      },
      { requiredKeys: ["lang", "native", "base_lang", "gloss"] },
    ),
  );
const file = (words, version = 2) => JSON.stringify({ format: B.FORMAT, schemaVersion: version, exportedAt: new Date(T0).toISOString(), words });

// What a restore's writes leave in the store.
function apply(existing, writes) {
  const out = new Map(existing.map((r) => [r.id, r]));
  for (const { record } of writes) out.set(record.id, record);
  return [...out.values()];
}

describe("reading any file", () => {
  test("never throws: a known refusal, or words that all passed the checks", () => {
    const doc = fc.oneof(
      fc.string({ maxLength: 40 }),
      fc.jsonValue().map((v) => JSON.stringify(v)),
      fc.record({ format: fc.oneof(fc.constant(B.FORMAT), fc.string()), schemaVersion: fc.oneof(fc.integer({ min: -1, max: 4 }), fc.double(), fc.string()), words: fc.oneof(fc.array(fc.oneof(rawWord, fc.anything()), { maxLength: 6 }), fc.anything()) }, { requiredKeys: [] }),
      fc.anything(),
    );
    fc.assert(
      fc.property(doc, (input) => {
        const r = B.read(input, { now: T0 });
        if (!r.ok) return assert.ok(CODES.has(r.code), r.code);
        assert.equal(r.total, r.words.length + r.invalid.length);
        for (const w of r.words) {
          assert.equal(typeof w.native, "string");
          assert.ok(w.forms.length >= 1 && w.forms.length <= 10);
          assert.equal(w.deleted_at, null);
          assert.ok(!("english" in w));
        }
      }),
    );
  });
});

describe("a backup reads back as it was written", () => {
  test("export then read is a fixed point of read", () => {
    fc.assert(
      fc.property(fc.array(rawWord, { maxLength: 8 }), (raw) => {
        const first = B.read(file(raw), { now: T0 });
        assert.equal(first.ok, true);
        const again = B.read(B.stringify(B.exportDoc({ words: first.words, now: T0 })), { now: T0 });
        assert.equal(again.ok, true);
        assert.deepEqual(again.invalid, []);
        assert.deepEqual(again.dropped, []);
        assert.deepEqual(byId(again.words), byId(first.words));
      }),
    );
  });

  test("a word the checks accept keeps every one of its fields", () => {
    fc.assert(
      fc.property(rawWord, (raw) => {
        const r = B.read(file([raw]), { now: T0 });
        if (!r.words.length) return;
        const [w] = r.words;
        assert.equal(w.native, raw.native.normalize("NFC"));
        assert.equal(w.gloss, raw.gloss.trim().replace(/\s+/g, " "));
        assert.equal(w.lang, raw.lang);
        if (raw.future_field !== undefined) assert.equal(w.future_field, raw.future_field);
        if (typeof raw.note === "string" && raw.note.length > 200) assert.equal(w.note, null);
      }),
    );
  });
});

describe("restoring", () => {
  test("restoring the same backup twice changes nothing the second time", () => {
    fc.assert(
      fc.property(fc.array(rawWord, { maxLength: 8 }), fc.array(rawWord, { maxLength: 4 }), (raw, here) => {
        const fileWords = B.read(file(raw), { now: T0 }).words;
        const existing = B.plan(B.read(file(here), { now: T0 }).words, [], { now: T0 }).writes.map((w) => w.record);
        const once = B.plan(fileWords, existing, { now: T0 + 1000 });
        const after = apply(existing, once.writes);
        const twice = B.plan(fileWords, after, { now: T0 + 2000 });
        assert.deepEqual(twice.writes, []);
        assert.ok(twice.items.every((i) => i.kind === "identical" || i.kind === "kept"), JSON.stringify(twice.items));
      }),
    );
  });

  test("into an empty list every word is new, unless two share a natural key", () => {
    fc.assert(
      fc.property(fc.array(rawWord, { maxLength: 8 }), (raw) => {
        const words = B.read(file(raw), { now: T0 }).words;
        const p = B.plan(words, [], { now: T0 });
        const keys = new Set(words.map((w) => JSON.stringify(L.Merge.naturalKey(w))));
        assert.equal(p.writes.length, keys.size);
        assert.equal(p.counts.new, keys.size);
        assert.equal(p.counts.new + p.counts.merge + p.counts.identical, words.length);
      }),
    );
  });
});

describe("settings in a backup (slice 39's allowlist)", () => {
  const secret = fc.stringMatching(/^[0-9a-f]{24}$/).map((h) => `SECRET${h}`);
  const anyValue = fc.oneof(fc.string({ maxLength: 6 }), fc.boolean(), fc.integer(), fc.constant(null));
  test("no secret ever reaches a backup, and addresses lose their user name, query and fragment", () => {
    fc.assert(
      fc.property(secret, fc.dictionary(fc.string({ maxLength: 8 }), anyValue, { maxKeys: 5 }), fc.webUrl({ withQueryParameters: true, withFragments: true }), (s, extra, url) => {
        const local = {
          ...extra,
          token: s,
          apiKey: s,
          server: { url: url.replace("://", `://user:${s}@`), token: s },
          lookup: { provider: "openrouter", baseUrl: `${url}?key=${s}`, apiKey: s, model: "m" },
          oauth: { verifier: s },
          enabled: true,
          seedSalt: "0123456789abcdef0123456789abcdef",
        };
        const out = B.settingsOf({ local, sync: { ui: { uiLang: "es", token: s } } });
        assert.ok(!JSON.stringify(out).includes(s));
        for (const k of Object.keys(out)) assert.ok(["enabled", "pausedHosts", "hiddenLangs", "prefs", "mixing", "speech", "seedSalt", "lookup", "server", "ui"].includes(k), k);
        if (out.server) assert.equal(new URL(out.server.url).username, "");
      }),
    );
  });

  test("restoring settings never changes where requests go", () => {
    fc.assert(
      fc.property(fc.webUrl(), fc.webUrl(), fc.constantFrom("openrouter", "ollama", "custom"), fc.constantFrom("openrouter", "ollama", "custom"), (fileUrl, hereUrl, fileProvider, hereProvider) => {
        const current = { lookup: { provider: hereProvider, baseUrl: hereUrl, model: "here" }, server: { url: hereUrl } };
        const { local, sync } = B.settingsPatch({ lookup: { provider: fileProvider, baseUrl: fileUrl, model: "file" }, server: { url: fileUrl }, ui: { baseLangs: ["es", "en", "xx-invalid-tag-that-is-long"] } }, { current });
        assert.equal(local.lookup.provider, hereProvider);
        assert.equal(local.lookup.baseUrl, hereUrl);
        assert.equal(local.lookup.model, fileProvider === hereProvider ? "file" : "here");
        assert.ok(!("server" in local));
        assert.ok(sync.baseLangs.length <= 4);
      }),
    );
  });
});
