// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// extension/lib/controls.js: which elements are controls, whose text Kotiko leaves alone.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { requireExt } from "../helpers/load-script.mjs";

const C = requireExt("lib/controls.js");

function page(html) {
  const { window } = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  const doc = window.document;
  const calls = [];
  const getCursor = (el) => {
    calls.push(el);
    return window.getComputedStyle(el).cursor;
  };
  const check = C.createControlCheck(getCursor);
  return { doc, $: (id) => doc.getElementById(id), calls, check, cursorOf: getCursor };
}

describe("module shape", () => {
  test("exports the API and sets globalThis.KotikoControls", () => {
    for (const k of ["isControlElement", "isPointerControl", "createControlCheck"]) assert.equal(typeof C[k], "function", k);
    assert.equal(globalThis.KotikoControls, C);
    assert.equal(C.MAX_WORDS, 4);
    assert.equal(C.MAX_CHARS, 40);
  });
});

describe("isControlElement", () => {
  test("control tags", () => {
    const { doc } = page("");
    for (const t of ["button", "label", "select", "option", "summary", "legend", "nav", "menu"]) {
      assert.equal(C.isControlElement(doc.createElement(t)), true, t);
    }
    for (const t of ["div", "span", "p", "a", "main", "li"]) assert.equal(C.isControlElement(doc.createElement(t)), false, t);
  });

  test("ARIA roles, including fallback lists", () => {
    const { $ } = page(`
      <div id="tab" role="tab">x</div><div id="sw" role="switch">x</div><div id="mi" role="menuitemradio">x</div>
      <div id="tb" role="textbox">x</div><div id="list" role="foo option">x</div>
      <div id="cell" role="gridcell">x</div><div id="reg" role="region">x</div><div id="none" role="presentation">x</div>`);
    for (const id of ["tab", "sw", "mi", "tb", "list"]) assert.equal(C.isControlElement($(id)), true, id);
    for (const id of ["cell", "reg", "none"]) assert.equal(C.isControlElement($(id)), false, id);
  });

  test("links are content unless they open a menu", () => {
    const { $ } = page(`
      <a id="a" href="#">House</a><a id="pop" href="#" aria-haspopup="menu">House</a>
      <span id="rl" role="link" aria-haspopup="true">x</span><span id="rl0" role="link" aria-haspopup="false">x</span>`);
    assert.equal(C.isControlElement($("a")), false);
    assert.equal(C.isControlElement($("pop")), true);
    assert.equal(C.isControlElement($("rl")), true);
    assert.equal(C.isControlElement($("rl0")), false);
  });

  test("forms, except one that wraps the page's content", () => {
    const { $ } = page(`<form id="f"><p>x</p></form><form id="wrap"><main><p>x</p></main></form><form id="h"><h1>T</h1></form>`);
    assert.equal(C.isControlElement($("f")), true);
    assert.equal(C.isControlElement($("wrap")), false);
    assert.equal(C.isControlElement($("h")), false);
  });

  test("tabindex >= 0 on a short, non-landmark element", () => {
    const { $ } = page(`
      <div id="chip" tabindex="0">AOI II</div><div id="chip3" tabindex="3">House</div>
      <div id="neg" tabindex="-1">AOI II</div><div id="bad" tabindex="x">AOI II</div>
      <main id="main" tabindex="0">short</main><section id="sec" tabindex="0">short</section>
      <div id="reg" role="region" tabindex="0">short</div><a id="a" href="#" tabindex="0">House</a>
      <div id="scroll" tabindex="0">A wide table that scrolls sideways, full of words about houses and gardens.</div>`);
    assert.equal(C.isControlElement($("chip")), true);
    assert.equal(C.isControlElement($("chip3")), true);
    for (const id of ["neg", "bad", "main", "sec", "reg", "a", "scroll"]) assert.equal(C.isControlElement($(id)), false, id);
  });
});

describe("isPointerControl", () => {
  test("an element that sets cursor: pointer itself and has control-like text", () => {
    const { $, cursorOf } = page(`
      <style>.opt { cursor: pointer }</style>
      <div id="opt" class="opt">AOI I</div>
      <div id="five" class="opt">one two three four five</div>
      <div id="long" class="opt">Supercalifragilistic expialidociousness!!</div>
      <div id="forty" class="opt">Supercalifragilistic expialidociousness!</div>
      <div id="card" class="opt"><span id="inner">Read</span> the whole story about a house by the sea.</div>
      <a id="link" href="#">House</a><p id="plain">House</p><main id="main" class="opt">x</main>`);
    assert.equal(C.isPointerControl($("opt"), cursorOf), true);
    assert.equal(C.isPointerControl($("five"), cursorOf), false, "more than 4 words");
    assert.equal(C.isPointerControl($("long"), cursorOf), false, "more than 40 characters");
    assert.equal(C.isPointerControl($("forty"), cursorOf), true, "exactly 40 characters");
    assert.equal(C.isPointerControl($("card"), cursorOf), false, "a clickable card with long text");
    assert.equal(C.isPointerControl($("inner"), cursorOf), false, "inherits the card's pointer");
    assert.equal(C.isPointerControl($("link"), cursorOf), false, "links are content");
    assert.equal(C.isPointerControl($("plain"), cursorOf), false);
    assert.equal(C.isPointerControl($("main"), cursorOf), false);
  });
});

describe("createControlCheck", () => {
  test("any ancestor below body makes a control; body never does", () => {
    const { $, check } = page(`
      <div id="t" role="tablist"><div><span id="deep">x</span></div></div>
      <p id="p"><b id="b">x</b></p>`);
    assert.equal(check.inControl($("deep")), true);
    assert.equal(check.inControl($("b")), false);
    assert.equal(check.inControl(null), false);
  });

  test("reads no computed style when a cheap signal is found, and each style once", () => {
    const { $, check, calls } = page(`
      <button id="btn"><span id="s">x</span></button>
      <div id="d"><p id="p1">x</p><p id="p2">y</p></div>`);
    assert.equal(check.inControl($("s")), true);
    assert.equal(calls.length, 0);
    assert.equal(check.inControl($("p1")), false);
    const after = calls.length;
    assert.ok(after > 0);
    assert.equal(check.inControl($("p1")), false);
    assert.equal(check.inControl($("p2")), false);
    assert.equal(new Set(calls).size, calls.length, "no element's style read twice");
    check.reset();
    check.inControl($("p1"));
    assert.ok(calls.length > after, "reset() forgets decisions");
  });

  test("decisions are cached until reset()", () => {
    const { $, check } = page(`<div id="d"><span id="s">x</span></div>`);
    assert.equal(check.inControl($("s")), false);
    $("d").setAttribute("role", "button");
    assert.equal(check.inControl($("s")), false, "cached");
    check.reset();
    assert.equal(check.inControl($("s")), true);
  });
});
