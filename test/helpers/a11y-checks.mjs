// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Checks axe can't make (slice 27 §6), run in Playwright against Kotiko's own pages:
//
//   tabWalk(page)        Tab through the page; every element that should be a tab stop is
//                        reached, shows a focus indicator (2.4.7) and isn't hidden behind
//                        another element (2.4.11). Returns { stops, problems }.
//   smallTargets(page)   interactive elements under 24 × 24 CSS px (2.5.8), with WCAG's
//                        inline exception. Returns a list of problems.
//   horizontalScroll(page)  the page's overflow past the viewport's width (1.4.10).
//   transformAnimations(page)  running animations or transitions that move things (06 §9).

/* global __kDescribe, __kKey -- set in the page by describeFn() */

const FOCUSABLE = [
  "a[href]", "button", "input:not([type=hidden])", "select", "textarea", "summary",
  "[tabindex]", "[contenteditable=''], [contenteditable=true]", "iframe", "audio[controls]", "video[controls]",
].join(",");

// Runs in the page: a short, stable description of an element.
function describeFn() {
  // A number per element, stable for the page's life, so two "Undo" buttons stay apart.
  const keys = (globalThis.__kKeys ??= new WeakMap());
  globalThis.__kKey = (el) => {
    if (!keys.has(el)) keys.set(el, (globalThis.__kN = (globalThis.__kN ?? 0) + 1));
    return keys.get(el);
  };
  globalThis.__kDescribe = (el) => {
    if (!el || el.nodeType !== 1) return String(el);
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
    const name = (el.getAttribute("aria-label") || el.textContent || el.value || "").replace(/\s+/g, " ").trim().slice(0, 30);
    return `${el.localName}${id}${cls}${name ? ` "${name}"` : ""}`;
  };
}

// Elements that should be tab stops: focusable, rendered, not inert, not disabled, not
// tabindex=-1, and not inside a closed <details> or a hidden subtree.
async function expectedStops(page) {
  return page.evaluate((sel) => {
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      if (el.closest("[inert]") || el.disabled) continue;
      if (el.getAttribute("tabindex") !== null && Number(el.getAttribute("tabindex")) < 0) continue;
      if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: false })) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      // A radio's group is one stop: the checked one (or the first) is the stop.
      if (el.matches("input[type=radio]") && el.name) {
        const group = [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)];
        const stop = group.find((g) => g.checked) ?? group[0];
        if (stop !== el) continue;
      }
      // A modal dialog that's open keeps focus inside itself.
      const modal = [...document.querySelectorAll("dialog[open], [aria-modal=true]")].filter((d) => d.checkVisibility()).at(-1);
      if (modal && !modal.contains(el)) continue;
      out.push({ key: __kKey(el), name: __kDescribe(el) });
    }
    return out;
  }, FOCUSABLE);
}

