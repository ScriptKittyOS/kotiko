// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
// SPDX-License-Identifier: Apache-2.0

const ext = globalThis.browser ?? globalThis.chrome;
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
};

let host = null;
let names = null;

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

// The line shown for a sync error. `syncError` is {code, message, details} since slice 26;
// an older string value is shown as it is. (Slice 25 replaces this wording.)
function syncErrorText(err, serverUrl) {
  if (typeof err === "string") return err;
  const d = err.details ?? {};
  switch (err.code) {
    case "server_key_rejected":
      return d.reason === "no_token" ? "Paste your API token to connect." : "The server rejected that API token.";
    case "server_address_invalid":
      return d.hint ? `Check the server address. ${d.hint}` : "The server didn't accept this address. Check the server address.";
    case "server_unreachable":
      return d.reason === "timeout"
        ? `${serverUrl} didn't answer in time. Is the server running?`
        : `Can't reach ${serverUrl}. Is the server running?`;
    case "not_mira_server":
      return `${serverUrl} answered, but not with a word list. Check the server address.`;
    case "internal":
      return d.error || `The server answered ${d.status ?? "with an error"}.`;
    default:
      return err.message || "Sync failed.";
  }
}

// The line shown when adding or removing fails.
function messageErrorText(error) {
  if (typeof error === "string") return error;
  if (error?.code === "invalid_message") return "That's too long. Add a word or a short phrase.";
  return "The extension refused that request.";
}

function languageName(code, fallback) {
  if (fallback) return fallback;
  try {
    names ??= new Intl.DisplayNames(["en"], { type: "language" });
    return names.of(code);
  } catch {
    return code;
  }
}

