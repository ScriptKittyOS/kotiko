const ext = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  serverUrl: "http://localhost:4747",
  token: "",
  lang: "ru",
  enabled: true,
  pausedHosts: [],
  words: [],
  lastSync: null,
  syncError: null,
};

let host = null;

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

async function render() {
  const s = await ext.storage.local.get(DEFAULTS);
  $("lang").value = s.lang;
  $("enabled").checked = s.enabled;
  $("serverUrl").value = s.serverUrl;
  $("token").value = s.token;

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
    status.textContent = s.syncError;
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

async function init() {
  try {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && /^https?:/.test(tab.url)) host = new URL(tab.url).hostname;
  } catch {
    host = null;
  }

  $("lang").addEventListener("change", (e) => ext.storage.local.set({ lang: e.target.value }));
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
}

init();
