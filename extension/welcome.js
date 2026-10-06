// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The welcome tab (slice 22): a short conversation that helps a new learner choose their
// first word, celebrates it, and shows it swapped into a sentence in their own language.
//
// 1. The languages they read: detected from the browser (slice 50), confirmed by doing
//    nothing; ticking and unticking writes them at once.
// 2. Their own AI (slice 11): Connect OpenRouter (its sign-in in a new tab), a pasted
//    OpenRouter key, another service or a local model, or their Kotiko server; each checked
//    once. Or no AI at all.
// 3. The first word: anything the add box takes. "native = meaning" is parsed here, with
//    no model and no network. Everything else is looked up with `words.preview`, which
//    saves nothing; only "Make it my first word" saves (`words.save`).
// 4. The celebration (slice 32's `vocab:first`, claimed once from the background), with
//    confetti unless motion is reduced or celebrations are off, then the live preview
//    with the matcher pages use and the popover pages show.
//
// Every string comes from _locales through KotikoI18n; word data is only ever text.
(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  const I18n = globalThis.KotikoI18n;
  const Icons = globalThis.KotikoIcons;
  const M = globalThis.KotikoWelcomeModel;
  const Lang = globalThis.KotikoLang;
  const Local = globalThis.KotikoLocal;
  const Matcher = globalThis.KotikoMatcher;
  const Card = globalThis.KotikoWordCard;
  const Speak = globalThis.KotikoSpeak;
  const LookupStatus = globalThis.KotikoLookupStatus;
  const Errors = globalThis.KotikoErrors;
  const Confetti = globalThis.KotikoConfetti;
  const SPEC = globalThis.KOTIKO_SPEC;
  const { t } = I18n;
  const $ = (id) => document.getElementById(id);

  const PLACEHOLDER_MS = 4000;
  const NOTES = {
    openai: "dash_note_openai",
    anthropic: "dash_note_anthropic",
    gemini: "dash_note_gemini",
    groq: "dash_note_groq",
    ollama: "dash_note_ollama",
    lmstudio: "dash_note_lmstudio",
    custom: "dash_note_custom",
  };
  const state = {
    chips: [], // every chip shown, in order
    bases: [], // the ticked ones, in order: the first is the primary base
    detected: [],
    ui: {},
    backend: null,
    check: null, // { status: "busy" | "ok" | "bad", panel, text }; panel "connect" is the sign-in
    panel: null, // "paste" | "other" | "server"
    changing: false,
    aiSkipped: false,
    other: null, // the provider picked under "Another service or my own model"
    ask: idleAsk(),
    hadWords: false,
    saving: false,
    saved: null,
    prefs: {},
    langList: null,
    confetti: null,
    placeholder: 1,
    timer: null,
    popover: null,
  };

  function idleAsk() {
    return { phase: "idle", text: "", hint: null, token: 0, groups: [], chosen: 0, entry: null, manual: null, picked: null, meaningBase: null };
  }

  // ---------------------------------------------------------------------------------
  // Small helpers.

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : String(v));
    }
    node.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
    return node;
  }
  const icon = (name, size) => Icons.icon(name, size);
  const bdi = (text, lang, cls) => el("bdi", { class: cls, lang: lang || null, dir: "auto" }, text ?? "");
  const nameOf = (tag) => I18n.languageName(tag) ?? Lang.displayName(tag, I18n.locale()) ?? tag;
  const endonymOf = (tag) => I18n.endonym(tag) ?? Lang.endonym(tag) ?? tag;
  const primary = () => state.bases[0];
  const welcomeData = () => M.langFile(SPEC, primary(), "welcome");
  const wd = (field, key) => welcomeData()?.[field] ?? t(key);
  const listOf = (names) => {
    try {
      return new Intl.ListFormat(I18n.locale(), { type: "conjunction" }).format(names);
    } catch {
      return names.join(", ");
    }
  };

  async function call(msg) {
    try {
      const res = await ext.runtime.sendMessage(msg);
      if (res === undefined) return { error: "no answer", code: "internal" };
      return res;
    } catch (e) {
      return { error: String(e?.message ?? e), code: "internal" };
    }
  }
  const failed = (res) => !res || typeof res.error === "string" || (res.error && typeof res.error === "object");
  const codeOf = (res) => res?.code ?? res?.error?.code ?? "internal";
  const detailsOf = (res) => res?.details ?? res?.error?.details ?? {};

  function uuid() {
    try {
      return crypto.randomUUID();
    } catch {
      const b = crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 15) | 64;
      b[8] = (b[8] & 63) | 128;
      const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }
  }

  // Kotiko's new lines, announced once each by the log (22 §14).
  function announce(text) {
    if (!text) return;
    const log = $("log");
    log.append(el("p", {}, text));
    while (log.childElementCount > 6) log.firstElementChild.remove();
  }

  const reduced = () => Confetti.reducedMotion(window);

  // ---------------------------------------------------------------------------------
  // 2. The languages you read (§2b).

  function chipLabel(tag) {
    const name = nameOf(tag);
    const endo = endonymOf(tag);
    return { name, endo, a11y: endo && endo.toLocaleLowerCase() !== name.toLocaleLowerCase() ? t("welcome_lang_a11y", { name, endonym: endo }) : name };
  }

  function renderBases() {
    const box = $("bases");
    const items = state.chips.map((tag) => {
      const on = state.bases.includes(tag);
      const { name, endo, a11y } = chipLabel(tag);
      const basic = M.levelOf(tag) === "basic";
      const help = basic ? t("welcome_base_basic_help", { language: endo }) : null;
      return el(
        "button",
        {
          class: "chip base-chip",
          type: "button",
          role: "checkbox",
          "aria-checked": String(on),
          "aria-label": a11y,
          "aria-description": help,
          title: endo !== name ? endo : null,
          "data-lang": tag,
          onclick: () => toggleBase(tag, !on),
        },
        el("span", { class: "chip-glyph", "aria-hidden": "true" }, icon(on ? "check" : "add", 14)),
        el("span", { class: "chip-label" }, name),
        basic ? el("span", { class: "chip-tag", title: help, "aria-hidden": "true" }, t("welcome_base_basic")) : null,
      );
    });
    const add = el("button", { class: "chip add-chip", id: "addBase", type: "button", "aria-expanded": String(!$("baseSearch").hidden), "aria-controls": "baseSearch", onclick: openBaseSearch },
      el("span", { class: "chip-glyph", "aria-hidden": "true" }, icon("add", 14)),
      el("span", { class: "chip-label" }, t("welcome_bases_add")));
    const focused = document.activeElement?.dataset?.lang;
    box.replaceChildren(...items, add);
    if (focused) [...box.children].find((c) => c.dataset.lang === focused)?.focus();
  }

  function note(key) {
    const n = $("basesNote");
    n.hidden = !key;
    n.textContent = key ? t(key) : "";
  }

  // Settings are changed by the background, which keeps the real copy (SCR-448).
  async function saveSettings(change) {
    const res = await call({ type: "settings.set", ...change });
    if (failed(res)) throw Object.assign(new Error(String(res?.error?.message ?? res?.error ?? "settings")), { code: codeOf(res) });
  }

  async function writeBases() {
    const bases = state.bases.slice();
    state.ui = { uiLang: "auto", ...state.ui, baseLangs: bases, baseLangsDetected: state.detected };
    await saveSettings({ merge: { ui: { uiLang: state.ui.uiLang, baseLangs: bases, baseLangsDetected: state.detected.slice() } }, set: { baseLangs: bases } });
    // A connected server's Telegram bot follows them (slice 41 §9).
    call({ type: "profile.sync" });
  }

  async function toggleBase(tag, on) {
    const r = M.toggleBase(state.bases, tag, on);
    if (r.error) {
      note(r.error === "last" ? "welcome_bases_last" : "welcome_bases_full");
      return renderBases();
    }
    if (on && !state.chips.includes(tag)) state.chips.push(tag);
    const ticked = state.chips.filter((c) => r.bases.includes(c));
    note(null);
    state.bases = ticked;
    renderBases();
    renderAskExtras();
    await writeBases();
    // A card on screen depends on the bases: look it up again (or rebuild a typed one).
    const a = state.ask;
    if (a.phase === "card" && a.manual) showManual(a.manual.parsed, a.manual.lang, a.text);
    else if ((a.phase === "card" || a.phase === "choices") && a.text) lookup(a.text, a.hint);
    else if (a.phase === "which" && a.entry) submit(a.text, { keepBox: true });
  }

  function languageList() {
    state.langList ??= M.languageList({ spec: SPEC, uiLocale: I18n.locale(), Lang });
    return state.langList;
  }

  // A searchable list (22 §2b and §5 D): a combobox with a listbox of matches.
  function bindSearch(input, list, { exclude, onPick, onClose }) {
    let options = [];
    let active = -1;
    const render = () => {
      const q = input.value;
      options = M.searchLanguages(languageList(), q, { exclude: exclude() });
      active = options.length ? 0 : -1;
      input.setAttribute("aria-expanded", String(!!q.trim()));
      if (!q.trim()) return list.replaceChildren();
      if (!options.length) return list.replaceChildren(el("li", { class: "lang-option lang-option-none", role: "option", "aria-disabled": "true" }, t("welcome_bases_none")));
      list.replaceChildren(...options.map((o, i) => el("li", {
        class: "lang-option",
        role: "option",
        id: `${list.id}-${i}`,
        "aria-selected": String(i === active),
        "data-lang": o.tag,
        onmousedown: (e) => e.preventDefault(),
        onclick: () => onPick(o.tag),
      }, el("span", {}, o.name), o.endonym && o.endonym.toLocaleLowerCase() !== o.name.toLocaleLowerCase() ? el("span", { class: "endonym", lang: o.tag }, o.endonym) : null)));
      input.setAttribute("aria-activedescendant", `${list.id}-0`);
    };
    const move = (d) => {
      if (!options.length) return;
      active = (active + d + options.length) % options.length;
      [...list.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
      input.setAttribute("aria-activedescendant", `${list.id}-${active}`);
    };
    input.addEventListener("input", render);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        move(e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (active >= 0) onPick(options[active].tag);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      }
    });
    return { reset: () => ((input.value = ""), render()) };
  }

  let baseSearch = null;
  function openBaseSearch() {
    const box = $("baseSearch");
    box.hidden = !box.hidden;
    $("addBase")?.setAttribute("aria-expanded", String(!box.hidden));
    if (!box.hidden) {
      baseSearch.reset();
      $("baseSearchField").focus();
    }
  }
  function closeBaseSearch() {
    $("baseSearch").hidden = true;
    baseSearch.reset();
    renderBases();
    $("addBase")?.focus();
  }

  // ---------------------------------------------------------------------------------
  // 3. Connect your AI (§4).

  const presets = () => state.backend?.providers ?? [];
  const preset = (id) => presets().find((p) => p.id === id) ?? null;
  const ready = () => M.aiReady(state.backend);

  function providerLabel(p) {
    if (!p) return "";
    if (p.id === "custom") return t("dash_provider_custom");
    return p.label;
  }

  function connectedText() {
    const l = state.backend?.lookup ?? {};
    if (l.kind === "server") return t("welcome_connected_server");
    if (l.provider === "openrouter") return t("welcome_connected_openrouter");
    return t("welcome_connected", { provider: providerLabel(preset(l.provider)) || l.provider });
  }

  function renderAi() {
    const showLine = !state.changing && ((ready() && state.check?.status !== "bad" && state.check?.status !== "busy") || state.aiSkipped);
    $("aiConnected").hidden = !showLine;
    $("aiSetup").hidden = showLine;
    if (showLine) {
      const ok = ready() && !state.aiSkipped;
      $("aiConnected").querySelector(".icon")?.toggleAttribute("hidden", !ok);
      $("aiConnectedText").textContent = ok ? connectedText() : t("welcome_ai_skipped", { example: wd("no_ai_example", "welcome_no_ai_example") });
    }
    for (const [panel, btn] of [["paste", "aiPaste"], ["other", "aiOther"], ["server", "aiServer"]]) {
      $(`${panel}Panel`).hidden = state.panel !== panel;
      $(btn).setAttribute("aria-expanded", String(state.panel === panel));
    }
    renderOther();
    for (const panel of ["connect", "paste", "other", "server"]) renderStatus(panel);
    renderAskExtras();
  }

  function renderStatus(panel) {
    const box = $(`${panel}Status`);
    const c = state.check?.panel === panel ? state.check : null;
    box.className = `status${c ? ` status-${c.status}` : ""}`;
    if (!c) return box.replaceChildren();
    const glyph = c.status === "ok" ? icon("success", 18) : c.status === "bad" ? icon("error", 18) : null;
    box.replaceChildren(...[glyph, el("span", {}, c.text)].filter(Boolean));
  }

  function openPanel(panel) {
    state.panel = state.panel === panel ? null : panel;
    renderAi();
    if (state.panel === "paste") $("pasteKey").focus();
    if (state.panel === "other") $("providerOptions").querySelector('[tabindex="0"]')?.focus();
    if (state.panel === "server") $("serverUrl").focus();
  }

  async function refreshBackend() {
    const b = await call({ type: "backend.get" });
    if (!failed(b)) state.backend = b;
  }

  // Checks whoever now looks words up (one tiny lookup, 11's Test) and shows the result.
  async function checkLookups(panel) {
    state.check = { status: "busy", panel, text: t("welcome_ai_checking") };
    renderAi();
    await refreshBackend();
    const r = await call({ type: "backend.test" });
    await refreshBackend();
    if (!failed(r) && r.ok) {
      state.check = { status: "ok", panel, text: connectedText() };
      state.changing = false;
      state.panel = null;
      renderAi();
      announce(connectedText());
      retryPending();
      return true;
    }
    const code = r?.error?.code ?? codeOf(r);
    state.check = { status: "bad", panel, text: problemText(code, r?.error?.details ?? detailsOf(r)) };
    renderAi();
    announce(state.check.text);
    // The key stays saved: an offline learner can finish, and Kotiko checks again on use.
    retryPending();
    return false;
  }

  // Connect OpenRouter (11 §4): the background keeps the PKCE verifier and opens OpenRouter's
  // sign-in in a new tab. OpenRouter returns to kotiko.org/connect/, whose content script
  // hands the code to the background; this page learns the key arrived when `lookup` and
  // `keys` change (onStorage). Until then it says it's waiting, and every other way to
  // connect still works. Selecting it again starts a new sign-in.
  async function connectOpenRouter() {
    state.panel = null;
    const res = await call({ type: "oauth.start" });
    state.check = failed(res) ? { status: "bad", panel: "connect", text: problemText(codeOf(res), detailsOf(res)) } : { status: "busy", panel: "connect", text: t("welcome_ai_waiting") };
    renderAi();
    announce(state.check.text);
  }

  // The sign-in finished on the other tab: OpenRouter now looks words up.
  function connectArrived() {
    if (state.check?.panel !== "connect" || state.check.status !== "busy") return;
    if (!ready() || state.backend?.lookup?.provider !== "openrouter") return;
    state.check = { status: "ok", panel: "connect", text: connectedText() };
    state.changing = false;
    announce(connectedText());
  }

  // Saves a pasted key for a provider (11 §3: the background keeps it; this page never sees
  // it again), makes that provider the one that looks words up, and checks it.
  async function saveKey(providerId, value, panel) {
    const key = String(value ?? "").trim();
    if (!key) return;
    const res = await call({ type: "secrets.set", id: `provider:${providerId}`, value: key });
    const field = panel === "paste" ? $("pasteKey") : $("otherKey");
    if (!failed(res) && res.masked) field.placeholder = t("dash_key_saved_as", { masked: res.masked });
    if (failed(res)) {
      state.check = { status: "bad", panel, text: t("dash_key_placeholder") };
      return renderAi();
    }
    await call({ type: "backend.set", lookup: { kind: "provider", provider: providerId, baseUrl: providerId === "openrouter" ? null : state.backend?.lookup?.provider === providerId ? state.backend.lookup.baseUrl ?? null : null, model: null } });
    await checkLookups(panel);
  }

  function bindKeyField(input, save) {
    let last = "";
    const commit = () => {
      const v = input.value.trim();
      if (!v || v === last) return;
      last = v;
      input.value = "";
      save(v);
    };
    // Pasting saves at once: no Save button (22 §4).
    input.addEventListener("paste", () => setTimeout(commit, 0));
    input.addEventListener("change", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      }
    });
  }

  function renderOther() {
    const list = presets().filter((p) => p.id !== "openrouter");
    const box = $("providerOptions");
    const current = state.other;
    const focused = box.contains(document.activeElement);
    const items = list.map((p) => el("button", {
      class: "radio",
      type: "button",
      role: "radio",
      "aria-checked": String(p.id === current),
      tabindex: p.id === (current ?? list[0]?.id) ? "0" : "-1",
      "data-value": p.id,
      onclick: () => pickOther(p.id),
    }, el("span", { class: "radio-dot", "aria-hidden": "true" }), el("span", {}, p.beta ? t("dash_provider_beta", { name: providerLabel(p) }) : providerLabel(p))));
    box.replaceChildren(...items);
    box.onkeydown = (e) => {
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      const fwd = e.key === "ArrowDown" || e.key === "ArrowRight";
      const back = e.key === "ArrowUp" || e.key === "ArrowLeft";
      if (!fwd && !back) return;
      e.preventDefault();
      pickOther(items[(i + (fwd ? 1 : -1) + items.length) % items.length].dataset.value);
    };
    if (focused) items.find((b) => b.getAttribute("aria-checked") === "true")?.focus();
    const p = preset(current);
    $("otherFields").hidden = !p;
    if (!p) return;
    $("otherUrlField").hidden = !(p.local || p.id === "custom");
    const url = $("otherUrl");
    if (document.activeElement !== url && !url.dataset.dirty) url.value = (state.backend?.lookup?.provider === p.id ? state.backend.lookup.baseUrl : null) ?? p.baseUrl ?? "";
    url.placeholder = p.baseUrl ?? "https://…/v1";
    $("otherKeyField").hidden = !(p.keyRequired || p.id === "custom");
    $("otherKeyLabel").textContent = p.id === "custom" ? t("dash_key_label_custom") : t("dash_key_label", { provider: providerLabel(p) });
    $("otherNote").textContent = t(NOTES[p.id] ?? "dash_note_custom");
  }

  async function pickOther(id) {
    state.other = id;
    $("otherUrl").dataset.dirty = "";
    renderAi();
    const p = preset(id);
    // A model on this computer needs no key: it is checked as soon as it is picked.
    if (p && p.local && !p.keyRequired) {
      await call({ type: "backend.set", lookup: { kind: "provider", provider: id, baseUrl: null, model: null } });
      await checkLookups("other");
    }
  }

  async function saveOtherUrl() {
    const p = preset(state.other);
    const input = $("otherUrl");
    input.dataset.dirty = "";
    if (!p) return;
    const value = input.value.trim();
    if (!value) return;
    const res = await call({ type: "backend.set", lookup: { kind: "provider", provider: p.id, baseUrl: value === p.baseUrl ? null : value, model: null } });
    if (failed(res)) {
      state.check = { status: "bad", panel: "other", text: t("error_server_address_invalid") };
      return renderAi();
    }
    if (!p.keyRequired || state.backend?.keys?.providers?.[p.id]) await checkLookups("other");
    else await refreshBackend();
  }

  async function connectServer(e) {
    e?.preventDefault();
    const url = $("serverUrl").value.trim();
    const token = $("serverKey").value.trim();
    if (!token) return $("serverKey").focus();
    state.check = { status: "busy", panel: "server", text: t("welcome_ai_checking") };
    renderAi();
    const res = await call({ type: "server.connect", url: url || "http://localhost:4747", token });
    $("serverKey").value = "";
    await refreshBackend();
    const problem = failed(res) ? res : res.sync?.code ? res.sync : null;
    if (problem) {
      state.check = { status: "bad", panel: "server", text: Errors.message(problem) };
      renderAi();
      return announce(state.check.text);
    }
    state.check = { status: "ok", panel: "server", text: t("welcome_connected_server") };
    state.changing = false;
    state.panel = null;
    renderAi();
    announce(t("welcome_connected_server"));
    retryPending();
  }

  // ---------------------------------------------------------------------------------
  // 4. Ask (§5).

  function renderAskExtras() {
    const hello = wd("hello", "welcome_hello_word");
    $("tryHello").textContent = t("welcome_try_hello", { hello });
    $("noAiHint").textContent = t("welcome_no_ai_hint", { example: wd("no_ai_example", "welcome_no_ai_example") });
    $("noAiHint").hidden = ready();
    $("askLine").textContent = t(state.hadWords ? "welcome_reopened_ask" : "welcome_ask");
    $("askSub").hidden = state.hadWords;
  }

  // "Try “hello”" only fills the box: the start of the question, caret at the end.
  function tryHello() {
    const box = $("askText");
    box.value = wd("ask_prefix", "welcome_ask_prefix");
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }

  function cyclePlaceholder() {
    const box = $("askText");
    box.placeholder = t(`welcome_placeholder_${state.placeholder}`);
    if (reduced()) return;
    state.timer = setInterval(() => {
      state.placeholder = (state.placeholder % 4) + 1;
      box.placeholder = t(`welcome_placeholder_${state.placeholder}`);
    }, PLACEHOLDER_MS);
  }

  function setResult(text, { announceIt = true } = {}) {
    $("turnResult").hidden = !text;
    $("resultLine").textContent = text ?? "";
    if (announceIt) announce(text);
  }

  function clearCard() {
    $("cardSlot").replaceChildren();
    $("meaningForm").hidden = true;
  }

  function onAsk(e) {
    e.preventDefault();
    const text = $("askText").value.trim();
    if (!text) return;
    $("askText").value = "";
    submit(text);
  }

  function submit(text, { keepBox = false } = {}) {
    const entry = M.parseEntry(text, { bases: state.bases, Lang, Local, spec: SPEC });
    if (!keepBox) $("askText").value = "";
    state.ask = { ...idleAsk(), token: state.ask.token + 1, text, hint: entry.hint ?? null };
    if (entry.kind === "empty") return;
    if (entry.kind === "manual") {
      const parsed = Local.parseManual(M.prefixOf(text, Lang).rest);
      return showManual(parsed, entry.word.lang, text);
    }
    if (entry.kind === "which") return showWhich(entry);
    if (!ready()) return showNoAi(text);
    return lookup(text, entry.hint);
  }

  async function lookup(text, hint) {
    const token = ++state.ask.token;
    Object.assign(state.ask, { phase: "looking", text, hint, groups: [], manual: null, entry: null });
    clearCard();
    setResult(t("welcome_looking_up", { text }));
    const msg = { type: "words.preview", text, base_langs: state.bases.slice(0, 4) };
    if (hint) msg.hint_lang = hint;
    const res = await call(msg);
    if (token !== state.ask.token) return; // a newer entry replaced this one
    if (failed(res)) return lookupFailed(text, codeOf(res), detailsOf(res));
    const groups = M.groupCandidates(res.candidates);
    if (!groups.length) return lookupFailed(text, res.code ?? "no_word_found", {});
    Object.assign(state.ask, { phase: groups.length > 1 ? "choices" : "card", groups, chosen: 0 });
    setResult(t(groups.length > 1 ? "welcome_several" : "welcome_one_result"));
    renderCard();
  }

  function problemText(code, details) {
    if (code === "key_rejected" && state.backend?.lookup?.kind !== "server") {
      const p = preset(details?.provider ?? state.backend?.lookup?.provider);
      return t("welcome_key_rejected", { provider: p ? providerLabel(p) : LookupStatus.providerName(details?.provider) ?? "OpenRouter" });
    }
    if (code === "offline" || (code === "server_unreachable" && details?.reason === "network" && !navigator.onLine)) return t("welcome_error_offline");
    return Errors.message({ code, details }, { local: state.backend?.lookup?.kind !== "server" });
  }

  function lookupFailed(text, code, details) {
    if (code === "lookup_not_set_up") return showNoAi(text);
    state.ask.phase = "failed";
    clearCard();
    let line;
    if (code === "no_word_found") line = t("welcome_no_word_found", { example: wd("example_question", "welcome_example_question"), meaning: wd("no_ai_example", "welcome_no_ai_example") });
    else if (code === "rejected_same_as_gloss") line = t("welcome_same_as_gloss", { base: nameOf(primary()), example: wd("example_other_language", "welcome_example_other_language") });
    else if (!navigator.onLine) line = t("welcome_error_offline");
    else line = problemText(code, details);
    setResult(`${line} ${t("welcome_or_meaning")}`);
    showMeaningForm(text);
  }

  // E: a word or question with no AI connected.
  function showNoAi(text) {
    Object.assign(state.ask, { phase: "noai", text });
    clearCard();
    setResult(t("welcome_no_ai_word", { text }));
    showMeaningForm(text);
  }

  function showMeaningForm(text) {
    const form = $("meaningForm");
    form.hidden = false;
    $("meaningWord").textContent = text;
    const input = $("meaningText");
    input.value = "";
    input.placeholder = t("welcome_meaning_placeholder", { base: nameOf(primary()) });
    input.setAttribute("aria-label", t("welcome_meaning_label", { text }));
    input.lang = primary();
  }

  function onMeaning(e) {
    e.preventDefault();
    const meaning = $("meaningText").value.trim();
    if (!meaning) return $("meaningText").focus();
    const word = state.ask.text;
    submit(`${word} = ${meaning}`, { keepBox: true });
  }

  // Connecting after asking looks the word up with no retyping (24's waiting rule).
  function retryPending() {
    if (state.ask.phase === "noai" && ready()) lookup(state.ask.text, state.ask.hint);
  }

  // A "native = meaning" word built here, in the chosen meaning base.
  function showManual(parsed, lang, text) {
    const base = state.ask.meaningBase && state.bases.includes(state.ask.meaningBase) && !Lang.sameBase(lang, state.ask.meaningBase) ? state.ask.meaningBase : state.bases.find((b) => !Lang.sameBase(lang, b)) ?? primary();
    const word = Local.manualWord(parsed, { lang, base, text });
    if (!word) return showNoAi(text);
    Object.assign(state.ask, { phase: "card", text, manual: { parsed, lang }, groups: [{ lang: word.lang, native: word.native, records: [word] }], chosen: 0, meaningBase: base });
    setResult(t("welcome_one_result"));
    renderCard();
  }

  // D: which language is this?
  function showWhich(entry) {
    Object.assign(state.ask, { phase: "which", entry, picked: null });
    setResult(null, { announceIt: false });
    $("turnResult").hidden = true;
    renderWhich();
  }

  // ---------------------------------------------------------------------------------
  // The word card (C, C2, D).

  function pronunciationNode(words, cls) {
    const node = el("span", { class: cls, "aria-hidden": "true" });
    words.forEach((syls, wi) => {
      if (wi) node.append(" ");
      syls.forEach((s, si) => {
        if (si) node.append("-");
        node.append(s.stressed ? el("strong", {}, s.text) : s.text);
        if (s.tone) node.append(el("sup", {}, String(s.tone)));
      });
    });
    return node;
  }

  function pronA11y(words) {
    const a = Card.pronunciationA11y(words, (n) => t("popover_tone", { n }));
    if (!a) return "";
    return a.stressed.length ? t("popover_pron_a11y", { pronunciation: a.plain, syllable: a.stressed.join(", ") }) : t("popover_pron_a11y_plain", { pronunciation: a.plain });
  }

  function speakButton(rec) {
    const btn = el("button", { class: "btn btn-icon speak", type: "button", hidden: true, "aria-label": t("speak_label", { word: rec.native, lang: nameOf(rec.lang) }), title: t("speak_label", { word: rec.native, lang: nameOf(rec.lang) }), onclick: () => Speak.say(rec).catch?.(() => {}) }, icon("speaker", 20));
    Promise.resolve(Speak.canSpeak(rec.lang)).then((ok) => {
      btn.hidden = !ok;
    }, () => {});
    return btn;
  }

  // The popover's pronunciation block (19 §1a) for one word, then its meanings.
  function wordDetails(group, { withHead = true, withMeanings = true } = {}) {
    const rec = M.recordFor(group, primary());
    const c = Card.cardFor(rec);
    const out = [];
    const a11y = [c.headword];
    if (withHead) out.push(el("div", { class: "wcard-head" }, bdi(c.headword, rec.lang, "wcard-word"), speakButton(rec)));
    if (c.pronunciation) {
      out.push(el("p", { class: "wcard-pron" }, pronunciationNode(c.pronunciation), el("span", { class: "sr-only" }, pronA11y(c.pronunciation))));
      a11y.push(pronA11y(c.pronunciation));
    }
    if (c.careful) {
      const slow = I18n.parts("popover_careful", { pronunciation: pronunciationNode(c.careful) });
      out.push(el("p", { class: "wcard-slow" }, slow));
    }
    const label = c.label?.kind === "ai" ? t("popover_pron_ai") : null;
    if (c.romanization || label) {
      out.push(el("p", { class: "wcard-rom" }, c.romanization ? bdi(c.romanization, c.romanizationLang) : null, c.romanization && label ? " · " : null, label));
    }
    const records = state.bases.map((b) => group.records.find((r) => r.base_lang === b)).filter(Boolean);
    const shown = records.length ? records : [rec];
    const langName = nameOf(rec.lang);
    const lines = shown.length > 1
      ? [...shown.map((r) => el("li", {}, I18n.parts("welcome_meaning_on_pages", { gloss: bdi(r.gloss, r.base_lang), base: nameOf(r.base_lang) }))), el("li", { class: "lang-name" }, langName)]
      : [el("li", {}, bdi(shown[0].gloss, shown[0].base_lang), el("span", { class: "lang-name" }, ` · ${langName}`))];
    if (withMeanings) out.push(el("ul", { class: "wcard-meaning" }, lines));
    a11y.push(...shown.map((r) => r.gloss), langName);
    return { nodes: out, a11y: a11y.filter(Boolean).join(", "), rec };
  }

  function actions({ disabled = false, label = null } = {}) {
    return el("div", { class: "wcard-actions" },
      el("button", { class: "btn btn-primary", id: "confirm", type: "button", "aria-disabled": disabled ? "true" : null, onclick: () => !disabled && confirm() }, label ?? t(state.hadWords ? "welcome_confirm_next" : "welcome_confirm")),
      el("button", { class: "link link-quiet", id: "tryAnother", type: "button", onclick: tryAnother }, t("welcome_try_another")));
  }

  function meaningInChoice() {
    const m = state.ask.manual;
    const options = state.bases.filter((b) => !Lang.sameBase(m.lang, b));
    if (options.length < 2) return null;
    const select = el("select", { id: "meaningIn", onchange: (e) => {
      state.ask.meaningBase = e.target.value;
      showManual(m.parsed, m.lang, state.ask.text);
    } }, options.map((b) => el("option", { value: b, selected: b === state.ask.meaningBase ? true : null }, nameOf(b))));
    return el("label", { class: "wcard-meaning-in" }, t("welcome_meaning_in"), select);
  }

  function renderCard() {
    const a = state.ask;
    const slot = $("cardSlot");
    if (a.phase === "choices") {
      const legend = el("legend", { class: "sr-only" }, t("welcome_several"));
      const radios = a.groups.map((g, i) => {
        const rec = M.recordFor(g, primary());
        const c = Card.cardFor(rec);
        return el("label", { class: "choice" },
          el("input", { type: "radio", name: "choice", value: String(i), checked: i === a.chosen ? true : null, onchange: () => {
            a.chosen = i;
            renderDetail();
          } }),
          el("span", { class: "choice-text" }, bdi(c.headword, rec.lang, "choice-word"), c.romanization ? bdi(c.romanization, c.romanizationLang, "choice-meta") : null, el("span", { class: "choice-meta" }, `${rec.gloss} · ${nameOf(rec.lang)}`)));
      });
      const detail = el("div", { class: "choice-detail", id: "choiceDetail" });
      const card = el("section", { class: "wcard", tabindex: "-1", "aria-label": t("welcome_several") }, el("fieldset", { class: "choices" }, legend, radios), detail, actions());
      slot.replaceChildren(card);
      renderDetail();
      card.focus();
      return;
    }
    const g = a.groups[a.chosen];
    const d = wordDetails(g);
    const card = el("section", { class: "wcard", id: "wordCard", tabindex: "-1", "aria-label": d.a11y }, d.nodes, a.manual ? meaningInChoice() : null, actions());
    slot.replaceChildren(card);
    card.focus();
  }

  // Under the radio group: the chosen word's pronunciation, label and speak button.
  function renderDetail() {
    const a = state.ask;
    const box = $("choiceDetail");
    if (!box) return;
    const d = wordDetails(a.groups[a.chosen], { withHead: false, withMeanings: false });
    const speak = speakButton(d.rec);
    box.replaceChildren(el("div", { class: "choice-pron" }, el("div", {}, ...d.nodes), speak));
  }

  function renderWhich() {
    const a = state.ask;
    const entry = a.entry;
    const chips = M.languageChips(entry, { Lang });
    const pick = (tag) => {
      const word = M.manualFor(entry, tag, { Lang, Local });
      if (!word) return;
      a.picked = tag;
      showManual(entry.parsed, word.lang, entry.text);
    };
    const searchInput = el("input", { class: "field", id: "whichSearch", type: "text", role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": "whichList", autocomplete: "off", spellcheck: "false", placeholder: t("welcome_bases_search"), "aria-label": t("welcome_bases_search") });
    const list = el("ul", { class: "lang-options", id: "whichList", role: "listbox", "aria-label": t("welcome_bases_search") });
    const card = el("section", { class: "wcard", id: "wordCard", tabindex: "-1", "aria-label": `${entry.parsed.native}, ${entry.parsed.gloss}, ${t("welcome_which_language")}` },
      el("div", { class: "wcard-head" }, bdi(entry.parsed.native, null, "wcard-word")),
      el("ul", { class: "wcard-meaning" }, el("li", {}, bdi(entry.parsed.gloss, entry.base), el("span", { class: "lang-name" }, ` · ${t("welcome_which_language")}`))),
      el("div", { class: "lang-chips", role: "group", "aria-label": t("welcome_which_language") }, chips.map((tag) => el("button", { class: "chip pick-chip", type: "button", lang: tag, "aria-pressed": "false", "aria-label": chipLabel(tag).a11y, onclick: () => pick(tag) }, endonymOf(tag)))),
      el("div", { class: "lang-search" }, searchInput, list),
      actions({ disabled: true, label: t("welcome_choose_language_first") }));
    $("cardSlot").replaceChildren(card);
    bindSearch(searchInput, list, { exclude: () => state.bases.filter((b) => b === entry.base), onPick: pick, onClose: () => searchInput.blur() });
    card.focus();
  }

  function tryAnother() {
    const text = state.ask.text;
    state.ask = { ...idleAsk(), token: state.ask.token + 1 };
    clearCard();
    setResult(null, { announceIt: false });
    const box = $("askText");
    box.value = text;
    box.focus();
    box.setSelectionRange(text.length, text.length);
  }

  // ---------------------------------------------------------------------------------
  // 6. Make it my first word, 7. the celebration, 8. the preview.

  async function confirm() {
    const a = state.ask;
    if (state.saving || !(a.phase === "card" || a.phase === "choices")) return;
    const group = a.groups[a.chosen];
    const words = group.records.map((r) => {
      const w = { ...r };
      delete w.language;
      return w;
    });
    state.saving = true;
    const first = !state.hadWords;
    $("confirm")?.setAttribute("aria-disabled", "true");
    const res = await call({ type: "words.save", words, client_request_id: uuid(), clientId: "welcome" });
    const results = !failed(res) && Array.isArray(res.results) ? res.results : [];
    if (!results.length) {
      state.saving = false;
      $("confirm")?.removeAttribute("aria-disabled");
      return setResult(t("welcome_save_failed"));
    }
    const saved = results.map((r) => r.word).filter((w) => w && w.native);
    state.saved = saved.length ? saved : words;
    state.hadWords = true;
    await finishOnboarding(false);
    let claim = { claimed: false, celebrate: false };
    if (first) claim = await call({ type: "celebrations.claim", key: "vocab:first" });
    state.saving = false;
    showDone({ celebrate: first && claim?.claimed === true, confetti: claim?.celebrate === true && state.prefs.celebrations !== false });
  }

  async function finishOnboarding(skipped) {
    const { onboarding } = await ext.storage.local.get({ onboarding: null });
    state.ui = { uiLang: "auto", ...state.ui, baseLangs: state.bases.slice(), baseLangsDetected: state.detected, baseLangsConfirmed: true };
    const done = !onboarding?.completedAt || skipped ? { merge: { onboarding: { completedAt: Date.now(), skipped: !!skipped, version: 2 } } } : { merge: {} };
    await saveSettings({ ...done, merge: { ...done.merge, ui: { uiLang: state.ui.uiLang, baseLangs: state.bases.slice(), baseLangsDetected: state.detected.slice(), baseLangsConfirmed: true } } }).catch(() => {});
  }

  function miniCard(rec) {
    const c = Card.cardFor(rec);
    return [
      el("div", { class: "mini-head" }, bdi(c.headword, rec.lang, "mini-word"), c.pronunciation ? pronunciationNode(c.pronunciation, "mini-pron") : null, speakButton(rec)),
      el("p", { class: "mini-meaning" }, bdi(rec.gloss, rec.base_lang), ` · ${nameOf(rec.lang)}`),
    ];
  }

  function showDone({ celebrate, confetti }) {
    const saved = state.saved;
    const rec = saved.find((r) => r.base_lang === primary()) ?? saved[0];
    state.ask = { ...idleAsk(), token: state.ask.token + 1 };
    clearCard();
    setResult(null, { announceIt: false });
    renderAskExtras();
    const done = $("done");
    done.hidden = false;
    // The ask step steps aside so the moment is the word's; Add another word brings it back.
    $("turnAsk").hidden = true;
    $("turnCelebrate").hidden = !celebrate;
    if (celebrate) {
      $("celebrateLine").textContent = t("welcome_celebration");
      $("miniCard").replaceChildren(...miniCard(rec));
      $("celebrationsOff").hidden = state.prefs.celebrations === false;
      $("celebrationsOffDone").hidden = true;
      announce(t("welcome_celebration"));
    }
    renderPreviews();
    renderNext(rec);
    // Motion allowed: confetti; otherwise (or with celebrations off) the message fades in.
    done.classList.remove("fade-in");
    if (celebrate && confetti && !reduced()) {
      state.confetti = Confetti.burst({ host: document.body });
    } else {
      void done.offsetWidth;
      done.classList.add("fade-in");
    }
    $("tryPage").focus({ preventScroll: true });
    done.scrollIntoView?.({ block: "start", behavior: reduced() ? "auto" : "smooth" });
  }

  const previewInfo = new WeakMap();

  function afterLine(parts, base) {
    const p = el("p", { class: "preview-after", lang: base, dir: "auto" });
    for (const part of parts) {
      if (part.native === undefined) {
        p.append(part.text);
        continue;
      }
      const w = el("kotiko-w", { lang: part.word.lang, dir: "auto", translate: "no", class: `notranslate${reduced() ? "" : " swap-in"}` }, part.native);
      previewInfo.set(w, { surface: part.surface, word: part.word, all: part.all, others: state.saved.filter((r) => r.base_lang !== part.word.base_lang) });
      p.append(w);
    }
    return p;
  }

  function renderPreviews() {
    const box = $("previews");
    const bases = state.bases.filter((b) => state.saved.some((r) => r.base_lang === b)).slice(0, 2);
    const figures = bases.map((base) => {
      const pv = M.pickPreview(state.saved, base, { spec: SPEC, Matcher });
      if (!pv) return null;
      const before = el("p", { class: "preview-before", lang: base, dir: "auto" }, pv.before);
      let after = afterLine(pv.parts, base);
      const edit = el("button", { class: "link link-quiet", type: "button" }, t("welcome_preview_edit"));
      let field = null;
      edit.addEventListener("click", () => {
        if (field) {
          before.textContent = field.value;
          field.replaceWith(before);
          field = null;
          edit.textContent = t("welcome_preview_edit");
          return;
        }
        field = el("input", { class: "field preview-field", type: "text", lang: base, dir: "auto", spellcheck: "false", "aria-label": t("welcome_preview_field", { base: nameOf(base) }) });
        field.value = before.textContent;
        let frame = 0;
        field.addEventListener("input", () => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            const next = afterLine(M.previewText(state.saved, base, field.value, { Matcher }), base);
            next.querySelectorAll("kotiko-w").forEach((w) => w.classList.remove("swap-in"));
            after.replaceWith(next);
            after = next;
          });
        });
        before.replaceWith(field);
        edit.textContent = t("welcome_preview_done");
        field.focus();
      });
      return el("figure", { class: "preview", "data-base": base }, el("figcaption", {}, el("span", {}, nameOf(base) && bases.length > 1 ? `${t("welcome_preview_caption")} · ${nameOf(base)}` : t("welcome_preview_caption")), edit), before, after);
    });
    box.replaceChildren(...figures.filter(Boolean));
    state.popover ??= globalThis.KotikoPopover?.createPopover({ infoFor: (el2) => previewInfo.get(el2) ?? null, reduceMotion: () => document.documentElement.dataset.motion === "reduce" });
    try {
      state.popover?.install();
    } catch {
      // the popover needs a real browser; the preview still reads
    }
  }

  function renderNext(rec) {
    const form = M.formTexts(rec)[0] ?? rec.gloss;
    const bases = [...new Set(state.saved.map((r) => r.base_lang))].filter((b) => state.bases.includes(b));
    $("whatsNext").replaceChildren(...I18n.parts("welcome_whats_next", { native: bdi(rec.native, rec.lang), base: listOf(bases.map(nameOf)), form }));
    $("tryPage").href = M.wikipediaUrl(rec.base_lang, form);
    $("tryPageDesc").textContent = t("welcome_try_page_desc", { form });
    const firefox = /firefox/i.test(navigator.userAgent);
    $("pinTip").textContent = t(firefox ? "welcome_pin_firefox" : "welcome_pin_chrome");
    $("noAiLater").hidden = ready();
  }

  async function celebrationsOff() {
    state.confetti?.stop();
    state.prefs = { ...state.prefs, celebrations: false };
    await saveSettings({ merge: { prefs: { celebrations: false } } }).catch(() => {});
    $("celebrationsOff").hidden = true;
    $("celebrationsOffDone").hidden = false;
    announce(t("celebrations_off_done"));
  }

  function addAnother() {
    state.confetti?.stop();
    $("done").hidden = true;
    $("turnAsk").hidden = false;
    renderAskExtras();
    $("askText").focus();
    $("turnAsk").scrollIntoView?.({ block: "center" });
  }

  async function openTab(url) {
    await Promise.resolve(ext.tabs?.create?.({ url })).catch(() => {});
  }

  // ---------------------------------------------------------------------------------
  // Skip, permission, wiring.

  async function skip() {
    await finishOnboarding(true);
    try {
      const tab = await ext.tabs.getCurrent();
      if (tab?.id !== undefined) return void (await ext.tabs.remove(tab.id));
    } catch {
      // not in a tab (tests)
    }
    window.close();
  }

  async function checkPermission() {
    try {
      if (!ext.permissions?.contains) return;
      const ok = await ext.permissions.contains({ origins: ["<all_urls>"] });
      $("permission").hidden = ok;
    } catch {
      // no permissions API: Chrome grants host access at install
    }
  }

  async function allow() {
    let granted;
    try {
      granted = await ext.permissions.request({ origins: ["<all_urls>"] });
    } catch {
      granted = false;
    }
    if (granted) $("permission").hidden = true;
    else $("permissionText").textContent = t("welcome_permission_declined");
  }

  function onStorage(changes, area) {
    if (area === "local") {
      if (changes.prefs) state.prefs = changes.prefs.newValue ?? {};
      if (changes.lookup || changes.keys || changes.wordsHome || changes.server) {
        refreshBackend().then(() => {
          connectArrived();
          renderAi();
          retryPending();
        });
      }
      if (changes.words && !state.saving && !state.saved) {
        const had = Array.isArray(changes.words.newValue) && changes.words.newValue.length > 0;
        if (had !== state.hadWords) {
          state.hadWords = had;
          renderAskExtras();
        }
      }
    }
  }

  async function loadBases(local) {
    // The background's copy of storage.sync's `ui` (SCR-448).
    const { ui } = await ext.storage.local.get({ ui: {} });
    state.ui = ui && typeof ui === "object" ? ui : {};
    let bases = Array.isArray(ui.baseLangs) && ui.baseLangs.length ? ui.baseLangs : Array.isArray(local.baseLangs) && local.baseLangs.length ? local.baseLangs : null;
    let detected = Array.isArray(ui.baseLangsDetected) && ui.baseLangsDetected.length ? ui.baseLangsDetected : null;
    if (!bases || !detected) {
      let accept;
      try {
        accept = (await ext.i18n?.getAcceptLanguages?.()) ?? [];
      } catch {
        accept = [];
      }
      if (!accept.length) accept = [...(navigator.languages ?? [])];
      let uiLang;
      try {
        uiLang = ext.i18n?.getUILanguage?.() ?? navigator.language ?? "en";
      } catch {
        uiLang = "en";
      }
      const found = M.detectBases({ uiLanguage: uiLang, acceptLanguages: accept, Lang });
      detected ??= found;
      bases ??= found;
    }
    state.bases = bases.slice(0, M.MAX_BASES);
    state.detected = detected.slice(0, M.MAX_DETECTED);
    state.chips = [...new Set([...state.detected, ...state.bases])];
  }

  async function init() {
    await I18n.loadPreference();
    I18n.apply(document);
    Icons.hydrate(document);
    document.title = t("welcome_title");
    const local = await ext.storage.local.get({ words: [], prefs: {}, speech: null, baseLangs: null, onboarding: null });
    state.prefs = local.prefs ?? {};
    state.hadWords = Array.isArray(local.words) && local.words.length > 0;
    Speak.configure?.({ ...Speak.DEFAULTS, ...(local.speech && typeof local.speech === "object" ? local.speech : {}) });
    await loadBases(local);
    await refreshBackend();
    if (!state.hadWords) {
      // Words kept on a server, or in the store before the projection caught up.
      const res = await call({ type: "words.list" });
      if (!failed(res) && Array.isArray(res.words) && res.words.length) state.hadWords = true;
    }
    await checkPermission();

    baseSearch = bindSearch($("baseSearchField"), $("baseSearchList"), {
      exclude: () => state.chips,
      onPick: (tag) => {
        closeBaseSearch();
        toggleBase(tag, true);
      },
      onClose: closeBaseSearch,
    });
    $("skip").addEventListener("click", skip);
    $("allow").addEventListener("click", allow);
    $("aiConnect").addEventListener("click", connectOpenRouter);
    $("aiPaste").addEventListener("click", () => openPanel("paste"));
    $("aiOther").addEventListener("click", () => openPanel("other"));
    $("aiServer").addEventListener("click", () => openPanel("server"));
    $("aiSkip").addEventListener("click", () => {
      state.aiSkipped = true;
      state.changing = false;
      state.panel = null;
      renderAi();
      $("askText").focus();
    });
    $("aiChange").addEventListener("click", () => {
      state.changing = true;
      state.aiSkipped = false;
      state.check = null;
      renderAi();
      $("aiConnect").focus();
    });
    $("pasteShow").addEventListener("click", () => {
      const input = $("pasteKey");
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      $("pasteShow").setAttribute("aria-pressed", String(show));
      $("pasteShow").textContent = t(show ? "settings_hide_key" : "settings_show_key");
    });
    bindKeyField($("pasteKey"), (v) => saveKey("openrouter", v, "paste"));
    bindKeyField($("otherKey"), (v) => saveKey(state.other, v, "other"));
    $("otherUrl").addEventListener("input", () => ($("otherUrl").dataset.dirty = "1"));
    $("otherUrl").addEventListener("change", saveOtherUrl);
    $("otherUrl").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveOtherUrl();
      }
    });
    const getKey = preset("openrouter")?.keyUrl;
    if (getKey) $("getKey").href = getKey;
    $("serverPanel").addEventListener("submit", connectServer);
    $("serverUrl").value = state.backend?.server?.url ?? "";
    // Slice 28 §5: plain http:// beyond this computer or a Tailscale address says so.
    const warnHttp = () => ($("serverUrlWarn").hidden = !globalThis.ServerUrl?.sendsInClear($("serverUrl").value));
    $("serverUrl").addEventListener("input", warnHttp);
    warnHttp();
    $("askForm").addEventListener("submit", onAsk);
    $("tryHello").addEventListener("click", tryHello);
    $("meaningForm").addEventListener("submit", onMeaning);
    $("celebrationsOff").addEventListener("click", celebrationsOff);
    $("addAnother").addEventListener("click", addAnother);
    $("openWords").addEventListener("click", () => Promise.resolve(ext.runtime.openOptionsPage?.()).catch(() => openTab(ext.runtime.getURL("dashboard.html"))));
    $("addList").addEventListener("click", () => openTab(ext.runtime.getURL("dashboard.html#add")));
    ext.storage.onChanged.addListener(onStorage);
    addEventListener("pagehide", () => clearInterval(state.timer));

    renderBases();
    renderAi();
    renderAskExtras();
    cyclePlaceholder();
    $("main").dataset.ready = "true";
    $("askText").focus();
  }

  globalThis.KotikoWelcome = {
    state,
    stopTimers: () => clearInterval(state.timer),
    ready: init(),
  };
})();
