// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 32 §5's confetti (extension/ui/confetti.js), shipped by slice 22 for the first
// word: one full-viewport canvas that never takes a click, 60 to 120 particles in the
// brand's colors, 1.6 s with a fade over the last 0.4 s, then removed; Esc, any click or
// any key stops it; a tab hidden for more than a second abandons it; reduced motion never
// starts it. Driven frame by frame with a fake clock, no real time.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { requireExt } from "../helpers/load-script.mjs";

const Confetti = requireExt("ui/confetti.js");

// A window whose animation frames run only when the test says so, and a 2d context that
// counts what is drawn.
function setup({ width = 1280, height = 800, motion = null } = {}) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
  const win = dom.window;
  Object.defineProperty(win, "innerWidth", { value: width });
  Object.defineProperty(win, "innerHeight", { value: height });
  if (motion) win.document.documentElement.dataset.motion = motion;
  const frames = new Map();
  let next = 1;
  const draws = { fill: 0, alpha: [], fills: new Set() };
  const ctx = new Proxy({}, {
    get(target, k) {
      if (k === "fill") return () => void draws.fill++;
      if (k in target) return target[k];
      return () => {};
    },
    set(target, k, v) {
      if (k === "globalAlpha") draws.alpha.push(v);
      if (k === "fillStyle") draws.fills.add(v);
      target[k] = v;
      return true;
    },
  });
  win.HTMLCanvasElement.prototype.getContext = () => ctx;
  const raf = (f) => {
    const id = next++;
    frames.set(id, f);
    return id;
  };
  const caf = (id) => frames.delete(id);
  // Runs the pending frame at time `t`.
  const frame = (t) => {
    const [[id, f]] = frames;
    frames.delete(id);
    f(t);
  };
  return { win, raf, caf, frame, frames, draws };
}

describe("confetti (32 §5)", () => {
  test("a full-viewport canvas that never takes a click, removed at 1.6 s", async () => {
    const s = setup();
    const run = Confetti.burst({ win: s.win, raf: s.raf, caf: s.caf, random: () => 0.5, colors: ["#a", "#b", "#c", "#d", "#e"] });
    const canvas = s.win.document.querySelector("canvas");
    assert.equal(canvas, run.canvas);
    assert.equal(canvas.getAttribute("aria-hidden"), "true");
    assert.match(canvas.style.cssText, /pointer-events: none/);
    assert.match(canvas.style.cssText, /position: fixed/);
    assert.equal(run.count, 85, "1280 × 800 / 12,000");
    for (let t = 0; t <= 1200; t += 16) s.frame(t);
    assert.ok(s.draws.fill > 85 * 10, "particles are drawn every frame");
    assert.equal(Math.max(...s.draws.alpha), 1);
    for (let t = 1216; t < 1600; t += 16) s.frame(t);
    assert.ok(Math.min(...s.draws.alpha) < 0.1, "fades over the last 0.4 s");
    s.frame(1601);
    assert.equal(await run.finished, "done");
    assert.equal(s.win.document.querySelector("canvas"), null);
    assert.equal(s.frames.size, 0, "nothing loops or restarts");
  });

  test("particle count: at least 60, at most 120", () => {
    assert.equal(Confetti.count(320, 568), 60);
    assert.equal(Confetti.count(3840, 2160), 120);
  });

  test("Esc, any click or any key stops it at once", async () => {
    for (const fire of [(w) => w.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" })), (w) => w.dispatchEvent(new w.Event("pointerdown")), (w) => w.dispatchEvent(new w.KeyboardEvent("keydown", { key: "a" }))]) {
      const s = setup();
      const run = Confetti.burst({ win: s.win, raf: s.raf, caf: s.caf });
      s.frame(0);
      fire(s.win);
      assert.equal(await run.finished, "stopped");
      assert.equal(s.win.document.querySelector("canvas"), null);
      assert.equal(s.frames.size, 0);
    }
  });

  test("hidden for more than a second: abandoned, not resumed; a short pause resumes", async () => {
    const s = setup();
    const run = Confetti.burst({ win: s.win, raf: s.raf, caf: s.caf });
    s.frame(0);
    s.frame(16);
    s.frame(500); // a 484 ms pause: the clock moves on
    assert.ok(s.win.document.querySelector("canvas"));
    s.frame(1700); // 1.2 s with no frame
    assert.equal(await run.finished, "abandoned");
    assert.equal(s.win.document.querySelector("canvas"), null);
  });

  test("reduced motion (the media query or Kotiko's setting) never starts it", () => {
    const s = setup({ motion: "reduce" });
    assert.equal(Confetti.reducedMotion(s.win), true);
    assert.equal(Confetti.burst({ win: s.win, raf: s.raf, caf: s.caf }), null);
    assert.equal(s.win.document.querySelector("canvas"), null);
    const m = setup();
    m.win.matchMedia = (q) => ({ matches: q.includes("reduce") });
    assert.equal(Confetti.reducedMotion(m.win), true);
    assert.equal(Confetti.burst({ win: m.win, raf: m.raf, caf: m.caf }), null);
  });

  test("colors: the page's --brand and --orange, a lighter orange, blue and the light primary hover", () => {
    const s = setup();
    s.win.document.documentElement.style.setProperty("--brand", "#8E5EFA");
    s.win.document.documentElement.style.setProperty("--orange", "#B4501A");
    let i = 0;
    const run = Confetti.burst({ win: s.win, raf: s.raf, caf: s.caf, random: () => ((i = (i * 7 + 3) % 97), i / 97) });
    for (let t = 0; t < 200; t += 16) s.frame(t);
    run.stop();
    assert.deepEqual([...s.draws.fills].sort(), ["#723CD7", "#8DBBFF", "#8E5EFA", "#B4501A", "#F6A672"]);
  });
});
