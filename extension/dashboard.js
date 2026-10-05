// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Kotiko's dashboard (slice 21): every word, live. The language shelf, a virtualized list
// with search and filters, an inspector that saves as you type, delete and bulk actions
// with Undo, Recently deleted, the pronunciation-refresh line, adding words, and the
// settings hub. Every string comes from _locales through KotikoI18n; word data is only
// ever set as text.
//
// Data goes through lib/word-source.js: the background answers from the extension's own
// store when words live in this browser, or from the server's /api/v1 (slice 11). Pure
// rules are in lib/dashboard-model.js, search in lib/word-search.js. The settings hold
// slice 11's Word lookups (the learner's own AI and key) and the words' home.
(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  const I18n = globalThis.KotikoI18n;
  const Icons = globalThis.KotikoIcons;
  const Speak = globalThis.KotikoSpeak;
  const Cards = globalThis.KotikoWordCard;
  const Search = globalThis.KotikoSearch;
  const M = globalThis.KotikoDashModel;
  const LookupStatus = globalThis.KotikoLookupStatus;
  // Base-language rules and language data (slice 50), shared with the welcome tab.
  const Bases = globalThis.KotikoWelcomeModel;
  const Lang = globalThis.KotikoLang;
  const SPEC = globalThis.KOTIKO_SPEC;
  const { t } = I18n;
  const $ = (id) => document.getElementById(id);

  const ROW_WIDE = 52;
  const ROW_NARROW = 64;
  const OVERSCAN = 10;
  const TOAST_MS = 10_000;
  const SAVED_MS = 1500;
  const SKELETON_MS = 150;
  const REFRESH_POLL_MS = 15_000;
  const RETRY_MS = 30_000;
  const RELOAD_DEBOUNCE_MS = 250;
  const NEW_MS = 15_000;
  const MAX_ADD_JOBS = 6;
  const CONFIRM_AT = 4; // 24 §2: four or more words from one add are confirmed first

  const DEFAULT_SERVER = "http://localhost:4747";
  const LOCAL_DEFAULTS = {
    // Kept here before slice 11; the background moves them into its store at once.
    serverUrl: null,
    token: "",
    // Slice 11: where words live, who looks them up, which secrets exist (no key material).
    wordsHome: null,
    lookup: null,
    server: null,
    keys: null,
    hiddenLangs: [],
    lastSync: null,
    syncError: null,
    baseLangs: null,
    speech: { allowOnline: false, rate: 0.9, voices: {} },
    prefs: {},
    mixing: null,
    lastBackupAt: null, // slice 12: the last backup saved or restored
  };

  // ---------------------------------------------------------------------------------
  // State.

  const state = {
    s: { ...LOCAL_DEFAULTS },
    records: new Map(), // id -> server record
    overlay: new Map(), // id -> patch applied optimistically
    removing: new Set(), // ids deleted optimistically
    waiting: new Map(), // id -> ops that couldn't reach the server ("Waiting to save")
    groups: [],
    byId: new Map(), // group id -> group
    groupOf: new Map(), // record id -> group id
    sorted: [], // groups in sort order
    view: [], // group ids shown, after filters and search
    deleted: [], // recentlyDeleted entries
    deletedGroups: [],
    route: { view: "words", id: null, params: {} },
    selected: new Set(),
    anchor: null,
    active: 0,
    open: null, // group id in the inspector
    newIds: new Map(), // group id -> time it arrived
    hiddenNew: new Set(), // new group ids the filters hide
    loaded: false,
    loadError: null,
    job: null,
    online: navigator.onLine !== false,
    addJobs: [],
    hint: null, // language hint for the add box ("Start a language")
    lookupStatus: null, // the server's free lookups left today (slice 10)
    backend: null, // backend.get: presets and settings (slice 11)
    masked: {}, // secrets.describe: "sk-or-…a1b2" per secret id
    replacing: false,
    testing: false,
    lookupTest: null,
    move: null, // {to, count, server, busy, error}
    ui: {}, // storage.sync `ui`: baseLangs, baseLangsDetected, uiLang (slice 50)
    langList: null, // every language a learner can read in, named in the interface language
  };

  const index = Search.createIndex();
  const indexSig = new Map();
  const deletedIndex = Search.createIndex();
  const undoStack = M.createUndoStack();
  let source = null;
  let rowH = ROW_WIDE;
  let jobSeq = 0;

  // ---------------------------------------------------------------------------------
  // DOM helpers (text only: words, notes and server text are never parsed as HTML).

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (k in node && typeof v !== "string") node[k] = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    node.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
    return node;
  }
  const icon = (name, size) => Icons.icon(name, size);
  const bdi = (text, lang, cls) => el("bdi", { class: cls, lang: lang || null, dir: "auto" }, text ?? "");
  const languageName = (lang, fallback) => I18n.languageName(lang) ?? fallback ?? lang;
  const endonym = (lang) => I18n.endonym(lang) ?? languageName(lang);
  const isTyping = (node) =>
    node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node?.isContentEditable === true;
  // After "delete everything" this page asks for nothing more, so nothing is recreated.
  const send = (msg) => (state.wiped && msg.type !== "data.deleteAll" && msg.type !== "welcome.open" ? Promise.reject(Object.assign(new Error("Everything was deleted."), { code: "wiped" })) : Promise.resolve().then(() => ext.runtime.sendMessage(msg)));

  // Slice 11: where words live and whether new ones can be looked up.
  const legacyToken = (s) => !!String(s?.token ?? "").trim();
  const mode = (s) => s?.wordsHome ?? (legacyToken(s) ? "server" : "local");
  const serverKey = (s) => s?.keys?.server === true || legacyToken(s);
  const hasToken = (s) => mode(s) === "server" && serverKey(s);
  const lookupKind = (s) => s?.lookup?.kind ?? (legacyToken(s) ? "server" : "none");
  const preset = (id) => state.backend?.providers?.find((p) => p.id === id) ?? null;
  function lookupReady(s) {
    const kind = lookupKind(s);
    if (kind === "server") return serverKey(s);
    if (kind !== "provider") return false;
    const p = preset(s.lookup.provider);
    return p ? !p.keyRequired || s.keys?.providers?.[p.id] === true : s.keys?.providers?.[s.lookup.provider] === true;
  }

  // Sets matched letters in weight 600 (§4), not by color alone.
  function highlighted(text, query, lang) {
    const ranges = query ? Search.highlight(text, query, lang) : [];
    if (!ranges.length) return [text];
    const out = [];
    let at = 0;
    for (const [a, b] of ranges) {
      if (a > at) out.push(text.slice(at, a));
      out.push(el("mark", { class: "hit" }, text.slice(a, b)));
      at = b;
    }
    if (at < text.length) out.push(text.slice(at));
    return out;
  }

  // ---------------------------------------------------------------------------------
  // Records -> groups -> the list.

  function effective(r) {
    const o = state.overlay.get(r.id);
    return o ? { ...r, ...o } : r;
  }

  function bases() {
    const synced = Array.isArray(state.ui?.baseLangs) && state.ui.baseLangs.length ? state.ui.baseLangs : null;
    const stored = synced ?? (Array.isArray(state.s.baseLangs) && state.s.baseLangs.length ? state.s.baseLangs : null);
    if (stored) return stored.slice(0, Bases.MAX_BASES);
    // Until slice 50: the bases words already have, English first (today's pages).
    const seen = new Set(["en"]);
    for (const r of state.records.values()) seen.add(r.base_lang ?? "en");
    return [...seen];
  }
  const primaryBase = () => bases()[0] ?? "en";

  // Rebuilds groups from the records (with optimistic changes), the search index for the
  // groups that changed, and the sort. Returns ids of groups that weren't there before.
  function rebuild() {
    const before = new Set(state.byId.keys());
    const live = [];
    for (const r of state.records.values()) if (!state.removing.has(r.id)) live.push(effective(r));
    state.groups = M.groupRecords(live, { bases: bases() });
    state.byId = new Map(state.groups.map((g) => [g.id, g]));
    state.groupOf = new Map();
    for (const g of state.groups) for (const r of g.records) state.groupOf.set(r.id, g.id);
    for (const g of state.groups) {
      if (indexSig.get(g.id) === g.sig) continue;
      index.set(g.id, Search.entryFor(g));
      indexSig.set(g.id, g.sig);
    }
    for (const id of indexSig.keys()) {
      if (!state.byId.has(id)) {
        index.delete(id);
        indexSig.delete(id);
      }
    }
    resort();
    const added = [];
    if (state.loaded) for (const id of state.byId.keys()) if (!before.has(id)) added.push(id);
    return added;
  }

  function rebuildDeleted() {
    state.deletedGroups = M.deletedGroups(state.deleted, { bases: bases() });
    deletedIndex.clear();
    for (const g of state.deletedGroups) deletedIndex.set(g.id, Search.entryFor(g));
  }

  const params = () => state.route.params ?? {};
  const isDeletedView = () => params().status === "deleted";

  function resort() {
    const list = isDeletedView() ? state.deletedGroups : state.groups;
    state.sorted = isDeletedView()
      ? list.slice()
      : M.sortGroups(list, params().sort ?? "newest", { uiLocale: I18n.locale(), primaryBase: primaryBase(), languageName: (l) => languageName(l) });
    refilter();
  }

  function groupById(id) {
    return state.byId.get(id) ?? state.deletedGroups.find((g) => g.id === id) ?? null;
  }

  function refilter() {
    const p = params();
    const deleted = isDeletedView();
    const filtered = deleted
      ? state.sorted.filter((g) => !p.lang || g.lang === p.lang)
      : M.filterGroups(state.sorted, { lang: p.lang, status: p.status ?? "live", added: p.added, source: p.source, missingIn: p.missing }, { now: Date.now() });
    // 13's "See them": the words of the last bulk add.
    const batch = p.batch && state.batchIds ? filtered.filter((g) => g.records.some((r) => state.batchIds.has(r.id))) : filtered;
    const ids = batch.map((g) => g.id);
    state.view = p.q ? (deleted ? deletedIndex : index).search(p.q, ids) : ids;
    for (const id of [...state.selected]) if (!groupById(id)) state.selected.delete(id);
    state.active = Math.min(state.active, Math.max(0, state.view.length - 1));
  }

  // ---------------------------------------------------------------------------------
  // Loading and live updates (§10).

  let reloadTimer = null;
  let loading = null;

  async function load() {
    if (loading) return loading;
    loading = (async () => {
      try {
        const records = await source.list();
        const anchor = scrollAnchor();
        state.records = new Map(records.map((r) => [r.id, r]));
        // Optimistic changes the server now has (or replaced) are dropped.
        // Optimistic changes stay until their write settles (settlePatch drops them).
        for (const id of [...state.overlay.keys()]) if (!state.records.has(id)) state.overlay.delete(id);
        for (const id of [...state.removing]) if (!state.records.has(id)) state.removing.delete(id);
        const added = rebuild();
        state.loadError = null;
        const first = !state.loaded;
        state.loaded = true;
        if (!first) markArrivals(added);
        renderWords({ anchor });
        if (first) openFromRoute();
        else refreshInspector();
      } catch (e) {
        state.loadError = e;
        state.loaded = true;
        renderWords();
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  async function loadDeleted() {
    try {
      state.deleted = await source.deleted();
    } catch {
      state.deleted = [];
    }
    rebuildDeleted();
    if (isDeletedView()) {
      resort();
      renderWords();
    }
  }

  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => load(), RELOAD_DEBOUNCE_MS);
  }

  // A new word that matches the filters arrives with the swap motion and a wash; one that
  // doesn't is counted in a quiet strip (§10).
  function markArrivals(ids) {
    const now = Date.now();
    const shown = new Set(state.view);
    for (const id of ids) {
      if (shown.has(id)) state.newIds.set(id, now);
      else state.hiddenNew.add(id);
    }
    setTimeout(() => {
      for (const [id, at] of state.newIds) if (Date.now() - at >= NEW_MS) state.newIds.delete(id);
      renderWindow(true);
    }, NEW_MS + 50);
  }

  // The first visible row's id and its offset, so changes above it don't move the view.
  function scrollAnchor() {
    const body = $("gridBody");
    if (!body || !state.view.length) return null;
    const i = Math.floor(body.scrollTop / rowH);
    const id = state.view[i];
    return id ? { id, offset: body.scrollTop - i * rowH } : null;
  }

  // ---------------------------------------------------------------------------------
  // Writes: optimistic, then through the source; failures roll back or wait (§5, §11).

  function overlayPatch(id, patch) {
    const merged = { ...(state.overlay.get(id) ?? {}), ...patch };
    // 07's update: clearing the pronunciation clears all three fields; editing either sets
    // the source to the learner's own.
    if ("pronunciation" in patch && !patch.pronunciation) Object.assign(merged, { pronunciation_careful: null, pronunciation_source: null });
    else if (("pronunciation" in patch || "pronunciation_careful" in patch) && !("pronunciation_source" in patch)) merged.pronunciation_source = "user";
    state.overlay.set(id, merged);
  }

  // Applies `items` ([{id, patch}]) at once and sends them. Resolves with per-item results.
  async function patchRecords(items, { force = false } = {}) {
    const touch = [];
    for (const it of items) {
      const r = state.records.get(it.id);
      if (r) touch.push(effective(r));
      overlayPatch(it.id, it.patch);
      if (r) touch.push(effective(r));
    }
    rebuild();
    renderWords();
    const ops = items.map((it) => {
      const r = state.records.get(it.id);
      const op = { op: "patch", id: it.id, patch: it.patch };
      if (!force && r?.updated_at) op.if_updated_at = r.updated_at;
      return op;
    });
    const results = await source.write(ops, { touch });
    results.forEach((res, i) => settlePatch(items[i], res));
    rebuild();
    renderWords();
    refreshInspector();
    return results;
  }

  function settlePatch(item, res) {
    const id = item.id;
    if (res.ok && res.word) {
      state.records.set(id, res.word);
      if (!state.waiting.has(id)) state.overlay.delete(id);
      return;
    }
    if (isOffline(res.code)) {
      // Keep the change and send it again when the server is back (§11).
      const queued = state.waiting.get(id) ?? {};
      state.waiting.set(id, { ...queued, ...item.patch });
      scheduleRetry();
      return;
    }
    if (res.code === "word_conflict" && res.details?.reason === "stale" && res.details.word) {
      state.records.set(id, res.details.word);
    }
    state.overlay.delete(id);
  }

  const isOffline = (code) => code === "server_unreachable" || code === "offline";

  let retryTimer = null;
  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(retryWaiting, RETRY_MS);
  }

  async function retryWaiting() {
    retryTimer = null;
    if (!state.waiting.size) return;
    const items = [...state.waiting].map(([id, patch]) => ({ id, patch }));
    state.waiting.clear();
    const results = await source.write(items.map((it) => ({ op: "patch", id: it.id, patch: it.patch })), { touch: [] });
    results.forEach((res, i) => settlePatch(items[i], res));
    rebuild();
    renderWords();
    refreshInspector();
  }

  async function deleteGroups(ids, { undoable = true } = {}) {
    const groups = ids.map(groupById).filter(Boolean);
    if (!groups.length) return;
    const recordIds = groups.flatMap((g) => g.records.map((r) => r.id));
    for (const id of recordIds) state.removing.add(id);
    if (groups.some((g) => g.id === state.open)) closeInspector({ focusList: true });
    for (const g of groups) state.selected.delete(g.id);
    rebuild();
    renderWords();
    const results = await source.write(recordIds.map((id) => ({ op: "delete", id })), { touch: groups.flatMap((g) => g.records) });
    const failed = [];
    results.forEach((res, i) => {
      const id = recordIds[i];
      if (res.ok || res.code === "word_gone") state.records.delete(id);
      else failed.push(res);
      state.removing.delete(id);
    });
    rebuild();
    renderWords();
    if (failed.length) return toast({ text: problemText(failed[0]), error: true });
    if (!undoable) return;
    const label = groups.length === 1
      ? I18n.parts("dash_toast_deleted_word", { native: bdi(groups[0].native, groups[0].lang) })
      : [t("dash_toast_deleted", { count: groups.length })];
    const entry = undoStack.push({ run: () => restoreRecords(recordIds, { undoable: false }) });
    toast({ parts: label, undo: entry });
  }

  async function restoreRecords(recordIds, { undoable = true } = {}) {
    const results = await source.write(recordIds.map((id) => ({ op: "restore", id })), { touch: [] });
    const restored = [];
    let problem = null;
    results.forEach((res, i) => {
      if (res.ok && res.word) {
        state.records.set(recordIds[i], res.word);
        restored.push(res.word);
      } else problem ??= res;
    });
    state.deleted = state.deleted.filter((e) => !recordIds.includes(e.id) || !restored.some((w) => w.id === e.id));
    rebuildDeleted();
    rebuild();
    renderWords();
    if (problem) toast({ text: problemText(problem), error: true });
    if (undoable && restored.length) {
      const n = M.groupRecords(restored).length;
      toast({ text: t("dash_toast_restored", { count: n }) });
    }
    return results;
  }

  // Pause or resume groups (§5 "Swap on pages", §6, P).
  async function setPaused(ids, paused, { undoable = true } = {}) {
    const groups = ids.map((id) => state.byId.get(id)).filter(Boolean);
    const items = [];
    const before = [];
    for (const g of groups) {
      for (const r of g.records) {
        const status = paused ? "paused" : "active";
        if (r.status === status) continue;
        items.push({ id: r.id, patch: { status } });
        before.push({ id: r.id, patch: { status: r.status ?? "active" } });
      }
    }
    if (!items.length) return;
    const results = await patchRecords(items, { force: true });
    const bad = results.find((r) => !r.ok && !isOffline(r.code));
    if (bad) return toast({ text: problemText(bad), error: true });
    if (!undoable) return;
    const entry = undoStack.push({ run: () => patchRecords(before, { force: true }) });
    const one = groups.length === 1;
    toast({
      parts: one
        ? I18n.parts(paused ? "dash_toast_paused_word" : "dash_toast_resumed_word", { native: bdi(groups[0].native, groups[0].lang) })
        : [t(paused ? "dash_toast_paused" : "dash_toast_resumed", { count: groups.length })],
      undo: entry,
    });
  }

  // Move to another language (§5): every record in each group.
  async function moveGroups(ids, lang, { undoable = true } = {}) {
    const groups = ids.map((id) => state.byId.get(id)).filter((g) => g && g.lang !== lang);
    if (!groups.length) return;
    const items = [];
    const before = [];
    for (const g of groups) {
      for (const r of g.records) {
        items.push({ id: r.id, patch: { lang } });
        before.push({ id: r.id, patch: { lang: r.lang } });
      }
    }
    const results = await patchRecords(items, { force: true });
    const bad = results.find((r) => !r.ok && !isOffline(r.code));
    if (bad) return toast({ text: problemText(bad, { lang }), error: true });
    if (!undoable) return;
    const entry = undoStack.push({ run: () => patchRecords(before, { force: true }) });
    toast({
      parts: groups.length === 1
        ? I18n.parts("dash_toast_moved_word", { native: bdi(groups[0].native, lang), language: languageName(lang) })
        : [t("dash_toast_moved", { count: groups.length, language: languageName(lang) })],
      undo: entry,
    });
  }

  async function undoLast() {
    const entry = undoStack.pop();
    if (!entry) return false;
    dismissToastFor(entry);
    await entry.run();
    return true;
  }

  // ---------------------------------------------------------------------------------
  // Plain-language problems (slice 25).

  function problemText(res, { field = null, lang = null } = {}) {
    const code = res?.code ?? "internal";
    const d = res?.details ?? {};
    const n = state.groups.length;
    switch (code) {
      case "server_unreachable":
      case "offline":
        return n ? t("error_server_unreachable", { count: n }) : t("error_server_unreachable_empty");
      case "server_key_rejected":
        return t("error_server_key_rejected");
      case "server_address_invalid":
        return t("error_server_address_invalid");
      case "not_kotiko_server":
        return t("error_not_kotiko_server");
      case "server_outdated":
        return t("dash_error_server_outdated");
      case "word_gone":
        return t("dash_error_word_gone");
      case "word_conflict":
        if (d.reason === "duplicate") return t("dash_error_duplicate", { language: languageName(lang ?? "") });
        return t("dash_conflict");
      case "invalid_word":
        return invalidText(d.reason ?? null, field ?? d.field);
      default: {
        // A failed lookup (slice 10's codes).
        const lookup = LookupStatus.lookupProblem(code, d, { locale: I18n.locale(), local: lookupKind(state.s) !== "server" });
        return lookup ? t(lookup.key, lookup.params) : t("error_internal");
      }
    }
  }

  function invalidText(reason, field) {
    switch (reason) {
      case "stress":
        return t("dash_pron_stress");
      case "letters":
        return t("dash_pron_letters");
      case "bad_pronunciation":
        return field === "pronunciation" || field === "pronunciation_careful" ? t("dash_pron_stress") : t("dash_invalid");
      case "stress_mismatch":
        return t("dash_stress_mismatch");
      case "bad_vocalized":
        return t("dash_vocalized_other_word");
      case "bad_romanization":
        return t("dash_bad_romanization");
      case "too_long":
        return t("dash_too_long");
      case "missing_field":
        return t("dash_required");
      case "no_usable_forms":
        return t("dash_forms_last");
      case "target_is_base":
        return t("dash_target_is_base");
      default:
        return t("dash_invalid");
    }
  }

  // ---------------------------------------------------------------------------------
  // Header, banners and summary.

  function currentBanner() {
    const s = state.s;
    // Words in this browser: no server to be connected to; say when no AI is set up.
    if (mode(s) === "local") {
      if (state.loadError) return { severity: "state", text: problemText(state.loadError), action: { label: t("error_try_again_action"), run: () => tryAgain() } };
      return lookupReady(s) ? null : { severity: "info", text: t("dash_lookups_off_banner"), action: { label: t("popup_set_up_lookups"), run: () => go("#settings/lookups") } };
    }
    if (!hasToken(s)) {
      return { severity: "info", text: t("dash_not_connected"), action: { label: t("error_connection_settings_action"), run: () => go("#settings/connection") } };
    }
    if (!state.online) return { severity: "info", text: t("dash_offline") };
    const err = state.loadError ?? (s.syncError?.code && s.syncError.code !== "server_key_rejected" ? s.syncError : null) ?? (s.syncError?.code === "server_key_rejected" && s.syncError.details?.reason !== "no_token" ? s.syncError : null);
    if (!err) return null;
    const blocking = ["server_key_rejected", "server_address_invalid", "not_kotiko_server"].includes(err.code);
    return {
      severity: blocking ? "blocking" : "state",
      text: problemText(err),
      details: [err.message, err.details?.status ? `HTTP ${err.details.status}` : null].filter(Boolean).join("\n"),
      action: blocking
        ? { label: t("error_connection_settings_action"), run: () => go("#settings/connection") }
        : { label: t("error_try_again_action"), run: () => tryAgain() },
    };
  }

  async function tryAgain() {
    await source.syncNow();
    state.s = { ...state.s, ...(await ext.storage.local.get({ syncError: null, lastSync: null })) };
    await load();
    renderBanners();
  }

  const SEVERITY_ICON = { state: "warning", info: "info", blocking: "error" };

  function renderBanners() {
    const host = $("banners");
    const b = currentBanner();
    const open = host.querySelector("details")?.open;
    host.replaceChildren();
    if (!b) return;
    const node = el("div", { class: `banner banner-${b.severity}`, "data-severity": b.severity },
      icon(SEVERITY_ICON[b.severity]),
      el("p", { class: "banner-body" }, b.text),
      b.action ? el("div", { class: "banner-actions" }, el("button", { class: "btn btn-secondary btn-sm", type: "button", onclick: b.action.run }, b.action.label)) : null,
      b.details ? el("details", { class: "details", open: !!open }, el("summary", {}, t("error_details")), el("pre", {}, b.details)) : null);
    host.append(node);
  }

  function renderSummary() {
    const n = state.groups.length;
    const langs = new Set(state.groups.map((g) => g.lang)).size;
    $("summary").textContent = n ? t(langs === 1 ? "dash_summary_one_lang" : "dash_summary", { count: n, langs: I18n.formatNumber(langs) }) : "";
  }

  // ---------------------------------------------------------------------------------
  // The language shelf (§2, §7).

  function renderShelf() {
    const list = $("shelf");
    const p = params();
    const entries = M.shelf(state.groups, { hiddenLangs: state.s.hiddenLangs, languageName: (l) => languageName(l), uiLocale: I18n.locale() });
    $("shelfWrap").hidden = !state.loaded || (!entries.length && !isDeletedView());
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset.lang ?? "" : null;
    const card = (lang, title, sub, count, meta, extra = {}) => {
      const selected = (p.lang ?? "") === lang;
      const main = el("button", {
        class: "shelf-card",
        type: "button",
        "data-lang": lang,
        "aria-pressed": String(selected),
        "aria-label": extra.label,
        onclick: () => setParams({ lang: selected && lang ? null : lang || null }),
      },
      el("span", { class: "shelf-title", lang: lang || null, dir: "auto" }, title),
      el("span", { class: "shelf-sub" }, sub),
      el("span", { class: "shelf-foot" },
        el("span", { class: "shelf-count num" }, I18n.formatNumber(count)),
        meta));
      const li = el("li", { class: `shelf-item${extra.hidden ? " is-hidden" : ""}` }, main);
      if (extra.menu) {
        li.append(el("button", {
          class: "shelf-more btn btn-icon",
          type: "button",
          "aria-haspopup": "menu",
          "aria-expanded": "false",
          "aria-label": t("dash_shelf_menu", { language: sub }),
          title: t("dash_shelf_menu", { language: sub }),
          onclick: (e) => openShelfMenu(e.currentTarget, extra.menu),
        }, icon("more", 18)));
      }
      return li;
    };
    const total = state.groups.length;
    const items = [card("", t("dash_shelf_all"), t("dash_shelf_all_sub"), total, null, { label: t("dash_shelf_all_label", { count: total }) })];
    for (const e of entries) {
      const meta = [];
      if (e.week) meta.push(el("span", { class: "shelf-week" }, t("dash_shelf_week", { count: e.week })));
      if (e.hidden) meta.push(el("span", { class: "shelf-hidden" }, icon("circle", 12), t("dash_shelf_hidden")));
      const label = t(e.hidden ? "dash_shelf_card_label_hidden" : "dash_shelf_card_label", { language: e.name, endonym: endonym(e.lang), count: e.count });
      items.push(card(e.lang, endonym(e.lang), e.name, e.count, meta, { label, hidden: e.hidden, menu: e }));
    }
    items.push(el("li", { class: "shelf-item" }, el("button", { class: "shelf-card shelf-start", type: "button", onclick: startLanguage },
      icon("add", 20), el("span", { class: "shelf-start-text" }, t("dash_shelf_start")))));
    list.replaceChildren(...items);
    if (focused !== null) [...list.querySelectorAll(".shelf-card")].find((c) => (c.dataset.lang ?? "") === focused)?.focus();
  }

  function openShelfMenu(anchor, entry) {
    const hidden = (state.s.hiddenLangs ?? []).includes(entry.lang);
    openMenu(anchor, [
      { label: t(hidden ? "dash_shelf_show" : "dash_shelf_hide", { language: entry.name }), run: () => toggleHidden(entry.lang) },
      { label: t("dash_shelf_delete_all", { language: entry.name }), danger: true, run: () => deleteLanguage(entry) },
    ]);
  }

  async function toggleHidden(lang) {
    const { hiddenLangs = [] } = await ext.storage.local.get({ hiddenLangs: [] });
    const set = new Set(hiddenLangs);
    if (set.has(lang)) set.delete(lang);
    else set.add(lang);
    state.s.hiddenLangs = [...set];
    renderShelf();
    await ext.storage.local.set({ hiddenLangs: [...set] });
  }

  // The one confirmed action (§6): one click affecting a whole language.
  async function deleteLanguage(entry) {
    const ok = await confirmDialog({
      text: t("dash_confirm_delete_lang", { count: entry.count, language: entry.name }),
      confirm: t("dash_confirm_delete_lang_action", { count: entry.count }),
    });
    if (!ok) return;
    if (params().lang === entry.lang) setParams({ lang: null });
    await deleteGroups(state.groups.filter((g) => g.lang === entry.lang).map((g) => g.id));
  }

  async function startLanguage() {
    const lang = await pickLanguage({ title: t("dash_start_title"), exclude: new Set() });
    if (!lang) return;
    state.hint = lang;
    go("#add");
  }

  // ---------------------------------------------------------------------------------
  // Search and filter chips (§3, §4).

  const STATUS_KEYS = { live: "dash_status_live", active: "dash_status_active", paused: "dash_status_paused", deleted: "dash_status_deleted" };
  const ADDED_KEYS = { any: "dash_added_any", today: "dash_added_today", week: "dash_added_week", month: "dash_added_month" };
  const SOURCE_KEYS = { any: "dash_source_any", typed: "dash_source_typed", imported: "dash_source_imported", telegram: "dash_source_telegram" };
  const SORT_KEYS = { newest: "dash_sort_newest", oldest: "dash_sort_oldest", native: "dash_sort_native", meaning: "dash_sort_meaning", language: "dash_sort_language" };

  function renderFilters() {
    const p = params();
    const chip = (name, keys, value, def, { clearable = true } = {}) => {
      const active = value !== def;
      const btn = el("button", {
        class: `filter${active ? " is-active" : ""}`,
        type: "button",
        "data-filter": name,
        "aria-haspopup": "menu",
        "aria-expanded": "false",
        onclick: (e) => openMenu(e.currentTarget, Object.entries(keys).map(([v, k]) => ({
          label: t(k),
          checked: v === value,
          run: () => setParams({ [name]: v === def ? null : v }),
        })), { radio: true }),
      }, el("span", {}, t(keys[value] ?? keys[def])), el("span", { class: "filter-caret", "aria-hidden": "true" }));
      const wrap = el("span", { class: "filter-wrap" }, btn);
      if (active && clearable) {
        wrap.append(el("button", {
          class: "filter-clear",
          type: "button",
          "aria-label": t("dash_filter_clear", { filter: t(keys[value]) }),
          title: t("dash_filter_clear", { filter: t(keys[value]) }),
          onclick: () => setParams({ [name]: null }),
        }, icon("close", 14)));
      }
      return wrap;
    };
    // "Missing a meaning in français", from Settings → Languages you read in (50 §2).
    const missing = p.missing
      ? el("span", { class: "filter-wrap" },
        el("span", { class: "filter is-active", "data-filter": "missing" }, t("dash_filter_missing", { language: languageName(p.missing) })),
        el("button", {
          class: "filter-clear",
          type: "button",
          "aria-label": t("dash_filter_clear", { filter: t("dash_filter_missing", { language: languageName(p.missing) }) }),
          title: t("dash_filter_clear", { filter: t("dash_filter_missing", { language: languageName(p.missing) }) }),
          onclick: () => setParams({ missing: null }),
        }, icon("close", 14)))
      : null;
    const items = [
      missing,
      chip("status", STATUS_KEYS, p.status ?? "live", "live"),
      chip("added", ADDED_KEYS, p.added ?? "any", "any"),
      chip("source", SOURCE_KEYS, p.source ?? "any", "any"),
      el("span", { class: "filters-space" }),
      chip("sort", SORT_KEYS, p.sort ?? "newest", "newest", { clearable: false }),
    ].filter(Boolean);
    const focused = $("filters").contains(document.activeElement) ? document.activeElement.dataset.filter : null;
    $("filters").replaceChildren(...items);
    if (focused) $("filters").querySelector(`[data-filter="${focused}"]`)?.focus();
    const search = $("search");
    const n = isDeletedView() ? state.deletedGroups.length : state.groups.length;
    search.placeholder = !n ? t("dash_search_label") : isDeletedView() ? t("dash_search_deleted_placeholder", { count: n }) : t("dash_search_placeholder", { count: n });
    if (document.activeElement !== search && search.value !== (p.q ?? "")) search.value = p.q ?? "";
  }

  // ---------------------------------------------------------------------------------
  // The refresh line (§3) and the new-words strip (§10).

  function renderLines() {
    const line = M.refreshLine(state.job, {
      formatTime: (iso) => {
        try {
          return new Intl.DateTimeFormat(I18n.locale(), { timeStyle: "short" }).format(new Date(iso));
        } catch {
          return iso;
        }
      },
    });
    const box = $("refreshLine");
    box.hidden = !line || isDeletedView();
    if (line) {
      const p = Object.fromEntries(Object.entries(line.params).map(([k, v]) => [k, typeof v === "number" ? I18n.formatNumber(v) : v]));
      const text = t(line.key, p);
      // Announced at most once a minute (§3): the visible numbers follow the job, the status
      // region only when a minute has passed or the state changed.
      const now = Date.now();
      const changed = box.dataset.state !== state.job.state;
      $("refreshText").textContent = text;
      if (changed || !box.dataset.announced || now - Number(box.dataset.announced) >= 60_000) {
        $("refreshStatus").textContent = text;
        box.dataset.announced = String(now);
      }
      box.dataset.state = state.job.state;
      const action = $("refreshAction");
      action.textContent = t({ pause: "dash_refresh_pause", resume: "dash_refresh_resume", setup: "dash_refresh_setup" }[line.action]);
      action.dataset.action = line.action;
    }
    const strip = $("newStrip");
    const hidden = [...state.hiddenNew].filter((id) => state.byId.has(id));
    strip.hidden = !hidden.length;
    if (hidden.length) {
      strip.replaceChildren(
        t("dash_new_hidden", { count: hidden.length }),
        " ",
        el("button", { class: "link", type: "button", onclick: () => { state.hiddenNew.clear(); setParams({ lang: null, status: null, added: null, source: null, missing: null, q: null }); } }, t("dash_new_hidden_show")),
      );
    }
  }

  async function onRefreshAction() {
    const action = $("refreshAction").dataset.action;
    if (action === "setup") return go(mode(state.s) === "local" ? "#settings/lookups" : "#settings/connection");
    try {
      state.job = await source.refreshJob(action);
    } catch (e) {
      toast({ text: problemText(e), error: true });
    }
    renderLines();
  }

  let pollTimer = null;
  async function pollJob() {
    clearTimeout(pollTimer);
    try {
      state.job = await source.refreshJob();
    } catch {
      state.job = null;
    }
    renderLines();
    if (state.job && state.job.state !== "done") pollTimer = setTimeout(() => !document.hidden && pollJob(), REFRESH_POLL_MS);
  }

  // ---------------------------------------------------------------------------------
  // The virtualized grid (§3).

  function renderWords({ anchor = null } = {}) {
    if (!state.loaded) return;
    renderBanners();
    renderSummary();
    renderShelf();
    renderFilters();
    renderLines();
    renderList({ anchor });
    renderSelbar();
  }

  function renderList({ anchor = null } = {}) {
    const grid = $("grid");
    const body = $("gridBody");
    const n = state.view.length;
    grid.setAttribute("aria-rowcount", String(n + 1));
    $("addedHead").textContent = t(isDeletedView() ? "dash_col_deleted" : "dash_col_added");
    $("gridSpacer").style.height = `${n * rowH}px`;
    if (anchor) {
      const i = state.view.indexOf(anchor.id);
      if (i >= 0) body.scrollTop = i * rowH + anchor.offset;
    }
    renderEmpty();
    renderWindow(true);
  }

  function viewportHeight() {
    return $("gridBody").clientHeight || 640;
  }

  const rows = new Map(); // group id -> row element
  let rafPending = false;

  function onScroll() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      renderWindow(false);
    });
  }

  function renderWindow(force) {
    const body = $("gridBody");
    const n = state.view.length;
    const top = body.scrollTop;
    const first = Math.max(0, Math.floor(top / rowH) - OVERSCAN);
    const last = Math.min(n, Math.ceil((top + viewportHeight()) / rowH) + OVERSCAN);
    const want = new Map(); // id -> index
    for (let i = first; i < last; i++) want.set(state.view[i], i);
    // The active row stays in the DOM so aria-activedescendant always points at something.
    const activeId = state.view[state.active];
    if (activeId && !want.has(activeId)) want.set(activeId, state.active);
    for (const [id, row] of rows) {
      if (!want.has(id)) {
        row.remove();
        rows.delete(id);
      }
    }
    const q = params().q ?? "";
    for (const [id, i] of want) {
      const g = groupById(id);
      if (!g) continue;
      const sig = rowSig(g, i, q);
      let row = rows.get(id);
      if (!row || force || row.dataset.sig !== sig) {
        const fresh = buildRow(g, i, q);
        fresh.dataset.sig = sig;
        if (row) row.replaceWith(fresh);
        else body.append(fresh);
        rows.set(id, fresh);
        row = fresh;
      }
      row.style.transform = `translateY(${i * rowH}px)`;
    }
    const grid = $("grid");
    if (activeId && rows.has(activeId) && n) grid.setAttribute("aria-activedescendant", rows.get(activeId).id);
    else grid.removeAttribute("aria-activedescendant");
  }

  function rowSig(g, i, q) {
    return [g.sig, i, q, state.selected.has(g.id), state.open === g.id, state.newIds.has(g.id), state.view[state.active] === g.id, rowH, waitingIn(g)].join("|");
  }

  const waitingIn = (g) => g.records.some((r) => state.waiting.has(r.id));

  function buildRow(g, i, q) {
    const deleted = isDeletedView();
    const selected = state.selected.has(g.id);
    const isNew = state.newIds.has(g.id);
    const m = M.meaningOf(g);
    const romanization = g.romanization && Search.fold(g.romanization) !== Search.fold(g.native) ? g.romanization : null;
    const meaning = [];
    m.glosses.forEach((x, k) => {
      if (k) meaning.push(el("span", { class: "sep", "aria-hidden": "true" }, " · "));
      meaning.push(el("bdi", { lang: x.base, dir: "auto" }, highlighted(x.gloss, q, x.base)));
    });
    if (m.more) meaning.push(" ", el("span", { class: "more", title: m.rest.join(", ") }, t("dash_more_forms", { count: m.more })));
    const status = [];
    if (deleted) {
      status.push(el("button", {
        class: "btn btn-secondary btn-sm row-restore",
        type: "button",
        tabindex: "-1",
        "aria-label": t("dash_restore_label", { native: g.native }),
        onclick: (e) => {
          e.stopPropagation();
          restoreRecords(g.records.map((r) => r.id));
        },
      }, icon("restore", 16), t("dash_restore")));
    } else if (waitingIn(g)) status.push(el("span", { class: "pill pill-neutral" }, icon("clock", 14), t("dash_status_waiting")));
    else if (isNew) status.push(el("span", { class: "pill pill-new" }, t("dash_status_new")));
    else if (g.paused) status.push(el("span", { class: "pill pill-neutral" }, icon("pause", 14), t("dash_status_paused_chip")));
    const when = deleted ? g.deletedAt : g.created;
    const row = el("div", {
      class: `grid-row wrow${selected ? " is-selected" : ""}${state.open === g.id ? " is-open" : ""}${g.paused && !deleted ? " is-paused" : ""}${isNew ? " row-new" : ""}${state.view[state.active] === g.id ? " is-active" : ""}`,
      role: "row",
      id: `row-${i}-${String(g.id).replace(/[^a-zA-Z0-9_-]/g, "")}`,
      "aria-rowindex": String(i + 2),
      "aria-selected": String(selected),
      "data-id": g.id,
      onclick: (e) => onRowClick(e, g.id),
      // Shift+click selects a range, not the text between.
      onmousedown: (e) => e.shiftKey && e.preventDefault(),
    },
    el("span", { class: "c-check", role: "gridcell" },
      el("input", {
        class: "check",
        type: "checkbox",
        tabindex: "-1",
        checked: selected,
        "aria-label": t("dash_select_word", { native: g.native }),
        onclick: (e) => {
          e.stopPropagation();
          toggleSelect(g.id, { range: e.shiftKey });
        },
      })),
    el("span", { class: "c-native", role: "gridcell" },
      el("bdi", { class: `w-native${isNew ? " swap-in motion" : ""}`, lang: g.lang, dir: "auto" }, highlighted(g.native, q, g.lang)),
      romanization ? el("span", { class: "w-rom", lang: Cards.romanizationLang(g.lang) }, highlighted(romanization, q, g.lang)) : null),
    el("span", { class: "c-meaning", role: "gridcell" }, meaning),
    el("span", { class: "c-lang", role: "gridcell" }, languageName(g.lang, g.language)),
    el("span", { class: "c-added num", role: "gridcell" }, M.addedLabel(when, { locale: I18n.locale() })),
    el("span", { class: "c-status", role: "gridcell" }, status));
    return row;
  }

  function renderEmpty() {
    const box = $("listEmpty");
    const card = $("listCard");
    const p = params();
    let content = null;
    if (!state.loaded) return;
    if (state.loadError && !state.groups.length) {
      content = el("div", { class: "empty-inline" }, el("p", { class: "empty-title" }, t("dash_list_unavailable")));
    } else if (!state.groups.length && !isDeletedView()) {
      // No words (§11).
      content = el("div", { class: "empty-hero" },
        el("img", { class: "empty-art art-light", src: "ui/art/kitten-curious.png", alt: "", width: 112, height: 100 }),
        el("img", { class: "empty-art art-dark", src: "ui/art/kitten-curious-on-purple.png", alt: "", width: 112, height: 96 }),
        el("h2", { class: "empty-title" }, t("dash_empty_title")),
        el("p", { class: "empty-body" }, t("dash_empty_body")),
        el("div", { class: "empty-actions" },
          el("button", { class: "btn btn-primary", type: "button", onclick: () => go("#add") }, icon("add", 18), t("dash_add_words"))));
    } else if (!state.view.length && p.q) {
      // No results (§4).
      content = el("div", { class: "empty-inline" },
        el("p", { class: "empty-title" }, I18n.parts("dash_no_results", { q: bdi(p.q, null) })),
        el("div", { class: "empty-actions" },
          isDeletedView() ? null : el("button", { class: "btn btn-primary", type: "button", onclick: () => addFromSearch(p.q) }, icon("add", 18), I18n.parts("dash_add_as_new", { q: bdi(p.q, null) })),
          el("button", { class: "btn btn-quiet", type: "button", onclick: () => setParams({ q: null }, { focusSearch: true }) }, t("dash_clear_search"))));
    } else if (!state.view.length) {
      // Filters exclude everything.
      const key = isDeletedView() ? "dash_none_deleted" : p.status === "paused" ? "dash_none_paused" : "dash_none_filtered";
      content = el("div", { class: "empty-inline" },
        el("p", { class: "empty-title" }, t(key)),
        el("div", { class: "empty-actions" }, el("button", { class: "btn btn-secondary", type: "button", onclick: () => setParams({ lang: null, status: null, added: null, source: null, q: null }) }, t("dash_clear_filters"))));
    }
    box.hidden = !content;
    card.dataset.empty = String(!!content);
    $("grid").hidden = !!content && !state.view.length;
    box.replaceChildren(...(content ? [content] : []));
  }

  function showSkeleton() {
    if (state.loaded) return;
    $("app").setAttribute("aria-busy", "true");
    const body = $("gridBody");
    body.replaceChildren($("gridSpacer"), ...Array.from({ length: 6 }, (_, i) => el("div", { class: "grid-row skel-row", "aria-hidden": "true", style: `transform: translateY(${i * rowH}px)` },
      el("span", { class: "c-check" }),
      el("span", { class: "c-native" }, el("span", { class: "skeleton", style: `width:${70 + ((i * 37) % 60)}px` })),
      el("span", { class: "c-meaning" }, el("span", { class: "skeleton", style: `width:${90 + ((i * 53) % 90)}px` })),
      el("span", { class: "c-lang" }, el("span", { class: "skeleton", style: "width:64px" })),
      el("span", { class: "c-added" }, el("span", { class: "skeleton", style: "width:48px" })),
      el("span", { class: "c-status" }))));
  }

  // ---------------------------------------------------------------------------------
  // Selection (§6).

  function onRowClick(e, id) {
    const i = state.view.indexOf(id);
    if (i >= 0) state.active = i;
    if (e.shiftKey) return toggleSelect(id, { range: true });
    if (e.ctrlKey || e.metaKey) return toggleSelect(id);
    state.selected = new Set([id]);
    state.anchor = id;
    openInspector(id);
  }

  function toggleSelect(id, { range = false } = {}) {
    if (range && state.anchor && state.view.includes(state.anchor)) {
      const a = state.view.indexOf(state.anchor);
      const b = state.view.indexOf(id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      for (let i = lo; i <= hi; i++) state.selected.add(state.view[i]);
    } else {
      if (state.selected.has(id)) state.selected.delete(id);
      else state.selected.add(id);
      state.anchor = id;
    }
    const i = state.view.indexOf(id);
    if (i >= 0) state.active = i;
    renderWindow(false);
    renderSelbar();
    announce(t("dash_selected_count", { count: state.selected.size }));
  }

  // The words an action applies to: the checked ones, else the open or active row.
  function targets() {
    if (state.selected.size) return [...state.selected];
    if (state.open) return [state.open];
    const id = state.view[state.active];
    return id ? [id] : [];
  }

  function renderSelbar() {
    const bar = $("selbar");
    const n = state.selected.size;
    const show = n >= 2;
    bar.hidden = !show;
    // Checkboxes show on every row once something is checked (§6), not for the open row alone.
    $("app").dataset.selecting = String(n > 1 || (n === 1 && !state.selected.has(state.open)));
    if (!show) return bar.replaceChildren();
    const ids = [...state.selected];
    const deleted = isDeletedView();
    const anyActive = !deleted && ids.some((id) => state.byId.get(id) && !state.byId.get(id).paused);
    const anyPaused = !deleted && ids.some((id) => state.byId.get(id)?.paused);
    const b = (label, run, opts = {}) => el("button", { class: `btn btn-sm ${opts.cls ?? "btn-quiet"}`, type: "button", onclick: run, "aria-keyshortcuts": opts.keys ?? null }, opts.icon ? icon(opts.icon, 16) : null, label);
    const all = state.view.length > n ? el("button", { class: "link link-quiet", type: "button", onclick: selectAll }, t("dash_select_all", { count: state.view.length })) : null;
    bar.replaceChildren(...[
      el("span", { class: "selbar-count num" }, t("dash_selected_count", { count: n })),
      all,
      el("span", { class: "selbar-space" }),
      deleted ? b(t("dash_restore"), () => restoreRecords(ids.flatMap((id) => groupById(id)?.records.map((r) => r.id) ?? [])), { icon: "restore" }) : null,
      anyActive ? b(t("dash_pause"), () => setPaused(ids, true), { icon: "pause", keys: "P" }) : null,
      anyPaused ? b(t("dash_resume"), () => setPaused(ids, false), { icon: "play", keys: "P" }) : null,
      deleted ? null : b(t("dash_move_to"), (e) => moveMenu(e.currentTarget, ids), { keys: "M" }),
      // 12: "Export" (E) joins here when export ships.
      deleted ? null : b(t("dash_delete"), () => deleteGroups(ids), { cls: "btn-danger", keys: "Delete" }),
      el("button", { class: "btn btn-icon", type: "button", "aria-label": t("dash_clear_selection"), title: t("dash_clear_selection"), onclick: clearSelection }, icon("close", 18)),
    ].filter(Boolean));
  }

  function selectAll() {
    state.selected = new Set(state.view);
    renderWindow(false);
    renderSelbar();
    announce(t("dash_selected_count", { count: state.selected.size }));
  }

  function clearSelection() {
    state.selected.clear();
    renderWindow(false);
    renderSelbar();
    $("grid").focus();
  }

  function moveMenu(anchor, ids) {
    const current = new Set(ids.map((id) => state.byId.get(id)?.lang));
    const langs = M.shelf(state.groups, { languageName: (l) => languageName(l), uiLocale: I18n.locale() }).map((e) => e.lang).filter((l) => !(current.size === 1 && current.has(l)));
    openMenu(anchor, [
      ...langs.map((l) => ({ label: languageName(l), lang: l, run: () => moveGroups(ids, l) })),
      { label: t("dash_move_elsewhere"), run: async () => {
        const lang = await pickLanguage({ title: t("dash_move_title"), exclude: current });
        if (lang) moveGroups(ids, lang);
      } },
    ]);
  }

  // ---------------------------------------------------------------------------------
  // Keyboard (§12): active when focus is in the list.

  function moveActive(to, { extend = false } = {}) {
    const n = state.view.length;
    if (!n) return;
    const from = state.active;
    state.active = Math.max(0, Math.min(n - 1, to));
    if (extend) {
      state.anchor ??= state.view[from];
      toggleSelect(state.view[state.active], { range: true });
    }
    scrollToActive();
    renderWindow(false);
  }

  function scrollToActive() {
    const body = $("gridBody");
    const y = state.active * rowH;
    const h = viewportHeight();
    if (y < body.scrollTop) body.scrollTop = y;
    else if (y + rowH > body.scrollTop + h) body.scrollTop = y + rowH - h;
  }

  function onGridKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    const page = Math.max(1, Math.floor(viewportHeight() / rowH) - 1);
    const id = state.view[state.active];
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        return moveActive(state.active + 1, { extend: e.shiftKey });
      case "ArrowUp":
        e.preventDefault();
        return moveActive(state.active - 1, { extend: e.shiftKey });
      case "Home":
        e.preventDefault();
        return moveActive(0);
      case "End":
        e.preventDefault();
        return moveActive(state.view.length - 1);
      case "PageDown":
        e.preventDefault();
        return moveActive(state.active + page);
      case "PageUp":
        e.preventDefault();
        return moveActive(state.active - page);
      case "Enter":
        if (!id) return;
        e.preventDefault();
        state.selected = new Set([id]);
        state.anchor = id;
        return openInspector(id, { focus: true });
      case " ":
        if (!id) return;
        e.preventDefault();
        return toggleSelect(id);
      case "Delete":
      case "Backspace":
        if (isDeletedView()) return;
        e.preventDefault();
        return deleteGroups(targets());
      default:
        break;
    }
    if (mod && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      return selectAll();
    }
    if (mod || e.altKey) return;
    if ((e.key === "p" || e.key === "P") && !isDeletedView()) {
      e.preventDefault();
      const ids = targets();
      const paused = ids.every((x) => state.byId.get(x)?.paused);
      return setPaused(ids, !paused);
    }
    if ((e.key === "m" || e.key === "M") && !isDeletedView()) {
      e.preventDefault();
      const ids = targets();
      if (!ids.length) return;
      const row = rows.get(state.view[state.active]);
      return moveMenu(row ?? $("grid"), ids);
    }
  }

  function onGlobalKey(e) {
    const typing = isTyping(e.target);
    const mod = e.ctrlKey || e.metaKey;
    if (document.querySelector(".menu, .dialog-card")) return; // menus and dialogs handle their own keys
    if (mod && !e.shiftKey && (e.key === "z" || e.key === "Z") && !typing) {
      e.preventDefault();
      undoLast();
      return;
    }
    if (state.route.view !== "words") {
      if (e.key === "Escape" && state.route.view === "add") {
        e.preventDefault();
        closeAdd();
      }
      return;
    }
    // "/" in the empty search field (focused when the page opens) is the shortcut, not text.
    if (e.key === "/" && e.target === $("search") && !$("search").value) {
      e.preventDefault();
      return;
    }
    if (e.key === "/" && !typing) {
      e.preventDefault();
      $("search").focus();
      $("search").select();
      return;
    }
    if (e.key === "Escape") {
      if (state.open) {
        e.preventDefault();
        return closeInspector({ focusList: true });
      }
      if (state.selected.size) {
        e.preventDefault();
        return clearSelection();
      }
      if (params().q) {
        e.preventDefault();
        return setParams({ q: null }, { focusSearch: e.target === $("search") });
      }
      return;
    }
    if (typing || mod || e.altKey) return;
    if (e.key === "?") {
      e.preventDefault();
      return showShortcuts();
    }
    if ((e.key === "n" || e.key === "N") && !e.target.closest?.("#inspector")) {
      e.preventDefault();
      return go("#add");
    }
  }

  // ---------------------------------------------------------------------------------
  // The inspector (§5).

  let fields = []; // [{node, read, original, dirty}]
  let inspectorGroup = null;
  let speakToken = 0;

  const narrow = () => !matchMedia("(min-width: 960px)").matches;

  function openInspector(id, { focus = false } = {}) {
    state.open = id;
    const g = groupById(id);
    if (!g) return closeInspector();
    state.newIds.delete(id);
    updateRoute({ id: g.id });
    renderInspector(g);
    renderWindow(false);
    renderSelbar();
    const insp = $("inspector");
    if (narrow()) {
      $("scrim").hidden = false;
      insp.setAttribute("role", "dialog");
      insp.setAttribute("aria-modal", "true");
      // A modal sheet takes focus; from the keyboard (Enter) the word itself, else the sheet.
      if (!focus) insp.focus();
    } else {
      insp.setAttribute("role", "region");
      insp.removeAttribute("aria-modal");
    }
    if (focus) (insp.querySelector(".spec-field") ?? insp).focus();
  }

  function closeInspector({ focusList = false } = {}) {
    if (!state.open) return;
    state.open = null;
    inspectorGroup = null;
    fields = [];
    $("inspector").hidden = true;
    $("inspector").replaceChildren();
    $("scrim").hidden = true;
    $("workspace").dataset.inspector = "false";
    updateRoute({ id: null });
    renderWindow(false);
    if (focusList) $("grid").focus();
  }

  function renderInspector(g) {
    const insp = $("inspector");
    inspectorGroup = g;
    fields = [];
    insp.hidden = false;
    $("workspace").dataset.inspector = "true";
    insp.setAttribute("aria-label", t("dash_inspector_label", { native: g.native }));
    const deleted = !state.byId.has(g.id);
    const lang = g.lang;

    const close = el("button", { class: "btn btn-icon insp-close", type: "button", "aria-label": t("dash_close"), title: t("dash_close"), onclick: () => closeInspector({ focusList: true }) }, icon("close"));

    // The specimen: the word at --t-specimen, editable in place, with the speak button.
    const native = textField({
      cls: "spec-field",
      lang,
      label: t("dash_field_native"),
      labelHidden: true,
      read: (x) => x.native,
      save: (v, o) => saveGroupField("native", v.trim(), { label: t("dash_field_native_name") }, o),
      readOnly: deleted,
    });
    const speakBtn = el("button", { class: "speak", type: "button", hidden: true, "aria-label": t("dash_speak", { native: g.native, language: languageName(lang) }), title: t("dash_speak", { native: g.native, language: languageName(lang) }), onclick: () => sayWord(g, speakBtn) }, icon("speaker", 20));
    const token = ++speakToken;
    Promise.resolve(Speak?.canSpeak?.(lang)).then((ok) => {
      if (token === speakToken) speakBtn.hidden = !ok;
    }, () => {});

    const romanization = textField({
      cls: "rom-field",
      lang: Cards.romanizationLang(lang),
      label: t("dash_field_romanization"),
      labelHidden: true,
      placeholder: t("dash_field_romanization_placeholder"),
      read: (x) => x.romanization ?? "",
      save: (v, o) => saveGroupField("romanization", v.trim() || null, { label: t("dash_field_romanization_name") }, o),
      readOnly: deleted,
    });

    const langLine = el("div", { class: "insp-lang" },
      el("span", {}, languageName(lang, g.language)),
      endonym(lang) && endonym(lang).toLocaleLowerCase() !== languageName(lang).toLocaleLowerCase() ? [el("span", { class: "sep", "aria-hidden": "true" }, " · "), bdi(endonym(lang), lang)] : null,
      deleted ? null : el("button", { class: "link link-quiet insp-move", type: "button", "aria-haspopup": "menu", onclick: (e) => moveMenu(e.currentTarget, [g.id]) }, t("dash_move")));

    // "Kotiko shows X where pages say “thanks”." for each base with a meaning.
    const shows = g.records.filter((r) => (r.gloss ?? r.english)).map((r) =>
      el("p", { class: "insp-shows" }, I18n.parts("dash_shows", {
        native: el("bdi", { class: "word dots", lang, dir: "auto" }, g.native),
        gloss: bdi(r.gloss ?? r.english, r.base_lang ?? "en"),
        base: languageName(r.base_lang ?? "en"),
      })));

    const head = el("div", { class: "insp-head" },
      el("div", { class: "spec" }, native.wrap, speakBtn),
      romanization.wrap,
      langLine);

    const parts = [close, head];

    if (M.STRESS_LANGS.has(M.primary(lang)) && !deleted) {
      const voc = textField({
        cls: "voc-field",
        lang,
        label: t("dash_field_vocalized"),
        placeholder: g.native,
        read: (x) => x.records[0].native_vocalized ?? "",
        check: (v) => {
          const pron = g.records.map((r) => r.pronunciation).find(Boolean);
          return v.trim() && M.stressMismatch(v, pron) ? t("dash_stress_mismatch") : null;
        },
        save: (v, o) => saveGroupField("native_vocalized", v.trim() || null, { label: t("dash_field_vocalized_name") }, o),
      });
      parts.push(voc.wrap);
    }
    parts.push(...shows, el("hr", { class: "rule" }));

    for (const r of g.records) parts.push(baseBlock(g, r, deleted));
    if (!deleted) {
      for (const base of bases()) {
        if (g.records.some((r) => (r.base_lang ?? "en") === base) || M.primary(base) === M.primary(lang)) continue;
        parts.push(addMeaningButton(g, base));
      }
    }

    if (!deleted) {
      const active = !g.paused;
      parts.push(el("button", {
        class: "switch-row insp-swap",
        type: "button",
        role: "switch",
        "aria-checked": String(active),
        onclick: () => setPaused([g.id], active),
      }, el("span", {}, t("dash_swap_on_pages")), el("span", { class: "switch", "aria-hidden": "true" })));
    }

    parts.push(el("hr", { class: "rule" }), provenance(g, deleted));
    parts.push(deleted
      ? el("button", { class: "btn btn-secondary insp-restore", type: "button", onclick: () => restoreRecords(g.records.map((r) => r.id)).then(() => closeInspector({ focusList: true })) }, icon("restore", 18), t("dash_restore"))
      : el("button", { class: "btn btn-danger insp-delete", type: "button", "aria-keyshortcuts": "Delete", onclick: () => deleteGroups([g.id]) }, t("dash_delete_word")));

    insp.replaceChildren(...parts);
  }

  function provenance(g, deleted) {
    const date = (ts) => {
      try {
        return new Intl.DateTimeFormat(I18n.locale(), { dateStyle: "medium" }).format(new Date(ts));
      } catch {
        return new Date(ts).toDateString();
      }
    };
    const r0 = g.records[0];
    const lines = [];
    if (g.created) {
      const from = typeof r0.source_text === "string" && r0.source_text.trim() && r0.source_text.trim() !== g.native ? r0.source_text.trim() : null;
      lines.push(el("p", {}, from ? I18n.parts("dash_added_from", { date: date(g.created), text: bdi(from, null) }) : t("dash_added_on", { date: date(g.created) })));
    }
    if (deleted && g.deletedAt) lines.push(el("p", {}, t("dash_deleted_on", { date: date(g.deletedAt) })));
    else if (g.updated && g.updated - g.created > 1000) lines.push(el("p", {}, t("dash_changed_on", { date: date(g.updated) })));
    return el("div", { class: "insp-prov" }, lines);
  }

  // One record's block: "On pages in {base}" (§5).
  function baseBlock(g, r, deleted) {
    const base = r.base_lang ?? "en";
    const rid = r.id;
    const rec = (x) => x.records.find((y) => y.id === rid) ?? {};
    const block = el("section", { class: "base-block", "aria-label": t("dash_on_pages_in", { base: languageName(base) }) });
    const headRow = el("div", { class: "base-head" }, el("h3", { class: "base-title" }, t("dash_on_pages_in", { base: languageName(base) })));
    if (g.records.length > 1 && !deleted) {
      headRow.append(el("button", { class: "link link-quiet", type: "button", onclick: () => removeMeaning(g, r) }, t("dash_remove_meaning")));
    }
    block.append(headRow);

    const gloss = textField({
      cls: "gloss-field",
      lang: base,
      label: t("dash_field_meaning"),
      read: (x) => rec(x).gloss ?? rec(x).english ?? "",
      check: (v) => (v.trim() ? null : t("dash_required")),
      save: (v, o) => saveRecordField(g, rid, "gloss", v.trim(), { label: t("dash_field_meaning_name") }, o),
      readOnly: deleted,
    });
    block.append(gloss.wrap, formsEditor(g, r, deleted));

    if (M.hasKey(base) || r.pronunciation) {
      const preview = el("p", { class: "pron-preview", lang: base, "aria-hidden": "true" });
      const updatePreview = (value) => {
        const words = Cards.parsePronunciation(value, g.lang);
        preview.replaceChildren(...(words ? syllables(words) : []));
        preview.hidden = !words;
      };
      const pron = textField({
        cls: "pron-field",
        lang: base,
        label: t("dash_field_pronunciation"),
        read: (x) => rec(x).pronunciation ?? "",
        check: (v) => {
          const p = M.pronunciationProblem(v, g.lang, base);
          return p ? invalidText(p, "pronunciation") : null;
        },
        onInput: updatePreview,
        save: (v, o) => saveRecordField(g, rid, "pronunciation", v.trim() || null, { label: t("dash_field_pronunciation_name") }, o),
        readOnly: deleted,
      });
      updatePreview(r.pronunciation);
      const careful = textField({
        cls: "pron-field",
        lang: base,
        label: t("dash_field_careful"),
        read: (x) => rec(x).pronunciation_careful ?? "",
        check: (v) => {
          const p = M.pronunciationProblem(v, g.lang, base);
          return p ? invalidText(p, "pronunciation_careful") : null;
        },
        save: (v, o) => saveRecordField(g, rid, "pronunciation_careful", v.trim() || null, { label: t("dash_field_careful_name") }, o),
        readOnly: deleted,
      });
      pron.wrap.querySelector(".fld-row")?.after(preview);
      // The source label (19 §1a); gone once the pronunciation is the learner's own.
      const labelBox = el("p", { class: "pron-label" });
      const updateLabel = (x) => {
        const label = Cards.sourceLabel(rec(x));
        labelBox.hidden = !label;
        if (!label) return labelBox.replaceChildren();
        const text = label.kind === "checked" ? t("popover_pron_checked", { source: label.source }) : label.kind === "differs" ? t("popover_pron_differs", { source: label.source }) : t("popover_pron_ai");
        labelBox.replaceChildren(...(label.kind === "checked" ? [icon("check", 14)] : []), text);
      };
      updateLabel(g);
      fields.push({ node: null, refresh: updateLabel });
      block.append(el("div", { class: "pron-pair" }, pron.wrap, careful.wrap), labelBox);
      // 44: "How to read this" opens the base's respelling key once slice 09 ships it.
    }

    const note = textField({
      cls: "note-field",
      lang: base,
      label: t("dash_field_note"),
      multiline: true,
      read: (x) => rec(x).note ?? "",
      save: (v, o) => saveRecordField(g, rid, "note", v.trim() || null, { label: t("dash_field_note_name") }, o),
      readOnly: deleted,
    });
    block.append(note.wrap);
    return block;
  }

  function syllables(words) {
    const out = [];
    words.forEach((syls, wi) => {
      if (wi) out.push(" ");
      syls.forEach((s, si) => {
        if (si) out.push("-");
        out.push(s.stressed ? el("b", {}, s.text) : s.text);
        if (s.tone) out.push(el("sup", {}, String(s.tone)));
      });
    });
    return out;
  }

  // The forms chip editor (§5): each form a removable chip, "+ Add" takes one or several.
  function formsEditor(g, r, deleted) {
    const base = r.base_lang ?? "en";
    const rid = r.id;
    const labelId = `forms-${++jobSeq}`;
    const error = el("p", { class: "field-error", hidden: true });
    const list = el("ul", { class: "form-chips", "aria-labelledby": labelId });
    const text = (f) => (typeof f === "string" ? f : f.text);
    const formsOf = () => {
      const cur = state.records.get(rid);
      const forms = cur ? effective(cur).forms : r.forms;
      return (Array.isArray(forms) ? forms : []).map((f) => (typeof f === "string" ? { text: f, enabled: true } : f));
    };
    const showError = (msg) => {
      error.hidden = !msg;
      error.replaceChildren(...(msg ? [icon("error", 16), el("span", {}, msg)] : []));
    };
    const save = (next) =>
      saveRecordField(g, rid, "forms", next, { label: t("dash_field_forms_name") }).then((res) => {
        if (res && !res.ok && !isOffline(res.code)) showError(problemText(res, { field: "forms" }));
        render();
      });
    const input = deleted
      ? null
      : el("input", { class: "form-add", type: "text", lang: base, dir: "auto", placeholder: t("dash_form_add"), "aria-label": t("dash_form_add_label", { base: languageName(base) }) });
    input?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const added = M.splitForms(input.value, base);
      if (!added.length) return;
      const have = new Set(formsOf().map((f) => text(f).toLocaleLowerCase()));
      input.value = "";
      showError(null);
      save([...formsOf(), ...added.filter((a) => !have.has(a.toLocaleLowerCase())).map((a) => ({ text: a, enabled: true }))]);
    });
    const addItem = input ? el("li", { class: "form-add-item" }, input) : null;
    function render() {
      const chips = formsOf().map((f, i) => el("li", { class: "form-chip" },
        el("bdi", { lang: base, dir: "auto" }, text(f)),
        deleted ? null : el("button", {
          class: "form-remove",
          type: "button",
          "aria-label": t("dash_form_remove", { form: text(f) }),
          title: t("dash_form_remove", { form: text(f) }),
          onclick: () => {
            const next = formsOf().filter((_, k) => k !== i);
            // A word needs at least one meaning in each base it has (§5).
            if (!next.some((x) => typeof x === "string" || x.enabled !== false)) return showError(t("dash_forms_last_in", { base: languageName(base) }));
            showError(null);
            save(next);
          },
        }, icon("close", 12))));
      list.replaceChildren(...chips, ...(addItem ? [addItem] : []));
    }
    render();
    fields.push({ node: input, refresh: render });
    return el("div", { class: "fld forms" }, el("p", { class: "field-label", id: labelId }, t("dash_field_forms")), list, error);
  }

  function addMeaningButton(g, base) {
    const box = el("div", { class: "add-meaning" });
    const btn = el("button", { class: "link link-quiet", type: "button", onclick: () => {
      const input = el("input", { class: "field", type: "text", lang: base, dir: "auto", "aria-label": t("dash_add_meaning_in", { base: languageName(base) }), placeholder: t("dash_field_meaning") });
      input.addEventListener("keydown", async (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          box.replaceChildren(btn);
          btn.focus();
        }
        if (e.key !== "Enter" || !input.value.trim()) return;
        e.preventDefault();
        const gloss = input.value.trim();
        try {
          const res = await source.save([{ lang: g.lang, native: g.native, base_lang: base, gloss, forms: [gloss], romanization: g.romanization ?? undefined, origin: "manual" }], { requestId: M.uuid7() });
          for (const x of res.results) if (x.word) state.records.set(x.word.id, x.word);
          rebuild();
          renderWords();
          refreshInspector(true);
        } catch (err) {
          toast({ text: problemText(err), error: true });
        }
      });
      box.replaceChildren(input);
      input.focus();
    } }, icon("add", 16), t("dash_add_meaning_in", { base: languageName(base) }));
    box.append(btn);
    return box;
  }

  async function removeMeaning(g, r) {
    if (g.records.length < 2) return;
    state.removing.add(r.id);
    rebuild();
    renderWords();
    refreshInspector(true);
    const [res] = await source.write([{ op: "delete", id: r.id }], { touch: [r] });
    state.removing.delete(r.id);
    if (res.ok) state.records.delete(r.id);
    rebuild();
    renderWords();
    refreshInspector(true);
    if (!res.ok) return toast({ text: problemText(res), error: true });
    const entry = undoStack.push({ run: () => restoreRecords([r.id], { undoable: false }).then(() => refreshInspector(true)) });
    toast({ parts: I18n.parts("dash_toast_meaning_removed", { base: languageName(r.base_lang ?? "en"), native: bdi(g.native, g.lang) }), undo: entry });
  }

  // A field that saves on Enter or blur (§5), with "Saved" and inline errors.
  function textField({ cls, lang, label, labelHidden = false, placeholder = null, read, save, check = null, onInput = null, multiline = false, readOnly = false }) {
    const id = `f${++jobSeq}`;
    const errId = `${id}-err`;
    const input = el(multiline ? "textarea" : "input", {
      class: `field ${cls}`,
      id,
      type: multiline ? null : "text",
      lang: lang || null,
      dir: "auto",
      spellcheck: "false",
      placeholder,
      rows: multiline ? 2 : null,
      readonly: readOnly,
      "aria-describedby": errId,
    });
    const value = read(inspectorGroup) ?? "";
    input.value = value;
    const saved = el("span", { class: "saved", hidden: true }, icon("check", 14), t("dash_saved"));
    const error = el("p", { class: "field-error", id: errId, hidden: true });
    const labelEl = el("label", { class: `field-label${labelHidden ? " sr-only" : ""}`, for: id }, label);
    const head = el("div", { class: "fld-head" }, labelEl, saved);
    const wrap = el("div", { class: `fld fld-${cls}` }, head, el("div", { class: "fld-row" }, input), error);
    const f = { node: input, read, original: value, conflict: null, wrap, error, saved };
    fields.push(f);

    const showError = (msg, actions = []) => {
      error.hidden = !msg;
      input.setAttribute("aria-invalid", msg ? "true" : "false");
      if (msg) error.replaceChildren(icon("error", 16), el("span", {}, msg), ...actions.flatMap((a) => [" ", a]));
      else error.replaceChildren();
    };

    let busy = false;
    const commit = async () => {
      if (readOnly || busy) return;
      const v = input.value;
      if (v === f.original) return showError(null);
      const problem = check?.(v) ?? null;
      if (problem) return showError(problem);
      busy = true;
      const before = f.original;
      const res = await save(v);
      busy = false;
      if (!res || res.ok) {
        f.original = v;
        f.conflict = null;
        showError(null);
        flashSaved(saved);
        return;
      }
      if (res.code === "word_conflict" && res.details?.reason === "stale") {
        // §5 conflicts: keep the draft, offer both.
        const theirs = read(inspectorGroup) ?? "";
        f.conflict = theirs;
        showError(t("dash_conflict_field"), [
          el("span", { class: "conflict-actions" }, " ",
            el("button", { class: "link", type: "button", onclick: () => { input.value = theirs; f.original = theirs; f.conflict = null; showError(null); onInput?.(theirs); } }, t("dash_use_theirs")), " ",
            el("button", { class: "link", type: "button", onclick: async () => { f.conflict = null; const again = await save(input.value, { force: true }); if (!again || again.ok) { f.original = input.value; showError(null); flashSaved(saved); } else showError(problemText(again, { field: cls })); } }, t("dash_keep_mine"))),
        ]);
        return;
      }
      if (isOffline(res.code)) {
        f.original = v;
        showError(null);
        return;
      }
      // Error on one edit (§11): revert, say why, offer Try again.
      const draft = v;
      input.value = before;
      onInput?.(before);
      showError(problemText(res, { field: cls.replace("-field", "") }), [
        el("button", { class: "link", type: "button", onclick: () => { input.value = draft; onInput?.(draft); input.focus(); commit(); } }, t("error_try_again_action")),
      ]);
    };

    input.addEventListener("input", () => {
      onInput?.(input.value);
      if (!error.hidden && !f.conflict) showError(null);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (!multiline || !e.shiftKey)) {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape" && input.value !== f.original) {
        e.stopPropagation();
        input.value = f.original;
        onInput?.(f.original);
        showError(null);
      }
    });
    input.addEventListener("blur", () => commit());
    return { wrap, input };
  }

  function flashSaved(node) {
    node.hidden = false;
    clearTimeout(node._timer);
    node._timer = setTimeout(() => (node.hidden = true), SAVED_MS);
  }

  // Saves one record's field; the toast names the field and the word.
  async function saveRecordField(g, rid, field, value, { label }, { force = false } = {}) {
    const r = state.records.get(rid);
    if (!r) return { ok: false, code: "word_gone" };
    const old = effective(r)[field] ?? null;
    if (JSON.stringify(old) === JSON.stringify(value)) return { ok: true };
    const [res] = await patchRecords([{ id: rid, patch: { [field]: value } }], { force });
    if (res.ok || isOffline(res.code)) changedToast(g, label, [{ id: rid, patch: { [field]: old } }]);
    return res;
  }

  // Saves a field every record of the group shares (native, romanization, stress mark).
  async function saveGroupField(field, value, { label }, { force = false } = {}) {
    const g = inspectorGroup;
    if (!g) return { ok: true };
    const items = [];
    const before = [];
    for (const r of g.records) {
      const cur = effective(state.records.get(r.id) ?? r);
      if (JSON.stringify(cur[field] ?? null) === JSON.stringify(value)) continue;
      items.push({ id: r.id, patch: { [field]: value } });
      before.push({ id: r.id, patch: { [field]: cur[field] ?? null } });
    }
    if (!items.length) return { ok: true };
    const results = await patchRecords(items, { force });
    const bad = results.find((x) => !x.ok && !isOffline(x.code));
    if (bad) return bad;
    changedToast(g, label, before);
    return { ok: true };
  }

  function changedToast(g, label, before) {
    const entry = undoStack.push({ run: () => patchRecords(before, { force: true }) });
    toast({ parts: I18n.parts("dash_toast_changed", { field: label, native: bdi(g.native, g.lang) }), undo: entry });
  }

  // After data changes: fields not being edited update silently; a field being edited
  // keeps its draft and offers both versions when the word changed elsewhere (§5).
  function refreshInspector(force = false) {
    if (!state.open) return;
    const g = groupById(state.open) ?? state.groups.find((x) => x.records.some((r) => inspectorGroup?.records.some((y) => y.id === r.id)));
    if (!g) return closeInspector();
    if (g.id !== state.open) state.open = g.id;
    const insp = $("inspector");
    const editing = insp.contains(document.activeElement) && isTyping(document.activeElement);
    const structural = !inspectorGroup || inspectorGroup.records.length !== g.records.length || inspectorGroup.paused !== g.paused || inspectorGroup.lang !== g.lang;
    if ((structural || force) && !editing) {
      const focusedClass = insp.contains(document.activeElement) ? document.activeElement.className : null;
      renderInspector(g);
      if (focusedClass) insp.querySelector(`.${focusedClass.split(" ").filter(Boolean).join(".")}`)?.focus();
      return;
    }
    inspectorGroup = g;
    for (const f of fields) {
      if (f.refresh) {
        f.refresh(g);
        continue;
      }
      const next = f.read(g) ?? "";
      if (next === f.original) continue;
      if (document.activeElement === f.node && f.node.value !== f.original) {
        // The learner is editing this field and the stored value changed under them.
        f.conflict = next;
        f.error.hidden = false;
        f.error.replaceChildren(icon("warning", 16), el("span", {}, t("dash_conflict_field")), " ",
          el("span", { class: "conflict-actions" },
            el("button", { class: "link", type: "button", onmousedown: (e) => e.preventDefault(), onclick: () => { f.node.value = next; f.original = next; f.error.hidden = true; } }, t("dash_use_theirs")), " ",
            el("button", { class: "link", type: "button", onmousedown: (e) => e.preventDefault(), onclick: () => { f.original = next; f.error.hidden = true; f.node.dispatchEvent(new Event("blur")); } }, t("dash_keep_mine"))));
        continue;
      }
      f.node.value = next;
      f.original = next;
    }
  }

  function sayWord(g, btn) {
    btn.dataset.playing = "";
    Promise.resolve(Speak.say({ native: g.records[0].native_vocalized || g.native, lang: g.lang, reading: g.records[0].reading }, {
      onEnd: () => delete btn.dataset.playing,
      onError: () => {
        delete btn.dataset.playing;
        btn.hidden = true;
      },
    })).then((ok) => ok || delete btn.dataset.playing, () => delete btn.dataset.playing);
  }

  // Keeps Tab inside the inspector while it is a modal sheet (narrow screens).
  function onInspectorKey(e) {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      closeInspector({ focusList: true });
      return;
    }
    if (e.key !== "Tab" || !narrow()) return;
    const items = [...$("inspector").querySelectorAll("button, input, textarea, [tabindex='0']")].filter((n) => !n.hidden && !n.closest("[hidden]"));
    if (!items.length) return;
    const first = items[0];
    const last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // ---------------------------------------------------------------------------------
  // Toasts (§5, §6): role="status", never focused, paused while hovered or focused.

  function toast({ text = null, parts = null, undo = null, error = false }) {
    const host = $("toasts");
    const node = el("div", { class: `toast${error ? " toast-error" : ""}` },
      error ? icon("error", 18) : null,
      el("span", { class: "toast-text" }, parts ?? text));
    if (undo) {
      node.append(el("button", { class: "link toast-undo", type: "button", onclick: async () => {
        undoStack.remove(undo);
        node.remove();
        await undo.run();
      } }, t("add_undo")));
      node._undo = undo;
    }
    node.append(el("button", { class: "toast-close", type: "button", "aria-label": t("dash_dismiss"), title: t("dash_dismiss"), onclick: () => node.remove() }, icon("close", 14)));
    let left = TOAST_MS;
    let started = Date.now();
    let timer = setTimeout(() => node.remove(), left);
    const pause = () => {
      clearTimeout(timer);
      left -= Date.now() - started;
    };
    const resume = () => {
      started = Date.now();
      clearTimeout(timer);
      timer = setTimeout(() => node.remove(), Math.max(1000, left));
    };
    node.addEventListener("mouseenter", pause);
    node.addEventListener("mouseleave", resume);
    node.addEventListener("focusin", pause);
    node.addEventListener("focusout", resume);
    host.append(node);
    while (host.children.length > 3) host.firstElementChild.remove();
    return node;
  }

  function dismissToastFor(entry) {
    for (const n of $("toasts").children) if (n._undo === entry) n.remove();
  }

  // A polite announcement that isn't a toast (selection counts).
  function announce(text) {
    const live = $("announcer") ?? document.body.appendChild(el("div", { id: "announcer", class: "sr-only", role: "status", "aria-live": "polite" }));
    live.textContent = text;
  }

  // ---------------------------------------------------------------------------------
  // Menus, dialogs and the language picker (27 §3 patterns).

  function openMenu(anchor, items, { radio = false } = {}) {
    closeMenus();
    const menu = el("div", { class: "menu", role: "menu" });
    const buttons = items.map((it) => el("button", {
      class: `menu-item${it.danger ? " is-danger" : ""}`,
      type: "button",
      role: radio ? "menuitemradio" : "menuitem",
      "aria-checked": radio ? String(!!it.checked) : null,
      tabindex: "-1",
      onclick: () => {
        closeMenus();
        it.run();
      },
    }, radio ? el("span", { class: "menu-check", "aria-hidden": "true" }, it.checked ? icon("check", 16) : null) : null, el("span", { lang: it.lang ?? null }, it.label)));
    menu.append(...buttons);
    anchor.setAttribute("aria-expanded", "true");
    menu._anchor = anchor;
    $("layer").append(menu);
    placeMenu(menu, anchor);
    const start = Math.max(0, buttons.findIndex((b) => b.getAttribute("aria-checked") === "true"));
    buttons[start]?.focus();
    menu.addEventListener("keydown", (e) => {
      const i = buttons.indexOf(document.activeElement);
      if (e.key === "ArrowDown") buttons[(i + 1) % buttons.length].focus();
      else if (e.key === "ArrowUp") buttons[(i - 1 + buttons.length) % buttons.length].focus();
      else if (e.key === "Home") buttons[0].focus();
      else if (e.key === "End") buttons.at(-1).focus();
      else if (e.key === "Escape" || e.key === "Tab") {
        closeMenus();
        anchor.focus();
      } else if (e.key.length === 1 && /\S/.test(e.key)) {
        const k = e.key.toLocaleLowerCase();
        const from = i + 1;
        const hit = [...buttons.slice(from), ...buttons.slice(0, from)].find((b) => b.textContent.trim().toLocaleLowerCase().startsWith(k));
        hit?.focus();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    });
    return menu;
  }

  function placeMenu(menu, anchor) {
    const r = anchor.getBoundingClientRect();
    const w = menu.offsetWidth || 220;
    const h = menu.offsetHeight || 0;
    const rtl = document.documentElement.dir === "rtl";
    let left = rtl ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    let top = r.bottom + 6;
    if (h && top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function closeMenus() {
    for (const m of $("layer").querySelectorAll(".menu")) {
      m._anchor?.setAttribute("aria-expanded", "false");
      m.remove();
    }
  }

  function dialog({ title, body, actions, onClose, labelled = true }) {
    const prev = document.activeElement;
    const titleId = `dlg${++jobSeq}`;
    const card = el("div", { class: "dialog-card", role: "dialog", "aria-modal": "true", "aria-labelledby": labelled ? titleId : null },
      title ? el("h2", { class: "dialog-title", id: titleId }, title) : null, body, actions ? el("div", { class: "dialog-actions" }, actions) : null);
    const backdrop = el("div", { class: "dialog-backdrop" }, card);
    const close = (value) => {
      backdrop.remove();
      prev?.focus?.();
      onClose?.(value);
    };
    backdrop.addEventListener("mousedown", (e) => e.target === backdrop && close(null));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(null);
      }
      if (e.key === "Tab") {
        const items = [...card.querySelectorAll("button, input, [tabindex='0']")].filter((n) => !n.hidden);
        if (!items.length) return;
        if (e.shiftKey && document.activeElement === items[0]) {
          e.preventDefault();
          items.at(-1).focus();
        } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
          e.preventDefault();
          items[0].focus();
        }
      }
    });
    $("layer").append(backdrop);
    return { card, close };
  }

  function confirmDialog({ text, confirm }) {
    return new Promise((resolve) => {
      let d;
      const yes = el("button", { class: "btn btn-danger-fill", type: "button", onclick: () => { d.close(true); } }, confirm);
      const no = el("button", { class: "btn btn-secondary", type: "button", onclick: () => d.close(false) }, t("dash_cancel"));
      d = dialog({ title: text, body: null, actions: [no, yes], onClose: (v) => resolve(v === true) });
      no.focus();
    });
  }

  // A searchable list of languages by name in the interface language (§5 "Other
  // language…", §7 "+ Start a language").
  // A searchable list of languages; `given` replaces the default list (the shelf's languages
  // and the common ones) with options of its own, {lang, name, endonym}.
  function pickLanguage({ title, exclude = new Set(), options: given = null, query = "" }) {
    return new Promise((resolve) => {
      const c = new Intl.Collator(I18n.locale());
      let options = given;
      if (!options) {
        const known = M.shelf(state.groups).map((e) => e.lang);
        const all = [...new Set([...known, ...M.COMMON_LANGS])].filter((l) => !exclude.has(l));
        options = all.map((l) => ({ lang: l, name: languageName(l), endonym: endonym(l) })).sort((a, b) => c.compare(a.name, b.name));
      }
      const input = el("input", { class: "field", type: "search", role: "combobox", "aria-autocomplete": "list", "aria-expanded": "true", "aria-label": t("dash_lang_search"), placeholder: t("dash_lang_search") });
      const list = el("ul", { class: "lang-list", role: "listbox", id: `lst${++jobSeq}`, "aria-label": title });
      input.setAttribute("aria-controls", list.id);
      let shown = options;
      let active = 0;
      const pick = (l) => d.close(l);
      const render = () => {
        const q = Search.fold(input.value.trim());
        shown = q ? options.filter((o) => Search.fold(o.name).includes(q) || Search.fold(o.endonym).includes(q) || o.lang.toLowerCase().startsWith(q)) : options;
        active = Math.min(active, Math.max(0, shown.length - 1));
        list.replaceChildren(...shown.map((o, i) => el("li", {
          class: `lang-option${i === active ? " is-active" : ""}`,
          role: "option",
          id: `${list.id}-${i}`,
          "aria-selected": String(i === active),
          onclick: () => pick(o.lang),
        }, el("span", {}, o.name), o.endonym && o.endonym !== o.name ? el("span", { class: "lang-endonym", lang: o.lang, dir: "auto" }, o.endonym) : null)));
        if (shown.length) input.setAttribute("aria-activedescendant", `${list.id}-${active}`);
        else input.removeAttribute("aria-activedescendant");
        list.children[active]?.scrollIntoView?.({ block: "nearest" });
      };
      input.addEventListener("input", () => {
        active = 0;
        render();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") active = Math.min(shown.length - 1, active + 1);
        else if (e.key === "ArrowUp") active = Math.max(0, active - 1);
        else if (e.key === "Enter") {
          e.preventDefault();
          if (shown[active]) pick(shown[active].lang);
          return;
        } else return;
        e.preventDefault();
        render();
      });
      const d = dialog({ title, body: el("div", { class: "lang-picker" }, input, list), actions: [el("button", { class: "btn btn-secondary", type: "button", onclick: () => d.close(null) }, t("dash_cancel"))], onClose: (v) => resolve(v) });
      input.value = query;
      render();
      input.focus();
    });
  }

  function showShortcuts() {
    const rows = [
      ["/", "dash_key_search"], ["↑ ↓", "dash_key_move"], [t("dash_kbd_enter"), "dash_key_open"], [t("dash_kbd_space"), "dash_key_toggle"],
      [`${t("dash_kbd_shift")} + ↑ ↓`, "dash_key_extend"], ["Ctrl/⌘ + A", "dash_key_select_all"], [t("dash_kbd_delete"), "dash_key_delete"],
      ["P", "dash_key_pause"], ["M", "dash_key_move_lang"], ["N", "dash_key_add"], ["Esc", "dash_key_escape"], ["Ctrl/⌘ + Z", "dash_key_undo"], ["?", "dash_key_help"],
    ];
    let d;
    const list = el("dl", { class: "keys" }, rows.map(([k, key]) => [el("dt", {}, el("kbd", {}, k)), el("dd", {}, t(key))]));
    d = dialog({ title: t("dash_keys_title"), body: list, actions: [el("button", { class: "btn btn-primary", type: "button", onclick: () => d.close(null) }, t("dash_done"))] });
    d.card.querySelector(".btn").focus();
  }

  // ---------------------------------------------------------------------------------
  // Adding words (#add, §8; 24's flow with the server's preview: nothing is saved before
  // the learner says so; one to three words are saved at once with Undo, four or more
  // wait for a choice).

  // Bulk add (13): its own sheet under the add box, made once.
  let bulk = null;
  // Bulk add's column roles (bulk/parse.js) for slice 12's export columns.
  const CSV_ROLES = [["native", "native"], ["native_vocalized", "native_vocalized"], ["pronunciation", "pronunciation"], ["pronunciation_careful", "pronunciation_careful"], ["romanization", "romanization"], ["gloss", "gloss"], ["forms", "forms"], ["lang", "language"], ["lang_code", "language_code"], ["base_lang", "base_language"], ["base_code", "base_language_code"], ["note", "note"], ["pronunciation_source", "pronunciation_source"]];
  function bulkSheet() {
    bulk ??= globalThis.KotikoBulkSheet.create({
      el,
      t,
      icon,
      I18n,
      langName: (l) => languageName(l),
      source,
      send,
      ext,
      bases: () => bases(),
      records: () => state.records.values(),
      // The language the list is in by default: the add box's hint, else Focus, else the
      // most recently added word's language (13 §3).
      defaultLang: () => state.hint ?? (state.s.mixing?.focus?.length === 1 ? state.s.mixing.focus[0] : null) ?? [...state.records.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]?.lang ?? null,
      pickLanguage,
      lookupStatus: () => state.lookupStatus,
      // The CSV columns of 12's export, in the interface language: read back unmapped.
      csvHeaders: () => Object.fromEntries(CSV_ROLES.map(([role, id]) => [role, t(`export_csv_col_${id}`)])),
      // Kotiko's own backup dropped or pasted into bulk add: restored through 12's import.
      restoreBackup: ({ text, filename }) => {
        closeAdd();
        go("#settings/data");
        withTools((x) => x.restoreText(text, filename ?? ""))();
      },
      seeBatch: (ids) => {
        state.batchIds = new Set(ids);
        closeAdd();
        go("#words?batch=1");
      },
    });
    if (!bulk.node.isConnected) $("bulkHost").replaceChildren(bulk.node);
    return bulk;
  }

  function openAdd() {
    $("addSheet").hidden = false;
    $("addBackdrop").hidden = false;
    const hint = $("addHint");
    hint.hidden = !state.hint;
    if (state.hint) {
      hint.replaceChildren(I18n.parts("dash_add_hint", { language: languageName(state.hint) }), " ",
        el("button", { class: "link link-quiet", type: "button", onclick: () => { state.hint = null; hint.hidden = true; $("addText").focus(); } }, t("dash_add_hint_clear")));
    }
    renderAddJobs();
    renderQuota();
    refreshQuota();
    $("addText").focus();
    // A list handed over from the popup (13 §1), once.
    const sheet = bulkSheet();
    Promise.resolve(ext.storage.session?.get({ bulkDraft: "" }))
      .then((s) => {
        sheet.open({ text: s?.bulkDraft ?? "" });
        if (s?.bulkDraft) return ext.storage.session.remove("bulkDraft");
      })
      .catch(() => sheet.open());
  }

  // "12 free lookups left today" under the add box (slice 10 §3), from the server.
  function refreshQuota() {
    Promise.resolve()
      .then(() => source.lookupStatus?.())
      .then((s) => {
        if (s && !s.error) state.lookupStatus = s;
        renderQuota();
        if (state.route.view === "settings") renderConnStatus();
      })
      .catch(() => {});
  }

  function renderQuota() {
    const node = $("addQuota");
    const line = LookupStatus.quotaLine(state.lookupStatus, { locale: I18n.locale() });
    node.hidden = !line;
    node.textContent = line ? t(line.key, line.params) : "";
  }

  function closeAdd() {
    $("addSheet").hidden = true;
    $("addBackdrop").hidden = true;
    go(formatWordsRoute(), { replace: false });
  }

  function addFromSearch(q) {
    go("#add");
    submitAdd(q);
  }

  function submitAdd(text) {
    const value = String(text ?? "").trim();
    if (!value) return;
    const job = { id: ++jobSeq, text: value, status: "looking", hint: state.hint, words: [], candidates: [] };
    state.addJobs.unshift(job);
    state.addJobs = state.addJobs.slice(0, MAX_ADD_JOBS);
    if ([...value].length > 200) {
      job.status = "failed";
      job.error = t("error_input_too_long");
      return renderAddJobs();
    }
    renderAddJobs();
    runAdd(job);
  }

  async function runAdd(job) {
    job.status = "looking";
    renderAddJobs();
    try {
      const res = await source.preview(job.text, { baseLangs: bases().slice(0, 4), hintLang: job.hint });
      const fresh = res.candidates.filter((c) => !hasWord(c));
      job.known = res.candidates.filter((c) => hasWord(c)).map((c) => c.native);
      if (!res.candidates.length) {
        job.status = "failed";
        job.error = noWordText(res, job.text);
      } else if (M.groupRecords(fresh.map((c, i) => ({ ...c, id: i }))).length >= CONFIRM_AT) {
        job.status = "choose";
        job.candidates = fresh.map((c) => ({ word: c, keep: true }));
      } else if (fresh.length) {
        await saveCandidates(job, fresh);
      } else {
        job.status = "done";
      }
    } catch (e) {
      job.status = "failed";
      job.error = problemText(e);
    }
    renderAddJobs();
    refreshQuota();
  }

  // Why a lookup found nothing to add (slice 09's codes, slice 25's words).
  function noWordText(res, text) {
    if (res.code === "bad_lookup_result") return t("error_bad_lookup_result");
    if (res.code === "rejected_same_as_gloss") {
      const base = res.rejected?.find((r) => r?.base_lang)?.base_lang ?? bases()[0];
      return t("error_rejected_same_as_gloss", { text, base: languageName(base) });
    }
    return t("error_no_word_found", { text });
  }

  const hasWord = (c) => state.records.size && [...state.records.values()].some((r) => r.lang === c.lang && M.nativeKey(r.native) === M.nativeKey(c.native) && (r.base_lang ?? "en") === (c.base_lang ?? "en"));

  async function saveCandidates(job, words) {
    job.status = "saving";
    renderAddJobs();
    const res = await source.save(words.map((w) => ({ ...w, origin: w.origin ?? "add" })), { requestId: job.requestId ??= M.uuid7() });
    const saved = res.results.map((r) => r.word).filter(Boolean);
    for (const w of saved) state.records.set(w.id, w);
    job.words = saved.map((w) => ({ word: w, undo: null }));
    job.status = "done";
    const added = rebuild();
    markArrivals(added);
    renderWords();
  }

  async function undoAdd(job, entry) {
    entry.undo = "pending";
    renderAddJobs();
    const ids = [...state.records.values()].filter((r) => r.lang === entry.word.lang && M.nativeKey(r.native) === M.nativeKey(entry.word.native)).map((r) => r.id);
    const results = await source.write(ids.map((id) => ({ op: "delete", id })), { touch: [entry.word] });
    results.forEach((r, i) => (r.ok || r.code === "word_gone") && state.records.delete(ids[i]));
    entry.undo = results.every((r) => r.ok || r.code === "word_gone") ? "done" : null;
    rebuild();
    renderWords();
    renderAddJobs();
  }

  function renderAddJobs() {
    const list = $("addJobs");
    const items = [];
    for (const job of state.addJobs) {
      if (job.status === "looking" || job.status === "saving") {
        items.push(el("li", { class: "add-job is-looking", "data-status": job.status }, el("span", { class: "spinner", "aria-hidden": "true" }), el("span", {}, t("add_looking_up", { text: job.text }))));
      } else if (job.status === "failed") {
        items.push(el("li", { class: "add-job is-failed", "data-status": "failed" }, icon("error", 18), el("span", { class: "add-job-text" }, job.error),
          el("button", { class: "link link-quiet", type: "button", onclick: () => runAdd(job) }, t("error_try_again_action"))));
      } else if (job.status === "choose") {
        const keep = job.candidates.filter((c) => c.keep).length;
        items.push(el("li", { class: "add-job is-choose", "data-status": "choose" },
          el("p", { class: "add-job-title" }, t("dash_add_choose", { count: job.candidates.length, text: job.text })),
          el("ul", { class: "cand-list" }, job.candidates.map((c) => el("li", {}, el("label", { class: "cand" },
            el("input", { type: "checkbox", checked: c.keep, onchange: (e) => { c.keep = e.target.checked; renderAddJobs(); } }),
            candidateLine(c.word))))),
          el("div", { class: "add-job-actions" },
            el("button", { class: "btn btn-primary btn-sm", type: "button", disabled: !keep, onclick: () => saveCandidates(job, job.candidates.filter((c) => c.keep).map((c) => c.word)).then(renderAddJobs) }, t("dash_add_keep", { count: keep })),
            el("button", { class: "btn btn-quiet btn-sm", type: "button", onclick: () => { state.addJobs = state.addJobs.filter((j) => j !== job); renderAddJobs(); } }, t("dash_cancel")))));
      } else {
        for (const entry of job.words) {
          items.push(el("li", { class: "add-job is-done", "data-status": "done" },
            entry.undo === "done"
              ? el("span", { class: "add-job-text" }, I18n.parts("undo_done_created", { native: bdi(entry.word.native, entry.word.lang) }))
              : [el("span", { class: "add-job-text" }, I18n.parts("dash_add_added", { word: candidateLine(entry.word) })),
                el("button", { class: "btn btn-quiet btn-sm", type: "button", "aria-disabled": entry.undo === "pending" ? "true" : null, "aria-label": t("add_undo_label", { native: entry.word.native }), onclick: () => entry.undo !== "pending" && undoAdd(job, entry) }, icon("undo", 16), t("add_undo"))]));
        }
        if (job.known?.length) {
          items.push(el("li", { class: "add-job is-known" }, el("span", { class: "add-job-text" }, I18n.parts("add_already_known", { words: el("span", {}, job.known.map((n, i) => [i ? ", " : "", bdi(n, null, "word")])) }))));
        }
      }
    }
    list.replaceChildren(...items);
  }

  function candidateLine(w) {
    const rom = w.romanization && Search.fold(w.romanization) !== Search.fold(w.native) ? w.romanization : null;
    // Spaces between the parts, so screen readers and copied text keep them apart.
    const parts = [
      el("bdi", { class: "word dots", lang: w.lang, dir: "auto" }, w.native),
      rom ? el("span", { class: "cand-rom", lang: Cards.romanizationLang(w.lang) }, rom) : null,
      el("span", { class: "cand-eq", "aria-hidden": "true" }, "="),
      bdi(w.gloss ?? "", w.base_lang ?? "en", "cand-gloss"),
      el("span", { class: "cand-lang" }, languageName(w.lang)),
    ].filter(Boolean);
    return el("span", { class: "cand-line" }, parts.flatMap((p, i) => (i ? [" ", p] : [p])));
  }

  // ---------------------------------------------------------------------------------
  // Settings (§9).

  const SETTINGS_SECTIONS = [
    ["languages", "dash_set_bases"],
    ["language", "dash_set_ui_lang"],
    ["lookups", "dash_set_lookups"],
    ["connection", "dash_set_connection"],
    ["voices", "settings_voices"],
    ["learning", "dash_set_learning"],
    ["mixing", "dash_set_mixing"],
    ["pages", "dash_set_pages"],
    ["appearance", "dash_set_appearance"],
    ["data", "data_title"],
    ["about", "dash_set_about"],
  ];
  const dirty = new Set();

  function renderSettings() {
    $("settingsIndex").replaceChildren(...SETTINGS_SECTIONS.map(([id, key]) => el("li", {}, el("a", {
      class: `index-link${state.route.section === id ? " is-current" : ""}`,
      href: `#settings/${id}`,
      "aria-current": state.route.section === id ? "true" : null,
    }, t(key)))));
    renderBases();
    renderUiLang();
    renderLookups();
    renderConnection();
    renderConnStatus();
    renderWordsHome();
    if (lookupReady(state.s)) refreshQuota();
    $("onlineVoices").setAttribute("aria-checked", String(state.s.speech?.allowOnline === true));
    renderSegmented($("themeOptions"), [["system", "dash_theme_system"], ["light", "dash_theme_light"], ["dark", "dash_theme_dark"]], state.s.prefs?.theme ?? "system", (v) => setPref("theme", v));
    renderSegmented($("motionOptions"), [["system", "dash_motion_system"], ["reduce", "dash_motion_on"]], state.s.prefs?.motion ?? "system", (v) => setPref("motion", v));
    let version = "";
    try {
      version = ext.runtime.getManifest().version;
    } catch {
      // no manifest in tests
    }
    $("aboutVersion").textContent = t("dash_set_version", { version });
    $("celebrations").setAttribute("aria-checked", String(state.s.prefs?.celebrations !== false));
    renderPages();
    renderMixing();
    renderStory();
    renderData();
  }

  // ---------------------------------------------------------------------------------
  // Your data (slice 12). The exports, the restore and "delete everything" live in
  // data-tools.js, loaded with the backup libraries on first use.

  const scripts = new Map();
  const script = (src) => scripts.get(src) ?? scripts.set(src, new Promise((resolve, reject) => document.head.append(el("script", { src, onload: resolve, onerror: reject })))).get(src);
  let dataTools = null;
  async function tools() {
    for (const src of ["lib/word-merge.js", "lib/wordspec.js", "lib/backup.js", "lib/export-files.js", "data-tools.js"]) await script(src);
    dataTools ??= globalThis.KotikoDataTools.create({
      el,
      t,
      I18n,
      send,
      ext,
      dialog,
      toast,
      langName: (l) => languageName(l),
      bases: () => bases(),
      allRecords: () => [...state.records.values()].filter((r) => !state.removing.has(r.id)).map(effective),
      // The words the list shows now (its filters and search), every record of each.
      viewRecords: () => state.view.map(groupById).filter(Boolean).flatMap((g) => g.records),
      addBases: (tags) => writeBases([...bases(), ...tags.filter((b) => !bases().includes(b))].slice(0, Bases.MAX_BASES)),
      includeSettings: () => $("dataIncludeSettings").checked,
      onWipe: (on) => {
        state.wiped = on;
      },
      refresh: () => {
        refreshDataStatus();
        scheduleReload();
      },
    });
    return dataTools;
  }
  const withTools = (fn) => () => tools().then(fn).catch((e) => toast({ text: problemText(e), error: true }));
  const filtered = () => {
    const p = params();
    return !!(p.lang || (p.status && p.status !== "live") || p.added || p.source || p.q || p.missing || p.batch);
  };

  // "today", "12 days ago" in the interface language.
  function daysAgo(at) {
    const day = (ms) => new Date(ms).setHours(0, 0, 0, 0);
    const days = Math.max(0, Math.round((day(Date.now()) - day(at)) / 86_400_000));
    try {
      return new Intl.RelativeTimeFormat(I18n.locale(), { numeric: "auto" }).format(-days, "day");
    } catch {
      return new Date(at).toLocaleDateString();
    }
  }

  function renderData() {
    const at = state.s.lastBackupAt;
    $("dataLastBackup").textContent = typeof at === "number" ? t("data_last_backup", { when: daysAgo(at) }) : t("data_last_backup_never");
    state.dataScope ??= "all";
    renderSegmented($("dataScope"), [["all", "data_scope_all"], ["filter", "data_scope_filter"]], state.dataScope, (v) => {
      state.dataScope = v;
      renderData();
    });
    const local = mode(state.s) === "local";
    $("dataReminder").hidden = !local;
    $("dataReminderHelp").hidden = !local;
    $("dataReminder").setAttribute("aria-checked", String(state.s.prefs?.backupReminder !== false));
    const last = state.lastImport;
    $("dataLastRestore").hidden = !last;
    if (last) {
      $("dataLastRestore").replaceChildren(t("data_last_restore", { file: last.label || "kotiko-backup.json" }), " ",
        el("button", { class: "link", type: "button", "data-action": "undo-restore", onclick: withTools((x) => x.undoRestore()) }, t("add_undo")));
    }
  }

  async function refreshDataStatus() {
    try {
      const st = await send({ type: "backup.status" });
      state.lastImport = st.lastImport;
      if (typeof st.lastBackupAt === "number") state.s.lastBackupAt = st.lastBackupAt;
    } catch {
      state.lastImport = null;
    }
    if (state.route.view === "settings") renderData();
  }

  // Slice 18: one language per page (default), mix within the page, or always in this
  // order; a weight per language, or the order; new words first for a week.
  const WEIGHTS = [["0.33", "dash_weight_less"], ["1", "dash_weight_normal"], ["3", "dash_weight_more"], ["0", "dash_weight_backup"]];
  function renderMixing() {
    const m = { ...globalThis.KotikoPrecedence.DEFAULTS, ...state.s.mixing };
    renderSegmented($("mixingMode"), [["balanced", "dash_mixing_balanced"], ["mix", "dash_mixing_mix"], ["priority", "dash_mixing_priority"]], m.mode, (v) => setMixing({ mode: v }));
    const langs = [...new Set(state.groups.map((g) => g.lang))];
    const order = [...m.priority.filter((l) => langs.includes(l)), ...langs.filter((l) => !m.priority.includes(l))];
    const rows = (m.mode === "priority" ? order : langs).map((lang, i) => {
      const id = `weight-${lang}`;
      const control = m.mode === "priority"
        ? el("button", { class: "btn btn-quiet btn-sm", type: "button", disabled: i === 0 ? "" : null, "aria-label": t("dash_priority_up", { language: languageName(lang) }), onclick: () => setMixing({ priority: [...order.slice(0, i - 1), lang, order[i - 1], ...order.slice(i + 1)] }) }, icon("up", 14))
        : el("div", { class: "segmented", role: "radiogroup", "aria-labelledby": id });
      if (m.mode !== "priority") renderSegmented(control, WEIGHTS, String(m.weights[lang] ?? 1), (v) => setMixing({ weights: { ...m.weights, [lang]: Number(v) } }));
      return el("li", { class: "mixing-lang" }, el("span", { id, class: "field-label" }, m.mode === "priority" ? `${i + 1}. ${languageName(lang)}` : languageName(lang)), control);
    });
    $("mixingLangs").replaceChildren(...rows);
    $("freshFirst").setAttribute("aria-checked", String(m.freshDays > 0));
  }

  async function setMixing(patch) {
    const { mixing } = await ext.storage.local.get({ mixing: null });
    const next = { ...mixing, ...patch };
    state.s.mixing = next;
    renderSettings();
    await ext.storage.local.set({ mixing: next });
  }

  // Slice 16: sensitive sites (on by default) and the ones the learner runs Kotiko on
  // anyway, words in buttons and menus (off), and the never-swap list.
  function renderPages() {
    const p = state.s.prefs ?? {};
    $("sensitiveSites").setAttribute("aria-checked", String(p.sensitiveSites !== false));
    $("swapControls").setAttribute("aria-checked", String(p.swapControls === true));
    const chips = (list, key, label) =>
      (Array.isArray(list) ? list : []).map((v) => el("li", { class: "form-chip" },
        el("bdi", { dir: "auto" }, v),
        el("button", { class: "form-remove", type: "button", "aria-label": t(label, { [key]: v }), title: t(label, { [key]: v }), onclick: () => setPref(key === "host" ? "sensitiveAllowed" : "neverSwap", list.filter((x) => x !== v)) }, icon("close", 12))));
    const allowed = chips(p.sensitiveAllowed, "host", "dash_sensitive_allowed_remove");
    $("sensitiveAllowedField").hidden = !allowed.length;
    $("sensitiveAllowed").replaceChildren(...allowed);
    const never = chips(p.neverSwap, "word", "dash_never_swap_remove");
    $("neverSwap").replaceChildren(...(never.length ? never : [el("li", { class: "field-help" }, t("dash_never_swap_empty"))]));
  }

  // Settings → About: the "Why Kotiko?" story in the interface language (slice 22), from
  // the copy of its single source the extension ships (lib/story.js).
  let storyFor = null;
  async function renderStory() {
    const Story = globalThis.KotikoStory;
    const locale = I18n.locale();
    if (!Story || storyFor === locale) return;
    storyFor = locale;
    const story = await Story.load(locale);
    if (!story || storyFor !== locale) return;
    $("story").hidden = false;
    $("story").lang = story.locale;
    $("storyTitle").textContent = story.title;
    $("storyBody").replaceChildren(...story.paragraphs.map((p) => el("p", {}, p)));
    $("storyPending").hidden = !story.placeholder;
  }

  // --- Languages you read in (slice 50 §2) ------------------------------------------------
  // Kotiko swaps words on pages in these languages, primary first. Changes save at once to
  // storage.sync `ui` (the background projects the words again) and to the local mirror
  // content scripts read. Removing a language keeps its meanings; they stop swapping.

  const LANG_README = "https://github.com/ScriptKittyOS/kotiko/blob/main/spec/lang/README.md";

  function baseNote(text) {
    $("basesNote").textContent = text ?? "";
  }

  async function writeBases(next) {
    state.ui = { uiLang: "auto", ...state.ui, baseLangs: next.slice(), baseLangsConfirmed: true };
    try {
      await ext.storage.sync.set({ ui: state.ui });
    } catch {
      // no storage.sync: the local copy below still works
    }
    state.s.baseLangs = next.slice();
    await ext.storage.local.set({ baseLangs: next.slice() });
    rebuild();
    renderWords();
  }

  // Focus follows the moved or neighbouring language after a re-render.
  let baseFocus = null;

  async function moveBase(from, to, action) {
    const next = Bases.moveBase(bases(), from, to);
    baseFocus = { lang: next[to], action };
    baseNote(null);
    await writeBases(next);
    renderBases();
  }

  async function removeBase(tag) {
    const before = bases();
    const r = Bases.toggleBase(before, tag, false);
    if (r.error) {
      baseNote(t("dash_bases_last"));
      return;
    }
    const i = before.indexOf(tag);
    const kept = state.groups.filter((g) => g.bases.includes(tag)).length;
    baseFocus = { lang: r.bases[Math.min(i, r.bases.length - 1)], action: "remove" };
    baseNote(null);
    await writeBases(r.bases);
    renderBases();
    const language = languageName(tag);
    const entry = undoStack.push({ run: async () => {
      baseFocus = { lang: tag, action: "remove" };
      await writeBases(before);
      renderBases();
    } });
    toast({ text: kept ? t("dash_base_removed", { language, count: kept }) : t("dash_base_removed_none", { language }), undo: entry });
  }

  // Every language this browser can split into words, named in the interface language.
  function readableLanguages() {
    state.langList ??= Bases.languageList({ spec: SPEC, uiLocale: I18n.locale(), Lang });
    return state.langList;
  }

  async function addBase({ preselect = null } = {}) {
    const now = bases();
    if (preselect && now.some((b) => Lang.sameBase(b, preselect))) return;
    if (now.length >= Bases.MAX_BASES) {
      baseNote(t("dash_bases_full", { max: Bases.MAX_BASES }));
      return;
    }
    baseNote(null);
    const options = readableLanguages()
      .filter((o) => !now.some((b) => Lang.sameBase(b, o.tag)))
      .map((o) => ({ lang: o.tag, name: o.name, endonym: o.endonym ?? endonym(o.tag) }));
    const ready = preselect ? options.find((o) => Lang.sameBase(o.lang, preselect)) : null;
    const picked = await pickLanguage({ title: t("dash_bases_add_title"), options, query: ready?.name ?? "" });
    if (!picked) return;
    const tag = Lang.baseTagOf(picked) ?? picked;
    const r = Bases.toggleBase(bases(), tag, true);
    if (r.error) return baseNote(t("dash_bases_full", { max: Bases.MAX_BASES }));
    baseFocus = { lang: tag, action: "remove" };
    await writeBases(r.bases);
    renderBases();
  }

  function baseButton(name, label, disabled, run) {
    return el("button", {
      class: "btn btn-icon",
      type: "button",
      "aria-label": label,
      title: label,
      disabled,
      "data-action": name,
      onclick: run,
    }, icon(name === "remove" ? "close" : name, 16));
  }

  function renderBases() {
    const active = document.activeElement;
    if (!baseFocus && $("baseList").contains(active)) baseFocus = { lang: active.closest(".base-row")?.dataset.lang, action: active.dataset.action ?? null };
    const list = bases();
    const number = new Intl.NumberFormat(I18n.locale());
    const rows = list.map((tag, i) => {
      const name = languageName(tag);
      const endo = endonym(tag);
      const full = Bases.levelOf(tag) === "full";
      const helpId = `baseHelp${i}`;
      const missing = M.missingMeanings(state.groups, tag);
      const row = el("li", {
        class: "base-row",
        "data-lang": tag,
        draggable: "true",
        ondragstart: (e) => {
          e.dataTransfer?.setData("text/plain", String(i));
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
          row.classList.add("is-dragging");
        },
        ondragend: () => row.classList.remove("is-dragging"),
        ondragover: (e) => {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        },
        ondrop: (e) => {
          e.preventDefault();
          const from = Number(e.dataTransfer?.getData("text/plain"));
          if (Number.isInteger(from) && from !== i) moveBase(from, i, "up");
        },
      },
      el("span", { class: "base-grip", "aria-hidden": "true" }, icon("grip", 16)),
      el("span", { class: "base-pos", "aria-hidden": "true" }, number.format(i + 1)),
      el("span", { class: "base-main" },
        el("span", { class: "base-name" },
          el("span", { class: "base-label" }, name),
          endo && endo.toLocaleLowerCase() !== name.toLocaleLowerCase() ? el("span", { class: "base-endonym", lang: tag, dir: "auto" }, endo) : null,
          el("span", { class: `base-level is-${full ? "full" : "basic"}`, tabindex: "0", "aria-describedby": helpId }, t(full ? "dash_base_full" : "dash_base_basic")),
          el("span", { class: "base-tip", id: helpId, role: "tooltip" }, t(full ? "dash_base_full_help" : "dash_base_basic_help", { language: endo || name })),
          i === 0 ? el("span", { class: "base-primary" }, t("dash_base_primary")) : null),
        !full ? el("a", { class: "link link-quiet base-improve", href: LANG_README, target: "_blank", rel: "noopener noreferrer" }, t("dash_base_improve")) : null,
        missing ? el("span", { class: "base-missing" },
          t("dash_base_missing", { count: missing, language: name }), " ",
          el("button", { class: "link", type: "button", onclick: () => go(M.formatRoute({ view: "words", params: { missing: tag } })) }, t("dash_base_type_meanings"))) : null),
      el("span", { class: "base-controls" },
        baseButton("up", t("dash_base_up", { language: name }), i === 0, () => moveBase(i, i - 1, "up")),
        baseButton("down", t("dash_base_down", { language: name }), i === list.length - 1, () => moveBase(i, i + 1, "down")),
        baseButton("remove", t("dash_base_remove", { language: name }), false, () => removeBase(tag))));
      return row;
    });
    $("baseList").replaceChildren(...rows);
    if (baseFocus) {
      const row = rows.find((r) => r.dataset.lang === baseFocus.lang);
      const buttons = row ? [...row.querySelectorAll("button[data-action]")] : [];
      (buttons.find((b) => b.dataset.action === baseFocus.action && !b.disabled) ?? buttons.find((b) => !b.disabled))?.focus();
      baseFocus = null;
    }
    const detected = Array.isArray(state.ui?.baseLangsDetected) ? state.ui.baseLangsDetected : [];
    const hint = $("basesDetected");
    hint.hidden = !detected.length;
    hint.textContent = detected.length
      ? t("dash_bases_detected", { languages: new Intl.ListFormat(I18n.locale(), { type: "conjunction" }).format(detected.map((b) => endonym(b))) })
      : "";
  }

  function renderUiLang() {
    const box = $("uiLangOptions");
    const current = state.uiLang ?? "auto";
    let browser;
    try {
      browser = ext.i18n.getUILanguage();
    } catch {
      browser = "en";
    }
    const browserName = I18n.languageName(browser.split("-")[0], browser.split("-")[0]) ?? browser;
    const options = [["auto", t("dash_ui_lang_auto", { language: browserName })], ...I18n.shipped().map((l) => [l, endonym(l)])];
    renderRadios(box, options, current, (v) => setUiLang(v));
  }

  // A radio group with arrow keys that apply at once (27 §3). Options of the interface
  // language carry their `lang`; others (providers) don't.
  function renderRadios(box, options, current, onPick, cls = "radio", { langs = box.id === "uiLangOptions" } = {}) {
    const focused = box.contains(document.activeElement);
    const items = options.map(([value, label]) => el("button", {
      class: cls,
      type: "button",
      role: "radio",
      "aria-checked": String(value === current),
      tabindex: value === current ? "0" : "-1",
      "data-value": value,
      lang: langs && cls === "radio" && value !== "auto" ? value : null,
      onclick: () => onPick(value),
    }, cls === "radio" ? el("span", { class: "radio-dot", "aria-hidden": "true" }) : null, el("span", {}, label)));
    box.replaceChildren(...items);
    box.onkeydown = (e) => {
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      const rtl = getComputedStyle(box).direction === "rtl";
      const fwd = e.key === "ArrowDown" || e.key === (rtl ? "ArrowLeft" : "ArrowRight");
      const back = e.key === "ArrowUp" || e.key === (rtl ? "ArrowRight" : "ArrowLeft");
      if (!fwd && !back) return;
      e.preventDefault();
      const next = items[(i + (fwd ? 1 : -1) + items.length) % items.length];
      onPick(next.dataset.value);
    };
    if (focused) items.find((b) => b.getAttribute("aria-checked") === "true")?.focus();
  }

  const renderSegmented = (box, options, current, onPick) => renderRadios(box, options.map(([v, k]) => [v, t(k)]), current, onPick, "segment");

  async function setPref(key, value) {
    const { prefs = {} } = await ext.storage.local.get({ prefs: {} });
    const next = { ...prefs, [key]: value };
    state.s.prefs = next;
    renderSettings();
    await ext.storage.local.set({ prefs: next });
  }

  async function setUiLang(value) {
    state.uiLang = value;
    try {
      const { ui = {} } = await ext.storage.sync.get({ ui: {} });
      await ext.storage.sync.set({ ui: { ...ui, uiLang: value } });
    } catch {
      // storage.sync unavailable: this page still switches
    }
    await applyUiLang(value);
  }

  // Re-renders everything in the new language in place, keeping scroll position (§9).
  async function applyUiLang(value) {
    const scroll = { list: $("gridBody").scrollTop, page: document.scrollingElement?.scrollTop ?? 0 };
    const changed = await I18n.useLocale(value).catch(() => false);
    if (!changed) return renderSettings();
    state.langList = null;
    I18n.apply(document);
    resort();
    renderWords();
    renderSettings();
    if (state.open && groupById(state.open)) renderInspector(groupById(state.open));
    renderAddJobs();
    $("gridBody").scrollTop = scroll.list;
    if (document.scrollingElement) document.scrollingElement.scrollTop = scroll.page;
  }

  function renderConnection() {
    const url = $("serverUrl");
    if (document.activeElement !== url && !dirty.has("serverUrl")) url.value = state.s.server?.url ?? state.s.serverUrl ?? "";
    // The token is never read back (slice 11 §3): a saved one shows only masked.
    $("accessKey").placeholder = state.masked.server ? t("settings_key_saved", { masked: state.masked.server }) : "";
  }

  // The address and token go to the background, which keeps the token where pages can't
  // read it. With words kept in this browser, connecting doesn't move them: the learner
  // sees the count first (the words' home, below).
  async function saveConnection(id) {
    dirty.delete(id);
    const value = $(id).value.trim();
    const msg = { type: "server.connect" };
    if (id === "serverUrl") {
      msg.url = value || DEFAULT_SERVER;
      if (msg.url === (state.s.server?.url ?? state.s.serverUrl ?? DEFAULT_SERVER)) return;
    } else {
      if (!value) return;
      msg.token = value;
    }
    state.checking = true;
    renderConnStatus();
    const res = await send(msg).catch((e) => ({ error: String(e?.message ?? e) }));
    if (id === "accessKey") $("accessKey").value = "";
    flashConnSaved();
    await refreshBackend();
    if (res?.needsSwitch) {
      state.checking = false;
      renderSettings();
      return openMove("server");
    }
    await checkConnection();
  }

  // Settings and masked secrets from the background (slice 11).
  async function refreshBackend() {
    const [b, d] = await Promise.all([send({ type: "backend.get" }).catch(() => null), send({ type: "secrets.describe" }).catch(() => null)]);
    if (b && !b.error) {
      state.backend = b;
      Object.assign(state.s, { wordsHome: b.wordsHome, lookup: b.lookup, server: b.server, keys: b.keys });
    }
    if (d && !d.error) state.masked = d.secrets ?? {};
  }

  // --- Word lookups (slice 11 §4) -------------------------------------------------------

  const NOTES = {
    openrouter: "dash_note_openrouter",
    openai: "dash_note_openai",
    anthropic: "dash_note_anthropic",
    gemini: "dash_note_gemini",
    groq: "dash_note_groq",
    ollama: "dash_note_ollama",
    lmstudio: "dash_note_lmstudio",
    custom: "dash_note_custom",
  };

  const providerName = (p) => (p.id === "custom" ? t("dash_provider_custom") : p.label);

  function renderLookups() {
    const s = state.s;
    const kind = lookupKind(s);
    const p = kind === "provider" ? preset(s.lookup.provider) : null;
    const options = (state.backend?.providers ?? []).map((x) => [x.id, x.free && !x.local ? t("dash_provider_free", { name: x.label }) : x.beta ? t("dash_provider_beta", { name: x.label }) : providerName(x)]);
    if (serverKey(s) || kind === "server") options.push(["server", t("dash_lookup_server")]);
    options.push(["none", t("dash_lookup_none")]);
    renderRadios($("providerOptions"), options, kind === "provider" ? s.lookup.provider : kind, pickProvider);

    $("providerNote").hidden = !p;
    $("providerNote").textContent = p ? t(NOTES[p.id] ?? "dash_note_custom") : "";
    const masked = p ? state.masked[`provider:${p.id}`] : null;
    const wantsKey = !!p && (p.keyRequired || p.id === "custom");
    $("lookupKeyField").hidden = !wantsKey;
    if (wantsKey) {
      $("lookupKeyLabel").textContent = p.id === "custom" ? t("dash_key_label_custom") : t("dash_key_label", { provider: providerName(p) });
      $("lookupKeySaved").hidden = !masked || state.replacing;
      $("lookupKeyMasked").replaceChildren(...(masked ? I18n.parts("dash_key_saved_as", { masked: el("code", { class: "key-code", dir: "ltr" }, masked) }) : []));
      $("lookupKeyEntry").hidden = !!masked && !state.replacing;
      $("getKey").hidden = !p.keyUrl;
      if (p.keyUrl) $("getKey").href = p.keyUrl;
    }
    $("noKeyNeeded").hidden = !(p && !p.keyRequired && p.local);
    $("baseUrlField").hidden = !(p && (p.local || p.id === "custom"));
    const baseUrl = $("lookupBaseUrl");
    if (p && document.activeElement !== baseUrl && !dirty.has("lookupBaseUrl")) {
      baseUrl.value = s.lookup.baseUrl ?? p.baseUrl ?? "";
      baseUrl.placeholder = p.baseUrl ?? "https://…/v1";
    }
    $("modelField").hidden = !p;
    const model = $("lookupModel");
    if (p && document.activeElement !== model && !dirty.has("lookupModel")) model.value = s.lookup.model ?? "";
    $("dataCollectionRow").hidden = p?.id !== "openrouter";
    $("dataCollection").setAttribute("aria-checked", String(s.lookup?.dataCollection === "deny"));
    $("lookupTestRow").hidden = kind === "none" || !lookupReady(s);
    // Only OpenRouter's free models have a daily count a test uses up.
    $("lookupTestNote").hidden = p?.id !== "openrouter";
    renderLookupState();
  }

  function renderLookupState() {
    const box = $("lookupState");
    const s = state.s;
    const kind = lookupKind(s);
    if (state.testing) return box.replaceChildren(el("p", { class: "conn-note" }, t("dash_lookup_testing")));
    const r = state.lookupTest;
    if (r && r.ok) {
      const seconds = I18n.formatNumber(Math.max(0.1, Math.round((r.ms ?? 0) / 100) / 10));
      return box.replaceChildren(el("p", { class: "conn-ok" }, icon("success", 18), el("span", {}, t("dash_lookup_test_ok", { model: r.model ?? r.provider ?? "", seconds }))));
    }
    if (r && (r.error || r.code)) {
      return box.replaceChildren(el("p", { class: "conn-bad" }, icon("error", 18), el("span", {}, problemText(r.code ? r : { code: r.error?.code, details: r.error?.details }))));
    }
    if (kind === "none") return box.replaceChildren(el("p", { class: "conn-note" }, t("dash_lookup_off")));
    if (!lookupReady(s)) return box.replaceChildren(el("p", { class: "conn-note" }, t("dash_lookup_needs_key")));
    const q = state.lookupStatus?.quota;
    const left = q && typeof q.remaining === "number" && typeof q.limit === "number" ? el("p", { class: "conn-note" }, t("dash_set_lookups_left", { count: q.remaining, limit: q.limit })) : "";
    box.replaceChildren(el("p", { class: "conn-ok" }, icon("success", 18), el("span", {}, t("dash_lookup_ready"))), left);
  }

  async function setLookup(patch) {
    state.lookupTest = null;
    state.s.lookup = { ...(state.s.lookup ?? {}), ...patch };
    renderLookups();
    renderBanners();
    const res = await send({ type: "backend.set", lookup: patch }).catch((e) => ({ error: String(e?.message ?? e), code: "internal" }));
    if (res?.error) state.lookupTest = res;
    else if (res?.lookup) state.s.lookup = res.lookup;
    renderLookups();
    renderBanners();
    renderQuota();
  }

  function pickProvider(value) {
    state.replacing = false;
    if (value === "none" || value === "server") return setLookup({ kind: value });
    return setLookup({ kind: "provider", provider: value, baseUrl: null, model: null });
  }

  async function saveKey() {
    const p = preset(state.s.lookup?.provider);
    const value = $("lookupKey").value.trim();
    if (!p || !value) return;
    const res = await send({ type: "secrets.set", id: `provider:${p.id}`, value }).catch((e) => ({ error: String(e?.message ?? e), code: "internal" }));
    $("lookupKey").value = "";
    if (res?.error) {
      state.lookupTest = res;
      return renderLookups();
    }
    state.masked[`provider:${p.id}`] = res.masked;
    state.s.keys = { ...(state.s.keys ?? {}), providers: { ...(state.s.keys?.providers ?? {}), [p.id]: true } };
    state.replacing = false;
    state.lookupTest = null;
    toast({ text: t("dash_set_saved") });
    renderLookups();
    renderBanners();
    refreshQuota();
  }

  async function removeKey() {
    const p = preset(state.s.lookup?.provider);
    if (!p) return;
    await send({ type: "secrets.remove", id: `provider:${p.id}` }).catch(() => null);
    delete state.masked[`provider:${p.id}`];
    state.s.keys = { ...(state.s.keys ?? {}), providers: { ...(state.s.keys?.providers ?? {}), [p.id]: false } };
    state.lookupTest = null;
    toast({ text: t("dash_key_removed") });
    renderLookups();
    renderBanners();
    $("lookupKey").focus();
  }

  async function testLookup() {
    state.testing = true;
    state.lookupTest = null;
    renderLookupState();
    const res = await send({ type: "backend.test" }).catch((e) => ({ error: String(e?.message ?? e), code: "internal" }));
    state.testing = false;
    state.lookupTest = res ?? { code: "internal" };
    if (res?.quota) state.lookupStatus = { ...(state.lookupStatus ?? {}), quota: res.quota };
    renderLookupState();
  }

  function saveLookupField(id) {
    dirty.delete(id);
    const value = $(id).value.trim() || null;
    const key = id === "lookupBaseUrl" ? "baseUrl" : "model";
    const p = preset(state.s.lookup?.provider);
    const current = state.s.lookup?.[key] ?? (key === "baseUrl" ? p?.baseUrl ?? null : null);
    if (value === current) return;
    return setLookup({ [key]: key === "baseUrl" && value === p?.baseUrl ? null : value });
  }

  // --- The words' home (slice 11 §6): moving words between this browser and a server ------

  function renderWordsHome() {
    const local = mode(state.s) === "local";
    $("wordsHomeText").textContent = t(local ? "dash_home_local" : "dash_home_server");
    const btn = $("moveWords");
    btn.textContent = t(local ? "dash_move_to_server" : "dash_move_to_local");
    btn.hidden = (local && !serverKey(state.s)) || !!state.move;
    const m = state.move;
    $("moveBox").hidden = !m;
    if (!m) return;
    const toLocal = m.to === "local";
    $("moveKeepRow").hidden = !toLocal;
    $("moveForgetRow").hidden = !toLocal;
    const confirm = $("moveConfirm");
    confirm.hidden = m.count === undefined || !!m.error || !!m.done;
    confirm.disabled = !!m.busy;
    if (m.error) $("moveText").textContent = t("dash_move_failed", { reason: problemText(m.error) });
    else if (m.done) $("moveText").textContent = m.done;
    else if (m.busy) $("moveText").textContent = t("dash_move_moving");
    else if (m.count === undefined) $("moveText").textContent = t("dash_move_counting");
    else {
      $("moveText").textContent = toLocal ? t("dash_move_to_local_confirm", { count: m.count }) : t("dash_move_to_server_confirm", { count: m.count, server: m.server ?? "" });
      confirm.textContent = toLocal ? t("dash_move_copy", { count: m.count }) : t("dash_move_upload", { count: m.count });
    }
  }

  async function openMove(to) {
    state.move = { to };
    renderWordsHome();
    const res = await send({ type: "migrate.preview", to }).catch((e) => ({ error: String(e?.message ?? e), code: "internal" }));
    if (state.move?.to !== to) return;
    state.move = res?.error ? { to, error: res } : { to, count: res.count, server: res.server };
    renderWordsHome();
    $(state.move.error ? "moveCancel" : "moveConfirm").focus();
  }

  async function confirmMove() {
    const m = state.move;
    if (!m || m.busy) return;
    state.move = { ...m, busy: true };
    renderWordsHome();
    const res = await send({ type: "migrate.run", to: m.to, forget: $("moveForget").checked, serverLookups: $("moveKeep").checked }).catch((e) => ({ error: String(e?.message ?? e), code: "internal" }));
    if (res?.error) {
      state.move = { ...m, busy: false, error: res };
      return renderWordsHome();
    }
    const done = m.to === "server"
      ? t("dash_move_done_server", { created: I18n.formatNumber(res.created ?? 0), merged: I18n.formatNumber(res.updated ?? 0), unchanged: I18n.formatNumber(res.unchanged ?? 0) })
      : t("dash_move_done_local", { count: res.total ?? 0 });
    state.move = null;
    toast({ text: done });
    await refreshBackend();
    Object.assign(state.s, await ext.storage.local.get({ lastSync: null, syncError: null }));
    renderSettings();
    renderBanners();
    await Promise.all([load(), loadDeleted()]);
  }

  function cancelMove() {
    state.move = null;
    renderWordsHome();
    $("moveWords").focus();
  }

  function flashConnSaved() {
    toast({ text: t("dash_set_saved") });
  }

  async function checkConnection() {
    state.checking = true;
    renderConnStatus();
    await source.syncNow();
    Object.assign(state.s, await ext.storage.local.get({ lastSync: null, syncError: null, wordsHome: null, server: null, keys: null }));
    state.checking = false;
    renderConnStatus();
    renderBanners();
    await load();
  }

  function renderConnStatus() {
    const box = $("connStatus");
    const s = state.s;
    if (state.checking) return box.replaceChildren(el("p", { class: "conn-note" }, t("settings_checking")));
    if (!serverKey(s)) return box.replaceChildren(el("p", { class: "conn-note" }, t("settings_not_connected")));
    // A server saved while the words stay in this browser: the words' home below says so.
    if (mode(s) === "local") return box.replaceChildren();
    const err = s.syncError;
    if (err && !(err.code === "server_key_rejected" && err.details?.reason === "no_token")) {
      return box.replaceChildren(el("p", { class: "conn-bad" }, icon("error", 18), el("span", {}, problemText(err))));
    }
    if (!s.lastSync) return box.replaceChildren(el("p", { class: "conn-note" }, t("settings_not_connected")));
    const q = state.lookupStatus?.quota;
    const left = q && typeof q.remaining === "number" && typeof q.limit === "number" && LookupStatus.quotaLine(state.lookupStatus, { showAt: Infinity })
      ? el("p", { class: "conn-note" }, t("dash_set_lookups_left", { count: q.remaining, limit: q.limit }))
      : null;
    box.replaceChildren(el("p", { class: "conn-ok" }, icon("success", 18), el("span", {}, t("dash_set_connected", { count: state.groups.length }))), left ?? "");
  }

  async function setOnlineVoices(on) {
    const { speech = LOCAL_DEFAULTS.speech } = await ext.storage.local.get({ speech: LOCAL_DEFAULTS.speech });
    const next = { ...LOCAL_DEFAULTS.speech, ...speech, allowOnline: on };
    state.s.speech = next;
    Speak?.configure?.(next);
    $("onlineVoices").setAttribute("aria-checked", String(on));
    await ext.storage.local.set({ speech: next });
  }

  // ---------------------------------------------------------------------------------
  // Routes (§1).

  function formatWordsRoute(extra = {}) {
    return M.formatRoute({ view: "words", id: state.open, params: params(), ...extra });
  }

  function go(hash, { replace = false } = {}) {
    if (location.hash === hash) return onRoute();
    if (replace) {
      history.replaceState(null, "", hash);
      onRoute();
    } else location.hash = hash;
  }

  // Mirrors list state in the hash without adding history entries.
  function updateRoute(extra = {}) {
    const hash = M.formatRoute({ view: "words", id: "id" in extra ? extra.id : state.open, params: { ...params(), ...(extra.params ?? {}) } });
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }

  function setParams(changes, { focusSearch = false } = {}) {
    const next = { ...params() };
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === undefined || v === "") delete next[k];
      else next[k] = v;
    }
    const statusChanged = (next.status ?? "live") !== (params().status ?? "live");
    const sortChanged = (next.sort ?? "newest") !== (params().sort ?? "newest");
    state.route = { ...state.route, view: "words", params: next };
    if (statusChanged && state.open) closeInspector();
    if (statusChanged || sortChanged) resort();
    else refilter();
    state.active = 0;
    $("gridBody").scrollTop = 0;
    if ("q" in changes && !next.q) $("search").value = "";
    updateRoute({ params: next });
    renderWords();
    if (focusSearch) $("search").focus();
  }

  function onRoute() {
    const route = M.parseRoute(location.hash || "#words");
    const prevView = state.route.view;
    const prevStatus = params().status;
    if (route.view === "words") {
      state.route = { view: "words", id: route.id, params: route.params };
    } else if (route.view === "add") {
      state.route = { ...state.route, view: "add" };
    } else {
      state.route = { ...state.route, view: route.view, section: route.section };
    }
    showView(prevView);
    // "#settings/languages/add/pt-BR" (the popup): the picker opens ready to add it, once.
    if (route.add && route.section === "languages") {
      history.replaceState(null, "", "#settings/languages");
      addBase({ preselect: route.add });
    }
    // "#settings/data/backup" (the popup's "Back up now", 12 §8): one backup, once.
    if (route.backup) {
      history.replaceState(null, "", "#settings/data");
      withTools((x) => x.exportBackup())();
    }
    if (route.view === "settings") refreshDataStatus();
    if (route.view === "words") {
      if ((params().status ?? "live") !== (prevStatus ?? "live")) resort();
      else refilter();
      renderWords();
      if (state.loaded) {
        if (route.id && route.id !== state.open) openFromRoute();
        else if (!route.id && state.open) closeInspector();
      }
    }
  }

  function openFromRoute() {
    const id = state.route.id;
    if (!id) return;
    const g = groupById(id) ?? groupById(state.groupOf.get(id));
    if (!g) return;
    const i = state.view.indexOf(g.id);
    if (i >= 0) {
      state.active = i;
      scrollToActive();
    }
    state.selected = new Set([g.id]);
    openInspector(g.id);
  }

  function showView(prevView) {
    const view = state.route.view;
    $("app").dataset.view = view;
    $("wordsView").hidden = view === "settings";
    $("settingsView").hidden = view !== "settings";
    if (view === "settings") {
      renderSettings();
      const section = state.route.section ? document.getElementById(`set-${state.route.section}`) : null;
      if (section) {
        section.scrollIntoView?.({ block: "start" });
        // Languages you read in is reached from the popup's "I read … too": its heading.
        (state.route.section === "languages" ? $("setBasesTitle") : section.querySelector("input, button"))?.focus({ preventScroll: true });
      } else if (prevView !== "settings") $("settingsTitle").focus();
      document.title = `${t("dash_settings")} · ${t("extName")}`;
    } else {
      document.title = `${t("dash_title")} · ${t("extName")}`;
    }
    if (view === "add") openAdd();
    else if (!$("addSheet").hidden) {
      $("addSheet").hidden = true;
      $("addBackdrop").hidden = true;
    }
    if (prevView === "settings" && view === "words") $("search").focus();
  }

  // ---------------------------------------------------------------------------------
  // Wiring.

  function onStorage(changes, area) {
    if (state.wiped) return;
    if (area === "sync" && changes.ui) {
      const prev = JSON.stringify(state.ui?.baseLangs ?? null);
      state.ui = changes.ui.newValue ?? {};
      const v = state.ui.uiLang ?? "auto";
      if (v !== state.uiLang) {
        state.uiLang = v;
        applyUiLang(v);
      } else if (JSON.stringify(state.ui.baseLangs ?? null) !== prev) {
        rebuild();
        renderWords();
        if (state.route.view === "settings") renderBases();
      }
      return;
    }
    if (area !== "local") return;
    let words = false;
    for (const k of Object.keys(changes)) {
      if (!(k in LOCAL_DEFAULTS)) continue;
      state.s[k] = changes[k].newValue ?? LOCAL_DEFAULTS[k];
      words ||= k === "baseLangs";
    }
    if (changes.speech) Speak?.configure?.(state.s.speech);
    if (changes.syncError || changes.lastSync || changes.token || changes.keys || changes.lookup) {
      renderBanners();
      if (state.route.view === "settings") renderSettings();
    }
    if (changes.serverUrl || changes.token || changes.server) {
      renderConnection();
      if (changes.token) scheduleReload();
    }
    // Words moved between this browser and a server: read them from their new home.
    if (changes.wordsHome) {
      renderBanners();
      scheduleReload();
      loadDeleted();
    }
    if (changes.hiddenLangs) renderShelf();
    if ((changes.prefs || changes.mixing || changes.lastBackupAt) && state.route.view === "settings") renderSettings();
    if (words) {
      rebuild();
      renderWords();
    }
  }

  function updateRowHeight() {
    const next = matchMedia("(max-width: 599px)").matches ? ROW_NARROW : ROW_WIDE;
    if (next === rowH) return;
    const anchor = scrollAnchor();
    rowH = next;
    renderList({ anchor });
  }

  async function init() {
    await I18n.loadPreference();
    state.uiLang = await I18n.preference();
    I18n.apply(document);
    Icons.hydrate(document);
    document.title = `${t("dash_title")} · ${t("extName")}`;
    rowH = matchMedia("(max-width: 599px)").matches ? ROW_NARROW : ROW_WIDE;

    source = globalThis.KotikoWordSource.createServerSource({ send, onChanged: ext.storage.onChanged });

    const skeleton = setTimeout(showSkeleton, SKELETON_MS);
    Object.assign(state.s, await ext.storage.local.get(LOCAL_DEFAULTS));
    try {
      state.ui = (await ext.storage.sync.get({ ui: {} })).ui ?? {};
    } catch {
      state.ui = {};
    }
    Speak?.configure?.(state.s.speech);

    $("search").addEventListener("input", (e) => setParams({ q: e.target.value || null }));
    $("search").addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" && state.view.length) {
        e.preventDefault();
        $("grid").focus();
      }
    });
    $("grid").addEventListener("keydown", onGridKey);
    $("grid").addEventListener("focus", () => renderWindow(false));
    $("gridBody").addEventListener("scroll", onScroll, { passive: true });
    $("inspector").addEventListener("keydown", onInspectorKey);
    $("scrim").addEventListener("click", () => closeInspector({ focusList: true }));
    $("addWords").addEventListener("click", () => go("#add"));
    // A file dragged over the dashboard (13 §2); "Choose a file" in the sheet is the other way.
    const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
    let dragging = 0;
    document.addEventListener("dragenter", (e) => hasFiles(e) && (dragging++, ($("dropOverlay").hidden = false)));
    document.addEventListener("dragleave", (e) => hasFiles(e) && --dragging <= 0 && ((dragging = 0), ($("dropOverlay").hidden = true)));
    document.addEventListener("dragover", (e) => hasFiles(e) && e.preventDefault());
    document.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragging = 0;
      $("dropOverlay").hidden = true;
      go("#add");
      bulkSheet().files(e.dataTransfer.files);
    });
    $("addBaseLang").addEventListener("click", addBase);
    $("closeAdd").addEventListener("click", closeAdd);
    $("addBackdrop").addEventListener("click", closeAdd);
    $("addForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("addText");
      const text = input.value;
      input.value = "";
      input.focus();
      submitAdd(text);
    });
    $("addSheet").addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeAdd();
      }
    });
    $("moreMenu").addEventListener("click", (e) => openMenu(e.currentTarget, [
      // 13: "Import a list or file".
      { label: t("data_menu_restore"), run: withTools((x) => x.chooseBackup()) },
      { label: t("data_menu_backup"), run: withTools((x) => x.exportBackup()) },
      // Export ▾ (21 §2): the words the list shows now.
      { label: t(filtered() ? "data_menu_csv_filter" : "data_menu_csv"), run: withTools((x) => x.exportCsv(filtered() ? "filter" : "all")) },
      { label: t(filtered() ? "data_menu_anki_filter" : "data_menu_anki"), run: withTools((x) => x.exportAnki(filtered() ? "filter" : "all")) },
      { label: t("dash_keys_title"), run: showShortcuts },
    ]));
    $("dataBackup").addEventListener("click", withTools((x) => x.exportBackup()));
    $("dataCsv").addEventListener("click", withTools((x) => x.exportCsv(state.dataScope ?? "all")));
    $("dataAnki").addEventListener("click", withTools((x) => x.exportAnki(state.dataScope ?? "all")));
    $("dataRestore").addEventListener("click", withTools((x) => x.chooseBackup()));
    $("dataDelete").addEventListener("click", withTools((x) => x.deleteEverything()));
    $("dataReminder").addEventListener("click", () => setPref("backupReminder", state.s.prefs?.backupReminder === false));
    $("refreshAction").addEventListener("click", onRefreshAction);
    $("testConn").addEventListener("click", () => checkConnection());
    $("saveKey").addEventListener("click", saveKey);
    $("lookupKey").addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), saveKey()));
    $("replaceKey").addEventListener("click", () => {
      state.replacing = true;
      renderLookups();
      $("lookupKey").focus();
    });
    $("removeKey").addEventListener("click", removeKey);
    $("testLookup").addEventListener("click", testLookup);
    $("celebrations").addEventListener("click", () => setPref("celebrations", state.s.prefs?.celebrations === false));
    $("sensitiveSites").addEventListener("click", () => setPref("sensitiveSites", state.s.prefs?.sensitiveSites === false));
    $("freshFirst").addEventListener("click", () => setMixing({ freshDays: (state.s.mixing?.freshDays ?? 7) > 0 ? 0 : 7 }));
    $("swapControls").addEventListener("click", () => setPref("swapControls", state.s.prefs?.swapControls !== true));
    $("showWelcome").addEventListener("click", () => send({ type: "welcome.open" }).catch(() => {}));
    $("dataCollection").addEventListener("click", () => setLookup({ dataCollection: $("dataCollection").getAttribute("aria-checked") === "true" ? "allow" : "deny" }));
    for (const id of ["lookupBaseUrl", "lookupModel"]) {
      $(id).addEventListener("input", () => dirty.add(id));
      $(id).addEventListener("change", () => saveLookupField(id));
      $(id).addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), saveLookupField(id)));
    }
    $("moveWords").addEventListener("click", () => openMove(mode(state.s) === "local" ? "server" : "local"));
    $("moveConfirm").addEventListener("click", confirmMove);
    $("moveCancel").addEventListener("click", cancelMove);
    $("onlineVoices").addEventListener("click", () => setOnlineVoices($("onlineVoices").getAttribute("aria-checked") !== "true"));
    $("toggleKey").addEventListener("click", () => {
      const input = $("accessKey");
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      $("toggleKey").setAttribute("aria-pressed", String(show));
      $("toggleKey").textContent = show ? t("settings_hide_key") : t("settings_show_key");
    });
    for (const id of ["serverUrl", "accessKey"]) {
      $(id).addEventListener("input", () => dirty.add(id));
      $(id).addEventListener("change", () => saveConnection(id));
      $(id).addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), saveConnection(id)));
    }
    document.addEventListener("keydown", onGlobalKey);
    document.addEventListener("mousedown", (e) => {
      if (!e.target.closest?.(".menu")) closeMenus();
    });
    addEventListener("hashchange", onRoute);
    addEventListener("resize", () => {
      updateRowHeight();
      closeMenus();
      renderWindow(false);
    });
    addEventListener("online", () => {
      state.online = true;
      renderBanners();
      retryWaiting();
    });
    addEventListener("offline", () => {
      state.online = false;
      renderBanners();
    });
    // Telegram adds arrive with the next background sync; ask for one when the page gains
    // focus (§10), and reload what changed.
    addEventListener("focus", () => {
      source.syncNow();
      if (state.waiting.size) retryWaiting();
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && state.job && state.job.state !== "done") pollJob();
    });
    ext.storage.onChanged.addListener(onStorage);
    source.subscribe(({ reason }) => (reason === "deleted" ? loadDeleted() : scheduleReload()));

    state.route = { view: "words", id: null, params: {} };
    await refreshBackend();
    onRoute();
    await Promise.all([load(), loadDeleted()]);
    clearTimeout(skeleton);
    $("app").removeAttribute("aria-busy");
    $("app").dataset.ready = "true";
    for (const n of $("gridBody").querySelectorAll(".skel-row")) n.remove();
    renderWords();
    if (state.route.view === "settings") renderSettings();
    // Find a word in one step (§13): typing goes to the search field from the start.
    if (state.route.view === "words" && !state.open && document.activeElement === document.body) $("search").focus({ preventScroll: true });
    pollJob();
    source.syncNow();
  }

  globalThis.KotikoDashboard = {
    state,
    ready: init(),
    undoLast,
    reload: () => load(),
    // For the performance test (test/perf): one pass of the virtualized window.
    _renderWindow: () => renderWindow(false),
    _rows: rows,
  };
})();
