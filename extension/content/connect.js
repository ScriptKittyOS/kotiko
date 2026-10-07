// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// "Connect OpenRouter" (slice 11 §4): OpenRouter sends the browser back to the docs site's
// return page, https://kotiko.org/connect/?code=…&state=… (slice 44). This content script
// runs only there (its own manifest entry), reads the code and the sign-in's state from the
// address and hands them to Kotiko's background as {type: "oauth.code", code, state}. The
// background checks the sender is that page (KotikoPKCE.isCallback) and the state is the
// sign-in it started, then trades the code, with the verifier it kept, for a key. The code
// goes nowhere else, and the page itself has no script.
//
// The page's status line (#kotiko-connect-status) then says how it went, in Kotiko's
// interface language. The code is taken out of the address afterwards, so reloading the
// tab doesn't send a used code again.
(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  const here = new URL(location.href);
  const code = here.searchParams.get("code");
  const state = here.searchParams.get("state");
  if (here.origin !== "https://kotiko.org" || here.pathname !== "/connect/" || !code) return;

  const status = document.getElementById("kotiko-connect-status");
  const say = (key) => {
    if (status) status.textContent = globalThis.KotikoI18n.t(key);
  };
  const outcome = (res) => {
    if (res?.ok) return "connect_done";
    if (res?.code === "key_rejected" && res?.details?.reason === "expired") return "connect_expired";
    return "connect_failed";
  };

  say("connect_working");
  Promise.resolve(ext.runtime.sendMessage({ type: "oauth.code", code, ...(state ? { state } : {}) }))
    .then((res) => say(outcome(res)), () => say("connect_failed"))
    .finally(() => history.replaceState(history.state, "", here.pathname));
})();
