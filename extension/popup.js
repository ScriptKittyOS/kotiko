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
    prefs: {},
    mixing: null,
    // The languages the learner reads (50), mirrored by the background.
    baseLangs: null,
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
    // Slice 12 §8: the last backup saved or restored, when the reminder started counting,
    // and "Not now" until when.
    lastBackupAt: null,
    backupSince: null,
    backupSnooze: null,
  };
  const MAX_JOBS = 3;
  const DEFAULT_SERVER = "http://localhost:4747";
  // Providers that run without a key (spec/providers.json's keyRequired: false).
  const KEYLESS = new Set(["ollama", "lmstudio", "custom"]);
  const NO_WORD = new Set(["no_word_found", "rejected_same_as_gloss"]);
  const CHIP_ROWS = 3;
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

  // Slice 12 §8: words only in this browser, at least 20, and no backup for 30 days (counted
  // from the update that brought the reminder, so nobody is nagged on day one).
  const BACKUP_DAYS = 30;
  const DAY_MS = 86_400_000;
  function backupDue(s, now = Date.now()) {
    if (!s || (s.wordsHome ?? "local") !== "local" || s.prefs?.backupReminder === false) return false;
    if (typeof s.backupSnooze === "number" && now < s.backupSnooze) return false;
    if (wordTotal(s.words) < 20) return false;
    const since = typeof s.lastBackupAt === "number" ? s.lastBackupAt : typeof s.backupSince === "number" ? s.backupSince : null;
    return since !== null && now - since > BACKUP_DAYS * DAY_MS;
  }

  function wordTotal(words) {
    let n = 0;
    for (const g of wordGroups(words).values()) n += g.set.size;
    return n;
  }

  const focusOf = (s) => (s?.mixing?.focus?.length ? s.mixing.focus : null);

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
      case "address_changed":
        return { severity: "blocking", text: t("error_address_changed"), details, actions: ["settings"] };
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
      const fix = code === "address_changed" ? (String(res?.details?.route ?? "").startsWith("lookup:") ? ["setupLookups"] : ["settings"]) : local && (code === "key_rejected" || code === "lookup_not_set_up") ? ["setupLookups"] : [];
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
    // 24 §8: the language hint, and the bases unticked for the next add only.
    hint: null,
    narrow: new Set(),
    voices: new Map(),
    maskedToken: null,
  };

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
      case "backupNow":
        return el("button", { class: "btn btn-secondary btn-sm", type: "button", onclick: () => openDashboardAt("#settings/data/backup"), "data-action": "backup-now" }, t("popup_backup_now"));
      case "notNow":
        return el("button", { class: "link link-quiet", type: "button", onclick: () => ext.storage.local.set({ backupSnooze: Date.now() + BACKUP_DAYS * DAY_MS }), "data-action": "not-now" }, t("popup_backup_not_now"));
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
      if (n && !lookupReady(s)) return { severity: "info", text: t("popup_lookups_off"), actions: ["setupLookups"], id: "bannerLookups" };
      return backupDue(s) ? { severity: "info", text: t("popup_backup_reminder", { count: n }), actions: ["backupNow", "notNow"], id: "bannerBackup" } : null;
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
    // Focus (18): only the focused languages show; hiddenLangs waits untouched for Stop.
    const focus = focusOf(s);
    const all = [...wordGroups(s.words).keys()];
    const langs = languages(s.words, focus ? all.filter((l) => !focus.includes(l)) : s.hiddenLangs);
    $("emptyWords").hidden = langs.length > 0;
    chips.hidden = langs.length === 0;

    // A language whose first word came during Focus waits for Stop, and says so.
    const since = Date.parse(s.mixing?.focusSince) || 0;
    const isNew = (l) => !s.words.some((w) => w.lang === l && !(Date.parse(w.created_at) > since));
    $("focusStrip").hidden = !focus;
    if (focus) {
      $("focusStrip").replaceChildren(
        t("popup_focus_strip", { langs: langs.filter((l) => !l.hidden).map((l) => l.endonym).join(", ") }),
        " · ",
        el("button", { class: "link", type: "button", onclick: () => saveFocus(null), "data-action": "stop-focus" }, t("popup_focus_stop")),
        ...langs.filter((l) => l.hidden && isNew(l.lang)).map((l) => el("span", { class: "focus-waiting" }, t("popup_focus_waiting", { lang: l.name }))),
      );
    }
    $("showAll").hidden = !!focus || !langs.some((l) => l.hidden);

    if (!langs.some((l) => l.lang === state.roving)) state.roving = langs[0]?.lang ?? null;
    const hadFocus = chips.contains(document.activeElement) ? document.activeElement.dataset.lang : null;
    chips.replaceChildren(...langs.map((l) => chip(l, !!focus?.includes(l.lang))));
    collapseChips(chips, langs.length);
    if (hadFocus) [...chips.querySelectorAll(".chip")].find((c) => c.dataset.lang === hadFocus)?.focus();

    // Forget hidden languages that no longer have words, so a language removed and later
    // started again doesn't come back hidden. Only trust the list after a good sync.
    // Focused ones too; Focus ends with its last language.
    const stale = s.hiddenLangs.filter((x) => !all.includes(x));
    const trusted = s.lastSync && !s.syncError;
    if (stale.length && trusted && !inFlight.has("hiddenLangs")) {
      write(["hiddenLangs"], async () => {
        const { hiddenLangs } = await ext.storage.local.get({ hiddenLangs: [] });
        await ext.storage.local.set({ hiddenLangs: hiddenLangs.filter((x) => !stale.includes(x)) });
      });
    }
    const kept = focus?.filter((x) => all.includes(x));
    if (kept?.length < focus?.length && trusted && !inFlight.has("mixing")) saveFocus(kept.length ? kept : null);
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

  function chip(l, focused) {
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
      "data-focus": focused ? "true" : null,
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
      "data-focus-lang": l.lang,
      "aria-label": t("popup_focus_button", { lang: l.name }),
      title: t("popup_focus_button", { lang: l.name }),
      onclick: () => setFocus(l.lang),
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

  // What the page's content script made of it (16): a sensitive site (16 §4), with a way
  // to run there anyway; a page that kept undoing Kotiko (15); a language they don't read,
  // or one of theirs with no word yet (20 states H, H2).
  function renderPageLanguage(st) {
    const link = (id, label, onclick) => el("button", { class: "link", id, type: "button", onclick }, label);
    const name = (l) => I18n.languageName(l) ?? l;
    let line = null;
    if (st?.sensitive) line = [`${t(`popup_sensitive_${st.sensitive}`)} `, link("runSensitive", t("popup_sensitive_run"), allowSensitive)];
    else if (st?.stoodDown) line = [t("popup_stood_down")];
    else if (st && !st.base && st.lang && st.reason !== "unknown") line = [`${t("popup_page_not_yours", { lang: name(st.lang) })} `, link("readToo", t("popup_read_too", { lang: name(st.lang) }), () => openDashboardAt("#settings/languages"))];
    else if (st?.base && st.words === 0 && wordTotal(state.s.words) > 0) line = [t("popup_no_meanings_base", { base: name(st.base) })];
    $("pageLang").hidden = !line;
    $("pageLangText").replaceChildren(...(line ?? []));
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

  // --- What loads later -----------------------------------------------------------------
  // The popup starts from scratch on every open, so what the first view doesn't need loads
  // after the first frame (the voice library) or on first use (the manual form, the full
  // language list, popup-more.js), as Chrome's and V8's guidance for popups advises.
  const loads = new Map();
  const load = (src) => loads.get(src) ?? loads.set(src, new Promise((resolve, reject) => document.head.append(el("script", { src, onload: resolve, onerror: reject })))).get(src);
  const more = () => load("popup-more.js").then(() => globalThis.KotikoPopupMore.create({ el, t, icon, send, langName, I18n, ext }));
  // Languages to offer first: the learner's own, by name.
  const myLangs = () => languages(state.s?.words ?? []).map((l) => l.lang);

  // Voices for the speak button (34), once the first frame is up: lang -> true | false.
  function loadVoices() {
    load("lib/speak.js").then(() => {
      globalThis.KotikoSpeak.configure({ ...globalThis.KotikoSpeak.DEFAULTS, ...state.s?.speech });
      renderJobs();
    }).catch(() => {});
  }
  function checkVoices(jobs) {
    const S = globalThis.KotikoSpeak;
    if (!S) return;
    for (const l of new Set(jobs.flatMap((j) => j.words.map((w) => w.word.lang)))) {
      if (state.voices.has(l)) continue;
      state.voices.set(l, false);
      S.canSpeak(l).then((ok) => ok && (state.voices.set(l, true), renderJobs())).catch(() => {});
    }
  }

  // The language hint (24 §8): Auto, or the Focus language, else one picked; kept for the
  // browser session.
  function renderHint() {
    const sel = $("hintLang");
    const focus = focusOf(state.s);
    const langs = [...new Set([...myLangs(), ...(state.hint ? [state.hint] : [])])];
    const auto = focus?.length === 1 ? langName(focus[0]) : t("popup_hint_auto");
    sel.replaceChildren(el("option", { value: "" }, auto), ...langs.map((l) => el("option", { value: l }, langName(l))), el("option", { value: "*" }, t("popup_hint_more")));
    sel.value = state.hint ?? "";
  }

  async function setHint(value) {
    if (value === "*") value = (await (await more()).pickLanguage({ anchor: $("hintLang"), first: myLangs() })) ?? state.hint;
    state.hint = value || null;
    renderHint();
    ext.storage.session?.set({ addHint: state.hint }).catch(() => {});
  }

  // "For pages in" (24 §8): one chip per language read, all ticked; unticking narrows the
  // next add only, and one always stays ticked.
  function renderPagesIn() {
    const bases = Array.isArray(state.s?.baseLangs) ? state.s.baseLangs : [];
    $("pagesIn").hidden = bases.length < 2;
    const on = bases.filter((b) => !state.narrow.has(b));
    $("pagesInChips").replaceChildren(...(bases.length < 2 ? [] : bases.map((b) => el("label", { class: "page-chip" },
      el("input", { type: "checkbox", value: b, checked: on.includes(b) ? "" : null, disabled: on.length === 1 && on[0] === b ? "" : null, onchange: (e) => (e.target.checked ? state.narrow.delete(b) : state.narrow.add(b), renderPagesIn()) }),
      langName(b)))));
  }

  // --- Recent adds -------------------------------------------------------------------
  // Add jobs live in `addJobs`, the background's, and finish with the popup closed (24 §1).
  // One line per target word, whatever the number of bases it has a record for (24 §4).
  const keyOf = (w) => `${w?.lang}\u001f${w?.native}`;
  const langName = (l) => I18n.languageName(l) ?? l;
  const problem = (e) => addProblem({ code: e?.code, details: e?.details ?? {} }, { online: state.online, n: wordTotal(state.s?.words) });

  function viewJob(j) {
    const e = j.error ?? {};
    const status = { waiting: "waiting", failed: "failed", done: "done", needs_choice: "choose" }[j.state] ?? "looking";
    const v = { id: j.id, text: j.text, status, words: [], code: e.code, details: e.details ?? {}, candidates: j.candidates ?? [], missing: j.missingBases ?? [], away: state.doneAtOpen.has(j.id) };
    if (status === "failed") {
      v.error = e.code === "rejected_same_as_gloss"
        ? { text: t("error_rejected_same_as_gloss", { text: j.text, base: langName(j.baseLangs?.[0] ?? "en") }), details: "", actions: [] }
        : NO_WORD.has(e.code) ? { text: t("error_no_word_found", { text: j.text }), details: e.details?.reply ?? "", actions: [] } : problem(e);
    }
    // A word's records in base order; the line reads as the most telling result.
    const order = (r) => ((j.baseLangs ?? []).indexOf(r.baseLang) + 99) % 99;
    const groups = new Map();
    for (const r of status === "done" ? j.results ?? [] : []) if (r?.word) (groups.get(keyOf(r.word)) ?? groups.set(keyOf(r.word), []).get(keyOf(r.word))).push(r);
    for (const [key, rs] of groups) {
      rs.sort((a, b) => order(a) - order(b));
      const live = rs.filter((r) => r.result !== "unchanged");
      const undo = state.undos.get(`${j.id}:${key}`) ?? (live.some((r) => r.undo === "failed") ? "failed" : live.some((r) => r.undo === "pending") ? "pending" : live.length && live.every((r) => r.undo === "done") ? "done" : null);
      const k = `${j.id}:${key}`;
      v.words.push({
        key,
        records: rs,
        word: rs[0].word,
        result: ["created", "updated", "unchanged"].find((x) => rs.some((r) => r.result === x)),
        undo,
        undoError: live.find((r) => r.undoError)?.undoError ?? null,
        fresh: !state.doneAtOpen.has(j.id) && !state.rendered.has(k),
      });
      state.rendered.add(k);
    }
    return v;
  }

  // The three most recent jobs that are running, waiting or asking, finished unseen, or
  // shown since the popup opened.
  function currentJobs() {
    if (!state.s) return [];
    // A job re-added in another language (24 §6) gives way to the new one.
    const stored = (state.s.addJobs ?? []).filter((j) => j?.id && j.state !== "cancelled" && !j.replacedBy);
    const list = [...[...state.optimistic.values()].reverse().filter((o) => !stored.some((j) => j.id === o.id)), ...stored]
      .filter((j) => !/done|failed/.test(j.state) || !j.seen || state.shownJobs.has(j.id))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_JOBS);
    for (const j of list) state.shownJobs.add(j.id);
    return list.map((j) => j.view ?? viewJob(j));
  }

  function jobLines(job) {
    if (job.status !== "done") return [{ key: `${job.id}`, kind: job.status, job }];
    const lines = job.words.map((entry) => ({ key: `${job.id}:${entry.key}`, kind: "word", job, entry }));
    if (job.missing.length && job.words.length) lines.push({ key: `${job.id}:missing`, kind: "missing", job });
    return lines;
  }

  function wordNode(w, fresh) {
    return el("bdi", { class: `word dots${fresh ? " swap-in motion" : ""}`, lang: w.lang }, w.native);
  }

  // "Added спасибо (spa-SEE-ba) = thanks · Russian"; with several bases, the glosses in base
  // order ("perro · dog") and the primary base's pronunciation.
  function wordText(entry, fresh) {
    const w = entry.word;
    const pron = w.pronunciation || w.romanization;
    const params = {
      native: wordNode(w, fresh),
      gloss: el("bdi", { class: "job-gloss" }, entry.records.map((r) => r.word.gloss ?? r.word.english ?? "").join(" · ")),
      lang: langName(w.lang),
    };
    if (entry.result === "unchanged") return I18n.parts("add_unchanged", params);
    if (entry.result === "updated") {
      // What the merge added: the forms the word didn't have before.
      const had = new Set(entry.records.flatMap((r) => (r.previous?.forms ?? []).map((f) => (typeof f === "string" ? f : f.text))));
      const added = [...new Set(entry.records.flatMap((r) => (r.word.forms ?? []).map((f) => (typeof f === "string" ? f : f.text))))].filter((f) => f && !had.has(f));
      return added.length ? I18n.parts("add_updated", { ...params, changes: t("add_updated_forms", { forms: added.join(", ") }) }) : I18n.parts("add_updated_plain", params);
    }
    if (pron) params.pronunciation = el("span", { class: "job-pron", lang: `${w.lang}-Latn` }, pron);
    // The wrong language, fixed in two clicks (24 §6): this chip, then a language.
    params.lang = el("button", { class: "lang-chip", type: "button", "data-action": "relang", "aria-haspopup": "dialog", "aria-label": t("add_change_lang", { native: w.native, lang: params.lang }), onclick: (e) => relang(entry, e.currentTarget) }, params.lang, icon("chevron", 12));
    return I18n.parts(pron ? "add_created" : "add_created_plain", params);
  }

  // Why a job waits (slice 24 §2), and what can be done about it.
  function waitingLine(job) {
    const { code, text } = job;
    const at = Date.parse(job.details.retry_at ?? "");
    if (code === "lookup_not_set_up") return { text: t("add_waiting_setup", { text }), actions: ["setupLookups", "manual", "cancel"] };
    if (code === "quota_exhausted" && at) return { text: t("add_waiting_quota", { text, time: new Intl.DateTimeFormat(I18n.locale(), { timeStyle: "short" }).format(at) }), actions: ["cancel"] };
    if (code === "offline") return { text: t("add_waiting_offline", { text }), actions: ["manual", "cancel"] };
    if (RETRYABLE.has(code)) return { text: t("add_waiting_busy", { text }), actions: ["retry", "manual", "cancel"] };
    return { text: t("add_waiting", { text, reason: problem(job).text }), actions: ["retry", "manual", "cancel"] };
  }

  const openWord = (id) => openDashboardAt(`#words/${encodeURIComponent(id)}`);
  const smallButton = (action, label, onclick, extra = {}) => el("button", { class: "btn btn-quiet btn-sm", type: "button", "data-action": action, onclick, ...extra }, label);

  // A pasted sentence: the words found, function words unticked, nothing saved yet.
  function chooseContent(job) {
    const words = [];
    for (const c of job.candidates) {
      const w = words.find((x) => x.key === keyOf(c));
      if (w) w.glosses.push(c.gloss);
      else words.push({ key: keyOf(c), word: c, glosses: [c.gloss], on: !c.unticked });
    }
    const button = smallButton("choose", "", () => send({ type: "jobs.choose", id: job.id, keys: words.filter((w) => w.on).map((w) => w.key) }));
    const count = () => {
      const k = words.filter((w) => w.on).length;
      button.textContent = t("add_choose", { count: k });
      button.disabled = !k;
    };
    count();
    const list = el("ul", { class: "choose-list" }, words.map((w) => el("li", {}, el("label", {},
      el("input", { type: "checkbox", checked: w.on ? "" : null, "data-key": w.key, onchange: (e) => ((w.on = e.target.checked), count()) }),
      " ", el("bdi", { class: "word", lang: w.word.lang }, w.word.native), ` = ${w.glosses.join(" · ")} · ${langName(w.word.lang)}`))));
    return [el("div", { class: "job-text" }, el("p", {}, t("add_needs_choice", { count: words.length, text: job.text })), list,
      el("div", { class: "job-more" }, button, actionLink("cancel", null, () => cancelJob(job))))];
  }

  function lineContent(line) {
    const { job, entry } = line;
    if (line.kind === "looking") return [el("span", { class: "job-text job-looking" }, t("add_looking_up", { text: job.text })), el("span", { class: "job-actions" }, actionLink("cancel", null, () => cancelJob(job)))];
    if (line.kind === "choose") return chooseContent(job);
    if (line.kind === "missing") return [icon("info", 18), el("span", { class: "job-text" }, t("add_missing_base", { base: job.missing.map(langName).join(", ") }))];
    if (line.kind === "waiting") {
      const w = waitingLine(job);
      const actions = w.actions.map((a) => (a === "manual" ? manualLink(job) : actionLink(a, () => retryJob(job), () => cancelJob(job)))).filter(Boolean);
      return [
        icon("info", 18),
        el("div", { class: "job-text" }, el("p", {}, w.text), el("div", { class: "job-more" }, actions)),
      ];
    }
    if (line.kind === "failed") {
      const e = job.error;
      const actions = [...e.actions.map((a) => actionLink(a, () => retryJob(job))), job.local ? null : manualLink(job)].filter(Boolean);
      const details = e.details ? el("details", { class: "details" }, el("summary", {}, t("error_details")), el("pre", {}, e.details)) : null;
      return [
        icon("error", 18),
        el("div", { class: "job-text" }, el("p", {}, e.text), actions.length || details ? el("div", { class: "job-more" }, actions, details) : null),
        el("button", { class: "btn btn-icon", type: "button", "data-action": "dismiss", "aria-label": t("add_dismiss"), title: t("add_dismiss"), onclick: () => dismissJob(job) }, icon("close", 16)),
      ];
    }
    const w = entry.word;
    const native = el("bdi", { lang: w.lang }, w.native);
    if (entry.undo === "done") {
      if (entry.result === "updated") return [el("span", { class: "job-text" }, I18n.parts("undo_done_updated", { native }))];
      return [el("span", { class: "job-text" }, I18n.parts("undo_done_created", { native })), el("span", { class: "job-actions" }, smallButton("redo", t("add_redo"), () => redo(job, entry)))];
    }
    if (entry.undo === "failed") {
      // Changed since (another device, the dashboard): fixing it is the learner's call.
      const stale = entry.undoError?.code === "word_conflict";
      return [
        icon("error", 18),
        el("div", { class: "job-text" }, el("p", {}, stale ? t("undo_stale") : t("undo_failed", { message: problem(entry.undoError).text })),
          el("div", { class: "job-more" }, stale ? smallButton("open", t("add_open"), () => openWord(w.id)) : actionLink("retry", () => undo(job, entry)))),
      ];
    }
    const fresh = entry.fresh;
    entry.fresh = false;
    // Say it, when the device has a voice for it (34); voices load after the first frame.
    const speak = state.voices.get(w.lang) ? smallButton("speak", icon("speaker", 16), () => globalThis.KotikoSpeak.say(w), { "aria-label": t("speak_label", { word: w.native, lang: langName(w.lang) }) }) : null;
    const action = entry.result === "unchanged"
      ? smallButton("open", t("add_open"), () => openWord(w.id), { "aria-label": t("add_open_label", { native: w.native }) })
      : smallButton("undo", [icon("undo", 16), t("add_undo")], () => entry.undo !== "pending" && undo(job, entry), { "aria-label": t("add_undo_label", { native: w.native }), "aria-disabled": entry.undo === "pending" ? "true" : null });
    return [el("span", { class: "job-text" }, wordText(entry, fresh)), el("span", { class: "job-actions" }, speak, action)];
  }

  function signature(line) {
    if (line.kind === "word") return `word:${line.entry.result}:${line.entry.undo ?? ""}:${state.voices.get(line.entry.word.lang) ?? ""}`;
    if (line.kind === "waiting") return `waiting:${line.job.code ?? ""}`;
    if (line.kind === "failed") return `failed:${line.job.error?.text ?? ""}`;
    if (line.kind === "choose") return `choose:${line.job.candidates.length}`;
    return line.kind;
  }

  function renderJobs(force = false) {
    const list = $("jobs");
    const existing = new Map([...list.children].map((li) => [li.dataset.key, li]));
    // A manual form being filled stays until it's saved or cancelled.
    const keep = new Set(force ? [] : [...existing].filter(([, li]) => li.dataset.sig === "manual").map(([k]) => k));
    const jobs = currentJobs();
    checkVoices(jobs);
    const lines = jobs.flatMap(jobLines);
    // Finished while the popup was closed: says so once, above those lines (24 §9).
    const away = jobs.some((j) => j.away && j.status === "done");
    const next = lines.map((line) => {
      const old = existing.get(line.key);
      if (old && (old.dataset.sig === signature(line) || keep.has(line.key))) return old;
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
    if (away) next.unshift(existing.get("away") ?? el("li", { class: "job-away", "data-key": "away" }, t("add_while_away")));
    list.replaceChildren(...next);
  }

  // A job, persisted by the background before anything else: the popup can close.
  async function queueJob(text) {
    const id = globalThis.crypto.randomUUID();
    const job = { id, text, state: "queued", createdAt: Date.now() };
    state.optimistic.set(id, job);
    renderJobs();
    const bases = (state.s?.baseLangs ?? []).filter((b) => !state.narrow.has(b));
    const res = await send({ type: "add", id, text, ...(state.hint ? { hintLang: state.hint } : {}), ...(state.narrow.size && bases.length ? { baseLangs: bases } : {}) });
    // Refused (too long): a line of its own, dismissed locally.
    if (res?.error) job.view = { id, local: true, text, status: "failed", words: [], missing: [], candidates: [], error: addProblem(res) };
    renderJobs();
  }

  function submit(e) {
    e.preventDefault();
    const input = $("addText");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    input.focus();
    queueJob(text);
    // The narrowing is for this add only; the draft is spent (24 §8, §9).
    state.narrow.clear();
    renderPagesIn();
    saveDraft("");
  }

  // The add box's text, kept for the session 300 ms after typing stops (24 §9).
  let draftTimer = 0;
  function saveDraft(text) {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => ext.storage.session?.set({ addDraft: text }).catch(() => {}), text ? 300 : 0);
  }

  // "Add it yourself" (24 §7), on a job that waits or failed: the form in its line.
  const manualLink = (job) => el("button", { class: "link link-quiet", type: "button", "data-action": "manual", onclick: (e) => manualForm(job, e.currentTarget.closest("li")) }, t("add_manual"));
  async function manualForm(job, li) {
    const m = await more();
    li.replaceChildren(m.manualForm({
      text: job.text,
      lang: state.hint,
      first: myLangs(),
      bases: (state.s?.baseLangs?.length ? state.s.baseLangs : job.baseLangs) ?? ["en"],
      onSave: async (fields) => {
        const res = await send({ type: "jobs.addManual", id: globalThis.crypto.randomUUID(), surface: "popup", ...fields });
        if (!res?.error) send({ type: "jobs.cancel", id: job.id });
        return res;
      },
      onCancel: () => renderJobs(true),
    }));
    li.dataset.sig = "manual";
    li.querySelector("input")?.focus();
  }

  // Another language for a created word (24 §6): the picker, then the same text again.
  async function relang(entry, anchor) {
    const job = (state.s.addJobs ?? []).find((j) => j.results?.some((r) => r.word && keyOf(r.word) === entry.key));
    const lang = await (await more()).pickLanguage({ anchor, first: myLangs().filter((l) => l !== entry.word.lang) });
    if (lang && job) send({ type: "jobs.relang", id: job.id, key: entry.key, lang });
  }

  function retryJob(job) {
    send({ type: "jobs.retry", id: job.id });
    $("addText").focus();
  }

  function cancelJob(job) {
    send({ type: "jobs.cancel", id: job.id });
    $("addText").focus();
  }

  function dismissJob(job) {
    state.optimistic.delete(job.id);
    if (!job.local) send({ type: "jobs.dismiss", id: job.id });
    state.s.addJobs = (state.s.addJobs ?? []).filter((j) => j.id !== job.id);
    renderJobs();
    $("addText").focus();
  }

  // Undo and "Add it back" (24 §5): the background writes the outcome on the job.
  async function undo(job, entry, type = "jobs.undo") {
    const k = `${job.id}:${entry.key}`;
    state.undos.set(k, "pending");
    renderJobs();
    await send({ type, id: job.id, key: entry.key });
    state.undos.delete(k);
    renderJobs();
  }
  const redo = (job, entry) => undo(job, entry, "jobs.redo");

  // --- Actions on storage --------------------------------------------------------------

  function toggleLang(lang) {
    // While focusing, a chip adds its language to Focus or takes it out.
    const focus = focusOf(state.s);
    if (focus) {
      const next = focus.includes(lang) ? focus.filter((l) => l !== lang) : [...focus, lang];
      return saveFocus(next.length ? next : null);
    }
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

  // Focus on one language (18); again on the only focused one stops.
  function setFocus(lang) {
    state.roving = lang;
    return saveFocus(String(focusOf(state.s)) === lang ? null : [lang]);
  }

  function saveFocus(focus) {
    const since = focus ? (focusOf(state.s) && state.s.mixing.focusSince) || new Date().toISOString() : null;
    state.s.mixing = { ...state.s.mixing, focus, focusSince: since };
    renderLangs();
    return write(["mixing"], async () => {
      const { mixing } = await ext.storage.local.get({ mixing: null });
      await ext.storage.local.set({ mixing: { ...mixing, focus, focusSince: since } });
    });
  }

  function showAll() {
    state.s.hiddenLangs = [];
    renderLangs();
    $("chips").querySelector('.chip[tabindex="0"]')?.focus();
    return write(["hiddenLangs"], () => ext.storage.local.set({ hiddenLangs: [] }));
  }

  // "Swap words here anyway" (16 §4).
  function allowSensitive() {
    state.pageStatus = { ...state.pageStatus, sensitive: null };
    renderPage();
    return write(["prefs"], async () => {
      const { prefs } = await ext.storage.local.get({ prefs: {} });
      await ext.storage.local.set({ prefs: { ...prefs, sensitiveAllowed: [...new Set([...(prefs.sensitiveAllowed ?? []), state.host])] } });
    });
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
    load("lib/url.js").then(warnHttp, () => {});
  }

  // Slice 28 §5: plain http:// beyond this computer or a Tailscale address says so.
  function warnHttp() {
    $("serverUrlWarn").hidden = !globalThis.ServerUrl?.sendsInClear($("serverUrl").value);
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
    warnHttp();
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
    words: [renderLangs, renderSections, renderBanners, renderSettingsStatus, renderHint],
    hiddenLangs: [renderLangs],
    mixing: [renderLangs, renderHint],
    baseLangs: [renderPagesIn],
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
    lastBackupAt: [renderBanners],
    backupSnooze: [renderBanners],
    prefs: [renderBanners],
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
    renderHint();
    renderPagesIn();
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
      setFocus(chips[i].dataset.lang);
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
      const first = $("jobs").querySelector(".job-actions button") ?? $("jobs").querySelector("button");
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
    $("addText").addEventListener("input", (e) => saveDraft(e.target.value));
    // A pasted list (two lines or more) is for bulk add (13 §1): kept whole for the session,
    // since the one-line box would drop its line breaks.
    $("addText").addEventListener("paste", (e) => {
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (text.split(/\r?\n/).filter((l) => l.trim()).length < 2) return;
      e.preventDefault();
      ext.storage.session?.set({ bulkDraft: text }).catch(() => {});
      $("bulkOffer").hidden = false;
      $("openBulk").focus();
    });
    $("openBulk").addEventListener("click", () => openDashboardAt("#add"));
    $("hintLang").addEventListener("change", (e) => setHint(e.target.value));
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
    $("serverUrl").addEventListener("input", warnHttp);
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

    // The session's hint and draft (24 §8, §9) come with the first read.
    const session = Promise.resolve(ext.storage.session?.get({ addHint: null, addDraft: "" })).catch(() => null);
    const [s, , , kept] = await Promise.all([ext.storage.local.get(DEFAULTS), tabQuery, checkPermission(), session]);
    state.hint = typeof kept?.addHint === "string" ? kept.addHint : null;
    if (kept?.addDraft && !$("addText").value) $("addText").value = kept.addDraft;
    clearTimeout(loading);
    $("chips").removeAttribute("aria-label");
    state.s = s;
    // Jobs that finished before the popup opened show their result without the swap motion;
    // the ones shown now count as seen (24 §9).
    for (const j of Array.isArray(s.addJobs) ? s.addJobs : []) if (j?.state === "done") state.doneAtOpen.add(j.id);
    $("main").dataset.ready = "true";
    renderAll();
    const seen = currentJobs().filter((j) => !j.local && (j.status === "done" || j.status === "failed")).map((j) => j.id);
    if (seen.length) send({ type: "jobs.seen", ids: seen });

    // Fire and forget: the background refreshes words if they're stale (slice 26), and the
    // free lookups left today (slice 10); the popup shows what it has until they arrive.
    send({ type: "sync" });
    if (lookupReady(s)) send({ type: "llmStatus" });
    askPage();
    requestAnimationFrame(() => setTimeout(loadVoices, 0));
  }

  globalThis.KotikoPopup = { wordGroups, wordTotal, languages, hostOf, syncProblem, addProblem, mode, lookupReady, backupDue, state, ready: init() };
})();
