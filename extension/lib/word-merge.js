// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 07's merge rules in JavaScript, the twin of Kotiko.WordMerge: what a re-add of a
// word the learner already has may change. Nothing the learner wrote is overwritten; empty
// fields are filled, forms are unioned and the meaning (`gloss`) stays. Both runtimes pass
// spec/fixtures/merge.json. Pure, so it runs in the background (globalThis.KotikoWordMerge)
// and in Node tests (module.exports).
//
//   KotikoWordMerge.changes(existing, incoming, {explicit, maxForms}) -> {field: value}
//   KotikoWordMerge.nativeKey("ΣΑΣ")                                -> "σασ"
//   KotikoWordMerge.naturalKey(word)                                -> [lang, key, sense, base]
(() => {
  const FILL = ["romanization", "native_vocalized", "note", "source_text"];
  const CASES = new Set(["any", "lower", "exact", "proper"]);
  const MAX_FORMS = 10;

  const blank = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  const fold = (s) => String(s).toLowerCase();

  // slice 07 section 2: NFC, Unicode default lowercase, final sigma as σ.
  const nativeKey = (native) => String(native ?? "").normalize("NFC").toLowerCase().replaceAll("ς", "σ");

  const naturalKey = (w) => [w.lang, nativeKey(w.native), w.sense ?? "", w.base_lang];

  // A Form with its defaults, from a string or an object.
  function form(f) {
    const o = typeof f === "string" ? { text: f } : f && typeof f === "object" ? f : {};
    return {
      text: typeof o.text === "string" ? o.text : null,
      enabled: typeof o.enabled === "boolean" ? o.enabled : true,
      case: CASES.has(o.case) ? o.case : "any",
      ambiguous: typeof o.ambiguous === "boolean" ? o.ambiguous : false,
    };
  }

  function changes(existing, incoming, { explicit = false, maxForms = MAX_FORMS } = {}) {
    const out = {};
    for (const f of FILL) {
      if (blank(existing[f]) && !blank(incoming[f])) out[f] = incoming[f];
    }
    // The three move together and only into a word with no pronunciation, so a learner's
    // edit survives and an everyday form is never paired with another answer's careful one.
    if (blank(existing.pronunciation) && !blank(incoming.pronunciation)) {
      out.pronunciation = incoming.pronunciation;
      out.pronunciation_careful = incoming.pronunciation_careful ?? null;
      out.pronunciation_source = incoming.pronunciation_source || "model";
    }
    // Union by case-insensitive text; existing forms keep their flags and are never dropped
    // by the cap; a different incoming gloss becomes a form.
    const old = (existing.forms ?? []).map(form);
    const seen = new Set(old.filter((f) => f.text !== null).map((f) => fold(f.text)));
    const candidates = [...(incoming.forms ?? []).map(form), ...(incoming.gloss ? [form({ text: incoming.gloss })] : [])];
    const added = [];
    for (const f of candidates) {
      if (f.text === null || seen.has(fold(f.text))) continue;
      seen.add(fold(f.text));
      added.push(f);
    }
    const room = Math.max(maxForms - old.length, 0);
    if (added.length && room) out.forms = [...old, ...added.slice(0, room)];
    // Status: a pending word becomes what the add says; an explicit add un-pauses.
    let to = existing.status;
    if (existing.status === "pending" && (incoming.status === "active" || incoming.status === "paused")) to = incoming.status;
    else if (existing.status === "paused" && incoming.status === "active" && explicit) to = "active";
    if (to !== existing.status) out.status = to;
    return out;
  }

  const api = { changes, form, nativeKey, naturalKey, FILL, MAX_FORMS };
  globalThis.KotikoWordMerge = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
