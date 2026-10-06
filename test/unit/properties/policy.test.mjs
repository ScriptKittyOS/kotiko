// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Properties of the privacy policy's Markdown reader (lib/policy.js, slice 28 §2): it
// loses no text, and nothing in the file ever becomes HTML.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { fc } from "../../helpers/properties.mjs";
import { requireExt } from "../../helpers/load-script.mjs";

const P = requireExt("lib/policy.js");
const piece = fc.oneof(
  fc.string({ maxLength: 12 }),
  fc.stringMatching(/^\*\*[a-z ]{1,8}\*\*$/),
  fc.stringMatching(/^`[a-z<>&"]{1,8}`$/),
  fc.stringMatching(/^<https:\/\/[a-z]{1,8}\.org\/[a-z]{0,5}>$/),
  fc.constantFrom("<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "<javascript:alert(1)>", "<http://insecure.example/>", "**", "`", "&amp;", "\n", "\n\n", "# ", "## ", "- ", "<!-- hidden -->"),
);

// The spans written back as Markdown.
const back = (spans) => spans.map((s) => (s.text !== undefined ? s.text : s.strong !== undefined ? `**${s.strong}**` : s.code !== undefined ? `\`${s.code}\`` : `<${s.link}>`)).join("");

describe("policy Markdown", () => {
  test("inline loses no character: its spans written back are the line", () => {
    fc.assert(fc.property(fc.array(piece, { maxLength: 10 }), (parts) => {
      const line = parts.join("");
      assert.equal(back(P.inline(line)), line);
    }));
  });

  test("only https links become links", () => {
    fc.assert(fc.property(fc.array(piece, { maxLength: 10 }), (parts) => {
      for (const s of P.inline(parts.join(""))) if (s.link !== undefined) assert.match(s.link, /^https:\/\/[^\s<>]+$/);
    }));
  });

  test("rendering any file makes only the policy's own elements, and no script, handler or foreign link", () => {
    const { window } = new JSDOM("<!doctype html><main></main>");
    const doc = window.document;
    fc.assert(fc.property(fc.array(piece, { maxLength: 30 }), (parts) => {
      const root = doc.createElement("main");
      P.render(doc, root, P.parse(parts.join("")));
      for (const el of root.querySelectorAll("*")) {
        assert.ok(["h1", "h2", "p", "ul", "li", "strong", "code", "a"].includes(el.localName), el.localName);
        for (const a of el.attributes) assert.ok(["href", "target", "rel"].includes(a.name), a.name);
        if (el.localName === "a") assert.match(el.getAttribute("href"), /^https:\/\//);
      }
    }));
  });
});
