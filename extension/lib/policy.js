// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The privacy policy's Markdown as DOM (slice 28 §2), for privacy.html. The policy uses a
// small part of Markdown: "#" and "##" headings, paragraphs, "- " lists, **bold**, `code`
// and <https://…> links. Everything becomes elements with text content; no HTML from the
// file is ever parsed. No extension APIs, so it runs in Node tests too.
//
//   KotikoPolicy.parse(markdown)            -> [{type: "h1" | "h2" | "p" | "ul", spans | items}]
//   KotikoPolicy.inline(text)               -> [{text} | {strong} | {code} | {link}]
//   KotikoPolicy.render(document, root, blocks)
(() => {
  // One paragraph's or list item's text as spans.
  function inline(text) {
    const out = [];
    const re = /\*\*([^*]+)\*\*|`([^`]+)`|<(https:\/\/[^\s<>]+)>/g;
    let last = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m.index > last) out.push({ text: text.slice(last, m.index) });
      if (m[1] !== undefined) out.push({ strong: m[1] });
      else if (m[2] !== undefined) out.push({ code: m[2] });
      else out.push({ link: m[3] });
      last = re.lastIndex;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  }

  function parse(md) {
    const blocks = [];
    const body = String(md ?? "").replace(/<!--[\s\S]*?-->/g, "");
    for (const chunk of body.split(/\n\s*\n/)) {
      const lines = chunk.split("\n").filter((l) => l.trim());
      if (!lines.length) continue;
      const h = /^(#{1,2})\s+(.+)$/.exec(lines[0]);
      if (h && lines.length === 1) {
        blocks.push({ type: h[1].length === 1 ? "h1" : "h2", spans: inline(h[2].trim()) });
      } else if (/^- /.test(lines[0])) {
        // A list: each "- " starts an item; indented lines continue it.
        const items = [];
        for (const l of lines) {
          if (/^- /.test(l)) items.push(l.slice(2).trim());
          else items[items.length - 1] += ` ${l.trim()}`;
        }
        blocks.push({ type: "ul", items: items.map(inline) });
      } else {
        blocks.push({ type: "p", spans: inline(lines.map((l) => l.trim()).join(" ")) });
      }
    }
    return blocks;
  }

  function spansTo(doc, parent, spans) {
    for (const s of spans) {
      if (s.text !== undefined) parent.append(doc.createTextNode(s.text));
      else if (s.strong !== undefined) parent.append(Object.assign(doc.createElement("strong"), { textContent: s.strong }));
      else if (s.code !== undefined) parent.append(Object.assign(doc.createElement("code"), { textContent: s.code }));
      else {
        const a = doc.createElement("a");
        a.href = s.link;
        a.textContent = s.link;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        parent.append(a);
      }
    }
  }

  function render(doc, root, blocks) {
    for (const b of blocks) {
      if (b.type === "ul") {
        const ul = doc.createElement("ul");
        for (const item of b.items) {
          const li = doc.createElement("li");
          spansTo(doc, li, item);
          ul.append(li);
        }
        root.append(ul);
      } else {
        const el = doc.createElement(b.type);
        spansTo(doc, el, b.spans);
        root.append(el);
      }
    }
  }

  const api = { parse, inline, render };
  globalThis.KotikoPolicy = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
