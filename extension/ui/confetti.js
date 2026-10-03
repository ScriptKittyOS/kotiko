// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Confetti for a milestone (slice 32 section 5): one burst on a full-viewport canvas that
// never takes a click or changes layout. Two bursts of small rounded rectangles and
// circles rise from the lower corners, inward, then fall with gravity, air drag and spin
// in the brand's colors; they fade over the last 0.4 s and the canvas is removed at 1.6 s.
// Nothing loops, flashes or makes a sound. Esc, any click or any key stops it at once.
// Under reduced motion it never starts: the caller shows its message with a fade instead.
// The welcome tab uses it for the first word (slice 22); slice 32's page milestones use it
// inside the popover's shadow root.
//
//   const run = KotikoConfetti.burst({ host: document.body });   -> null under reduced motion
//   run.stop();  await run.finished;                              -> "done" | "stopped" | "abandoned"
//   KotikoConfetti.reducedMotion(window)                          -> true when motion is reduced
(() => {
  const DURATION = 1600;
  const FADE = 400;
  const HIDDEN_LIMIT = 1000;
  // Per particle: x, y, vx, vy, angle, spin, shape (0 rect, 1 circle), color index.
  const F = 8;
  const GRAVITY = 1.35; // × viewport height per s²
  const DRAG = 1.1; // per second
  // Light --primary-hover, a lighter orange and blue (32 §5); --brand and --orange come
  // from the page's tokens.
  const FIXED = ["#723CD7", "#F6A672", "#8DBBFF"];
  const FALLBACK = { brand: "#8E5EFA", orange: "#B4501A" };

  const count = (w, h) => Math.round(Math.max(60, Math.min((w * h) / 12_000, 120)));

  function reducedMotion(win = globalThis.window) {
    try {
      if (win?.document?.documentElement?.dataset?.motion === "reduce") return true;
      return !!win?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    } catch {
      return false;
    }
  }

  function palette(win) {
    let brand = "";
    let orange = "";
    try {
      const cs = win.getComputedStyle(win.document.documentElement);
      brand = cs.getPropertyValue("--brand").trim();
      orange = cs.getPropertyValue("--orange").trim();
    } catch {
      // no styles (tests): the fallbacks
    }
    return [brand || FALLBACK.brand, orange || FALLBACK.orange, ...FIXED];
  }

  // Fills `p` with `n` particles: half from the lower left, half from the lower right,
  // thrown up and inward.
  function seed(p, n, w, h, rand) {
    for (let i = 0; i < n; i++) {
      const left = i % 2 === 0;
      const o = i * F;
      const angle = ((50 + rand() * 30) * Math.PI) / 180; // from the horizontal
      const speed = h * (1.05 + rand() * 0.75);
      p[o] = left ? -6 + rand() * 24 : w + 6 - rand() * 24;
      p[o + 1] = h + 8 - rand() * 24;
      p[o + 2] = Math.cos(angle) * speed * (left ? 1 : -1) * (0.55 + rand() * 0.5);
      p[o + 3] = -Math.sin(angle) * speed;
      p[o + 4] = rand() * Math.PI * 2;
      p[o + 5] = (rand() - 0.5) * 14;
      p[o + 6] = rand() < 0.62 ? 0 : 1;
      p[o + 7] = Math.floor(rand() * 5);
    }
  }

  // Moves every particle by dt seconds.
  function step(p, n, dt, h) {
    const g = GRAVITY * h * dt;
    const keep = Math.max(0, 1 - DRAG * dt);
    for (let i = 0; i < n; i++) {
      const o = i * F;
      p[o + 2] *= keep;
      p[o + 3] = p[o + 3] * keep + g;
      p[o] += p[o + 2] * dt;
      p[o + 1] += p[o + 3] * dt;
      p[o + 4] += p[o + 5] * dt;
    }
  }

  function draw(ctx, p, n, colors, alpha, w, h, k) {
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = alpha;
    for (let i = 0; i < n; i++) {
      const o = i * F;
      const x = p[o];
      const y = p[o + 1];
      if (y > h + 20 || x < -20 || x > w + 20) continue;
      ctx.fillStyle = colors[p[o + 7]];
      ctx.beginPath();
      if (p[o + 6] === 1) {
        ctx.setTransform(k, 0, 0, k, 0, 0);
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      } else {
        // A 6 × 10 rounded rectangle, spinning and fluttering (its width follows the spin).
        const a = p[o + 4];
        const c = Math.cos(a);
        const s = Math.sin(a);
        const fl = Math.abs(Math.cos(a * 0.7)) * 0.75 + 0.25;
        ctx.setTransform(c * fl * k, s * fl * k, -s * k, c * k, x * k, y * k);
        if (ctx.roundRect) ctx.roundRect(-3, -5, 6, 10, 1.5);
        else ctx.rect(-3, -5, 6, 10);
      }
      ctx.fill();
    }
  }

  function burst({
    host = null,
    win = globalThis.window,
    colors = null,
    reduced = reducedMotion(win),
    raf = (f) => win.requestAnimationFrame(f),
    caf = (id) => win.cancelAnimationFrame(id),
    random = Math.random,
    duration = DURATION,
  } = {}) {
    if (reduced) return null;
    const doc = win.document;
    const w = Math.max(1, win.innerWidth || doc.documentElement.clientWidth || 800);
    const h = Math.max(1, win.innerHeight || doc.documentElement.clientHeight || 600);
    const scale = Math.min(win.devicePixelRatio || 1, 2);
    const canvas = doc.createElement("canvas");
    canvas.className = "kotiko-confetti";
    canvas.setAttribute("aria-hidden", "true");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483646;contain:strict";
    let ctx = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      ctx = null;
    }
    (host ?? doc.body).append(canvas);

    const n = count(w, h);
    const p = new Float32Array(n * F);
    const fill = colors ?? palette(win);
    seed(p, n, w, h, random);

    let resolve;
    const finished = new Promise((r) => (resolve = r));
    let frame = 0;
    let start = null;
    let last = null;
    let ended = false;

    function end(how) {
      if (ended) return;
      ended = true;
      if (frame) caf(frame);
      frame = 0;
      canvas.remove();
      win.removeEventListener("keydown", onInput, true);
      win.removeEventListener("pointerdown", onInput, true);
      doc.removeEventListener("visibilitychange", onVisibility);
      resolve(how);
    }
    const onInput = () => end("stopped");
    function onVisibility() {
      // A hidden tab gets no frames; the gap is measured on the next one.
      if (doc.visibilityState === "hidden") return;
      if (!frame && !ended) frame = raf(tick);
    }

    function tick(ts) {
      frame = 0;
      if (ended) return;
      if (start === null) {
        start = ts;
        last = ts;
      }
      const gap = ts - last;
      // Hidden for more than a second: abandoned, never resumed.
      if (gap > HIDDEN_LIMIT) return end("abandoned");
      // A pause shorter than that moves the clock on, so the burst resumes where it was.
      if (gap > 100) start += gap - 16;
      const t = ts - start;
      if (t >= duration) return end("done");
      step(p, n, Math.min(gap, 50) / 1000, h);
      last = ts;
      const alpha = t > duration - FADE ? Math.max(0, (duration - t) / FADE) : 1;
      if (ctx) draw(ctx, p, n, fill, alpha, w, h, scale);
      frame = raf(tick);
    }

    win.addEventListener("keydown", onInput, true);
    win.addEventListener("pointerdown", onInput, true);
    doc.addEventListener("visibilitychange", onVisibility);
    frame = raf(tick);
    return { canvas, count: n, stop: () => end("stopped"), finished };
  }

  const api = { burst, reducedMotion, count, seed, step, DURATION, FADE };
  globalThis.KotikoConfetti = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
