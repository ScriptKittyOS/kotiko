// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Kotiko's toolbar popup (slice 20). Adds words without waiting, shows and hides
// languages, pauses the current site, and shows the server's state as plain-language
// banners (slice 25). Every string comes from _locales through KotikoI18n.
//
// Works against today's background: `add`, `remove` and `sync` messages, and the
// `storage.local` keys enabled, pausedHosts, hiddenLangs, words, lastSync, syncError,
// serverUrl and token. Hooks for later slices are marked with their number.
(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  const I18n = globalThis.KotikoI18n;
  const Icons = globalThis.KotikoIcons;
  const { t } = I18n;
  const $ = (id) => document.getElementById(id);

  const DEFAULTS = {
    serverUrl: "http://localhost:4747",
    token: "",
    enabled: true,
    pausedHosts: [],
    hiddenLangs: [],
    words: [],
    lastSync: null,
    syncError: null,
    // Voices for the speak button (slice 34); the dashboard's voice settings (21) add the
    // rest. Online voices send the word to the browser's voice service, so they're off.
    speech: { allowOnline: false, rate: 0.9, voices: {} },
  };
  const MAX_JOBS = 3;
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

  const hasToken = (s) => !!String(s?.token ?? "").trim();
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

  // The line for a failed add or undo, from the background's {error, code, details}.
  function addProblem(res, { connected = true, online = true, n = 0 } = {}) {
    const code = res?.code ?? res?.error?.code ?? "internal";
    const status = res?.details?.status ?? null;
    const details = technical(typeof res?.error === "string" ? res.error : res?.error?.message, status ? `HTTP ${status}` : null);
    const line = (key, actions = ["retry"], params) => ({ text: t(key, params), details, actions, code });
    if (!online && code === "server_unreachable") return line("error_add_offline");
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
    online: navigator.onLine !== false,
    permission: true,
    jobs: [],
    expanded: false,
    roving: null,
    checking: false,
    dirty: new Set(),
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
      default:
        return null;
    }
  }

  // The same actions as quiet links, for a line under the add box.
  function actionLink(action, onRetry) {
    const key = { retry: "error_try_again_action", settings: "error_connection_settings_action" }[action];
    if (!key) return null;
    return el("button", {
      class: "link link-quiet",
      type: "button",
      "data-action": action,
      onclick: action === "retry" ? onRetry : () => openSettings(),
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
    const firstRun = !!s && !hasToken(s) && wordTotal(s.words) === 0;
    $("firstRun").hidden = !firstRun;
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
  }

  // --- Recent adds -------------------------------------------------------------------

  function jobLines(job) {
    if (job.status === "looking") {
      return [{ key: `${job.id}`, kind: "looking", job }];
    }
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

  function lineContent(line) {
    const { job, entry } = line;
    if (line.kind === "looking") {
      return [el("span", { class: "job-text job-looking" }, t("add_looking_up", { text: job.text }))];
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
    return line.kind;
  }

  function renderJobs() {
    const list = $("jobs");
    const existing = new Map([...list.children].map((li) => [li.dataset.key, li]));
    const lines = state.jobs.flatMap(jobLines);
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

  function submit(e) {
    e.preventDefault();
    const input = $("addText");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    input.focus();
    const job = { id: ++jobSeq, text, status: "looking", words: [] };
    state.jobs.unshift(job);
    trimJobs();
    if ([...text].length > MAX_TEXT) {
      job.status = "failed";
      job.error = { text: t("error_input_too_long"), details: "", actions: [] };
      renderJobs();
      return;
    }
    runJob(job);
  }

  function retryJob(job) {
    runJob(job);
    $("addText").focus();
  }

  function dismissJob(job) {
    state.jobs = state.jobs.filter((j) => j !== job);
    renderJobs();
    $("addText").focus();
  }

  async function undo(job, entry) {
    entry.undo = "pending";
    renderJobs();
    const res = await send({ type: "remove", id: entry.word.id });
    if (res?.error) {
      entry.undo = "failed";
      entry.undoError = addProblem(res, { connected: hasToken(state.s), online: state.online, n: wordTotal(state.s?.words) });
    } else {
      entry.undo = "done";
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
    const fields = { serverUrl: state.s.serverUrl, accessKey: state.s.token };
    for (const [id, value] of Object.entries(fields)) {
      const input = $(id);
      // Never overwrite a field being edited (research 06 F16).
      if (document.activeElement === input || state.dirty.has(id)) continue;
      input.value = value ?? "";
    }
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

  async function saveConnection(e) {
    e.preventDefault();
    const serverUrl = $("serverUrl").value.trim() || DEFAULTS.serverUrl;
    const token = $("accessKey").value.trim();
    state.dirty.clear();
    state.s.serverUrl = serverUrl;
    state.s.token = token;
    await ext.storage.local.set({ serverUrl, token });
    renderSections();
    renderBanners();
    await syncNow();
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
    token: [renderSections, renderBanners, renderSettingsFields, renderSettingsStatus],
    serverUrl: [renderSettingsFields],
    speech: [renderVoices],
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
    $("getStarted").addEventListener("click", openSettings);
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
    $("main").dataset.ready = "true";
    renderAll();

    // Fire and forget: the background refreshes words if they're stale (slice 26).
    send({ type: "sync" });
  }

  globalThis.KotikoPopup = { wordGroups, wordTotal, languages, hostOf, syncProblem, addProblem, state, ready: init() };
})();
