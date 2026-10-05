// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// The popup's parts that load on first use (slice 24 §6-§8): the language picker, with every
// language Kotiko knows, and "Add it yourself", the manual form. The popup starts from
// scratch on every open, so these stay out of its first view (popup.js loads this file).
//
//   const more = KotikoPopupMore.create({ el, t, icon, send, langName, I18n, ext });
//   await more.pickLanguage({ anchor, first })      -> "es" | null
//   more.manualForm({ text, lang, first, bases, onSave, onCancel })   -> <form>
(() => {
  // Bases whose meanings may be one character long (24 §7).
  const SHORT_FORMS = new Set(["zh", "ja"]);
  const primary = (tag) => String(tag ?? "").split("-")[0].toLowerCase();

  function create({ el, t, icon, langName, I18n, ext }) {
    // Its styles come with it.
    if (!document.querySelector('link[href="popup-more.css"]')) document.head.append(el("link", { rel: "stylesheet", href: "popup-more.css" }));
    let all = null;
    // Every language Kotiko knows, with its own name, read once from the shared data.
    function allLanguages() {
      all ??= fetch(ext.runtime.getURL("spec/languages.json"))
        .then((r) => r.json())
        .then((d) => Object.entries(d.languages ?? {}).filter(([, v]) => !v.sign).map(([lang, v]) => ({ lang, name: langName(lang), endonym: v.endonym ?? "" })))
        .catch(() => []);
      return all;
    }

    // A dialog with a search box: the learner's languages first, every other by name, its
    // own name or its code. Resolves with the tag, or null when closed.
    function pickLanguage({ anchor = null, first = [] }) {
      return new Promise((resolve) => {
        const list = el("ul", { class: "picker-list", role: "listbox", "aria-label": t("lang_picker_title") });
        const search = el("input", { class: "field", type: "search", placeholder: t("lang_search"), "aria-label": t("lang_search"), "aria-controls": "pickerList" });
        list.id = "pickerList";
        const dialog = el("dialog", { class: "picker", "aria-label": t("lang_picker_title") }, search, list);
        const done = (lang) => {
          dialog.close?.();
          dialog.remove();
          anchor?.focus();
          resolve(lang);
        };
        const option = (o) => el("li", { role: "option" }, el("button", { type: "button", class: "picker-option", "data-lang": o.lang, onclick: () => done(o.lang) },
          el("span", {}, o.name), o.endonym && o.endonym !== o.name ? el("span", { class: "picker-endonym", lang: o.lang, dir: "auto" }, o.endonym) : null));
        const show = async () => {
          const q = search.value.trim().toLocaleLowerCase(I18n.locale());
          const mine = first.map((lang) => ({ lang, name: langName(lang), endonym: "" }));
          const match = (o) => !q || o.name.toLocaleLowerCase().includes(q) || o.endonym.toLocaleLowerCase().includes(q) || o.lang === q;
          const rest = q ? (await allLanguages()).filter((o) => !first.includes(o.lang) && match(o)).slice(0, 30) : [];
          const shown = [...mine.filter(match), ...rest];
          list.replaceChildren(...(shown.length ? shown.map(option) : [el("li", { class: "picker-none" }, t("lang_none"))]));
        };
        search.addEventListener("input", show);
        dialog.addEventListener("cancel", (e) => (e.preventDefault(), done(null)));
        dialog.addEventListener("click", (e) => e.target === dialog && done(null));
        document.body.append(dialog);
        show();
        dialog.showModal?.();
        search.focus();
      });
    }

    // Whether readers of `base` have a respelling key, so a typed pronunciation can be
    // checked against it (09); without one the field stays hidden.
    const respells = (base) => fetch(ext.runtime.getURL(`spec/lang/${primary(base)}/respelling.json`)).then((r) => r.ok).catch(() => false);

    // "Add it yourself" (24 §7): the word, a meaning per language read (the first required),
    // its language, and optionally its romanization, pronunciation and a note. Never asks
    // a model; saved as one record per meaning.
    function manualForm({ text = "", lang = null, first = [], bases = ["en"], onSave, onCancel }) {
      const field = (name, label, attrs = {}) => {
        const input = el("input", { class: "field", name, dir: "auto", autocomplete: "off", ...attrs });
        return [input, el("label", { class: "manual-field" }, el("span", { class: "field-label" }, label), input)];
      };
      const [native, nativeRow] = field("native", t("manual_native"), { value: text, maxlength: "64", required: "" });
      const meanings = bases.map((b, i) => field(`meaning-${b}`, t("manual_meaning", { base: langName(b) }), { lang: b, maxlength: "64", ...(i ? {} : { required: "" }) }));
      let chosen = lang;
      const langButton = el("button", { class: "btn btn-quiet btn-sm", type: "button", "data-action": "language", "aria-haspopup": "dialog" });
      const showLang = () => langButton.replaceChildren(chosen ? langName(chosen) : t("manual_choose_language"), icon("chevron", 12));
      showLang();
      langButton.addEventListener("click", async () => {
        const picked = await pickLanguage({ anchor: langButton, first });
        if (picked) chosen = picked;
        showLang();
      });
      const [romanization, romRow] = field("romanization", t("manual_romanization"));
      const [pronunciation, pronRow] = field("pronunciation", t("manual_pronunciation"));
      pronRow.hidden = true;
      respells(bases[0]).then((ok) => (pronRow.hidden = !ok));
      const [note, noteRow] = field("note", t("manual_note"), { maxlength: "200" });
      const error = el("p", { class: "manual-error", role: "alert" });
      let confirmed = false;
      const save = el("button", { class: "btn btn-primary btn-sm", type: "submit", "data-action": "save" }, t("manual_save"));

      // The shared rules (09, 24 §7), with the message for the first that fails.
      function problem() {
        const gloss = meanings[0][0].value.trim();
        if (!native.value.trim()) return t("manual_need_native");
        if (!gloss) return t("manual_need_meaning", { base: langName(bases[0]) });
        if (!chosen) return t("manual_need_language");
        const own = bases.find((b) => primary(b) === primary(chosen));
        if (own) return t("manual_same_base", { base: langName(own) });
        for (const [m, b] of meanings.map(([m], i) => [m, bases[i]])) {
          for (const f of m.value.split(/\s*[,、，]\s*/u).filter(Boolean)) if ([...f].length < (SHORT_FORMS.has(primary(b)) ? 1 : 2)) return t("manual_too_short", { form: f });
        }
        return null;
      }

      const form = el("form", { class: "manual-form", "aria-label": t("add_manual") },
        nativeRow, ...meanings.map(([, row]) => row),
        el("div", { class: "manual-field" }, el("span", { class: "field-label" }, t("manual_language")), langButton),
        romRow, pronRow, noteRow, error,
        el("div", { class: "job-more" }, save, el("button", { class: "link link-quiet", type: "button", "data-action": "cancel", onclick: () => onCancel?.() }, t("add_cancel"))));
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const bad = problem();
        if (bad) return void (error.textContent = bad);
        // Spelled the same as its meaning: fine for loanwords, but asked once.
        const same = native.value.trim().toLocaleLowerCase() === meanings[0][0].value.trim().toLocaleLowerCase();
        if (same && !confirmed) {
          confirmed = true;
          error.textContent = t("manual_same_spelling", { base: langName(bases[0]) });
          save.textContent = t("manual_save_anyway");
          return;
        }
        save.disabled = true;
        const res = await onSave({
          native: native.value.trim(),
          lang: chosen,
          meanings: meanings.map(([m], i) => ({ base_lang: bases[i], gloss: m.value.trim() })).filter((m) => m.gloss),
          romanization: romanization.value.trim() || null,
          pronunciation: pronRow.hidden ? null : pronunciation.value.trim() || null,
          note: note.value.trim() || null,
        });
        save.disabled = false;
        // The form checks first; what the background still refuses reads in plain words (25).
        if (res?.error) error.textContent = globalThis.KotikoErrors.message(res);
      });
      return form;
    }

    return { pickLanguage, manualForm, allLanguages };
  }

  const api = { create };
  globalThis.KotikoPopupMore = api;
})();
