// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Bulk add in the dashboard (slice 13): paste a list or drop a file, review every row,
// look up the ones without a meaning, save them all in one batch with one Undo. The rows
// come from bulk/parse.js; the words are saved through the dashboard's word source, so it
// works the same with words in this browser and on a server. Nothing is saved before
// "Add {n} words".
//
//   const sheet = KotikoBulkSheet.create(ctx);   ctx: see create()
//   host.append(sheet.node); sheet.open({ text }); sheet.files(fileList)
(() => {
  const P = () => globalThis.KotikoBulkParse;
  const SHOWN = 100; // rows rendered at once; "Show more" adds as many
  const SAVE_CHUNK = 500; // the batch route's limit (07)
  const LOOKUPS_AT_ONCE = 2;
  const MIN_FORM = (base) => (["zh", "ja"].includes(String(base).split("-")[0]) ? 1 : 2);
  const RESTORABLE = ["gloss", "forms", "romanization", "native_vocalized", "pronunciation", "pronunciation_careful", "pronunciation_source", "note", "status", "sense"];
  // The language a script usually means, to offer when the chosen one can't be right.
  const SCRIPT_LANG = { Hang: "ko", Hira: "ja", Kana: "ja", Hani: "zh", Cyrl: "ru", Arab: "ar", Grek: "el", Hebr: "he", Thai: "th", Deva: "hi", Geor: "ka", Armn: "hy" };
  const lower = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  const formText = (f) => (typeof f === "string" ? f : f?.text);

  // ctx: { el, t, icon, I18n, langName, source, send, ext, bases(), records(), defaultLang(),
  //        pickLanguage({title, exclude}), toast({text}), seeBatch(ids), lookupStatus(),
  //        restoreBackup({text, filename}) }
  function create(ctx) {
    const { el, t, icon, langName } = ctx;
    const st = { text: "", filename: null, decoded: null, built: null, rows: [], base: null, target: null, swap: null, roles: null, shown: SHOWN, filter: null, saving: false, summary: null, message: null, pron: true, lookups: 0 };
    let seq = 0;
    let timer = 0;

    const area = el("textarea", { class: "field bulk-text", id: "bulkText", rows: "5", dir: "auto", spellcheck: "false", "aria-label": t("bulk_title"), "aria-describedby": "bulkHint", placeholder: [t("bulk_paste"), t("bulk_example_1"), t("bulk_example_2"), t("bulk_example_3"), t("bulk_example_4")].join("\n") });
    const fileInput = el("input", { type: "file", accept: ".txt,.csv,.tsv,.json,text/plain,text/csv,application/json", hidden: true, onchange: () => files(fileInput.files) });
    const hint = el("p", { class: "bulk-hint", id: "bulkHint" }, t("bulk_drop_hint"), " ", el("button", { class: "btn btn-secondary btn-sm", type: "button", "data-action": "choose-file", onclick: () => fileInput.click() }, t("bulk_choose_file")));
    const controls = el("div", { class: "bulk-controls" });
    const notes = el("div", { class: "bulk-notes", role: "status" });
    const review = el("div", { class: "bulk-review" });
    const node = el("section", { class: "bulk", "aria-label": t("bulk_title") }, area, fileInput, hint, controls, notes, review);
    area.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => setText(area.value, null), 150);
    });

    // ── reading ──────────────────────────────────────────────────────────

    function open({ text = "" } = {}) {
      st.base ??= ctx.bases()[0] ?? "en";
      st.target ??= ctx.defaultLang() ?? null;
      if (text) {
        area.value = text;
        setText(text, null);
      } else render();
    }

    async function files(list) {
      const f = list?.[0];
      if (!f) return;
      if (st.rows.some((r) => r.edited) && !globalThis.confirm?.(t("bulk_replace_confirm"))) return;
      const decoded = P().decode(new Uint8Array(await f.arrayBuffer()));
      if (decoded.error) return fail(t(decoded.error === "too_big" ? "bulk_too_big" : "bulk_unreadable"));
      st.decoded = decoded;
      area.value = decoded.text;
      await setText(decoded.text, f.name);
    }

    const fail = (message) => {
      st.message = message;
      st.rows = [];
      render();
    };

    async function setText(text, filename) {
      st.text = text;
      st.filename = filename;
      st.summary = null;
      if (filename === null && st.decoded) st.decoded = null;
      if (!text.trim()) {
        st.rows = [];
        st.message = null;
        return render();
      }
      const read = P().read(text, { filename: filename ?? "" });
      if (read.error) return fail(t({ spreadsheet: "bulk_spreadsheet", apkg: "bulk_apkg" }[read.error] ?? "bulk_unreadable"));
      // Kotiko's own backup is restored, not reviewed as a list (slice 12 section 5).
      if (read.format === "kotiko-backup") {
        if (!ctx.restoreBackup) return fail(t("bulk_backup"));
        area.value = "";
        st.text = "";
        st.rows = [];
        render();
        return ctx.restoreBackup({ text, filename });
      }
      st.read = read;
      st.message = null;
      st.roles = null;
      st.swap = null;
      await rebuild();
    }

    // Rows from what was read, with the learner's choices (columns, swap, languages).
    async function rebuild() {
      const n = ++seq;
      const stopwords = await stopwordsOf(st.base);
      const built = await P().build(st.read, {
        base: st.base,
        target: st.target,
        langs: globalThis.KOTIKO_SPEC?.languages?.languages ?? {},
        stopwords,
        detect: (text) => ctx.ext.i18n?.detectLanguage?.(text.slice(0, 4000)),
        htmlToText: (html) => new DOMParser().parseFromString(html, "text/html").body.textContent ?? "",
        roles: st.roles,
        swap: st.swap,
        // Kotiko's CSV headers in the interface language (slice 12 §3).
        headers: ctx.csvHeaders?.() ?? null,
      });
      if (n !== seq) return;
      st.built = built;
      st.roles = built.roles;
      st.rows = built.rows.map((r, i) => ({ ...r, id: i, ticked: true, edited: false, state: r.lookup ? "needs" : null }));
      st.shown = SHOWN;
      st.filter = null;
      classify();
      render();
    }

    // The base's common words (50 §5): its own list, else the shared one.
    const stopCache = new Map();
    async function stopwordsOf(base) {
      const own = globalThis.KOTIKO_SPEC?.lang?.[base]?.stopwords;
      if (own?.length) return new Set(own);
      if (!stopCache.has(base)) {
        stopCache.set(base, fetch(ctx.ext.runtime.getURL("spec/lang/_generic/stopwords.json")).then((r) => r.json()).then((d) => new Set(d[base] ?? d[String(base).split("-")[0]] ?? [])).catch(() => new Set()));
      }
      return stopCache.get(base);
    }

    // ── statuses (§4) ────────────────────────────────────────────────────

    const langOf = (r) => r.lang ?? st.target;
    const keyOf = (r) => `${langOf(r)}|${lower(r.native)}|${st.base}`;

    function classify() {
      const Lang = globalThis.KotikoLang;
      const existing = new Map();
      for (const w of ctx.records()) if (!w.deleted_at) existing.set(`${w.lang}|${lower(w.native)}|${w.base_lang ?? "en"}`, w);
      const seen = new Set();
      for (const r of st.rows) {
        r.reason = null;
        r.adds = 0;
        if (r.state === "looking" || (r.state === "needs" && !r.gloss) || (r.state === "needs" && !r.native)) {
          r.status = r.state === "looking" ? "looking" : r.lookup === "find" && !r.native ? "find" : "needs";
          continue;
        }
        const lang = langOf(r);
        const forms = r.forms.length ? r.forms : r.gloss ? [r.gloss] : [];
        if (!r.native) r.reason = "empty";
        else if ([...r.native].length > 64) r.reason = "too_long";
        else if (lang && Lang?.sameBase(lang, st.base)) r.reason = "base";
        else if (forms.some((f) => [...f].length > 64)) r.reason = "meaning_long";
        else if (forms.some((f) => [...f].length < MIN_FORM(st.base))) r.reason = "short";
        if (r.reason) {
          r.status = "problem";
          r.ticked = false;
          continue;
        }
        if (forms.some((f) => lower(f) === lower(r.native))) {
          r.status = "same";
          if (!r.edited) r.ticked = false;
          continue;
        }
        const k = keyOf(r);
        if (seen.has(k)) {
          r.status = "duplicate";
          if (!r.edited) r.ticked = false;
          continue;
        }
        seen.add(k);
        const old = lang ? existing.get(k) : null;
        if (old) {
          const had = new Set((old.forms ?? []).map(formText).map(lower));
          r.adds = forms.filter((f) => !had.has(lower(f))).length + (["romanization", "note"].filter((f) => r[f] && !old[f]).length ? 1 : 0);
          r.status = r.adds ? "adds" : "known";
          if (!r.edited) r.ticked = r.adds > 0;
          continue;
        }
        r.status = "ready";
      }
    }

    // ── lookups (§5) ─────────────────────────────────────────────────────

    async function lookUp() {
      const todo = st.rows.filter((r) => r.ticked && (r.status === "needs" || r.status === "find"));
      for (const r of todo) r.state = "looking";
      st.message = null;
      classify();
      render();
      let stop = null;
      const next = async () => {
        while (!stop) {
          const r = todo.find((x) => x.state === "looking" && !x.asked);
          if (!r) return;
          r.asked = true;
          const text = r.native || r.gloss;
          try {
            const res = await ctx.source.preview(text, { baseLangs: [st.base], hintLang: langOf(r) ?? undefined });
            const c = (res.candidates ?? []).find((x) => (x.base_lang ?? st.base) === st.base) ?? res.candidates?.[0];
            if (!c) {
              r.state = null;
              r.reason = "unclear";
            } else {
              if (r.native && lower(c.native) !== lower(r.native)) r.readAs = { from: r.native, to: c.native };
              Object.assign(r, { native: c.native, gloss: c.gloss, forms: (c.forms ?? []).map(formText).filter(Boolean), romanization: c.romanization ?? r.romanization, pronunciation: c.pronunciation ?? null, lang: c.lang, state: null, found: true });
              st.lookups++;
            }
          } catch (e) {
            if (e?.code === "quota_exhausted" || e?.code === "user_quota_exhausted") stop = "quota";
            else if (["server_unreachable", "offline", "model_unavailable", "lookup_timeout", "rate_limited"].includes(e?.code)) stop = "busy";
            r.asked = false;
            if (!stop) {
              r.state = null;
              r.reason = "unclear";
            }
          }
          classify();
          render();
        }
      };
      await Promise.all(Array.from({ length: LOOKUPS_AT_ONCE }, next));
      if (stop) {
        const back = todo.filter((r) => r.state === "looking");
        for (const r of back) r.state = "needs";
        st.message = { key: stop === "quota" ? "bulk_quota_out" : "bulk_lookups_busy", count: back.length, later: back };
      }
      classify();
      render();
    }

    // The rest as add jobs (24), which wait for lookups to come back and save on their own.
    async function later(rows) {
      for (const r of rows) {
        await ctx.send({ type: "add", id: globalThis.crypto.randomUUID(), text: r.native || r.gloss, ...(langOf(r) ? { hintLang: langOf(r) } : {}), baseLangs: [st.base], surface: "dashboard" });
        r.ticked = false;
        r.status = "queued";
      }
      st.message = { key: "bulk_saved_for_later", count: rows.length };
      render();
    }

    // ── saving (§6) ──────────────────────────────────────────────────────

    const saveable = () => st.rows.filter((r) => r.ticked && (r.status === "ready" || r.status === "adds"));

    function wordOf(r) {
      const forms = (r.forms.length ? r.forms : [r.gloss]).map((text) => ({ text, enabled: true, case: "any", ambiguous: false }));
      return {
        lang: langOf(r),
        native: r.native,
        // A Kotiko CSV says which base each row's meaning is in (12 §3).
        base_lang: r.base_lang || st.base,
        sense: "",
        gloss: forms[0].text,
        forms,
        romanization: r.romanization || null,
        native_vocalized: r.native_vocalized || null,
        pronunciation: r.pronunciation || null,
        pronunciation_careful: r.pronunciation ? r.pronunciation_careful || null : null,
        pronunciation_source: r.pronunciation ? r.pronunciation_source || (r.found ? "model" : "user") : null,
        note: r.note || null,
        origin: st.filename ? "import" : "bulk",
        source_text: r.source_text ?? null,
        status: "active",
      };
    }

    async function save() {
      const rows = saveable();
      if (!rows.length || !st.target && rows.some((r) => !r.lang) || st.saving) return;
      st.saving = true;
      render();
      const results = [];
      let error = null;
      for (let i = 0; i < rows.length; i += SAVE_CHUNK) {
        try {
          const res = await ctx.source.save(rows.slice(i, i + SAVE_CHUNK).map(wordOf), { requestId: globalThis.crypto.randomUUID() });
          results.push(...(res.results ?? []));
        } catch (e) {
          error = e;
          break;
        }
      }
      // Rows still being looked up continue as add jobs, so closing is safe (§5).
      const pending = st.rows.filter((r) => r.state === "looking");
      if (pending.length) await later(pending);
      const batch = { id: globalThis.crypto.randomUUID(), at: Date.now(), results: results.map((r) => ({ id: r.word?.id, result: r.result, previous: r.previous ?? null, updated_at: r.word?.updated_at ?? null })) };
      // storage.session: kept by the browser for this session, out of content scripts' reach.
      await Promise.resolve(ctx.ext.storage.session?.set({ bulkBatch: batch })).catch(() => {});
      if (st.pron && results.some((r) => r.result === "created" && !r.word?.pronunciation)) ctx.source.refreshJob?.("start").catch(() => {});
      const count = (k) => results.filter((r) => r.result === k).length;
      st.summary = { batch, created: count("created"), updated: count("updated"), unchanged: count("unchanged"), pending: pending.length, lang: st.target, error };
      st.saving = false;
      area.value = "";
      st.rows = [];
      render();
    }

    // Undo for the whole batch (24 §5's rules per word): created words removed, updated
    // ones put back as they were, within a day.
    async function undo() {
      const { batch } = st.summary;
      const ops = batch.results.flatMap((r) =>
        r.result === "created" ? [{ op: "delete", id: r.id }] : r.result === "updated" && r.previous ? [{ op: "patch", id: r.id, patch: Object.fromEntries(RESTORABLE.filter((k) => k in r.previous).map((k) => [k, r.previous[k]])), if_updated_at: r.updated_at }] : [],
      );
      const failed = [];
      for (let i = 0; i < ops.length; i += 1000) failed.push(...(await ctx.source.write(ops.slice(i, i + 1000))).filter((x) => !x.ok && x.code !== "word_gone"));
      await Promise.resolve(ctx.ext.storage.session?.remove("bulkBatch")).catch(() => {});
      st.summary = { ...st.summary, undone: true, undoFailed: failed.length };
      render();
    }

    // ── rendering ────────────────────────────────────────────────────────

    const STATUS = {
      ready: ["success", "bulk_status_ready"],
      needs: ["info", "bulk_status_needs"],
      find: ["info", "bulk_status_find"],
      looking: ["clock", "bulk_status_looking"],
      known: ["check", "bulk_status_known"],
      adds: ["add", "bulk_status_adds"],
      duplicate: ["info", "bulk_status_duplicate"],
      same: ["warning", "bulk_status_same"],
      problem: ["error", "bulk_status_problem"],
      queued: ["clock", "bulk_status_queued"],
    };
    const statusText = (r) => t(STATUS[r.status][1], { count: r.adds, lang: langName(langOf(r) ?? ""), reason: r.reason ? t(`bulk_problem_${r.reason}`) : "" });

    function render() {
      hint.hidden = st.rows.length > 0 || !!st.summary;
      area.rows = st.rows.length ? 3 : 5;
      renderControls();
      notes.replaceChildren(...noteLines());
      review.replaceChildren(...(st.summary ? summaryView() : st.rows.length ? reviewView() : []));
    }

    function renderControls() {
      const bases = ctx.bases();
      const learn = el("button", { class: "btn btn-quiet btn-sm", type: "button", "data-action": "learning", onclick: chooseTarget }, st.target ? langName(st.target) : t("manual_choose_language"), icon("chevron", 12));
      const meanings = bases.length > 1
        ? el("select", { class: "field field-sm", "data-action": "meanings", onchange: (e) => ((st.base = e.target.value), st.read ? rebuild() : render()) }, bases.map((b) => el("option", { value: b, selected: b === st.base }, langName(b))))
        : null;
      controls.replaceChildren(
        el("span", { class: "bulk-control" }, el("span", { class: "field-label" }, t("bulk_learning")), learn),
        // Only with more than one language read: replaceChildren would write a null as "null".
        ...(meanings ? [el("label", { class: "bulk-control" }, el("span", { class: "field-label" }, t("bulk_meanings_in")), meanings)] : []),
      );
    }

    async function chooseTarget() {
      const lang = await ctx.pickLanguage({ title: t("bulk_learning"), exclude: new Set(ctx.bases()) });
      if (!lang) return;
      st.target = lang;
      if (st.read) await rebuild();
      else render();
    }

    function noteLines() {
      const out = [];
      if (st.decoded?.warning) out.push(el("p", { class: "bulk-note" }, icon("warning", 16), t("bulk_not_utf8")));
      if (st.message?.key) {
        const actions = st.message.later?.length ? [el("button", { class: "link", type: "button", "data-action": "later", onclick: () => later(st.message.later) }, t("bulk_save_later", { count: st.message.later.length }))] : [];
        out.push(el("p", { class: "bulk-note" }, icon("info", 16), t(st.message.key, { count: st.message.count }), " ", ...actions));
      } else if (st.message) out.push(el("p", { class: "bulk-note bulk-error", role: "alert" }, icon("error", 16), st.message));
      for (const n of st.built?.notes ?? []) if (n.key === "too_many") out.push(el("p", { class: "bulk-note" }, icon("info", 16), t("bulk_over_limit")));
      // Most words in a script the chosen language can't be written in.
      const script = mostScript();
      const guess = script && SCRIPT_LANG[script];
      if (st.target && guess && !P().scriptsOf(st.target, globalThis.KOTIKO_SPEC?.languages?.languages ?? {}).has(script) && !globalThis.KotikoLang?.sameBase(guess, st.base)) {
        out.push(el("p", { class: "bulk-note" }, icon("warning", 16), t("bulk_script_hint", { lang: langName(guess) }), " ",
          el("button", { class: "link", type: "button", "data-action": "use-guess", onclick: async () => ((st.target = guess), await rebuild()) }, t("bulk_script_use", { lang: langName(guess) }))));
      }
      if (st.built?.question && st.rows.length) {
        const { a, b } = st.built.question;
        out.push(el("p", { class: "bulk-note", "data-kind": "question" }, I18n().parts("bulk_which", { a: el("b", { dir: "auto" }, a), b: el("b", { dir: "auto" }, b) }), " ",
          el("button", { class: "btn btn-secondary btn-sm", type: "button", "data-action": "learn-a", onclick: () => setSwap(false) }, a),
          el("button", { class: "btn btn-secondary btn-sm", type: "button", "data-action": "learn-b", onclick: () => setSwap(true) }, b)));
      }
      return out;
    }
    const I18n = () => ctx.I18n;

    function mostScript() {
      const counts = new Map();
      for (const r of st.rows.slice(0, 500)) {
        const s = r.native && P().scriptOf(r.native);
        if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
      }
      const [best] = [...counts].sort((x, y) => y[1] - x[1]);
      return best && best[1] > st.rows.length / 2 ? best[0] : null;
    }

    async function setSwap(flip) {
      st.swap = flip;
      await rebuild();
    }

    function reviewView() {
      const counts = new Map();
      for (const r of st.rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
      const head = el("p", { class: "bulk-counts" }, t("bulk_count_words", { count: st.rows.length }), ...[...counts].map(([s, n]) => [" · ", el("button", { class: `link link-quiet${st.filter === s ? " is-current" : ""}`, type: "button", "data-status": s, onclick: () => ((st.filter = st.filter === s ? null : s), render()) }, `${n} ${statusText({ status: s, adds: 2 }).toLocaleLowerCase()}`)]));
      const mapping = st.roles ? columnsRow() : el("p", { class: "bulk-mapping" }, el("button", { class: "btn btn-quiet btn-sm", type: "button", "data-action": "swap", onclick: () => setSwap(!(st.swap ?? false)) }, icon("restore", 14), t("bulk_swap")));
      const rows = st.rows.filter((r) => !st.filter || r.status === st.filter);
      const showRom = st.rows.some((r) => r.romanization);
      const showPron = st.rows.some((r) => r.pronunciation);
      const showLang = new Set(st.rows.map(langOf)).size > 1;
      const th = (key) => el("th", { scope: "col" }, t(key));
      const table = el("table", { class: "bulk-table" },
        el("thead", {}, el("tr", {}, el("th", { scope: "col" }, el("span", { class: "sr-only" }, t("bulk_col_add"))), th("bulk_col_word"), th("bulk_col_meaning"), showRom ? th("manual_romanization") : null, showPron ? th("manual_pronunciation") : null, showLang ? th("manual_language") : null, th("bulk_col_status"))),
        el("tbody", {}, rows.slice(0, st.shown).map((r) => rowView(r, { showRom, showPron, showLang }))));
      const more = rows.length > st.shown ? el("button", { class: "btn btn-quiet btn-sm", type: "button", "data-action": "more", onclick: () => ((st.shown += SHOWN), render()) }, t("bulk_show_more", { count: Math.min(SHOWN, rows.length - st.shown) })) : null;
      return [head, mapping, el("div", { class: "bulk-scroll" }, table), more, footer()];
    }

    // The column mapping for tables, with Swap (§3 "Columns").
    function columnsRow() {
      const ROLES = ["side0", "side1", "romanization", "pronunciation", "note", "lang", "ignore"];
      const label = (role) => t(`bulk_role_${role === "side0" || role === "native" || role.startsWith("native:") ? "word" : role === "side1" || role === "gloss" ? "meaning" : role}`);
      const flip = () => {
        st.roles = st.roles.map((r) => (r === "side0" || r === "native" ? "side1" : r === "side1" || r === "gloss" ? "side0" : r));
        rebuild();
      };
      return el("p", { class: "bulk-mapping" }, st.roles.map((role, i) => el("label", { class: "bulk-control" }, el("span", { class: "field-label" }, t("bulk_column", { n: i + 1 })),
        el("select", { class: "field field-sm", "data-column": String(i), onchange: (e) => ((st.roles = st.roles.map((x, k) => (k === i ? e.target.value : x))), rebuild()) },
          ROLES.map((x) => el("option", { value: x, selected: x === role || (x === "side0" && (role === "native" || role.startsWith("native:"))) || (x === "side1" && role === "gloss") }, label(x)))))),
      el("button", { class: "btn btn-quiet btn-sm", type: "button", "data-action": "swap", onclick: flip }, icon("restore", 14), t("bulk_swap")));
    }

    function rowView(r, { showRom, showPron, showLang }) {
      const cell = (field, value, lang) => el("td", {}, el("input", { class: "field field-sm", value: value ?? "", dir: "auto", lang: lang || null, "aria-label": t(`bulk_col_${field === "gloss" ? "meaning" : field === "native" ? "word" : field}`), "data-field": field, onchange: (e) => edit(r, field, e.target.value) }));
      const [ic] = STATUS[r.status];
      return el("tr", { "data-status": r.status, "data-row": String(r.id) },
        el("td", {}, el("label", { class: "bulk-check" }, el("input", { type: "checkbox", checked: r.ticked, disabled: r.status === "problem" || r.status === "queued", "aria-label": t("bulk_col_add"), onchange: (e) => ((r.ticked = e.target.checked), render()) }))),
        cell("native", r.native, langOf(r)),
        cell("gloss", (r.forms.length ? r.forms : [r.gloss]).filter(Boolean).join(", "), st.base),
        showRom ? cell("romanization", r.romanization) : null,
        showPron ? cell("pronunciation", r.pronunciation) : null,
        showLang ? el("td", {}, langName(langOf(r) ?? "")) : null,
        el("td", { class: "bulk-status" }, icon(ic, 14), " ", statusText(r), r.readAs ? el("span", { class: "bulk-row-note" }, I18n().parts("bulk_read_as", { from: el("bdi", {}, r.readAs.from), to: el("bdi", {}, r.readAs.to) })) : null,
          r.reason === "too_long" ? el("button", { class: "link", type: "button", "data-action": "split", onclick: () => split(r) }, t("bulk_split")) : null));
    }

    function edit(r, field, value) {
      r.edited = true;
      if (field === "gloss") {
        r.forms = value.split(/\s*[,;/、，／]\s*/u).filter(Boolean);
        r.gloss = r.forms[0] ?? "";
      } else r[field] = value.trim();
      if (r.native && r.gloss) r.state = null;
      r.ticked = true;
      classify();
      render();
    }

    // A sentence pasted as one row: one row per word, by 14's tokenizer for its language.
    function split(r) {
      const Text = globalThis.KotikoText;
      const words = Text ? Text.tokenize(r.native, langOf(r) ?? st.base).map((x) => r.native.slice(x.start, x.end)) : r.native.split(/\s+/u);
      const i = st.rows.indexOf(r);
      st.rows.splice(i, 1, ...words.map((w, k) => ({ ...r, id: `${r.id}.${k}`, native: w, gloss: "", forms: [], state: "needs", lookup: "explain", reason: null, ticked: true })));
      classify();
      render();
    }

    function footer() {
      const need = st.rows.filter((r) => r.ticked && (r.status === "needs" || r.status === "find")).length;
      const left = ctx.lookupStatus()?.quota?.remaining;
      const cost = need ? (Number.isFinite(left) ? t("bulk_cost_left", { count: need, left }) : t("bulk_cost", { count: need })) : null;
      const n = saveable().length;
      const noLang = !st.target && saveable().some((r) => !r.lang);
      const respell = st.rows.some((r) => (r.status === "ready" || r.status === "adds") && !r.pronunciation);
      return el("div", { class: "bulk-footer" },
        need ? el("p", {}, t("bulk_need_meaning", { count: need }), " ", el("button", { class: "btn btn-secondary btn-sm", type: "button", "data-action": "look-up", onclick: lookUp }, t("bulk_look_up")), " ", el("span", { class: "bulk-cost" }, cost)) : null,
        respell ? el("label", { class: "bulk-control" }, el("input", { type: "checkbox", checked: st.pron, "data-action": "pronunciations", onchange: (e) => (st.pron = e.target.checked) }), t("bulk_pronunciations")) : null,
        el("p", { class: "bulk-actions" },
          el("button", { class: "btn btn-primary", type: "button", "data-action": "save", disabled: !n || st.saving || noLang, onclick: save }, noLang ? t("manual_choose_language") : t("bulk_add", { count: n })),
          el("button", { class: "link link-quiet", type: "button", "data-action": "cancel", onclick: cancel }, t("add_cancel"))));
    }

    function cancel() {
      area.value = "";
      st.rows = [];
      st.read = null;
      st.message = null;
      ctx.ext.storage.session?.remove("bulkDraft").catch(() => {});
      render();
      area.focus();
    }

    function summaryView() {
      const s = st.summary;
      if (s.undone) return [el("div", { class: "bulk-summary" }, el("p", {}, s.undoFailed ? t("bulk_undo_partly", { count: s.undoFailed }) : t("bulk_undone")))];
      const lines = [
        el("p", { class: "bulk-summary-title" }, icon("success", 18), t("bulk_added", { count: s.created + s.updated, lang: langName(s.lang ?? "") })),
        s.unchanged ? el("p", {}, t("bulk_added_known", { count: s.unchanged })) : null,
        s.updated ? el("p", {}, t("bulk_added_updated", { count: s.updated })) : null,
        s.pending ? el("p", {}, t("bulk_added_pending", { count: s.pending })) : null,
        s.error ? el("p", { class: "bulk-error", role: "alert" }, t("bulk_save_failed")) : null,
      ];
      const ids = s.batch.results.filter((r) => r.result !== "unchanged").map((r) => r.id);
      return [el("div", { class: "bulk-summary", role: "status" }, lines,
        el("p", { class: "bulk-actions" },
          ids.length ? el("button", { class: "btn btn-secondary btn-sm", type: "button", "data-action": "see", onclick: () => ctx.seeBatch(ids) }, t("bulk_see")) : null,
          ids.length ? el("button", { class: "link", type: "button", "data-action": "undo", onclick: undo }, t("add_undo")) : null,
          el("button", { class: "link", type: "button", "data-action": "more-words", onclick: () => ((st.summary = null), render(), area.focus()) }, t("bulk_add_more"))))];
    }

    render();
    return { node, open, files, state: st };
  }

  const api = { create };
  globalThis.KotikoBulkSheet = api;
})();