// [{lang, name, count}] in the order you first see them: most words first.
function languages(words) {
  const by = new Map();
  for (const w of words) {
    const l = by.get(w.lang) ?? by.set(w.lang, { lang: w.lang, name: null, count: 0 }).get(w.lang);
    l.count++;
    l.name ??= w.language;
  }
  return [...by.values()]
    .map((l) => ({ ...l, name: languageName(l.lang, l.name) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function setHidden(hiddenLangs) {
  return ext.storage.local.set({ hiddenLangs: [...new Set(hiddenLangs)] });
}

function renderLangs(s) {
  const list = $("langs");
  const langs = languages(s.words);
  const hidden = new Set(s.hiddenLangs);
  list.replaceChildren();

  if (!langs.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No words yet. Add one above, in any language.";
    list.append(li);
  }

  for (const l of langs) {
    const li = document.createElement("li");
    const id = `lang-${l.lang}`;

    const box = document.createElement("input");
    box.type = "checkbox";
    box.id = id;
    box.checked = !hidden.has(l.lang);
    box.addEventListener("change", () =>
      setHidden(box.checked ? s.hiddenLangs.filter((x) => x !== l.lang) : [...s.hiddenLangs, l.lang]),
    );

    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = l.name;

    const n = document.createElement("span");
    n.className = "n";
    n.textContent = l.count;

    const only = document.createElement("button");
    only.className = "link";
    only.textContent = "only";
    only.title = `Show only ${l.name}`;
    only.addEventListener("click", () => setHidden(langs.map((x) => x.lang).filter((x) => x !== l.lang)));

    li.append(box, label, n, only);
    list.append(li);
  }

  // Forget hidden languages that no longer have words, so a language you remove and later
  // start again doesn't come back hidden. Only trust the word list after a good sync.
  const stale = s.hiddenLangs.filter((x) => !langs.some((l) => l.lang === x));
  if (stale.length && s.lastSync && !s.syncError) setHidden(s.hiddenLangs.filter((x) => !stale.includes(x)));

  $("showAll").hidden = !langs.some((l) => hidden.has(l.lang));
}

async function render() {
  const s = await ext.storage.local.get(DEFAULTS);
  $("enabled").checked = s.enabled;
  // Don't overwrite a connection field you're typing in when a sync lands.
  for (const k of ["serverUrl", "token"]) if (document.activeElement !== $(k)) $(k).value = s[k];
  renderLangs(s);

  const paused = $("paused");
  if (host) {
    paused.disabled = false;
    paused.checked = s.pausedHosts.includes(host);
    $("pausedLabel").textContent = `Pause on ${host}`;
  } else {
    paused.disabled = true;
    $("pausedLabel").textContent = "Pause on this site";
  }

  const status = $("status");
  status.className = "status";
  if (s.syncError) {
    status.textContent = syncErrorText(s.syncError, s.serverUrl);
    status.classList.add("err");
    if (!s.token) $("conn").open = true;
  } else if (s.lastSync) {
    const n = s.words.length;
    status.textContent = `${n} word${n === 1 ? "" : "s"} known, synced ${ago(s.lastSync)}`;
    status.classList.add("ok");
  } else {
    status.textContent = "Not synced yet.";
    $("conn").open = true;
  }
}

// "Added شكرا (shukran) = thanks · Arabic  undo"
function showAdded(res) {
  const out = $("added");
  out.className = "added";
  out.replaceChildren();

  if (res.error) {
    out.classList.add("err");
    out.textContent = messageErrorText(res.error);
    return;
  }
  if (!res.words?.length) {
    out.textContent = res.reply || "I couldn't find a word in that.";
    return;
  }

  out.append("Added ");
  res.words.forEach((w, i) => {
    if (i) out.append(", ");
    const native = document.createElement("bdi");
    native.className = "w";
    native.lang = w.lang;
    native.textContent = w.native;
    out.append(native);
    if (w.romanization) out.append(` (${w.romanization})`);
    out.append(` = ${w.english} · ${languageName(w.lang, w.language)}`);
  });
  out.append(" ");

  const undo = document.createElement("button");
  undo.className = "link";
  undo.textContent = "undo";
  undo.addEventListener("click", async () => {
    undo.disabled = true;
    for (const w of res.words) await ext.runtime.sendMessage({ type: "remove", id: w.id });
    out.textContent = "Removed.";
  });
  out.append(undo);
}

async function init() {
  try {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && /^https?:/.test(tab.url)) host = new URL(tab.url).hostname;
  } catch {
    host = null;
  }

  $("addForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("addText").value.trim();
    if (!text) return;
    const btn = $("addBtn");
    btn.disabled = true;
    btn.textContent = "…";
    $("added").className = "added";
    $("added").textContent = "Looking it up…";
    try {
      const res = await ext.runtime.sendMessage({ type: "add", text });
      showAdded(res ?? { error: "No answer from the extension. Try again." });
      if (!res?.error) $("addText").value = "";
    } finally {
      btn.disabled = false;
      btn.textContent = "Add";
      $("addText").focus();
    }
  });

  $("showAll").addEventListener("click", () => setHidden([]));
  $("enabled").addEventListener("change", (e) => ext.storage.local.set({ enabled: e.target.checked }));

  $("paused").addEventListener("change", async (e) => {
    const { pausedHosts } = await ext.storage.local.get({ pausedHosts: [] });
    const set = new Set(pausedHosts);
    e.target.checked ? set.add(host) : set.delete(host);
    ext.storage.local.set({ pausedHosts: [...set] });
  });

  $("save").addEventListener("click", async () => {
    await ext.storage.local.set({
      serverUrl: $("serverUrl").value.trim() || DEFAULTS.serverUrl,
      token: $("token").value.trim(),
    });
    $("status").textContent = "Connecting…";
  });

  $("syncNow").addEventListener("click", async () => {
    const btn = $("syncNow");
    btn.disabled = true;
    btn.textContent = "Syncing…";
    try {
      await ext.runtime.sendMessage({ type: "sync", force: true });
    } finally {
      btn.disabled = false;
      btn.textContent = "Sync now";
    }
  });

  ext.storage.onChanged.addListener((_c, area) => area === "local" && render());
  render();
  $("addText").focus();
}

init();