// Tabs through the page from the top. For each stop, records whether a focus indicator is
// drawn (an outline or a box-shadow on the element, else a screenshot difference around it
// between before and after it took focus) and whether it's visible at all under whatever
// sits on top of it.
export async function tabWalk(page, { max = 250 } = {}) {
  await page.evaluate(describeFn);
  await page.addStyleTag({ content: "*, *::before, *::after { caret-color: transparent !important; }" }).catch(() => {});
  // Start at the top of the page (or of the open modal layer): a focusable marker put first
  // in the body sets the browser's sequential focus starting point, then goes away.
  await page.evaluate(() => {
    const m = document.createElement("span");
    m.tabIndex = -1;
    m.id = "__kStart";
    document.body.prepend(m);
    m.focus();
  });
  const modal = await page.evaluate(() => [...document.querySelectorAll("dialog[open], [aria-modal=true]")].some((d) => d.checkVisibility()));
  const stops = [];
  const problems = [];
  const seen = new Set();
  let removed = false;
  for (let i = 0; i < max; i++) {
    const before = await page.screenshot({ animations: "disabled" });
    await page.keyboard.press("Tab");
    if (!removed) {
      await page.evaluate(() => document.getElementById("__kStart")?.remove());
      removed = true;
    }
    const info = await page.evaluate(async () => {
      // A transition started by the focus change (a skip link sliding in) ends first.
      const running = document.getAnimations().filter((a) => a.playState === "running" && Number.isFinite(a.effect?.getComputedTiming?.().endTime));
      await Promise.race([Promise.all(running.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 1000))]);
      let el = document.activeElement;      while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;
      // A composite widget with aria-activedescendant (the word grid) may draw its ring on
      // the active item instead of itself.
      const ad = el.getAttribute("aria-activedescendant");
      const item = ad && document.getElementById(ad);
      const ringOf = (n) => {
        const cs = getComputedStyle(n);
        return (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 1 && !/rgba\(.*, 0\)|transparent/.test(cs.outlineColor)) || (cs.boxShadow && cs.boxShadow !== "none");
      };
      const ownRing = ringOf(el);
      const target = !ownRing && item ? item : el;
      const ring = ownRing || (item && ringOf(item));
      const r = target.getBoundingClientRect();
      // Visible at all (2.4.11): one of five points inside it hits it or its content.
      const pts = [[0.5, 0.5], [0.15, 0.2], [0.85, 0.2], [0.15, 0.8], [0.85, 0.8]].map(([fx, fy]) => [r.left + r.width * fx, r.top + r.height * fy]);
      const inView = r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
      const hit = inView && pts.some(([x, y]) => {
        const top = document.elementFromPoint(x, y);
        return top && (top === target || target.contains(top) || top.contains(target) || el.contains(top));
      });
      const covered = hit ? null : __kDescribe(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      return { key: __kKey(el), name: __kDescribe(el), ring, hit, covered, inView, rect: { x: r.left, y: r.top, width: r.width, height: r.height } };
    });
    // Past the last stop, focus leaves the page for the browser's own UI: the walk is done
    // (a native modal <dialog> brings it back to its first control: go on round).
    if (!info) {
      if (modal) continue;
      break;
    }
    if (seen.has(info.key)) {
      // Back to the first stop: the cycle is complete (headless Chromium sometimes wraps
      // without visiting its own UI), as it is inside a modal layer. Anywhere else, a loop.
      if (!modal && info.name !== stops[0]) problems.push(`focus came back to ${info.name} before reaching the end (a loop)`);
      break;
    }
    seen.add(info.key);
    stops.push(info.name);
    if (!info.ring) {
      const pad = 6;
      const vp = page.viewportSize();
      const clip = {
        x: Math.max(0, info.rect.x - pad),
        y: Math.max(0, info.rect.y - pad),
        width: Math.min(vp.width, info.rect.width + 2 * pad),
        height: Math.min(vp.height, info.rect.height + 2 * pad),
      };
      clip.width = Math.max(1, Math.min(clip.width, vp.width - clip.x));
      clip.height = Math.max(1, Math.min(clip.height, vp.height - clip.y));
      const after = await page.screenshot({ clip, animations: "disabled" });
      // Before must be the same region of the earlier full-page screenshot: re-crop it.
      const same = await page.evaluate(
        async ({ a, b, clip }) => {
          const load = (b64) => createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/png" }));
          const [ia, ib] = await Promise.all([load(a), load(b)]);
          const dpr = devicePixelRatio;
          const c1 = new OffscreenCanvas(ib.width, ib.height);
          const x1 = c1.getContext("2d");
          x1.drawImage(ia, clip.x * dpr, clip.y * dpr, ib.width, ib.height, 0, 0, ib.width, ib.height);
          const c2 = new OffscreenCanvas(ib.width, ib.height);
          const x2 = c2.getContext("2d");
          x2.drawImage(ib, 0, 0);
          const d1 = x1.getImageData(0, 0, ib.width, ib.height).data;
          const d2 = x2.getImageData(0, 0, ib.width, ib.height).data;
          let diff = 0;
          for (let i = 0; i < d1.length; i += 4) if (Math.abs(d1[i] - d2[i]) + Math.abs(d1[i + 1] - d2[i + 1]) + Math.abs(d1[i + 2] - d2[i + 2]) > 48) diff++;
          return diff;
        },
        { a: before.toString("base64"), b: after.toString("base64"), clip },
      );
      if (same < 8) problems.push(`no visible focus indicator: ${info.name}`);
    }
    if (!info.hit) problems.push(`focused but hidden${info.covered ? ` under ${info.covered}` : " (outside the viewport)"}: ${info.name}`);
  }
  // Controls taken out of the Tab order must be inside a composite widget whose arrow keys
  // reach them (27 §3: toolbars, radio groups, the grid, menus, listboxes).
  const stranded = await page.evaluate(() =>
    [...document.querySelectorAll("button[tabindex='-1'], a[href][tabindex='-1'], input[tabindex='-1'], select[tabindex='-1'], [role=button][tabindex='-1'], [role=switch][tabindex='-1']")]
      .filter((el) => el.checkVisibility() && !el.disabled && !el.closest("[inert]"))
      .filter((el) => !el.closest("[role=toolbar], [role=radiogroup], [role=grid], [role=menu], [role=listbox], [role=tablist], [role=tree]"))
      .map((el) => __kDescribe(el)),
  );
  for (const n of stranded) problems.push(`not reachable with Tab or arrow keys: ${n}`);

  // What should have been reached, read after the walk (a list that finished loading while
  // Tab went round has its final names). By element, else by name: a part of the page that
  // re-rendered while Tab went round has new elements with the same names.
  const expected = await expectedStops(page);
  const left = new Map();
  for (const n of stops) left.set(n, (left.get(n) ?? 0) + 1);
  for (const e of expected) {
    if (seen.has(e.key) && left.get(e.name)) left.set(e.name, left.get(e.name) - 1);
  }
  for (const e of expected) {
    if (seen.has(e.key)) continue;
    if (left.get(e.name)) left.set(e.name, left.get(e.name) - 1);
    else problems.push(`not reachable with Tab: ${e.name}`);
  }
  return { stops, problems };
}

