// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
// SPDX-License-Identifier: Apache-2.0

// A fake `chrome` namespace with the parts the extension uses: storage (local, sync,
// session) with onChanged, runtime messaging with sender objects, alarms and tabs.
// Events fire asynchronously, as in browsers; `await fake.idle()` waits for them.
//
//   const fake = createFakeChrome({ local: { token: "t" } });
//   window.chrome = fake.chrome;
//   await fake.chrome.storage.local.set({ enabled: false });
//   await fake.idle();                     // onChanged listeners have run

// Values cross a JSON boundary in Chrome's storage, so copies come back, `undefined`
// values are dropped, and objects from another realm (a vm context) become plain objects
// of this one.
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function createEvent() {
  const listeners = [];
  return {
    listeners,
    addListener: (f) => void (listeners.includes(f) || listeners.push(f)),
    removeListener: (f) => {
      const i = listeners.indexOf(f);
      if (i >= 0) listeners.splice(i, 1);
    },
    hasListener: (f) => listeners.includes(f),
    hasListeners: () => listeners.length > 0,
    // Calls every listener synchronously and returns what each returned.
    dispatch: (...args) => [...listeners].map((f) => f(...args)),
  };
}

// A controllable clock. `clock.Date` is a Date whose `now()` and argument-less
// constructor read the fake time; pass it as `Date` to a vm context.
export function createClock(start = Date.UTC(2026, 9, 1, 12, 0, 0)) {
  let t = start;
  const clock = {
    now: () => t,
    set: (ms) => void (t = ms),
    advance: (ms) => void (t += ms),
  };
  clock.Date = class FakeDate extends Date {
    constructor(...args) {
      if (args.length) super(...args);
      else super(clock.now());
    }
    static now() {
      return clock.now();
    }
  };
  return clock;
}

