// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Kotiko's toolbar popup (slice 20). Adds words without waiting, shows and hides
// languages, pauses the current site, and shows the server's state as plain-language
// banners (slice 25). Every string comes from _locales through KotikoI18n.
//
// Talks to the background (`add`, `remove`, `sync`, `jobs.*`, `server.connect`) and reads
// storage.local (slice 11 adds wordsHome, lookup, server, keys and addJobs). The AI key is
// never typed here (DECISIONS). Hooks for later slices are marked with their number.
(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  const I18n = globalThis.KotikoI18n;
  const Icons = globalThis.KotikoIcons;
  const LookupStatus = globalThis.KotikoLookupStatus;
  const { t } = I18n;
  const $ = (id) => document.getElementById(id);

  const DEFAULTS = {
    // Kept here before slice 11; the background moves them into its store at once.
    serverUrl: null,
    token: "",
    // Slice 11: where words live, who looks them up, which secrets exist (no key material).
    wordsHome: null,
    lookup: null,
    server: null,
    keys: null,
    addJobs: [],
    enabled: true,
    pausedHosts: [],
    hiddenLangs: [],
    words: [],
    lastSync: null,
    syncError: null,
    // The server's lookup status (slice 10): {provider, quota, at}, kept by the background.
    lookupStatus: null,
    // Voices for the speak button (slice 34); the dashboard's voice settings (21) add the
    // rest. Online voices send the word to the browser's voice service, so they're off.
    speech: { allowOnline: false, rate: 0.9, voices: {} },
    // Slice 22: {completedAt, skipped, version} once the welcome tab's first run is done.
    onboarding: null,
  };
  const MAX_JOBS = 3;
  const DEFAULT_SERVER = "http://localhost:4747";
  // Providers that run without a key (spec/providers.json's keyRequired: false).
  const KEYLESS = new Set(["ollama", "lmstudio", "custom"]);
  const NO_WORD = new Set(["no_word_found", "rejected_same_as_gloss"]);
  const CHIP_ROWS = 3;
  const MAX_TEXT = 200;
  const STORE_HOSTS = /^(chromewebstore\.google\.com|chrome\.google\.com|addons\.mozilla\.org|microsoftedge\.microsoft\.com)$/;

  // ---------------------------------------------------------------------------------
  // Pure helpers (exported for tests as KotikoPopup).

  // Words grouped the way a learner counts them: one per language and native spelling
  // (slice 07's natural key; today's records have no base_lang yet).
  function wordGroups(words) {
    const byLang = new Map();
    for (const w of Array.isArray(words) ? words : []) {
      if (!w || typeof w.lang !== "string" || typeof w.native !== "string") continue;
      const key = w.native.normalize("NFC").toLocaleLowerCase();
      (byLang.get(w.lang) ?? byLang.set(w.lang, { set: new Set(), language: null }).get(w.lang)).set.add(key);
      byLang.get(w.lang).language ??= w.language ?? null;
    }
    return byLang;
  }

  function wordTotal(words) {
    let n = 0;
    for (const g of wordGroups(words).values()) n += g.set.size;
    return n;
  }

  // [{lang, count, name, endonym, hidden}], most words first, then by name in the
  // interface language's collation.
  function languages(words, hiddenLangs = []) {
    const hidden = new Set(hiddenLangs);
    const collator = new Intl.Collator(I18n.locale());
    return [...wordGroups(words)].map(([lang, g]) => {
      const name = I18n.languageName(lang) ?? g.language ?? lang;
      return { lang, count: g.set.size, name, endonym: I18n.endonym(lang) ?? name, hidden: hidden.has(lang) };
    }).sort((a, b) => b.count - a.count || collator.compare(a.name, b.name));
  }

  function hostOf(url) {
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol) || STORE_HOSTS.test(u.hostname)) return null;
      return u.hostname || null;
    } catch {
      return null;
    }
  }

  const legacyToken = (s) => !!String(s?.token ?? "").trim();
  const mode = (s) => s?.wordsHome ?? (legacyToken(s) ? "server" : "local");
  const hasToken = (s) => mode(s) === "server" && (s?.keys?.server === true || legacyToken(s));
  const lookupKind = (s) => s?.lookup?.kind ?? (legacyToken(s) ? "server" : "none");
  // Something can look new words up: the learner's provider (with its key) or the server.
  function lookupReady(s) {
    const kind = lookupKind(s);
    if (kind === "provider") return KEYLESS.has(s.lookup.provider) || s?.keys?.providers?.[s.lookup.provider] === true;
    if (kind === "server") return s?.keys?.server === true || legacyToken(s);
    return false;
  }
  // Adds are background jobs (slice 11 §5) unless a server looks up and keeps the words.
  const queueMode = (s) => !(mode(s) === "server" && lookupKind(s) === "server");
  // Technical detail for "Details" (25 §3): never translated, each fact once.
  const technical = (...parts) => [...new Set(parts.filter((p) => p !== null && p !== undefined && p !== "").map(String))].join("\n");

  // The banner for a sync problem (slice 25 §2, §3), or null. `n` is the word count.
  function syncProblem(err, n) {
    if (!err) return null;
    if (typeof err === "string") return { severity: "state", text: t("error_internal"), details: err, actions: ["retry"] };
    const d = err.details ?? {};
    const details = technical(err.message, d.hint, d.status ? `HTTP ${d.status}` : null, d.error);
    switch (err.code) {
      case "server_unreachable":
        return {
          severity: "state",
          text: n ? t("error_server_unreachable", { count: n }) : t("error_server_unreachable_empty"),
          details,
          actions: ["retry", "settings"],
        };
      case "server_key_rejected":
        if (d.reason === "no_token") return null;
        return { severity: "blocking", text: t("error_server_key_rejected"), details, actions: ["settings"] };
      case "server_address_invalid":
        return { severity: "blocking", text: t("error_server_address_invalid"), details, actions: ["settings"] };
      case "not_kotiko_server":
        return { severity: "blocking", text: t("error_not_kotiko_server"), details, actions: ["settings"] };
      default:
        return { severity: "state", text: t("error_internal"), details, actions: ["retry"] };
    }
  }

  const RETRYABLE = new Set(["rate_limited", "model_unavailable", "lookup_timeout", "bad_lookup_result"]);

  // The line for a failed add or undo, from the background's {error, code, details}.
  function addProblem(res, { connected = true, online = true, n = 0 } = {}) {
    const code = res?.code ?? res?.error?.code ?? "internal";
    const status = res?.details?.status ?? null;
    const details = technical(typeof res?.error === "string" ? res.error : res?.error?.message, status ? `HTTP ${status}` : null);
    const line = (key, actions = ["retry"], params) => ({ text: t(key, params), details, actions, code });
    if (!online && code === "server_unreachable") return line("error_add_offline");
    // A failed lookup (slice 10's codes, slice 25's words); waiting ones can be retried.
    // Lookups in this browser (the learner's own key, or none set up yet) get their own words.
    const local = lookupKind(state.s) !== "server";
    const lookup = LookupStatus.lookupProblem(code, res?.details, { locale: I18n.locale(), local });
    if (lookup) {
      const fix = local && (code === "key_rejected" || code === "lookup_not_set_up") ? ["setupLookups"] : [];
      return line(lookup.key, RETRYABLE.has(code) ? ["retry"] : fix, lookup.params);
    }
    switch (code) {
      case "server_key_rejected":
        return connected ? line("error_server_key_rejected", ["settings"]) : line("error_add_not_connected", ["settings"]);
      case "server_unreachable":
        return n ? line("error_server_unreachable", ["retry"], { count: n }) : line("error_server_unreachable_empty");
      case "server_address_invalid":
        return line("error_server_address_invalid", ["settings"]);
      case "invalid_message":
        return line("error_input_too_long", []);
      case "http_error":
        if (status === 401) return line("error_server_key_rejected", ["settings"]);
        if (status === 422) return line("error_save_failed");
        if (status >= 500) return line("error_lookup_failed");
        return line("error_internal");
      default:
        return line("error_internal");
    }
  }

  // ---------------------------------------------------------------------------------
  // State.

  const state = {
    s: null,
    host: null,
    supported: false,
    tabId: null,
    // What the tab's content script made of the page (16): { base, reason, lang, words }.
    pageStatus: null,
    online: navigator.onLine !== false,
    permission: true,
    jobs: [],
    expanded: false,
    roving: null,
    checking: false,
    dirty: new Set(),
    // Queue jobs shown since opening, ones not yet in storage, Undo states, done at open.
    shownJobs: new Set(),
    optimistic: new Map(),
    undos: new Map(),
    doneAtOpen: new Set(),
    rendered: new Set(),
    maskedToken: null,
  };
  let jobSeq = 0;

  // Writes go through one queue, each reading the current value inside it, so rapid clicks
  // never lose an update (research 06 F37). While a key has writes in flight, the popup
  // keeps its optimistic value instead of echoing intermediate storage events.
  let queue = Promise.resolve();
  const inFlight = new Map();
  function write(keys, fn) {
    for (const k of keys) inFlight.set(k, (inFlight.get(k) ?? 0) + 1);
    const p = queue.then(fn);
    queue = p.catch(() => {});
    p.catch(() => {}).finally(async () => {
      const settled = keys.filter((k) => {
        const left = inFlight.get(k) - 1;
        if (left > 0) inFlight.set(k, left);
        else inFlight.delete(k);
        return left <= 0;
      });
      if (!settled.length) return;
      const fresh = await ext.storage.local.get(Object.fromEntries(settled.map((k) => [k, DEFAULTS[k]])));
      Object.assign(state.s, fresh);
      renderFor(settled);
    });
    return p;
  }

  // Sends at once; a failure to reach the background becomes an ordinary error answer.
  function send(msg) {
    const failed = (e) => ({ error: String(e?.message ?? e), code: "internal" });
    try {
      return Promise.resolve(ext.runtime.sendMessage(msg)).catch(failed);
    } catch (e) {
      return Promise.resolve(failed(e));
    }
  }

  // ---------------------------------------------------------------------------------
  // DOM helpers.

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (k in node && typeof v !== "string") node[k] = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
    return node;
  }

  const icon = (name, size) => Icons.icon(name, size);

  function actionButton(action, onRetry) {
    switch (action) {
      case "retry":
        return el("button", { class: "btn btn-secondary btn-sm", type: "button", onclick: onRetry, "data-action": "retry" }, t("error_try_again_action"));
      case "settings":
        return el("button", { class: "link", type: "button", onclick: () => openSettings(), "data-action": "settings" }, t("error_connection_settings_action"));
      case "turnOn":
        return el("button", { class: "btn btn-secondary btn-sm", type: "button", onclick: () => setEnabled(true), "data-action": "turn-on" }, t("popup_turn_on"));
      case "allow":
        return el("button", { class: "btn btn-secondary btn-sm", type: "button", onclick: requestPermission, "data-action": "allow" }, t("error_permission_missing_action"));
      case "setupLookups":
        return el("button", { class: "btn btn-secondary btn-sm", type: "button", onclick: openLookupSettings, "data-action": "setup-lookups" }, t("popup_set_up_lookups"));
      default:
        return null;
    }
  }

  // The same actions as quiet links, for a line under the add box.
  function actionLink(action, onRetry, onCancel) {
    const key = { retry: "error_try_again_action", settings: "error_connection_settings_action", setupLookups: "popup_set_up_lookups", cancel: "add_cancel" }[action];
    if (!key) return null;
    const run = { retry: onRetry, settings: () => openSettings(), setupLookups: openLookupSettings, cancel: onCancel }[action];
    return el("button", {
      class: "link link-quiet",
      type: "button",
      "data-action": action === "setupLookups" ? "setup-lookups" : action,
      onclick: run,
    }, t(key));
  }

  const SEVERITY_ICON = { state: "warning", info: "info", blocking: "error" };

  function banner({ severity, text, details, actions = [], art = null, id = null }, onRetry) {
    const lead = art
      ? el("span", {},
        el("img", { class: "banner-art art-light", src: art.light, alt: "" }),
        el("img", { class: "banner-art art-dark", src: art.dark, alt: "" }))
      : icon(SEVERITY_ICON[severity] ?? "info");
    const buttons = actions.map((a) => actionButton(a, onRetry)).filter(Boolean);
    return el("div", { class: `banner banner-${severity}`, id, "data-severity": severity },
      lead,
      el("p", { class: "banner-body" }, text),
      buttons.length ? el("div", { class: "banner-actions" }, buttons) : null,
      details ? el("details", { class: "details" }, el("summary", {}, t("error_details")), el("pre", {}, details)) : null,
    );
  }

  // ---------------------------------------------------------------------------------
  // Rendering. Each section renders from `state`; storage changes re-render only the
  // sections whose keys changed (20 §6).

  // "38 free lookups left today" under the add box, at 20 or fewer (20 §2, 10 §3).
  function renderQuota() {
    const node = $("lookupsLeft");
    const line = lookupReady(state.s) ? LookupStatus.quotaLine(state.s?.lookupStatus, { locale: I18n.locale() }) : null;
    node.hidden = !line;
    node.textContent = line ? t(line.key, line.params) : "";
  }

  function renderHeader() {
    const on = state.s ? state.s.enabled !== false : true;
    const sw = $("enabled");
    sw.setAttribute("aria-checked", String(on));
    $("enabledText").textContent = on ? t("popup_switch_on") : t("popup_switch_off");
    $("main").dataset.off = String(!on);
    $("offline").hidden = state.online;
  }

  function currentBanner() {
    const s = state.s;
    if (!s) return null;
    const n = wordTotal(s.words);
    if (!state.permission) {
      return { severity: "blocking", text: t("error_permission_missing"), actions: ["allow"], id: "bannerPermission" };
    }
    if (s.enabled === false) {
      return {
        severity: "info",
        text: t("popup_off_banner"),
        actions: ["turnOn"],
        art: { light: "ui/art/kitten-sleepy.png", dark: "ui/art/kitten-sleepy-on-purple.png" },
        id: "bannerOff",
      };
    }
    // Words in this browser: only "no AI set up yet" (11 §9); the first-run card without words.
    if (mode(s) === "local") {
      return n && !lookupReady(s) ? { severity: "info", text: t("popup_lookups_off"), actions: ["setupLookups"], id: "bannerLookups" } : null;
    }
    if (!hasToken(s)) {
      return n ? { severity: "info", text: t("popup_not_connected", { count: n }), actions: ["settings"], id: "bannerSync" } : null;
    }
    if (!state.online && s.syncError?.code === "server_unreachable") return null;
    const problem = syncProblem(s.syncError, n);
    return problem ? { ...problem, id: "bannerSync" } : null;
  }

  function renderBanners() {
    const b = currentBanner();
    const host = $("banners");
    // Keep an open "Details" open across re-renders of the same banner.
    const open = host.querySelector("details")?.open;
    host.replaceChildren();
    if (!b) return;
    const node = banner(b, () => syncNow());
    const det = node.querySelector("details");
    if (det && open) det.open = true;
    host.append(node);
  }

  function renderSections() {
    const s = state.s;
    const local = !!s && mode(s) === "local";
    const firstRun = !!s && (local || !hasToken(s)) && wordTotal(s.words) === 0;
    $("firstRun").hidden = !firstRun;
    if (firstRun && !onboarded(s)) {
      // Not onboarded yet (20 §2 A): Get started opens or focuses the welcome tab (22).
      $("firstRunTitle").textContent = t("popup_first_run_title");
      $("firstRunBody").textContent = t("popup_first_run_body_welcome");
      $("getStarted").textContent = t("popup_get_started");
      $("getStarted").hidden = false;
    } else if (firstRun) {
      $("firstRunTitle").textContent = local ? t("popup_first_run_title_local") : t("popup_first_run_title");
      $("firstRunBody").textContent = local ? t("popup_first_run_body_local") : t("popup_first_run_body");
      $("getStarted").textContent = local ? t("popup_set_up_lookups") : t("popup_get_started");
      $("getStarted").hidden = local && lookupReady(s);
    }
    $("langSection").hidden = firstRun || !s;
    $("pageSection").hidden = firstRun || !s;
    $("count").textContent = s && !firstRun && wordTotal(s.words) ? t("popup_word_count", { count: wordTotal(s.words) }) : "";
  }

  function renderLangs() {
    const s = state.s;
    const chips = $("chips");
    if (!s) return;
    $("main").removeAttribute("aria-busy");
    const langs = languages(s.words, s.hiddenLangs);
    $("emptyWords").hidden = langs.length > 0;
    chips.hidden = langs.length === 0;

    const shown = langs.filter((l) => !l.hidden);
    const only = langs.length > 1 && shown.length === 1 ? shown[0] : null;
    const strip = $("onlyStrip");
    strip.hidden = !only;
    if (only) {
      strip.replaceChildren(
        t("popup_only_strip", { endonym: only.endonym }),
        " · ",
        el("button", { class: "link", type: "button", onclick: showAll, "data-action": "show-all" }, t("popup_show_all")),
      );
    }
    $("showAll").hidden = !!only || !langs.some((l) => l.hidden);

    if (!langs.some((l) => l.lang === state.roving)) state.roving = langs[0]?.lang ?? null;
    const hadFocus = chips.contains(document.activeElement) ? document.activeElement.dataset.lang : null;
    chips.replaceChildren(...langs.map((l) => chip(l, only?.lang === l.lang)));
    collapseChips(chips, langs.length);
    if (hadFocus) [...chips.querySelectorAll(".chip")].find((c) => c.dataset.lang === hadFocus)?.focus();

    // Forget hidden languages that no longer have words, so a language removed and later
    // started again doesn't come back hidden. Only trust the list after a good sync.
    const stale = s.hiddenLangs.filter((x) => !langs.some((l) => l.lang === x));
    if (stale.length && s.lastSync && !s.syncError && !inFlight.has("hiddenLangs")) {
      write(["hiddenLangs"], async () => {
        const { hiddenLangs } = await ext.storage.local.get({ hiddenLangs: [] });
        await ext.storage.local.set({ hiddenLangs: hiddenLangs.filter((x) => !stale.includes(x)) });
      });
    }
  }

  // With many languages, chips wrap to at most CHIP_ROWS lines and "+n more" opens the
  // rest in place (20 §1). Measured from the layout, so it adapts to long endonyms and to
  // the interface language.
  function collapseChips(chips, total) {
    const moreButton = (hidden) => el("button", {
      class: "btn btn-quiet btn-sm chip-more",
      type: "button",
      id: "moreLangs",
      "aria-expanded": String(state.expanded),
      onclick: () => {
        state.expanded = !state.expanded;
        renderLangs();
        $("moreLangs")?.focus();
      },
    }, state.expanded ? t("popup_fewer_languages") : t("popup_more_languages", { count: hidden }));

    const groups = () => [...chips.querySelectorAll(".chip-group")];
    const rows = [...new Set(groups().map((g) => g.offsetTop))].sort((a, b) => a - b);
    if (rows.length <= CHIP_ROWS) return;
    if (state.expanded) return void chips.append(moreButton(0));
    const lastRow = rows[CHIP_ROWS - 1];
    for (const g of groups()) if (g.offsetTop > lastRow) g.remove();
    let more = moreButton(total - groups().length);
    chips.append(more);
    while (more.offsetTop > lastRow && groups().length > 1) {
      groups().at(-1).remove();
      const next = moreButton(total - groups().length);
      more.replaceWith(next);
      more = next;
    }
    // Keep one chip in the tab order.
    if (!chips.querySelector('.chip[tabindex="0"]')) {
      const first = chips.querySelector(".chip");
      if (first) {
        first.tabIndex = 0;
        state.roving = first.dataset.lang;
      }
    }
  }

  function chip(l, isOnly) {
    const nameKey = l.hidden ? "popup_chip_name_hidden" : "popup_chip_name_shown";
    const label = t(nameKey, { lang: l.name, endonym: l.endonym, count: l.count });
    const main = el("button", {
      class: "chip",
      type: "button",
      "data-lang": l.lang,
      "aria-pressed": String(!l.hidden),
      "aria-label": label,
      title: l.name,
      tabindex: l.lang === state.roving ? "0" : "-1",
      "data-only": isOnly ? "true" : null,
      onclick: () => toggleLang(l.lang),
      onfocus: () => void (state.roving = l.lang),
    },
    icon(l.hidden ? "circle" : "check", 14),
    el("span", { class: "chip-label", lang: l.lang, dir: "auto" }, l.endonym),
    el("span", { class: "chip-count num", "aria-hidden": "true" }, I18n.formatNumber(l.count)));
    // On: a check; off: a hollow circle (06 §10), so state never relies on color.
    main.querySelector(".icon").classList.add("chip-glyph");
    const aux = el("button", {
      class: "chip-aux",
      type: "button",
      tabindex: "-1",
      "data-only-lang": l.lang,
      "aria-label": t("popup_only_button", { lang: l.name }),
      title: t("popup_only_button", { lang: l.name }),
      onclick: () => onlyLang(l.lang),
    }, icon("target", 14));
    return el("span", { class: "chip-group" }, main, aux);
  }

  function renderPage() {
    const s = state.s;
    if (!s) return;
    const title = $("pageTitle");
    const supported = state.supported && state.host;
    title.hidden = !supported;
    title.textContent = supported ? t("popup_this_page", { host: state.host }) : "";
    $("unsupported").hidden = !!supported;
    const paused = supported && s.pausedHosts.includes(state.host);
    $("pauseRow").hidden = !supported || paused;
    $("pauseRow").setAttribute("aria-checked", "false");
    $("pausedRow").hidden = !paused;
    if (paused) {
      $("pausedText").replaceChildren(icon("pause", 16), el("span", {}, t("popup_paused_on", { host: state.host })));
    }
    renderPageLanguage(supported && !paused && s.enabled !== false ? state.pageStatus : null);
  }

  // Slice 20 states H and H2, from what the page's content script made of it (16): a page
  // in a language the learner doesn't read, or in one of theirs with no word for it yet.
  function renderPageLanguage(st) {
    if (st?.stoodDown) {
      $("pageLang").hidden = false;
      $("pageLangText").replaceChildren(t("popup_stood_down"));
      return;
    }
    const other = !!(st && !st.base && st.lang && st.reason !== "unknown");
    const empty = !!(st && st.base && st.words === 0 && wordTotal(state.s.words) > 0);
    $("pageLang").hidden = !other && !empty;
    if (other) {
      const name = I18n.languageName(st.lang) ?? st.lang;
      const readToo = el("button", { class: "link", id: "readToo", type: "button", onclick: () => openDashboardAt("#settings/languages") }, t("popup_read_too", { lang: name }));
      $("pageLangText").replaceChildren(`${t("popup_page_not_yours", { lang: name })} `, readToo);
    } else if (empty) {
      $("pageLangText").replaceChildren(t("popup_no_meanings_base", { base: I18n.languageName(st.base) ?? st.base }));
    } else {
      $("pageLangText").replaceChildren();
    }
  }

  // Asks the tab's content script which language it found the page in. No answer (a page
  // loaded before Kotiko, or one it can't run on) shows nothing.
  async function askPage() {
    if (!state.supported || state.tabId == null) return;
    try {
      state.pageStatus = (await ext.tabs.sendMessage(state.tabId, { type: "page-status" })) ?? null;
    } catch {
      state.pageStatus = null;
    }
    renderPage();
  }

  // --- Recent adds -------------------------------------------------------------------
  // Queue jobs (`addJobs`, the background's) finish with the popup closed; direct jobs live
  // in `state.jobs`. A storage job as the lines read it:
  function viewJob(j) {
    const e = j.error ?? {};
    const v = { id: j.id, queue: true, text: j.text, status: { waiting: "waiting", failed: "failed", done: "done" }[j.state] ?? "looking", words: [], known: [], code: e.code, details: e.details ?? {} };
    if (v.status === "failed") {
      v.error = NO_WORD.has(e.code) ? { text: t("error_no_word_found", { text: j.text }), details: e.details?.reply ?? "", actions: [] } : addProblem({ code: e.code, details: v.details }, { online: state.online, n: wordTotal(state.s.words) });
    }
    for (const r of v.status === "done" ? j.results ?? [] : []) {
      if (!r?.word) continue;
      const k = `${j.id}:${r.wordId}`;
      if (r.result !== "created") {
        if (!v.known.includes(r.word.native)) v.known.push(r.word.native);
        continue;
      }
      const u = state.undos.get(k);
      v.words.push({ word: r.word, undo: r.undo ?? u?.state ?? null, undoError: u?.error, fresh: !state.doneAtOpen.has(j.id) && !state.rendered.has(k) });
      state.rendered.add(k);
    }
    return v;
  }

  // The three most recent jobs that are running or waiting, finished unseen, or shown
  // since the popup opened.
  function currentJobs() {
    if (!state.s || !queueMode(state.s)) return state.jobs;
    const stored = (state.s.addJobs ?? []).filter((j) => j?.id && j.state !== "cancelled");
    const list = [...[...state.optimistic.values()].filter((o) => !stored.some((j) => j.id === o.id)), ...stored]
      .filter((j) => !/done|failed/.test(j.state) || !j.seen || state.shownJobs.has(j.id))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_JOBS);
    for (const j of list) state.shownJobs.add(j.id);
    return list.map((j) => j.view ?? viewJob(j));
  }

  function jobLines(job) {
    if (job.status === "looking") {
      return [{ key: `${job.id}`, kind: "looking", job }];
    }
    if (job.status === "waiting") return [{ key: `${job.id}`, kind: "waiting", job }];
    if (job.status === "failed") return [{ key: `${job.id}`, kind: "failed", job }];
    const lines = job.words.map((entry, i) => ({ key: `${job.id}:${i}`, kind: "word", job, entry }));
    if (job.known?.length) lines.push({ key: `${job.id}:known`, kind: "known", job });
    return lines;
  }

  function wordNode(w, fresh) {
    return el("bdi", { class: `word dots${fresh ? " swap-in motion" : ""}`, lang: w.lang }, w.native);
  }

  function createdText(w, fresh) {
    const lang = I18n.languageName(w.lang) ?? w.language ?? w.lang;
    const pron = w.pronunciation || w.romanization;
    const params = {
      native: wordNode(w, fresh),
      gloss: el("bdi", { class: "job-gloss" }, w.gloss ?? w.english ?? ""),
      lang,
    };
    if (pron) params.pronunciation = el("span", { class: "job-pron", lang: `${w.lang}-Latn` }, pron);
    return I18n.parts(pron ? "add_created" : "add_created_plain", params);
  }

  // Why a job waits (slice 24 §2), and what can be done about it.
  function waitingLine(job) {
    const { code, text } = job;
    const at = Date.parse(job.details.retry_at ?? "");
    if (code === "lookup_not_set_up") return { text: t("add_waiting_setup", { text }), actions: ["setupLookups", "cancel"] };
    if (code === "quota_exhausted" && at) return { text: t("add_waiting_quota", { text, time: new Intl.DateTimeFormat(I18n.locale(), { timeStyle: "short" }).format(at) }), actions: ["cancel"] };
    if (RETRYABLE.has(code)) return { text: t("add_waiting_busy", { text }), actions: ["retry", "cancel"] };
    return { text: t("add_waiting", { text, reason: addProblem(job, { online: state.online }).text }), actions: ["retry", "cancel"] };
  }

  function lineContent(line) {
    const { job, entry } = line;
    if (line.kind === "looking") {
      return [el("span", { class: "job-text job-looking" }, t("add_looking_up", { text: job.text }))];
    }
    if (line.kind === "waiting") {
      const w = waitingLine(job);
      const actions = w.actions.map((a) => actionLink(a, () => retryJob(job), () => cancelJob(job))).filter(Boolean);
      return [
        icon("info", 18),
        el("div", { class: "job-text" }, el("p", {}, w.text), el("div", { class: "job-more" }, actions)),
      ];
    }
    if (line.kind === "known") {
      const words = job.known.map((n, i) => [i ? ", " : "", el("bdi", { class: "word" }, n)]).flat().filter((x) => x !== "");
      return [el("span", { class: "job-text" }, I18n.parts("add_already_known", { words: el("span", {}, words) }))];
    }
    if (line.kind === "failed") {
      const e = job.error;
      const actions = e.actions.map((a) => actionLink(a, () => retryJob(job))).filter(Boolean);
      const details = e.details ? el("details", { class: "details" }, el("summary", {}, t("error_details")), el("pre", {}, e.details)) : null;
      return [
        icon("error", 18),
        el("div", { class: "job-text" }, el("p", {}, e.text), actions.length || details ? el("div", { class: "job-more" }, actions, details) : null),
        el("button", { class: "btn btn-icon", type: "button", "data-action": "dismiss", "aria-label": t("add_dismiss"), title: t("add_dismiss"), onclick: () => dismissJob(job) }, icon("close", 16)),
      ];
    }
    const w = entry.word;
    if (entry.undo === "done") {
      return [el("span", { class: "job-text" }, I18n.parts("undo_done_created", { native: el("bdi", { lang: w.lang }, w.native) }))];
    }
    if (entry.undo === "failed") {
      return [
        icon("error", 18),
        el("div", { class: "job-text" }, el("p", {}, t("undo_failed", { message: entry.undoError.text })),
          el("div", { class: "job-more" }, actionLink("retry", () => undo(job, entry)))),
      ];
    }
    const fresh = entry.fresh;
    entry.fresh = false;
    return [
      el("span", { class: "job-text" }, createdText(w, fresh)),
      el("span", { class: "job-actions" },
        el("button", {
          class: "btn btn-quiet btn-sm",
          type: "button",
          "data-action": "undo",
          "aria-label": t("add_undo_label", { native: w.native }),
          "aria-disabled": entry.undo === "pending" ? "true" : null,
          onclick: () => entry.undo !== "pending" && undo(job, entry),
        }, icon("undo", 16), t("add_undo"))),
    ];
  }

  function signature(line) {
    if (line.kind === "word") return `word:${line.entry.undo ?? ""}`;
    if (line.kind === "waiting") return `waiting:${line.job.code ?? ""}`;
    if (line.kind === "failed") return `failed:${line.job.error?.text ?? ""}`;
    return line.kind;
  }

  function renderJobs() {
    const list = $("jobs");
    const existing = new Map([...list.children].map((li) => [li.dataset.key, li]));
    const lines = currentJobs().flatMap(jobLines);
    const next = lines.map((line) => {
      const old = existing.get(line.key);
      if (old && old.dataset.sig === signature(line)) return old;
      const focused = old?.contains(document.activeElement);
      const li = el("li", {
        class: `job${line.kind === "failed" || line.entry?.undo === "failed" ? " job-failed" : ""}${line.kind === "word" && line.entry.fresh ? " row-new" : ""}`,
        "data-key": line.key,
        "data-kind": line.kind,
      }, lineContent(line));
      li.dataset.sig = signature(line);
      if (focused) queueMicrotask(() => li.querySelector("button")?.focus() ?? $("addText").focus());
      return li;
    });
    list.replaceChildren(...next);
  }

  function trimJobs() {
    state.jobs = state.jobs.slice(0, MAX_JOBS);
  }

  async function runJob(job) {
    job.status = "looking";
    renderJobs();
    const res = await send({ type: "add", text: job.text });
    if (res?.error) {
      job.status = "failed";
      job.error = addProblem(res, { connected: hasToken(state.s), online: state.online, n: wordTotal(state.s?.words) });
    } else if (res?.words?.length || res?.known?.length) {
      job.status = "done";
      job.words = (Array.isArray(res.words) ? res.words : []).map((word) => ({ word, undo: null, fresh: true }));
      // Words the learner already had: named, never offered an Undo that could delete them.
      job.known = Array.isArray(res.known) ? res.known.filter((n) => typeof n === "string" && n) : [];
    } else {
      job.status = "failed";
      job.error = { text: t("error_no_word_found", { text: job.text }), details: res?.reply ?? "", actions: [] };
    }
    renderJobs();
  }

  // A queue job, persisted by the background before anything else: the popup can close.
  async function queueJob(text) {
    const id = globalThis.crypto.randomUUID();
    const job = { id, text, state: "queued", createdAt: Date.now() };
    state.optimistic.set(id, job);
    renderJobs();
    const res = await send({ type: "add", id, text });
    // Refused (too long): a line of its own, dismissed locally.
    if (res?.error) job.view = { id, queue: true, local: true, text, status: "failed", words: [], error: addProblem(res) };
    renderJobs();
  }

  function submit(e) {
    e.preventDefault();
    const input = $("addText");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    input.focus();
    if (state.s && queueMode(state.s)) return void queueJob(text);
    if ([...text].length > MAX_TEXT) {
      state.jobs.unshift({ id: ++jobSeq, text, status: "failed", words: [], error: { text: t("error_input_too_long"), details: "", actions: [] } });
      trimJobs();
      renderJobs();
      return;
    }
    const job = { id: ++jobSeq, text, status: "looking", words: [] };
    state.jobs.unshift(job);
    trimJobs();
    runJob(job);
  }

  function retryJob(job) {
    if (job.queue) send({ type: "jobs.retry", id: job.id });
    else runJob(job);
    $("addText").focus();
  }

  function cancelJob(job) {
    if (job.queue) send({ type: "jobs.cancel", id: job.id });
    $("addText").focus();
  }

  function dismissJob(job) {
    if (job.queue) {
      state.optimistic.delete(job.id);
      if (!job.local) send({ type: "jobs.dismiss", id: job.id });
      state.s.addJobs = (state.s.addJobs ?? []).filter((j) => j.id !== job.id);
    } else {
      state.jobs = state.jobs.filter((j) => j !== job);
    }
    renderJobs();
    $("addText").focus();
  }

  async function undo(job, entry) {
    const key = `${job.id}:${entry.word.id}`;
    entry.undo = "pending";
    if (job.queue) state.undos.set(key, { state: "pending" });
    renderJobs();
    const res = await send(job.queue ? { type: "remove", id: entry.word.id, jobId: job.id } : { type: "remove", id: entry.word.id });
    if (res?.error) {
      entry.undo = "failed";
      entry.undoError = addProblem(res, { connected: hasToken(state.s), online: state.online, n: wordTotal(state.s?.words) });
      if (job.queue) state.undos.set(key, { state: "failed", error: entry.undoError });
    } else {
      entry.undo = "done";
      if (job.queue) state.undos.set(key, { state: "done" });
    }
    renderJobs();
  }

  // --- Actions on storage --------------------------------------------------------------

  function toggleLang(lang) {
    const hidden = new Set(state.s.hiddenLangs);
    if (hidden.has(lang)) hidden.delete(lang);
    else hidden.add(lang);
    state.s.hiddenLangs = [...hidden];
    renderLangs();
    return write(["hiddenLangs"], async () => {
      const { hiddenLangs } = await ext.storage.local.get({ hiddenLangs: [] });
      const set = new Set(hiddenLangs);
      if (set.has(lang)) set.delete(lang);
      else set.add(lang);
      await ext.storage.local.set({ hiddenLangs: [...set] });
    });
  }

  // "Show only": hide every other language; again on the only one shows all (the Stop of
  // slice 18's Focus, which replaces this when it ships).
  function onlyLang(lang) {
    const all = languages(state.s.words).map((l) => l.lang);
    const shown = all.filter((l) => !state.s.hiddenLangs.includes(l));
    if (shown.length === 1 && shown[0] === lang && all.length > 1) return showAll();
    state.s.hiddenLangs = all.filter((l) => l !== lang);
    state.roving = lang;
    renderLangs();
    return write(["hiddenLangs"], async () => {
      const { words } = await ext.storage.local.get({ words: [] });
      const others = [...wordGroups(words).keys()].filter((l) => l !== lang);
      await ext.storage.local.set({ hiddenLangs: others });
    });
  }

  function showAll() {
    state.s.hiddenLangs = [];
    renderLangs();
    $("chips").querySelector('.chip[tabindex="0"]')?.focus();
    return write(["hiddenLangs"], () => ext.storage.local.set({ hiddenLangs: [] }));
  }

  function setEnabled(on) {
    state.s.enabled = on;
    renderHeader();
    renderBanners();
    return write(["enabled"], () => ext.storage.local.set({ enabled: on }));
  }

  function setPaused(paused) {
    const host = state.host;
    if (!host) return;
    const set = new Set(state.s.pausedHosts);
    if (paused) set.add(host);
    else set.delete(host);
    state.s.pausedHosts = [...set];
    renderPage();
    (paused ? $("resume") : $("pauseRow")).focus();
    return write(["pausedHosts"], async () => {
      const { pausedHosts } = await ext.storage.local.get({ pausedHosts: [] });
      const next = new Set(pausedHosts);
      if (paused) next.add(host);
      else next.delete(host);
      await ext.storage.local.set({ pausedHosts: [...next] });
    });
  }

  async function syncNow() {
    state.checking = true;
    renderSettingsStatus();
    await send({ type: "sync", force: true });
    state.checking = false;
    const fresh = await ext.storage.local.get({ lastSync: null, syncError: null, words: [] });
    Object.assign(state.s, fresh);
    renderFor(["lastSync", "syncError", "words"]);
    // A new or checked connection: the free lookups left on that server (slice 10).
    if (lookupReady(state.s)) send({ type: "llmStatus" });
  }

  async function checkPermission() {
    try {
      if (ext.permissions?.contains) state.permission = await ext.permissions.contains({ origins: ["<all_urls>"] });
    } catch {
      state.permission = true;
    }
  }

  async function requestPermission() {
    try {
      await ext.permissions.request({ origins: ["<all_urls>"] });
    } catch {
      // the browser said no; the banner stays
    }
    await checkPermission();
    renderBanners();
  }

  // --- Settings (Connection, until slice 21's dashboard) ----------------------------------

  function openSettings() {
    $("main").hidden = true;
    $("settings").hidden = false;
    // The saved token is never read back; its masked form tells the learner one is saved.
    send({ type: "secrets.describe" }).then((res) => {
      state.maskedToken = res?.secrets?.server ?? null;
      renderSettingsFields();
    });
    renderSettingsFields();
    renderSettingsStatus();
    renderVoices();
    $("serverUrl").focus();
  }

  function closeSettings() {
    $("settings").hidden = true;
    $("main").hidden = false;
    renderLangs();
    $("openSettings").focus();
  }

  function renderVoices() {
    $("onlineVoices").setAttribute("aria-checked", String(state.s?.speech?.allowOnline === true));
  }

  function setOnlineVoices(on) {
    state.s.speech = { ...DEFAULTS.speech, ...state.s.speech, allowOnline: on };
    renderVoices();
    return write(["speech"], async () => {
      const { speech } = await ext.storage.local.get({ speech: DEFAULTS.speech });
      await ext.storage.local.set({ speech: { ...DEFAULTS.speech, ...speech, allowOnline: on } });
    });
  }

  function renderSettingsFields() {
    if (!state.s) return;
    const input = $("serverUrl");
    // Never overwrite a field being edited (research 06 F16).
    if (document.activeElement !== input && !state.dirty.has("serverUrl")) input.value = state.s.server?.url ?? state.s.serverUrl ?? "";
    const key = $("accessKey");
    key.placeholder = state.maskedToken ? t("settings_key_saved", { masked: state.maskedToken }) : "";
  }

  function relativeTime(ts) {
    const s = Math.round((ts - Date.now()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(I18n.locale(), { numeric: "auto" });
    if (Math.abs(s) < 60) return rtf.format(s, "second");
    if (Math.abs(s) < 3600) return rtf.format(Math.round(s / 60), "minute");
    if (Math.abs(s) < 86400) return rtf.format(Math.round(s / 3600), "hour");
    return rtf.format(Math.round(s / 86400), "day");
  }

  function renderSettingsStatus() {
    const box = $("connStatus");
    const s = state.s;
    if (!s) return box.replaceChildren();
    if (state.checking) return box.replaceChildren(el("p", { class: "conn-checking" }, t("settings_checking")));

    if (!hasToken(s)) return box.replaceChildren(el("p", { class: "conn-checking" }, t("settings_not_connected")));
    const problem = syncProblem(s.syncError, wordTotal(s.words));
    if (problem) {
      return box.replaceChildren(banner({ ...problem, actions: problem.actions.filter((a) => a !== "settings") }, () => syncNow()));
    }
    if (!s.lastSync) return box.replaceChildren(el("p", { class: "conn-checking" }, t("settings_not_connected")));
    box.replaceChildren(el("p", { class: "conn-ok" }, icon("success", 18),
      el("span", {}, t("settings_connected", { count: wordTotal(s.words) }),
        el("small", {}, t("settings_last_checked", { time: relativeTime(s.lastSync) })))));
  }

  // The address and token go to the background, which keeps the token where pages can't
  // read it (slice 11 §3) and checks the connection with them.
  async function saveConnection(e) {
    e.preventDefault();
    const url = $("serverUrl").value.trim() || DEFAULT_SERVER;
    const token = $("accessKey").value.trim();
    state.dirty.clear();
    state.checking = true;
    renderSettingsStatus();
    const msg = { type: "server.connect", url };
    if (token) msg.token = token;
    const res = await send(msg);
    if (token) $("accessKey").value = "";
    state.checking = false;
    // Words kept in this browser move to a server in the dashboard, after seeing the count.
    if (res?.needsSwitch) return openDashboardAt("#settings/connection");
    const fresh = await ext.storage.local.get(Object.fromEntries(["lastSync", "syncError", "words", "wordsHome", "lookup", "server", "keys"].map((k) => [k, DEFAULTS[k]])));
    Object.assign(state.s, fresh);
    const described = await send({ type: "secrets.describe" });
    state.maskedToken = described?.secrets?.server ?? state.maskedToken;
    renderFor(["lastSync", "syncError", "words", "wordsHome", "server", "keys"]);
    if (hasToken(state.s)) send({ type: "llmStatus" });
  }

  // The dashboard's settings at a section: the AI key is typed there, never here.
  async function openDashboardAt(hash) {
    await Promise.resolve(ext.tabs.create({ url: ext.runtime.getURL(`dashboard.html${hash}`) })).catch(() => {});
    window.close();
  }
  const openLookupSettings = () => openDashboardAt("#settings/lookups");

  // Slice 22: the first run is done once a word is saved or the welcome tab is skipped.
  const onboarded = (s) => !!s?.onboarding?.completedAt;
  async function openWelcome() {
    await send({ type: "welcome.open" });
    window.close();
  }
  function getStarted() {
    if (state.s && !onboarded(state.s)) return openWelcome();
    return state.s && mode(state.s) === "local" ? openLookupSettings() : openSettings();
  }

  // The dashboard (slice 21) is the extension's options page, so the browser focuses an
  // open one instead of opening a second.
  async function openDashboard() {
    try {
      await ext.runtime.openOptionsPage();
    } catch {
      await Promise.resolve(ext.tabs.create({ url: ext.runtime.getURL("dashboard.html") })).catch(() => {});
    }
    window.close();
  }

  // ---------------------------------------------------------------------------------
  // Wiring.

  const RENDER_BY_KEY = {
    words: [renderLangs, renderSections, renderBanners, renderSettingsStatus],
    hiddenLangs: [renderLangs],
    lastSync: [renderLangs, renderSettingsStatus],
    syncError: [renderBanners, renderSettingsStatus],
    enabled: [renderHeader, renderBanners],
    pausedHosts: [renderPage],
    token: [renderSections, renderBanners, renderSettingsFields, renderSettingsStatus, renderQuota],
    serverUrl: [renderSettingsFields],
    wordsHome: [renderSections, renderBanners, renderSettingsStatus, renderQuota, renderJobs],
    lookup: [renderSections, renderBanners, renderQuota, renderJobs],
    keys: [renderSections, renderBanners, renderSettingsStatus, renderQuota],
    server: [renderSettingsFields],
    addJobs: [renderJobs],
    speech: [renderVoices],
    lookupStatus: [renderQuota],
    onboarding: [renderSections],
  };

  function renderFor(keys) {
    const fns = new Set(keys.flatMap((k) => RENDER_BY_KEY[k] ?? []));
    for (const fn of fns) fn();
  }

  function renderAll() {
    renderHeader();
    renderBanners();
    renderSections();
    renderLangs();
    renderPage();
    renderJobs();
    renderQuota();
  }

  function onChipKeys(e) {
    const chips = [...$("chips").querySelectorAll(".chip")];
    const i = chips.indexOf(document.activeElement);
    if (i < 0) return;
    const rtl = getComputedStyle($("chips")).direction === "rtl";
    let next = null;
    if (e.key === "ArrowRight") next = chips[(i + (rtl ? -1 : 1) + chips.length) % chips.length];
    else if (e.key === "ArrowLeft") next = chips[(i + (rtl ? 1 : -1) + chips.length) % chips.length];
    else if (e.key === "Home") next = chips[0];
    else if (e.key === "End") next = chips.at(-1);
    else if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      onlyLang(chips[i].dataset.lang);
      return;
    }
    if (!next) return;
    e.preventDefault();
    for (const c of chips) c.tabIndex = c === next ? 0 : -1;
    state.roving = next.dataset.lang;
    next.focus();
  }

  function onGlobalKeys(e) {
    const target = e.target;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
    if (e.key === "/" && !typing && !$("main").hidden) {
      e.preventDefault();
      $("addText").focus();
    }
    if (e.key === "ArrowDown" && target === $("addText")) {
      const first = $("jobs").querySelector("button");
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
    if (e.key === "Escape" && !$("settings").hidden) {
      e.preventDefault();
      closeSettings();
    }
  }

  async function init() {
    I18n.apply(document);
    Icons.hydrate(document);
    $("addText").focus();

    $("addForm").addEventListener("submit", submit);
    $("enabled").addEventListener("click", () => setEnabled(!(state.s?.enabled !== false)));
    $("pauseRow").addEventListener("click", () => setPaused(true));
    $("resume").addEventListener("click", () => setPaused(false));
    $("showAll").addEventListener("click", showAll);
    $("chips").addEventListener("keydown", onChipKeys);
    $("openSettings").addEventListener("click", openSettings);
    $("openDashboard").addEventListener("click", openDashboard);
    $("getStarted").addEventListener("click", getStarted);
    $("closeSettings").addEventListener("click", closeSettings);
    $("connForm").addEventListener("submit", saveConnection);
    $("checkNow").addEventListener("click", () => syncNow());
    $("onlineVoices").addEventListener("click", () => setOnlineVoices(state.s?.speech?.allowOnline !== true));
    $("toggleKey").addEventListener("click", () => {
      const input = $("accessKey");
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      $("toggleKey").setAttribute("aria-pressed", String(show));
      $("toggleKey").textContent = show ? t("settings_hide_key") : t("settings_show_key");
    });
    for (const id of ["serverUrl", "accessKey"]) $(id).addEventListener("input", () => state.dirty.add(id));
    document.addEventListener("keydown", onGlobalKeys);
    addEventListener("online", () => {
      state.online = true;
      renderHeader();
      renderBanners();
    });
    addEventListener("offline", () => {
      state.online = false;
      renderHeader();
      renderBanners();
    });

    // State L: nothing for the first 100 ms; then placeholders if storage is still busy.
    const loading = setTimeout(() => {
      if (state.s) return;
      $("main").setAttribute("aria-busy", "true");
      $("chips").setAttribute("aria-label", t("popup_loading"));
      $("chips").replaceChildren(...[1, 2, 3].map(() => el("span", { class: "skeleton skeleton-chip" })));
    }, 100);

    const tabQuery = Promise.resolve()
      .then(() => ext.tabs.query({ active: true, currentWindow: true }))
      .then(([tab]) => {
        state.host = hostOf(tab?.url);
        state.supported = !!state.host;
        state.tabId = tab?.id ?? null;
      })
      .catch(() => {
        state.host = null;
        state.supported = false;
      });

    ext.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !state.s) return;
      const keys = Object.keys(changes).filter((k) => k in DEFAULTS && !inFlight.has(k));
      for (const k of keys) state.s[k] = changes[k].newValue ?? DEFAULTS[k];
      if (keys.length) renderFor(keys);
    });

    const [s] = await Promise.all([ext.storage.local.get(DEFAULTS), tabQuery, checkPermission()]);
    clearTimeout(loading);
    $("chips").removeAttribute("aria-label");
    state.s = s;
    // Jobs that finished before the popup opened show their result without the swap motion;
    // the ones shown now count as seen (24 §9).
    for (const j of Array.isArray(s.addJobs) ? s.addJobs : []) if (j?.state === "done") state.doneAtOpen.add(j.id);
    $("main").dataset.ready = "true";
    renderAll();
    const seen = currentJobs().filter((j) => j.queue && (j.status === "done" || j.status === "failed")).map((j) => j.id);
    if (seen.length) send({ type: "jobs.seen", ids: seen });

    // Fire and forget: the background refreshes words if they're stale (slice 26), and the
    // free lookups left today (slice 10); the popup shows what it has until they arrive.
    send({ type: "sync" });
    if (lookupReady(s)) send({ type: "llmStatus" });
    askPage();
  }

  globalThis.KotikoPopup = { wordGroups, wordTotal, languages, hostOf, syncProblem, addProblem, mode, lookupReady, state, ready: init() };
})();
