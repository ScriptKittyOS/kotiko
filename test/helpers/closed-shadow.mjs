// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Reads inside the word card's closed shadow root from Playwright (slice 19 e2e). Page
// scripts, Playwright locators and the content script's own world can't reach a closed
// root; the DevTools protocol can, which is what this uses.
//
//   const card = await readCard(page);
//   card.open, card.lines, card.text("k-label"), card.dark, card.focused
export async function inShadow(page, fn, arg = null) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const find = (n) => {
      if (n.localName === "kotiko-popover") return n;
      for (const c of n.children ?? []) {
        const f = find(c);
        if (f) return f;
      }
      return null;
    };
    const host = find(root);
    if (!host?.shadowRoots?.length) return null;
    const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: host.shadowRoots[0].backendNodeId });
    const res = await cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: fn.toString(),
      arguments: [{ value: arg }],
      returnByValue: true,
    });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
    return res.result.value;
  } finally {
    await cdp.detach().catch(() => {});
  }
}

// The card's state: whether it shows, its visible lines (screen-reader-only text left out),
// the theme, what has focus, and the text of any selector.
export async function readCard(page) {
  const state = await inShadow(page, function () {
    const card = this.querySelector(".k-card");
    const lines = [];
    for (const el of this.querySelectorAll(".k-scroll > div")) {
      const clone = el.cloneNode(true);
      clone.querySelectorAll(".sr, .k-speak").forEach((n) => n.remove());
      const t = clone.textContent.replace(/\s+/g, " ").trim();
      if (t) lines.push(t);
    }
    const all = {};
    for (const el of this.querySelectorAll("[class]")) {
      for (const c of el.classList) all[c] ??= el.textContent.replace(/\s+/g, " ").trim();
    }
    const r = card?.getBoundingClientRect();
    return {
      open: !!card && !card.hidden,
      rect: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null,
      lines,
      dark: this.querySelector(".k-root")?.classList.contains("k-dark") ?? false,
      focused: this.activeElement ? this.activeElement.className : null,
      speakHidden: this.querySelector(".k-speak")?.hidden ?? null,
      toast: this.querySelector(".k-toast")?.textContent ?? "",
      byClass: all,
    };
  });
  return state && { ...state, text: (cls) => state.byClass[cls] ?? null };
}