export function createFakeChrome(options = {}) {
  const {
    local = {},
    sync = {},
    session = {},
    runtimeId = "fake-extension-id",
    sender = { id: runtimeId, url: "https://example.com/", tab: { id: 1, url: "https://example.com/" } },
    tabs = [{ id: 1, active: true, url: "https://example.com/" }],
    clock = createClock(),
    onSendMessage = null,
  } = options;

  const pending = new Set();
  // Runs `fn` on a later task, like browser event dispatch, and tracks it for idle().
  const later = (fn) => {
    const p = new Promise((resolve) => setTimeout(resolve, 0)).then(fn);
    pending.add(p);
    p.finally(() => pending.delete(p)).catch(() => {});
    return p;
  };

  const onChanged = createEvent();
  const calls = { set: [], remove: [], sendMessage: [], alarms: [] };

  function area(name, initial) {
    const data = clone(initial);
    const areaChanged = createEvent();
    const emit = (changes) => {
      if (!Object.keys(changes).length) return;
      later(() => {
        onChanged.dispatch(clone(changes), name);
        areaChanged.dispatch(clone(changes));
      });
    };
    return {
      data,
      api: {
        async get(keys) {
          if (keys == null) return clone(data);
          if (typeof keys === "string") keys = [keys];
          if (Array.isArray(keys)) {
            const out = {};
            for (const k of keys) if (k in data) out[k] = clone(data[k]);
            return out;
          }
          const out = {};
          for (const [k, d] of Object.entries(keys)) out[k] = k in data ? clone(data[k]) : clone(d);
          return out;
        },
        async set(items) {
          calls.set.push({ area: name, items: clone(items) });
          const changes = {};
          for (const [k, v] of Object.entries(items)) {
            if (v === undefined) continue;
            const change = { newValue: clone(v) };
            if (k in data) change.oldValue = data[k];
            data[k] = clone(v);
            changes[k] = change;
          }
          emit(changes);
        },
        async remove(keys) {
          calls.remove.push({ area: name, keys });
          const changes = {};
          for (const k of [keys].flat()) {
            if (!(k in data)) continue;
            changes[k] = { oldValue: data[k] };
            delete data[k];
          }
          emit(changes);
        },
        async clear() {
          const changes = {};
          for (const k of Object.keys(data)) {
            changes[k] = { oldValue: data[k] };
            delete data[k];
          }
          emit(changes);
        },
        onChanged: areaChanged,
      },
    };
  }

  const areas = { local: area("local", local), sync: area("sync", sync), session: area("session", session) };

  const onMessage = createEvent();
  // Delivers a message to this fake's onMessage listeners, as the browser would deliver
  // one from `from` (a sender object). Resolves with the response, like sendMessage.
  function deliver(msg, from = sender) {
    return new Promise((resolve, reject) => {
      later(() => {
        if (!onMessage.hasListeners()) {
          reject(new Error("Could not establish connection. Receiving end does not exist."));
          return;
        }
        let answered = false;
        const sendResponse = (r) => {
          if (answered) return;
          answered = true;
          resolve(clone(r));
        };
        let results;
        try {
          results = onMessage.dispatch(clone(msg), from, sendResponse);
        } catch (e) {
          reject(e);
          return;
        }
        if (answered) return;
        const promise = results.find((r) => r && typeof r.then === "function");
        if (promise) return promise.then(sendResponse, reject);
        if (!results.includes(true)) sendResponse(undefined);
      });
    });
  }

  const alarms = new Map();
  const onAlarm = createEvent();

  const chrome = {
    storage: {
      local: areas.local.api,
      sync: areas.sync.api,
      session: areas.session.api,
      onChanged,
    },
    runtime: {
      id: runtimeId,
      lastError: undefined,
      getURL: (p) => `chrome-extension://${runtimeId}/${String(p).replace(/^\//, "")}`,
      getManifest: () => ({ manifest_version: 3, version: "0.0.0-test" }),
      sendMessage(msg) {
        calls.sendMessage.push(clone(msg));
        if (onSendMessage) return Promise.resolve().then(() => onSendMessage(clone(msg))).then(clone);
        return deliver(msg);
      },
      onMessage,
      onInstalled: createEvent(),
      onStartup: createEvent(),
    },
    alarms: {
      async create(name, info = {}) {
        if (typeof name === "object") [name, info] = ["", name];
        calls.alarms.push({ name, info: clone(info) });
        const delay = info.delayInMinutes ?? info.periodInMinutes ?? 0;
        alarms.set(name, {
          name,
          scheduledTime: info.when ?? clock.now() + delay * 60_000,
          ...(info.periodInMinutes ? { periodInMinutes: info.periodInMinutes } : {}),
        });
      },
      async get(name = "") {
        return clone(alarms.get(name));
      },
      async getAll() {
        return clone([...alarms.values()]);
      },
      async clear(name = "") {
        return alarms.delete(name);
      },
      async clearAll() {
        const had = alarms.size > 0;
        alarms.clear();
        return had;
      },
      onAlarm,
    },
    tabs: {
      async query(info = {}) {
        return clone(tabs.filter((t) => Object.entries(info).every(([k, v]) => k === "currentWindow" || t[k] === v)));
      },
      async sendMessage() {
        throw new Error("Could not establish connection. Receiving end does not exist.");
      },
    },
  };

  return {
    chrome,
    clock,
    calls,
    alarms,
    // Raw storage contents (live objects; read them, don't keep them).
    store: { local: areas.local.data, sync: areas.sync.data, session: areas.session.data },
    deliver,
    // Fires an alarm by name as if it went off; resolves after listeners have been called.
    fireAlarm(name) {
      const a = alarms.get(name) ?? { name, scheduledTime: clock.now() };
      return later(() => onAlarm.dispatch(clone(a)));
    },
    fireInstalled(details = { reason: "install" }) {
      return later(() => chrome.runtime.onInstalled.dispatch(details));
    },
    fireStartup() {
      return later(() => chrome.runtime.onStartup.dispatch());
    },
    // Resolves once every queued event (and anything those events queued) has fired.
    async idle() {
      for (let i = 0; i < 100 && pending.size; i++) await Promise.allSettled([...pending]);
    },
  };
}
