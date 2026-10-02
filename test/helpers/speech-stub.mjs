// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// A stubbed speech engine inside Kotiko's content script in Chromium (slice 34 e2e and
// screenshots). Page scripts and Playwright's page.evaluate run in the page's world, which
// can't reach the content script's KotikoSpeak; the Chrome DevTools Protocol can evaluate
// in the extension's isolated world, so the stub goes there:
//
//   const speech = await stubSpeech(page, voices);   // after the page has swapped
//   await speech.spoken()                             // [{ text, lang, voice, rate }]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VOICES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/speech/voices.json");
export const voiceLists = () => JSON.parse(fs.readFileSync(VOICES, "utf8"));

// Finds the content script's execution context in this page (main frame).
async function isolatedContext(page) {
  const cdp = await page.context().newCDPSession(page);
  const contexts = [];
  cdp.on("Runtime.executionContextCreated", ({ context }) => contexts.push(context));
  await cdp.send("Runtime.enable");
  const deadline = Date.now() + 5000;
  for (;;) {
    const ctx = contexts.find((c) => c.auxData?.type === "isolated" && String(c.origin).startsWith("chrome-extension://") && c.auxData?.isDefault === false);
    if (ctx) return { cdp, id: ctx.id };
    if (Date.now() > deadline) throw new Error("No Kotiko content script context in this page");
    await new Promise((r) => setTimeout(r, 50));
  }
}

export async function evalInContentScript(page, expression) {
  const { cdp, id } = await isolatedContext(page);
  const res = await cdp.send("Runtime.evaluate", { expression, contextId: id, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
  return res.result.value;
}

// Replaces the content script's speech engine with one that has `voices` and records what
// it is asked to say. `settings` are slice 34's speech settings (allowOnline, rate).
export async function stubSpeech(page, voices, settings = {}) {
  const { cdp, id } = await isolatedContext(page);
  const expression = `(() => {
    const voices = ${JSON.stringify(voices)};
    const spoken = (globalThis.__kotikoSpoken = []);
    const synth = {
      getVoices: () => voices,
      speak(u) {
        spoken.push({ text: u.text, lang: u.lang, voice: u.voice && u.voice.name, rate: u.rate });
        setTimeout(() => u.onend && u.onend(), 200);
      },
      cancel() {},
      addEventListener() {},
    };
    class Utterance { constructor(text) { this.text = text; } }
    const s = KotikoSpeak.createSpeaker({ synth, Utterance });
    s.configure({ ...KotikoSpeak.DEFAULTS, ...${JSON.stringify(settings)} });
    Object.assign(KotikoSpeak, s);
    return true;
  })()`;
  const res = await cdp.send("Runtime.evaluate", { expression, contextId: id, returnByValue: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
  return {
    async spoken() {
      const r = await cdp.send("Runtime.evaluate", { expression: "JSON.stringify(globalThis.__kotikoSpoken || [])", contextId: id, returnByValue: true });
      return JSON.parse(r.result.value);
    },
  };
}