// 2.5.8: interactive elements at least 24 × 24 CSS px. Exceptions, as WCAG has them:
// a link inside a sentence (inline), and a control whose own label is the target (a
// checkbox or radio wrapped in a label at least that big).
export async function smallTargets(page, { min = 24 } = {}) {
  await page.evaluate(describeFn);
  return page.evaluate((min) => {
    const sel = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=switch], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=menuitemradio], [role=option], [tabindex='0']";
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      if (el.closest("[inert], [aria-hidden=true]") || !el.checkVisibility({ visibilityProperty: true })) continue;
      // A control that lets clicks through to its container: the container is the target.
      let hit = el;
      while (hit.parentElement && getComputedStyle(hit).pointerEvents === "none") hit = hit.parentElement;
      const r = hit.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.width >= min - 0.01 && r.height >= min - 0.01) continue;
      const cs = getComputedStyle(el);
      // Visually hidden (sr-only) elements aren't targets.
      if (r.width <= 1 && r.height <= 1) continue;
      if (cs.clipPath && cs.clipPath !== "none" && r.width <= 2) continue;
      // Inline: a link or link-styled button in running text.
      if (cs.display === "inline" && el.parentElement && [...el.parentElement.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const label = el.closest("label");
      if (label && el.matches("input")) {
        const lr = label.getBoundingClientRect();
        if (lr.width >= min && lr.height >= min) continue;
      }
      out.push(`${__kDescribe(el)} is ${r.width.toFixed(1)} × ${r.height.toFixed(1)}`);
    }
    return out;
  }, min);
}

export async function horizontalScroll(page) {
  return page.evaluate(() => {
    const se = document.scrollingElement;
    const over = se.scrollWidth - se.clientWidth;
    if (over <= 1) return null;
    // The widest culprits, for the message.
    const wide = [...document.querySelectorAll("body *")]
      .filter((el) => el.checkVisibility() && el.getBoundingClientRect().right > se.clientWidth + 1)
      .filter((el) => ![...el.children].some((c) => c.getBoundingClientRect().right > se.clientWidth + 1))
      .slice(0, 5)
      .map((el) => `${el.localName}${el.id ? `#${el.id}` : ""}.${String(el.className).split(" ")[0]} (right ${Math.round(el.getBoundingClientRect().right)})`);
    return `${over}px wider than the viewport: ${wide.join(", ")}`;
  });
}

// Animations and transitions running now that change `transform`, `translate`, `scale` or
// `rotate` (06 §9: none under reduced motion), including inside open shadow roots.
export async function transformAnimations(page) {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "running" || a.playState === "pending")
      .filter((a) => {
        const kf = a.effect?.getKeyframes?.() ?? [];
        const props = a.transitionProperty ? [a.transitionProperty] : kf.flatMap((k) => Object.keys(k));
        return props.some((p) => ["transform", "translate", "scale", "rotate", "offset"].includes(p) && kf.some((k) => k[p] && !/^(none|0px|0px 0px|1|0deg)$/.test(String(k[p]))));
      })
      .map((a) => `${a.animationName || a.transitionProperty} on ${a.effect?.target?.localName}.${a.effect?.target?.className}`),
  );
}

// 1.4.12: with WCAG's text-spacing overrides (line height 1.5, letter spacing 0.12 em, word
// spacing 0.16 em, paragraph spacing 2 em), text that a box newly cuts off. Returns the
// elements whose own text overflows a box that hides overflow, after the overrides and not
// before. `allow`: selectors whose text may be cut (with the reason at the call).
const TEXT_SPACING = "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-block-end: 2em !important; }";
export async function textSpacingClips(page, { allow = [] } = {}) {
  await page.evaluate(describeFn);
  const clipped = () =>
    page.evaluate((allow) => {
      const out = new Map();
      for (const el of document.querySelectorAll("body *")) {
        if (!el.checkVisibility() || el.closest(["[aria-hidden=true]", ".sr-only", "svg", ...allow].join(","))) continue;
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        for (let box = el; box && box !== document.body; box = box.parentElement) {
          const cs = getComputedStyle(box);
          const hidesX = /hidden|clip/.test(cs.overflowX);
          const hidesY = /hidden|clip/.test(cs.overflowY);
          if (!hidesX && !hidesY) continue;
          const over = (hidesX && box.scrollWidth > box.clientWidth + 1) || (hidesY && box.scrollHeight > box.clientHeight + 1);
          if (over) out.set(__kKey(el), __kDescribe(el));
          break;
        }
      }
      return [...out];
    }, allow);
  const before = new Map(await clipped());
  const style = await page.addStyleTag({ content: TEXT_SPACING });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const after = await clipped();
  await style.evaluate((n) => n.remove());
  return after.filter(([k]) => !before.has(k)).map(([, name]) => `text cut off with WCAG text spacing: ${name}`);
}
