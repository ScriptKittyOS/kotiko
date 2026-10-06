// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// "Your data" in the dashboard (slice 12): back up, export to a spreadsheet or Anki, restore
// a backup with a preview and Undo, and delete everything. Loaded on first use, with
// lib/backup.js and lib/export-files.js, so the dashboard's first view doesn't pay for it.
// Files are made here and downloaded through an <a download> link (no `downloads`
// permission); restores and deletes run in the background.
//
//   const tools = KotikoDataTools.create(ctx);   ctx: see create()
//   tools.exportBackup({ settings }); tools.exportCsv(scope); tools.exportAnki(scope);
//   tools.chooseBackup(); tools.restoreText(text, filename); tools.undoRestore();
//   tools.deleteEverything()
(() => {
  const B = () => globalThis.KotikoBackup;
  const F = () => globalThis.KotikoExportFiles;
  // How long a download link stays alive before its Blob URL is revoked; "delete
  // everything" waits this long so the backup is written before anything is deleted.
  const CONSUME_MS = 1500;
  const RESPELL_BATCH = 20; // slice 09: one respell request covers up to 20 words
  const primary = (tag) => String(tag ?? "").split("-")[0];

  // ctx: { el, t, I18n, send, ext, dialog, toast, langName, bases(), allRecords(),
  //        viewRecords(), addBases(tags), includeSettings(), onWipe(), refresh() }
  function create(ctx) {
    const { el, t, ext } = ctx;
    // The background's answer, or its error thrown with slice 25's code.
    async function send(msg) {
      const r = await ctx.send(msg);
      if (r && r.error !== undefined) {
        const e = typeof r.error === "object" && r.error ? r.error : { message: r.error };
        throw Object.assign(new Error(String(e.message ?? r.error)), { code: r.code ?? e.code ?? "internal", details: r.details ?? e.details ?? {} });
      }
      return r;
    }
    let notetypes = null;

    const nowMs = () => Date.now();
    const version = () => {
      try {
        return ext.runtime.getManifest().version;
      } catch {
        return "";
      }
    };

    // Saves `text` as a file; resolves once the link has had time to be read.
    function download(text, name, type) {
      const url = URL.createObjectURL(new Blob([text], { type }));
      const a = el("a", { href: url, download: name, hidden: true });
      document.body.append(a);
      a.click();
      a.remove();
      return new Promise((resolve) => setTimeout(() => {
        URL.revokeObjectURL(url);
        resolve();
      }, CONSUME_MS));
    }

    // ── exports ────────────────────────────────────────────────────────

    async function settingsNow() {
      const local = await ext.storage.local.get(null);
      let sync = {};
      try {
        sync = await ext.storage.sync.get({ ui: {} });
      } catch {
        // no storage.sync here
      }
      return B().settingsOf({ local, sync });
    }

    // The JSON backup of every word (section 2), straight from where the words live.
    async function exportBackup({ settings = ctx.includeSettings(), wait = false } = {}) {
      const { words = [] } = await send({ type: "words.list" });
      const doc = B().exportDoc({ words, settings: settings ? await settingsNow() : null, version: version(), now: nowMs() });
      const name = F().filename("backup", nowMs());
      const saved = download(B().stringify(doc), name, "application/json");
      await send({ type: "backup.saved" }).catch(() => {});
      ctx.refresh();
      ctx.toast({ text: t("data_saved_file", { file: name }) });
      if (wait) await saved;
      return { name, count: doc.words.length };
    }

    const records = (scope) => (scope === "filter" ? ctx.viewRecords() : ctx.allRecords());
    const header = (id) => t(`export_csv_col_${id}`);

    function exportCsv(scope = "all") {
      const name = F().filename("csv", nowMs());
      download(F().csv(records(scope), { header, langName: ctx.langName }), name, "text/csv;charset=utf-8");
      ctx.toast({ text: t("data_saved_file", { file: name }) });
    }

    async function loadNotetypes() {
      if (notetypes) return notetypes;
      try {
        notetypes = (await (await fetch(ext.runtime.getURL("data/anki-notetypes.json"))).json()).names ?? {};
      } catch {
        notetypes = {};
      }
      return notetypes;
    }

    // The Anki export (section 4), after "My Anki is in", which picks the stock note type's
    // name in Anki's own interface language.
    async function exportAnki(scope = "all") {
      const names = await loadNotetypes();
      const list = records(scope);
      const ui = ctx.I18n.locale();
      const locales = Object.keys(names);
      const pick = locales.find((l) => l.toLowerCase() === ui.toLowerCase()) ?? locales.find((l) => primary(l) === primary(ui)) ?? "";
      const display = (l) => {
        try {
          return new Intl.DisplayNames([ui], { type: "language" }).of(l) ?? l;
        } catch {
          return l;
        }
      };
      const select = el("select", { class: "field", id: "ankiLocale" },
        ...locales.map((l) => [l, display(l)]).sort((a, b) => a[1].localeCompare(b[1], ui)).map(([l, label]) => el("option", { value: l, selected: l === pick }, label)),
        el("option", { value: "" }, t("data_anki_elsewhere")));
      select.value = pick;
      const go = el("button", { class: "btn btn-primary", type: "button", "data-action": "anki-download", onclick: () => {
        const name = F().filename("anki", nowMs());
        const notetype = select.value ? names[select.value] ?? null : null;
        download(F().anki(list, { langName: ctx.langName, careful: (p) => t("popover_careful", { pronunciation: p }), notetype }), name, "text/plain;charset=utf-8");
        d.close(true);
        ctx.toast({ text: t("data_saved_file", { file: name }) });
      } }, t("data_anki_download"));
      const d = ctx.dialog({
        title: t("data_anki_title"),
        body: el("div", { class: "data-dialog" },
          el("label", { class: "field-label", for: "ankiLocale" }, t("data_anki_locale")),
          select,
          el("p", { class: "field-help" }, t("data_anki_howto"))),
        actions: [el("button", { class: "btn btn-secondary", type: "button", onclick: () => d.close(false) }, t("dash_cancel")), go],
      });
      select.focus();
    }

    // ── restoring a backup (section 5) ─────────────────────────────────

    function chooseBackup() {
      const input = el("input", { type: "file", accept: ".json,application/json", hidden: true });
      input.addEventListener("change", async () => {
        const f = input.files?.[0];
        input.remove();
        if (f) await restoreFile(f);
      });
      document.body.append(input);
      input.click();
    }

    async function restoreFile(file) {
      if (file.size > B().MAX_BYTES) return problem("too_big");
      return restoreText(await file.text(), file.name);
    }

    function problem(code, details = {}) {
      const key = { backup_newer: "data_restore_newer", too_big: "data_restore_too_big", too_many: "data_restore_over_cap" }[code] ?? "data_restore_unreadable";
      ctx.toast({ text: t(key, { max: (details.max ?? B().MAX_WORDS).toLocaleString(ctx.I18n.locale()) }), error: true });
      return { ok: false, code };
    }

    const respellKey = (base) => !!globalThis.KOTIKO_SPEC?.lang?.[primary(base)]?.respelling;

    async function restoreText(text, filename = "") {
      const read = B().read(text, { now: nowMs() });
      if (!read.ok) return problem(read.code, read.details);
      let preview;
      try {
        preview = await send({ type: "backup.preview", words: read.words });
      } catch (e) {
        ctx.toast({ text: t("data_restore_failed"), error: true });
        return { ok: false, code: e?.code ?? "internal" };
      }
      return new Promise((resolve) => showPreview({ read, preview, filename, resolve }));
    }

    function showPreview({ read, preview, filename, resolve }) {
      const fmt = (n) => Number(n).toLocaleString(ctx.I18n.locale());
      const st = { restoreDeleted: preview.restoreDeleted, settings: !!read.settings, pron: true, missingDone: false, busy: false, preview };
      const counts = el("ul", { class: "data-counts" });
      const extra = el("div", { class: "data-options" });
      const notice = el("div", { class: "data-notice", hidden: true });
      const err = el("p", { class: "field-error", role: "alert", hidden: true });
      const go = el("button", { class: "btn btn-primary", type: "button", "data-action": "restore" });
      const needPron = read.words.filter((w) => !w.pronunciation && respellKey(w.base_lang)).length;
      const missing = read.bases.filter((b) => !ctx.bases().includes(b));

      function render() {
        const c = st.preview.counts;
        // replaceChildren() writes a null as the text "null": the optional lines are filtered.
        counts.replaceChildren(...[
          el("li", { class: "num" }, t("data_restore_new", { count: c.new })),
          el("li", { class: "num" }, t("data_restore_merge", { count: c.merge })),
          el("li", { class: "num" }, t("data_restore_identical", { count: c.identical })),
          c.kept ? el("li", { class: "num" }, t("data_restore_kept", { count: c.kept })) : null,
          el("li", { class: "num" }, t("data_restore_invalid", { count: read.invalid.length })),
          read.dropped.length ? el("li", { class: "num" }, t("data_restore_dropped", { count: read.dropped.length })) : null,
        ].filter(Boolean));
        const rows = [];
        if (c.deletedLater) {
          rows.push(el("label", { class: "check-row" }, el("input", { type: "checkbox", checked: st.restoreDeleted, "data-action": "restore-deleted", onchange: (e) => repreview(e.target.checked) }), t("data_restore_deleted", { count: c.deletedLater })));
        }
        if (read.settings) rows.push(el("label", { class: "check-row" }, el("input", { type: "checkbox", checked: st.settings, "data-action": "restore-settings", onchange: (e) => { st.settings = e.target.checked; render(); } }), t("data_restore_settings")));
        if (needPron && preview.home === "local") {
          rows.push(el("label", { class: "check-row" }, el("input", { type: "checkbox", checked: st.pron, "data-action": "restore-pronunciations", onchange: (e) => (st.pron = e.target.checked) }), t("data_restore_pron", { count: needPron, lookups: fmt(Math.ceil(needPron / RESPELL_BATCH)) })));
        }
        extra.replaceChildren(...rows);
        if (read.invalid.length) {
          extra.append(el("details", { class: "data-invalid" }, el("summary", {}, t("data_restore_invalid_list")),
            el("ul", {}, ...read.invalid.slice(0, 50).map((x) => el("li", { dir: "auto" }, x.native ?? `#${x.index + 1}`)))));
        }
        const names = missing.map((b) => ctx.langName(b)).join(", ");
        notice.hidden = !missing.length || st.missingDone;
        notice.replaceChildren(
          el("p", {}, t("data_restore_bases", { languages: names })),
          el("div", { class: "set-actions" },
            el("button", { class: "btn btn-secondary btn-sm", type: "button", "data-action": "add-bases", onclick: async () => {
              await ctx.addBases(missing);
              st.missingDone = true;
              render();
            } }, t("data_restore_add_bases", { languages: names })),
            el("button", { class: "btn btn-quiet btn-sm", type: "button", "data-action": "import-anyway", onclick: () => {
              st.missingDone = true;
              render();
            } }, t("data_restore_anyway"))),
        );
        const n = c.new + c.merge;
        go.disabled = st.busy || (!n && !st.settings);
        go.textContent = n ? t("data_restore_button", { count: n }) : st.settings ? t("data_restore_settings_only") : t("data_restore_nothing");
      }

      async function repreview(on) {
        st.restoreDeleted = on;
        try {
          st.preview = await send({ type: "backup.preview", words: read.words, restoreDeleted: on });
        } catch {
          // keep the last counts
        }
        render();
      }

      go.addEventListener("click", async () => {
        st.busy = true;
        err.hidden = true;
        render();
        try {
          const n = st.preview.counts.new + st.preview.counts.merge;
          let res = { counts: { new: 0, merge: 0, failed: 0 } };
          if (n) res = await send({ type: "backup.restore", words: read.words, restoreDeleted: st.restoreDeleted, label: filename, pronunciations: st.pron });
          if (st.settings && read.settings) await restoreSettings(read.settings);
          d.close(true);
          const restored = res.home === "server" ? (res.counts.created ?? 0) + (res.counts.updated ?? 0) : (res.counts.new ?? 0) + (res.counts.merge ?? 0);
          ctx.refresh();
          ctx.toast({
            text: [t("data_restore_done", { count: restored }), res.counts.failed ? t("data_restore_some_failed", { count: res.counts.failed }) : null].filter(Boolean).join(" "),
            undo: n ? { run: () => undoRestore() } : null,
          });
          resolve({ ok: true, ...res });
        } catch (e) {
          st.busy = false;
          err.textContent = e?.code === "vocabulary_full" ? t("data_restore_full", { max: fmt(e.details?.max ?? B().MAX_WORDS) }) : t("data_restore_failed");
          err.hidden = false;
          render();
        }
      });
      const d = ctx.dialog({
        title: t("data_restore_title", { file: filename || "kotiko-backup.json" }),
        body: el("div", { class: "data-dialog" }, el("p", { class: "num" }, t("data_restore_in_file", { count: read.total })), counts, notice, extra, err),
        actions: [el("button", { class: "btn btn-secondary", type: "button", onclick: () => d.close(false) }, t("dash_cancel")), go],
        onClose: (v) => v !== true && resolve({ ok: false, code: "cancelled" }),
      });
      render();
      go.focus();
    }

    async function restoreSettings(s) {
      const current = await ext.storage.local.get(null);
      const { local, sync } = B().settingsPatch(s, { current });
      if (Object.keys(local).length) await ext.storage.local.set(local);
      if (Object.keys(sync).length) {
        try {
          const { ui = {} } = await ext.storage.sync.get({ ui: {} });
          await ext.storage.sync.set({ ui: { uiLang: "auto", ...ui, ...sync, ...(sync.baseLangs ? { baseLangsConfirmed: true } : {}) } });
        } catch {
          // no storage.sync: the local copy of the bases still works
        }
      }
    }

    async function undoRestore() {
      try {
        const r = await send({ type: "backup.undo" });
        if (!r.ok) return ctx.toast({ text: t("data_undo_none"), error: true });
        ctx.refresh();
        ctx.toast({ text: [t("data_undo_done"), r.changed ? t("data_undo_changed", { count: r.changed }) : null].filter(Boolean).join(" ") });
        return r;
      } catch {
        ctx.toast({ text: t("data_restore_failed"), error: true });
        return { ok: false };
      }
    }

    // ── delete everything (section 6) ──────────────────────────────────

    async function deleteEverything() {
      let info;
      try {
        info = await send({ type: "data.describe" });
      } catch {
        info = { words: 0, providerKey: false, server: null, syncReal: false };
      }
      const box = (action, checked, label) => el("label", { class: "check-row" }, el("input", { type: "checkbox", checked, "data-action": action }), label);
      const backup = box("backup-first", true, t("data_delete_backup_first"));
      const syncBox = info.syncReal ? box("clear-sync", false, t("data_delete_sync")) : null;
      const serverBox = info.server
        ? box("delete-server", false, info.server.words === null ? t("data_delete_server_unknown", { server: info.server.url }) : t("data_delete_server", { count: info.server.words, server: info.server.url }))
        : null;
      const what = [t("data_delete_words", { count: info.words }), t("data_delete_settings"), info.providerKey ? t("data_delete_key") : null].filter(Boolean);
      const err = el("p", { class: "field-error", role: "alert", hidden: true });
      const cancel = el("button", { class: "btn btn-secondary", type: "button", onclick: () => d.close(false) }, t("dash_cancel"));
      const go = el("button", { class: "btn btn-danger-fill", type: "button", "data-action": "delete-everything" }, info.words ? t("data_delete_confirm", { count: info.words }) : t("data_delete_confirm_none"));
      const d = ctx.dialog({
        title: t("data_delete_title"),
        body: el("div", { class: "data-dialog" },
          el("ul", { class: "data-counts" }, ...what.map((x) => el("li", {}, x))),
          backup, syncBox, serverBox,
          el("p", { class: "field-help" }, t("data_delete_cant")),
          err),
        actions: [cancel, go],
      });
      cancel.focus();
      go.addEventListener("click", async () => {
        go.disabled = true;
        cancel.disabled = true;
        err.hidden = true;
        go.textContent = t("data_deleting");
        const checked = (n) => !!n?.querySelector("input")?.checked;
        try {
          if (checked(backup)) await exportBackup({ wait: true });
          ctx.onWipe(true);
          await send({ type: "data.deleteAll", confirm: "delete-everything", server: checked(serverBox), sync: checked(syncBox) });
        } catch (e) {
          ctx.onWipe(false);
          go.disabled = false;
          cancel.disabled = false;
          go.textContent = info.words ? t("data_delete_confirm", { count: info.words }) : t("data_delete_confirm_none");
          err.textContent = e?.details?.status !== undefined || /^server_|http_error|not_kotiko_server/.test(e?.code ?? "") ? t("data_delete_server_failed") : t("data_delete_failed");
          err.hidden = false;
          return;
        }
        try {
          localStorage.clear();
        } catch {
          // no localStorage here
        }
        d.close(true);
        done();
      });
    }

    function done() {
      const close = async () => {
        try {
          const tab = await ext.tabs?.getCurrent?.();
          if (tab?.id !== undefined) return void (await ext.tabs.remove(tab.id));
        } catch {
          // not a tab
        }
        globalThis.close?.();
      };
      // The welcome page (22) in a tab of its own; this one, showing nothing now, closes.
      const start = el("button", { class: "btn btn-primary", type: "button", "data-action": "start-again", onclick: async () => {
        await send({ type: "welcome.open" }).catch(() => {});
        await close();
      } }, t("data_delete_start_again"));
      ctx.dialog({
        title: t("data_delete_done"),
        body: null,
        actions: [el("button", { class: "btn btn-secondary", type: "button", "data-action": "close-tab", onclick: close }, t("data_delete_close")), start],
      });
      start.focus();
    }

    return { exportBackup, exportCsv, exportAnki, chooseBackup, restoreFile, restoreText, undoRestore, deleteEverything };
  }

  globalThis.KotikoDataTools = { create };
})();
