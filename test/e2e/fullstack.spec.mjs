// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Full-stack smoke: the real Elixir server (with the fake model from the fixture server
// as its LLM), the real extension, a word added through the popup and seen on a page.
//
// The server runs with `mix run --no-halt` on a random free port, a temporary data
// directory and a fixed token. MIX_ENV defaults to "dev": config/test.exs is for ExUnit
// (no HTTP listener, stubbed HTTP clients, environment ignored), so it can't serve a
// browser. Set FULLSTACK_MIX_ENV to override. Skipped when `mix` isn't installed.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "./fixtures.mjs";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server");
const TOKEN = "fullstack-token-0123456789abcdefghijklmnopq"; // 43 characters
const MIX_ENV = process.env.FULLSTACK_MIX_ENV || "dev";
const BOOT_TIMEOUT_MS = 150_000; // includes compiling on a cold cache

const hasMix = spawnSync("mix", ["--version"], { stdio: "ignore", shell: process.platform === "win32" }).status === 0;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url, child, log) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`The server exited (${child.exitCode}) before it was ready:\n${log.join("")}`);
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`The server didn't answer /health within ${BOOT_TIMEOUT_MS / 1000} s:\n${log.join("")}`);
}

test.describe("full stack", () => {
  test.skip(!hasMix, "`mix` isn't on PATH: install Elixir to run the full-stack smoke (CI runs it).");
  test.describe.configure({ timeout: BOOT_TIMEOUT_MS + 60_000 });

  let child;
  let dataDir;
  let serverUrl;
  const log = [];

  test.beforeAll(async () => {
    const fixtureUrl = process.env.FIXTURE_URL;
    if (!fixtureUrl) throw new Error("FIXTURE_URL isn't set; run the tests through `npm run e2e`.");
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "kotiko-fullstack-"));
    const port = await freePort();
    serverUrl = `http://127.0.0.1:${port}`;

    child = spawn("mix", ["run", "--no-halt"], {
      cwd: SERVER_DIR,
      detached: true, // own process group, so teardown stops the BEAM as well as mix
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        MIX_ENV,
        PORT: String(port),
        BIND: "127.0.0.1",
        API_TOKEN: TOKEN,
        KOTIKO_DATA_DIR: dataDir,
        LLM_URL: `${fixtureUrl}/llm/v1`,
        LLM_MODEL: "fake/model-a:free,fake/model-b:free",
        LLM_API_KEY: "fake-llm-key",
        TELEGRAM_BOT_TOKEN: "",
        ALLOWED_TELEGRAM_IDS: "",
        TRANSCRIBE_URL: "",
        // Self-contained: the real server never asks Wiktionary (slice 49 §4b) in tests.
        KOTIKO_WIKTIONARY: "false",
      },
    });
    child.stdout.on("data", (d) => log.push(String(d)));
    child.stderr.on("data", (d) => log.push(String(d)));
    await waitForHealth(serverUrl, child, log);
  });

  test.afterAll(async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise((r) => child.once("exit", r));
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // already gone
      }
      const timer = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // already gone
        }
      }, 5000);
      await exited;
      clearTimeout(timer);
    }
    if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach("server log", { body: log.join(""), contentType: "text/plain" });
    }
  });

  test("adds a word through the popup on the real server and sees it on basic.html", async ({ context, server, popup }) => {
    const p = await popup.connect(serverUrl, TOKEN);
    await expect(p.locator("#emptyWords")).toBeVisible();

    const added = await popup.add("shukran");
    await expect(added).toHaveText(/^Added شكرا \(shukran\) = thanks · Arabic\s*Undo$/);
    await expect(p.locator("#count")).toHaveText("1 word");

    const modelCalls = (await server.state()).log.filter((r) => r.path === "/llm/v1/chat/completions");
    expect(modelCalls).toHaveLength(1);
    expect(modelCalls[0].auth).toBe("Bearer fake-llm-key");

    const page = await context.newPage();
    await page.goto(server.page("basic.html"));
    await expect(page.locator("#p1")).toHaveText("شكرا for visiting. This house has three rooms and a garden.");
    await expect(page.locator("#p1 kotiko-w")).toHaveAttribute("lang", "ar");

    // Slice 07: adding it again merges instead of overwriting, and the popup names the
    // word with no Undo that could delete the original.
    const again = await popup.add("shukran");
    await expect(again).toHaveText("Already in your list: شكرا");
    await expect(again.locator("button")).toHaveCount(0);
    await expect(p.locator("#count")).toHaveText("1 word");

    // Undo of a new word tombstones it on the server; the next sync drops it.
    const dog = await popup.add("sobaka");
    await expect(dog).toHaveText(/^Added собака \(sobaka\) = dog · Russian\s*Undo$/);
    await expect(p.locator("#count")).toHaveText("2 words");
    await dog.getByRole("button", { name: "Undo adding собака" }).click();
    await expect(p.locator("#jobs li").first()).toHaveText("Removed собака.");
    await expect(p.locator("#count")).toHaveText("1 word");
  });

  // Slice 21 on the real server's /api/v1: add through the preview (nothing saved before
  // the learner's Enter), edit a pronunciation, pause, delete and restore.
  test("the dashboard reads, adds, edits, pauses, deletes and restores on the real server", async ({ context, popup }) => {
    const p = await popup.connect(serverUrl, TOKEN);
    const [dash] = await Promise.all([context.waitForEvent("page"), p.locator("#openDashboard").click()]);
    await expect(dash.locator("#app")).toHaveAttribute("data-ready", "true");
    const row = (native) => dash.locator(".wrow", { has: dash.locator(".w-native", { hasText: native }) });

    await dash.locator("#addWords").click();
    await dash.locator("#addText").fill("kniga");
    await dash.locator("#addText").press("Enter");
    await expect(dash.locator(".add-job.is-done")).toContainText("Added книга");
    await dash.keyboard.press("Escape");
    await expect(row("книга")).toHaveCount(1);

    await row("книга").click();
    const pron = dash.locator("#inspector .pron-field").first();
    await pron.fill("KNEE-ga");
    await pron.press("Enter");
    await expect(dash.locator("#inspector .fld-pron-field .saved").first()).toBeVisible();
    await expect(dash.locator("#inspector .pron-preview b")).toHaveText("KNEE");
    await expect(dash.locator("#inspector .pron-label")).toBeHidden();

    await pron.fill("KNEE-GA");
    await pron.press("Enter");
    await expect(dash.locator("#inspector .fld-pron-field .field-error").first()).toContainText("Write the stressed syllable in capitals");

    await dash.locator(".insp-swap").click();
    await expect(row("книга").locator(".c-status")).toHaveText("Paused");
    await dash.reload();
    await expect(row("книга").locator(".c-status")).toHaveText("Paused");

    await row("книга").click();
    await dash.locator(".insp-delete").click();
    await expect(row("книга")).toHaveCount(0);
    await dash.locator("#toasts .toast-undo").click();
    await expect(row("книга")).toHaveCount(1);
    await dash.reload();
    await expect(row("книга")).toHaveCount(1);
  });

  // Slice 10 on the real server: OpenRouter's own 429 (rate-limit headers) waits and asks
  // the same model again; a repeated lookup is free; a 429 without a wait stops at once
  // with slice 25's words; /api/v1/llm/status reports the models.
  test("429s, the lookup cache and the status route on the real server", async ({ server, popup }) => {
    const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
    const modelCalls = async () => (await server.state()).log.filter((r) => r.path === "/llm/v1/chat/completions").length;
    const preview = (text) =>
      fetch(`${serverUrl}/api/v1/words`, { method: "POST", headers: auth, body: JSON.stringify({ text, base_langs: ["en"], preview: true }) });

    const before = await modelCalls();
    await server.control({ llm: "429-once" });
    const first = await preview("dog in japanese");
    expect(first.status).toBe(200);
    expect((await first.json()).candidates.map((c) => c.native)).toEqual(["犬"]);
    expect(await modelCalls()).toBe(before + 2);

    const again = await preview("Dog in  Japanese");
    expect(again.status).toBe(200);
    expect(await modelCalls()).toBe(before + 2);

    const status = await (await fetch(`${serverUrl}/api/v1/llm/status`, { headers: auth })).json();
    expect(status).toMatchObject({ models: ["fake/model-a:free", "fake/model-b:free"], models_source: "env", quota: null, last_result: "ok" });

    await server.control({ llm: "429" });
    const p = await popup.connect(serverUrl, TOKEN);
    const line = await popup.add("hello");
    await expect(line.locator(".job-text > p")).toHaveText("Word lookup is busy. Try again in a minute.");
    await expect(line.locator('[data-action="retry"]')).toBeVisible();
    expect(await modelCalls()).toBe(before + 3);
    await expect(p.locator("#lookupsLeft")).toBeHidden();
    await server.control({ llm: null });
  });
});
