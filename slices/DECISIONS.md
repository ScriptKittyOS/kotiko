# Decisions

Decisions already made, so slices don't reopen them. Newest first. Each says who decided
and why. Open questions live in each slice's own "Open questions" section and in the
[index](README.md#open-questions-for-the-maintainers).

## 2026-10-01

**"Mira" is withdrawn; the final name is still to be chosen.** *Maintainer.* A trademark
clearance screen rated "Mira" high risk (moderate-to-high even with a descriptor). Closest
conflicts: Avant's "Mira powered by Avant", AI language-learning tools sold under the name
since 2025 (Mira Stride won a 2026 EdTech Awards category); Mira Translator, an
open-source extension that already saves and highlights words on pages; and @mira, a
large Telegram AI bot. Until a new name is chosen, "Mira" in these slices is a working
placeholder only. Slice 04 (the rename) is on hold, nothing is renamed in code, data
paths or the repository, and no public listing, store account or artwork uses the name.
The entry "The name is Mira" below is superseded.

**English is not the base language. The base language is whatever the learner uses.**
*Maintainer.* "If someone in Puerto Rico has an all-Spanish browser and the confetti is
waiting on English to be done, then no surprise." Mira swaps words on pages written in the
learner's own language(s), whatever they are, and English is just another language
someone can learn. Defaults: base languages come from the browser's languages at install,
editable on the welcome tab and in settings; a learner can have several (bilingual readers
get swaps on pages in each); word meanings are stored in the learner's base language, not
in an `english` field; the model answers in the base language; coverage and celebrations
count words on base-language pages; Mira's interface follows the browser's language, with
all text in translation files from the first release (English and Spanish first). This
moves base-language support from P2 to P0 and touches the word model, prompt, matcher,
page-language rules, coverage, onboarding and every UI slice. See
[50](50-ui-localization-and-base-language/SPEC.md).

**First run: the learner asks for their own first word, and it's celebrated.** *Maintainer.*
"Prompt the user to talk to the LLM and ask how to say the word hello in whatever language,
then it can say congrats, you got your first word, with confetti, or some other word, let
the user choose. It will be their favorite, they will get a reward and remember it even if
it is the only one they see." The welcome tab connects the learner's own AI, invites them to
ask for any word in any language ("hello" is the suggestion), shows the card, and on one tap
celebrates the first word with confetti before showing it swapped into a sentence. See
[22](22-first-run-onboarding/SPEC.md) and [32](32-page-coverage-and-celebrations/SPEC.md).

**No starter packs or word packs. Every word is one the learner chose.** *Maintainer.* "That
would never be helpful for real people. I only know certain words. I want full control and
to add either one at a time or bulk; no one wants to have to delete words or find them."
Mira never adds a word the learner didn't ask for: no bundled lists, no hosted or
subscribed packs, and nothing pushed by a teacher or a server without the learner accepting
it. Learners add words one at a time (popup, dashboard, right-click, Telegram) or in bulk
(paste a list or drop a file, with a review step). Slices 23 and 47 are dropped, and first
run starts from the learner's own first word. Following from this, a server
that does the lookup previews candidates and saves nothing until the learner accepts
(`"preview": true` on slice 07's add route; slice 24).

**Security and conduct reports go to security@scriptkittyos.com.** *Maintainer.* SECURITY.md's
email fallback and the code of conduct's enforcement contact. `hello@scriptkittyos.com`
stays the general and store-listing contact. See [03](03-oss-foundations/SPEC.md).

**Buttons and menus stay in the learner's own language.** *Maintainer.* Words inside
buttons, menus and labels are never swapped by default, so controls like "Delete" and
"Send" always read as expected. See [16](16-what-not-to-swap/SPEC.md).

**Learners bring their own key and their own model, entered on a full extension page.**
*Maintainer.* Each learner uses their own LLM: an OpenRouter key (free models by default),
another provider, or a model on their own machine. The key is typed on the welcome tab or in
the dashboard's settings, never in the popup, and is stored where web pages can't reach it.
See [11](11-local-first-mode/SPEC.md), [21](21-dashboard/SPEC.md) and
[22](22-first-run-onboarding/SPEC.md).

**The server is supported on every platform we can: Docker, Linux, macOS and Windows.**
*Maintainer.* All four are official and tested in CI. See
[40](40-server-packaging-docker/SPEC.md).

**Logo: the maintainer's kitten, on tile purple `#8E5EFA`.** *Maintainer.* A black kitten
with orange eyes and a purple outline ([`brand/source/mira-original.png`](../brand/source/mira-original.png)),
now the extension icon at every size on a `#8E5EFA` tile (from the artist's mockup; it
passes the contrast checks). The illustrations in `brand/illustrations/` (Mira on the moon
with greetings in six languages, and curious, happy, sleepy and oops expressions) are
placeholders cropped from the mockup until the artist delivers full-resolution files and
correctly sized store artwork. `#8E5EFA` is the input for the design system's palette
([06](06-design-system/SPEC.md)). See [`brand/README.md`](../brand/README.md).

**Store publisher: ScriptKittyOS, contact hello@scriptkittyos.com.** *Maintainer.* Both the
Chrome Web Store and Firefox Add-ons listings are published under the ScriptKittyOS
organization, with `hello@scriptkittyos.com` as the public contact, so no personal email
appears and others in the org can manage releases. See
[28](28-privacy-and-store-readiness/SPEC.md) and [30](30-release-pipeline/SPEC.md).

**License: Apache-2.0.** *Maintainer.* For the code. Word packs get their own content
license in [23](23-starter-packs/SPEC.md). See [03](03-oss-foundations/SPEC.md).

**Celebrations are on by default.** *Maintainer.* Gentle, once per milestone, a calm
alternative under reduced motion, and an off switch. See
[32](32-page-coverage-and-celebrations/SPEC.md).

**Language precedence: one stable language per English word per page.**
*Decided in synthesis, from [research 01](../docs/research/01-language-mixing.md).*
When several shown languages know the same English word, Mira picks one with a weighted,
seeded choice (word, page, day). Every "thanks" in one article is the same word, a reload
looks the same, and variety comes across pages and days. Round-robin within a page (the
behavior before this plan) stays available as the "Mix within the page" option. The UX
research worried about words changing language mid-read; this design removes that.
See [18](18-language-precedence-and-mixing/SPEC.md).

**Local first; the server becomes optional.**
*Decided in synthesis, from [research 04](../docs/research/04-architecture-release.md) and
[05](../docs/research/05-learner-ux.md); matches the maintainer's "since it's local, you can
even drop files".* The extension keeps words itself and calls a model with the user's
own key. The Elixir server stays as an add-on for Telegram, voice notes, multi-device sync and
families. Rejected: server-only (non-developers can't set it up) and a free hosted instance
for everyone (one key's free quota can't serve many people, plus abuse and data protection
obligations). See [11](11-local-first-mode/SPEC.md).

**Celebrations ship in P1, tastefully.** *Maintainer request; design from research 01.*
When most of a page's English is words you've learned, Mira can mark the moment, confetti
included. Once per milestone, never on every page, a quiet alternative under reduced motion,
and an off switch. See [32](32-page-coverage-and-celebrations/SPEC.md).

**Bulk add by pasting a whole list or dropping files.** *Maintainer.* Paste many words at
once, or drop CSV, TSV, TXT, JSON or Anki exports. Lines that already have a translation
skip the model entirely. See [13](13-bulk-add/SPEC.md).

**A full dashboard for all your words.** *Maintainer.* A complete page with a live view of
every word, alongside the popup. See [21](21-dashboard/SPEC.md).

**Design bar: original, calm and premium, with the fewest possible steps.** *Maintainer.*
"A design that Apple would be jealous of." Colors easy on every eye and comfortable across
cultures; light and dark mode. The maintainer loves burnt orange with purples, and blues
where they fit. The interface must not look like other dashboards or dropdowns, and users
reach their goal in as few steps as possible, whatever the load on the backend.
See [05](05-brand-identity/SPEC.md), [06](06-design-system/SPEC.md),
[20](20-popup-redesign/SPEC.md) and [21](21-dashboard/SPEC.md).

**Logo: no eye, no speech bubble.** *Maintainer.* An eye was rejected (and it suggests
surveillance on an extension that reads pages); a speech bubble reads as a chat app.
Superseded by the kitten logo above.

**The name is Mira.** *Maintainer.* The word means something different, and good, in many
languages, which is what the tool does with words: "look!" in Spanish, Italian and
Portuguese; "world" and "peace" in Russian (мир, мира); "wonderful" in Latin, the name of
the star Mira Ceti. It replaces "Slovo" (Russian for "word"), which was tied to one
language and collides with an existing language-learning app. See
[04](04-rename-to-mira/SPEC.md).

**Not a product; a free open-source tool from ScriptKittyOS.** *Maintainer.* No paid tier,
no hosted accounts. Optimise for people running it themselves with as little setup as
possible.

**Any language, mixed however the learner likes.** *Maintainer.* One language, a chosen
set, or all of them. A new language starts the moment its first word is added.

**Default model: free OpenRouter models, not a local model.** *Maintainer.* The local Ollama
model on the maintainer's machine isn't suited to this. Any OpenAI-compatible API stays
possible.

**Encoded-path auth bypass fixed immediately.** *Synthesis.* `/%61pi/words` skipped the
token check ([06 F01](../docs/research/06-adversarial-qa.md)). Fixed in commit 4705cb0 before
the plan was written: deny by default, only `/health` is open, bodies are parsed after auth
and capped at 64 KB. The rest of that work is in [01](01-api-auth-hardening/SPEC.md).
