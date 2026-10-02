// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The dashboard's data rules (slice 21), without DOM: grouping records into rows, sorting,
// filters, hash routes, the undo stack, the pronunciation-refresh line and the inline
// checks on edits. Runs in the dashboard (globalThis.KotikoDashModel) and in Node tests
// (module.exports).
(() => {
  const DAY = 86_400_000;
  const DELETED_DAYS = 30;
  const STRESS_LANGS = new Set(["ru", "uk", "be"]);
  // Targets with word stress (one capital syllable per word) and without (07 §7; the list
  // is the server's Kotiko.Pronunciation until slice 09's spec/pronunciation.json).
  const LEXICAL = new Set("ru uk be bg sr hr bs sl mk pl cs sk es en de it pt nl el ro ca gl ar he fa tr sv no nb da is ka hy lt lv sq eu".split(" "));
  const NO_STRESS = new Set("ja ko fr vi zh yue".split(" "));
  const TONES = { zh: [1, 4], yue: [1, 6] };
  // Bases with a respelling key and the letters it uses (07 §7: en and es at launch).
  const KEY_LETTERS = { en: "a-zA-Z", es: "a-zA-ZñÑ" };
  const MAX_PRON = 96;

  const primary = (tag) => String(tag ?? "").split(/[-_]/)[0].toLowerCase();
  const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const time = (iso) => {
    const t = Date.parse(iso ?? "");
    return Number.isFinite(t) ? t : 0;
  };

  // Slice 07 §2's native_key: the same in JavaScript and Elixir (spec/fixtures/native-key.json).
  const nativeKey = (native) => String(native ?? "").normalize("NFC").toLowerCase().replaceAll("ς", "σ");

  const formTexts = (forms) => (Array.isArray(forms) ? forms : []).map((f) => (typeof f === "string" ? f : f?.text)).filter((t) => typeof t === "string" && t);
  const enabledForms = (forms) =>
    (Array.isArray(forms) ? forms : []).filter((f) => typeof f === "string" || f?.enabled !== false).map((f) => (typeof f === "string" ? f : f.text)).filter(Boolean);

  // --- Groups (§3: one row per lang + native key; one record per base language) ---------

  function groupKey(record) {
    return `${record.lang}\u0001${nativeKey(record.native)}`;
  }

  // Records -> groups, newest first. `bases` orders a group's records (primary base first);
  // bases not in the list follow in the order they were added.
  function groupRecords(records, { bases = ["en"] } = {}) {
    const byKey = new Map();
    for (const r of Array.isArray(records) ? records : []) {
      if (!r || typeof r.lang !== "string" || typeof r.native !== "string" || r.id === undefined) continue;
      const key = groupKey(r);
      let g = byKey.get(key);
      if (!g) byKey.set(key, (g = { key, lang: r.lang, records: [] }));
      g.records.push(r);
    }
    const rank = (b) => {
      const i = bases.indexOf(b);
      return i < 0 ? bases.length : i;
    };
    const groups = [];
    for (const g of byKey.values()) {
      g.records.sort((a, b) => rank(a.base_lang ?? "en") - rank(b.base_lang ?? "en") || time(a.created_at) - time(b.created_at));
      finishGroup(g);
      groups.push(g);
    }
    return groups.sort((a, b) => b.created - a.created);
  }

  function finishGroup(g) {
    const r0 = g.records[0];
    g.id = r0.id;
    g.native = r0.native;
    g.romanization = g.records.map((r) => text(r.romanization)).find(Boolean) ?? null;
    g.language = r0.language ?? null;
    g.created = Math.min(...g.records.map((r) => time(r.created_at) || Infinity));
    if (!Number.isFinite(g.created)) g.created = 0;
    g.updated = Math.max(...g.records.map((r) => time(r.updated_at)));
    g.deletedAt = Math.max(...g.records.map((r) => time(r.deleted_at)));
    g.paused = g.records.every((r) => r.status === "paused");
    g.bases = g.records.map((r) => r.base_lang ?? "en");
    g.origin = r0.origin ?? null;
    g.sig = g.records.map((r) => `${r.id}@${r.updated_at ?? ""}:${r.status ?? ""}`).join("|");
    return g;
  }

  // The meaning column (§3): each base's gloss, primary first; with one base, the gloss and
  // a count of the other forms.
  function meaningOf(group) {
    const glosses = group.records.map((r) => ({ base: r.base_lang ?? "en", gloss: text(r.gloss ?? r.english) })).filter((m) => m.gloss);
    if (glosses.length !== 1) return { glosses, more: 0, rest: [] };
    const r = group.records.find((x) => text(x.gloss ?? x.english));
    const rest = enabledForms(r.forms).filter((f) => f.toLocaleLowerCase() !== glosses[0].gloss.toLocaleLowerCase());
    return { glosses, more: rest.length, rest };
  }

  // --- Sort and filters (§3) ---------------------------------------------------------------

  const SORTS = ["newest", "oldest", "native", "meaning", "language"];
  const STATUSES = ["live", "active", "paused", "deleted", "all"];
  const ADDED = ["any", "today", "week", "month"];
  const SOURCES = ["any", "typed", "imported", "telegram"];
  const SOURCE_ORIGINS = { typed: ["add", "manual"], imported: ["bulk", "import"], telegram: ["telegram"] };

  function collator(locale) {
    try {
      return new Intl.Collator(locale || undefined, { sensitivity: "base", numeric: true });
    } catch {
      return new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
    }
  }

  // Sorted copy. Collators per language are made once per call.
  function sortGroups(groups, sort = "newest", { uiLocale = "en", primaryBase = "en", languageName = (l) => l } = {}) {
    const list = groups.slice();
    const byAdded = (a, b) => b.created - a.created || (a.key < b.key ? -1 : 1);
    if (sort === "oldest") return list.sort((a, b) => -byAdded(a, b));
    if (sort === "native") {
      const cs = new Map();
      const c = (lang) => cs.get(lang) ?? cs.set(lang, collator(lang)).get(lang);
      return list.sort((a, b) => (a.lang === b.lang ? c(a.lang).compare(a.native, b.native) : a.lang < b.lang ? -1 : 1) || byAdded(a, b));
    }
    if (sort === "meaning") {
      const c = collator(primaryBase);
      const key = (g) => text(g.records[0].gloss ?? g.records[0].english) ?? "\uffff";
      const keys = new Map(list.map((g) => [g, key(g)]));
      return list.sort((a, b) => c.compare(keys.get(a), keys.get(b)) || byAdded(a, b));
    }
    if (sort === "language") {
      const c = collator(uiLocale);
      const names = new Map();
      const name = (l) => names.get(l) ?? names.set(l, languageName(l) ?? l).get(l);
      return list.sort((a, b) => c.compare(name(a.lang), name(b.lang)) || byAdded(a, b));
    }
    return list.sort(byAdded);
  }

  function startOf(period, now) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    if (period === "today") return d.getTime();
    if (period === "week") return now - 7 * DAY;
    if (period === "month") return now - 30 * DAY;
    return -Infinity;
  }

  // Groups passing the filters, in the given order. Status "deleted" is a separate list
  // (tombstones), so here it passes nothing.
  function filterGroups(groups, f = {}, { now = Date.now() } = {}) {
    const status = f.status ?? "live";
    const since = startOf(f.added ?? "any", now);
    const origins = SOURCE_ORIGINS[f.source] ?? null;
    return groups.filter((g) => {
      if (f.lang && g.lang !== f.lang) return false;
      if (status === "active" && g.paused) return false;
      if (status === "paused" && !g.paused) return false;
      if (g.created < since) return false;
      if (origins && !origins.includes(g.origin)) return false;
      if (f.meaningIn && !g.bases.includes(f.meaningIn)) return false;
      if (f.missingIn && g.bases.includes(f.missingIn)) return false;
      return true;
    });
  }

  // The shelf (§2): one entry per language with words, most words first.
  function shelf(groups, { now = Date.now(), hiddenLangs = [], languageName = (l) => l, uiLocale = "en" } = {}) {
    const by = new Map();
    const weekAgo = now - 7 * DAY;
    for (const g of groups) {
      const e = by.get(g.lang) ?? by.set(g.lang, { lang: g.lang, count: 0, week: 0, paused: 0 }).get(g.lang);
      e.count++;
      if (g.created >= weekAgo) e.week++;
      if (g.paused) e.paused++;
    }
    const c = collator(uiLocale);
    const hidden = new Set(hiddenLangs);
    return [...by.values()]
      .map((e) => ({ ...e, hidden: hidden.has(e.lang), name: languageName(e.lang) ?? e.lang }))
      .sort((a, b) => b.count - a.count || c.compare(a.name, b.name));
  }

  // --- Tombstones (§3 Recently deleted) -----------------------------------------------------

  // Entries {id, at, word} from the background's `recentlyDeleted`, within the 30-day
  // window, grouped like live words.
  function deletedGroups(entries, { now = Date.now(), bases } = {}) {
    const fresh = (Array.isArray(entries) ? entries : []).filter((e) => e?.word && now - (e.at ?? 0) < DELETED_DAYS * DAY);
    const groups = groupRecords(
      fresh.map((e) => ({ ...e.word, deleted_at: e.word.deleted_at ?? new Date(e.at).toISOString() })),
      { bases },
    );
    return groups.sort((a, b) => b.deletedAt - a.deletedAt);
  }

  // --- Routes (§1) ----------------------------------------------------------------------------

  const ROUTE_KEYS = ["lang", "status", "q", "sort", "added", "source"];

  // "#words/abc?lang=es&q=thank" -> { view: "words", id: "abc", params: {lang: "es", q: "thank"} }
  function parseRoute(hash) {
    const raw = String(hash ?? "").replace(/^#/, "");
    const [path, query = ""] = raw.split("?");
    const [view, ...rest] = path.split("/").map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
    const params = {};
    for (const [k, v] of new URLSearchParams(query)) if (ROUTE_KEYS.includes(k) && v) params[k] = v;
    if (params.status && !STATUSES.includes(params.status)) delete params.status;
    if (params.sort && !SORTS.includes(params.sort)) delete params.sort;
    if (params.added && !ADDED.includes(params.added)) delete params.added;
    if (params.source && !SOURCES.includes(params.source)) delete params.source;
    if (view === "settings") return { view, section: rest[0] || null, params: {} };
    if (view === "add") return { view, params: {} };
    return { view: "words", id: view === "words" && rest[0] ? rest[0] : null, params };
  }

  const DEFAULT_PARAMS = { status: "live", sort: "newest", added: "any", source: "any" };

  function formatRoute({ view = "words", id = null, section = null, params = {} } = {}) {
    if (view === "settings") return section ? `#settings/${encodeURIComponent(section)}` : "#settings";
    if (view === "add") return "#add";
    const q = new URLSearchParams();
    for (const k of ROUTE_KEYS) if (params[k] && params[k] !== DEFAULT_PARAMS[k]) q.set(k, params[k]);
    const qs = q.toString();
    return `#words${id ? `/${encodeURIComponent(id)}` : ""}${qs ? `?${qs}` : ""}`;
  }

  // --- Undo (§5, §6: Ctrl/Cmd+Z undoes the last change on this page) -----------------------

  function createUndoStack(max = 50) {
    const items = [];
    return {
      push(entry) {
        items.push(entry);
        if (items.length > max) items.shift();
        return entry;
      },
      pop: () => items.pop() ?? null,
      remove(entry) {
        const i = items.indexOf(entry);
        if (i >= 0) items.splice(i, 1);
      },
      peek: () => items.at(-1) ?? null,
      get size() {
        return items.length;
      },
    };
  }

  // --- The pronunciation refresh line (§3) ----------------------------------------------------

  // The job's state -> { key, params, action } for the line, or null when nothing shows.
  function refreshLine(job, { formatTime = (iso) => iso } = {}) {
    if (!job || typeof job !== "object") return null;
    const done = Number(job.done) || 0;
    const total = Number(job.total) || 0;
    switch (job.state) {
      case "running":
        return { key: "dash_refresh_running", params: { done, total }, action: "pause" };
      case "waiting":
        return job.retry_at
          ? { key: "dash_refresh_waiting", params: { time: formatTime(job.retry_at) }, action: "pause" }
          : { key: "dash_refresh_no_provider", params: {}, action: "setup" };
      case "paused":
        return { key: "dash_refresh_paused", params: { done, total }, action: "resume" };
      default:
        return null;
    }
  }

  // --- Inline checks on edits (§5) -------------------------------------------------------------

  const hasKey = (base) => Object.hasOwn(KEY_LETTERS, primary(base));
  const capital = (s) => {
    const letters = s.replace(/[^\p{L}]/gu, "");
    return letters !== "" && letters.toUpperCase() === letters && letters.toLowerCase() !== letters;
  };

  // null when `p` follows 07 §7's format for this target and base, else "letters" (a
  // character outside the base's key), "stress" (capitals on no syllable, several, or on a
  // word without stress) or "too_long".
  function pronunciationProblem(p, target, base) {
    const value = text(p);
    if (!value) return null;
    if ([...value].length > MAX_PRON) return "too_long";
    const letters = KEY_LETTERS[primary(base)];
    if (!letters) return null;
    const tones = TONES[primary(target)] ?? null;
    if (!new RegExp(`^[${letters}${tones ? "0-9" : ""}' -]+$`, "u").test(value)) return "letters";
    const t = primary(target);
    const stress = LEXICAL.has(t) ? "lexical" : NO_STRESS.has(t) ? "none" : "unknown";
    for (const word of value.split(" ").filter(Boolean)) {
      const syls = word.split("-");
      if (syls.some((s) => !s.replace(/[0-9]+$/, "") || /[0-9]/.test(s.replace(/[0-9]+$/, "")))) return "letters";
      if (!tones && syls.some((s) => /[0-9]/.test(s))) return "letters";
      // A syllable is all lowercase or all capitals.
      if (syls.some((s) => { const l = s.replace(/[^\p{L}]/gu, ""); return l !== l.toUpperCase() && l !== l.toLowerCase(); })) return "stress";
      const caps = syls.filter(capital).length;
      if (stress === "lexical" && (syls.length >= 2 ? caps !== 1 : caps !== 0)) return "stress";
      if (stress === "none" && caps) return "stress";
    }
    return null;
  }

  // The syllable the acute in `vocalized` (пожа́луйста) stresses, counted in vowels, against
  // the capital syllable of a one-word pronunciation. True when they disagree.
  function stressMismatch(vocalized, pronunciation) {
    const v = text(vocalized);
    const p = text(pronunciation);
    if (!v || !p || p.includes(" ")) return false;
    const d = v.normalize("NFD");
    const at = d.indexOf("\u0301");
    if (at < 0) return false;
    const vowels = /[аеёиоуыэюяіїєaeiouy]/i;
    let n = 0;
    for (const ch of d.slice(0, at)) if (vowels.test(ch)) n++;
    const syls = p.split("-");
    const cap = syls.findIndex(capital);
    if (cap < 0 || syls.length < 2) return false;
    return cap + 1 !== n;
  }

  // "+ Add" in the forms editor: one or several, separated by commas (or 、 ， for Japanese
  // and Chinese bases), trimmed, without repeats of each other.
  function splitForms(input, base) {
    const sep = ["ja", "zh"].includes(primary(base)) ? /[,、，]/ : /,/;
    const seen = new Set();
    const out = [];
    for (const part of String(input ?? "").split(sep)) {
      const t = part.trim();
      if (!t || seen.has(t.toLocaleLowerCase())) continue;
      seen.add(t.toLocaleLowerCase());
      out.push(t);
    }
    return out;
  }

  // --- Small things ----------------------------------------------------------------------------

  // A UUIDv7 (RFC 9562) for client_request_id, so a retried save is stored once (24 §3).
  function uuid7(now = Date.now(), random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
    const b = random(16);
    let ms = BigInt(Math.max(0, Math.floor(now)));
    for (let i = 5; i >= 0; i--) {
      b[i] = Number(ms & 0xffn);
      ms >>= 8n;
    }
    b[6] = (b[6] & 0x0f) | 0x70;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // "Added" (§3): relative for a week ("Today", "2 days ago"), then a date.
  function addedLabel(ts, { now = Date.now(), locale = "en" } = {}) {
    if (!ts) return "";
    const day = (t) => {
      const d = new Date(t);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    };
    const days = Math.round((day(now) - day(ts)) / DAY);
    if (days >= 0 && days < 7) {
      try {
        // A column label, so "Today", not "today".
        const s = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day");
        return s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);
      } catch {
        return new Date(ts).toLocaleDateString();
      }
    }
    const opts = { month: "short", day: "numeric" };
    if (new Date(ts).getFullYear() !== new Date(now).getFullYear()) opts.year = "numeric";
    try {
      return new Intl.DateTimeFormat(locale, opts).format(new Date(ts));
    } catch {
      return new Date(ts).toLocaleDateString();
    }
  }

  // Languages offered under "Other language…" when moving a word (slice 08 owns the full
  // list; these are the tags the server's lookups produce most).
  const COMMON_LANGS = (
    "af am ar az be bg bn bs ca cs cy da de el en eo es et eu fa fi fil fr ga gl gu he hi hr hu hy id is it ja ka kk km kn ko ky la lo lt lv mk ml mn mr ms mt my nb ne nl pa pl ps pt ro ru si sk sl sq sr sv sw ta te th tl tr uk ur uz vi yi yue zh zh-Hant zu"
  ).split(" ");

  const api = {
    DAY,
    DELETED_DAYS,
    STRESS_LANGS,
    SORTS,
    STATUSES,
    ADDED,
    SOURCES,
    COMMON_LANGS,
    primary,
    nativeKey,
    groupKey,
    formTexts,
    enabledForms,
    groupRecords,
    finishGroup,
    meaningOf,
    sortGroups,
    filterGroups,
    shelf,
    deletedGroups,
    parseRoute,
    formatRoute,
    createUndoStack,
    refreshLine,
    hasKey,
    pronunciationProblem,
    stressMismatch,
    splitForms,
    uuid7,
    addedLabel,
  };
  globalThis.KotikoDashModel = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
