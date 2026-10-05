// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// axe-core in Playwright (slice 27 §6). The engine is injected through the DevTools
// protocol (`page.evaluate`), which an extension page's `script-src 'self'` doesn't block,
// so nothing is added to the extension itself.
//
//   const v = await axeScan(page);                 // WCAG 2.2 A and AA rules
//   expect(v, summarize(v)).toEqual([]);
//   await exposePopover(page);                     // lets axe into the word card's closed root
//
// The tags are axe's names for WCAG 2.0, 2.1 and 2.2 at levels A and AA. `best-practice`
// rules are left out of the gate (they aren't WCAG failures), but `axeScan(page, { tags:
// [...WCAG_TAGS, "best-practice"] })` reports them for an audit.
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AXE_SOURCE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
export const AXE_VERSION = JSON.parse(fs.readFileSync(require.resolve("axe-core/package.json"), "utf8")).version;

export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

// Runs axe on the page (or on `include`, a list of CSS selectors) and returns its
// violations as plain data: rule id, impact, WCAG tags, help text and each failing node's
// selector and summary.
export async function axeScan(page, { include = null, exclude = [], tags = WCAG_TAGS, disable = [] } = {}) {
  const has = await page.evaluate(() => typeof globalThis.axe?.run === "function");
  if (!has) await page.evaluate(AXE_SOURCE);
  return page.evaluate(
    async ({ include, exclude, tags, disable }) => {
      const context = include ? { include: include.map((s) => [s]), exclude: exclude.map((s) => [s]) } : { exclude: exclude.map((s) => [s]) };
      const rules = Object.fromEntries(disable.map((id) => [id, { enabled: false }]));
      const res = await globalThis.axe.run(context.include || context.exclude.length ? context : document, {
        runOnly: { type: "tag", values: tags },
        rules,
        resultTypes: ["violations"],
      });
      return res.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        tags: v.tags.filter((t) => /^wcag\d/.test(t)),
        help: v.help,
        nodes: v.nodes.map((n) => ({ target: n.target.flat().join(" "), summary: n.failureSummary?.split("\n").slice(0, 3).join(" ") ?? "" })),
      }));
    },
    { include, exclude, tags, disable },
  );
}

// A readable line per violation, for assertion messages.
export function summarize(violations) {
  return violations.map((v) => `${v.impact} ${v.id} (${v.tags.join(", ")}): ${v.help}\n${v.nodes.map((n) => `    ${n.target}: ${n.summary}`).join("\n")}`).join("\n");
}

// The word card lives in a closed shadow root that page scripts (and so axe) can't see.
// For the test only, this gives the host element a `shadowRoot` getter in the page's own
// world that returns the closed root, through the DevTools protocol. The content script's
// world and the extension are unchanged.
export async function exposePopover(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const find = (n) => {
      if (n.localName === "kotiko-popover") return n;
      for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) {
        const f = find(c);
        if (f) return f;
      }
      return null;
    };
    const host = find(root);
    if (!host?.shadowRoots?.length) return false;
    const { object: hostObj } = await cdp.send("DOM.resolveNode", { backendNodeId: host.backendNodeId });
    const { object: rootObj } = await cdp.send("DOM.resolveNode", { backendNodeId: host.shadowRoots[0].backendNodeId });
    await cdp.send("Runtime.callFunctionOn", {
      objectId: hostObj.objectId,
      functionDeclaration: "function (r) { Object.defineProperty(this, 'shadowRoot', { get: () => r, configurable: true }); }",
      arguments: [{ objectId: rootObj.objectId }],
    });
    return true;
  } finally {
    await cdp.detach().catch(() => {});
  }
}
