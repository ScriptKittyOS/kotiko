# Decisions

Decisions already made, so slices don't reopen them. Newest first. Each says who decided
and why. Open questions live in each slice's own "Open questions" section and in the
[index](README.md#open-questions-for-the-maintainers).

## 2026-10-06

**Dependency licenses follow the Apache Software Foundation's categories.** *Lead agent,
delegated.* The maintainer: "you do this you are the coding agent i am the inventor" (on
confirming the license list in the dependency policy). Category A licenses (Apache-2.0,
MIT, BSD, ISC, 0BSD, Zlib, Unicode-3.0, CC0 and others) are allowed in anything Kotiko
ships; Category B (MPL-2.0, EPL-2.0, OFL-1.1 fonts, CC-BY media) only unmodified, labelled
and recorded here; Category X (GPL, LGPL, AGPL, SSPL, BUSL, non-commercial terms) never.
Source: <https://www.apache.org/legal/resolved.html>. Everything Kotiko ships today is
Apache-2.0, MIT, public domain (SQLite) or Unicode-3.0 (CLDR data).

**Maintainers are repository collaborators, and governance changes like any other
decision.** *Maintainer.* "That is not how I have it set up in my other projects so that is
not how it should be done here. I cant add him to the team as an admin and there are no
seats available", and on GOVERNANCE.md's 7-day, all-maintainers rule: "that is not what i do
with the other repos". Kotiko now follows the maintainer's other projects (Trinity): the
maintainers are collaborators with the Maintain role (no GitHub team), the tag ruleset makes
tags permanent instead of limiting who creates them, GOVERNANCE.md has a Continuity section,
and GOVERNANCE.md changes by pull request recorded here, with no waiting period.

**Kotiko adopts the Developer Certificate of Origin.** *Maintainer.* Asked about the OpenSSF
silver `dco` criterion, which slice 53 had left unmet: "for dco figure out how to get it
met". Every commit is signed off (`git commit -s`), CONTRIBUTING.md explains it, and CI's
required `secrets` job checks every commit of a pull request (`scripts/check-dco.mjs`); bots
and merge commits are exempt. This replaces slice 53's open question 1 and slice 03's "no
sign-off to add". Contributions stay under Apache-2.0 section 5 (inbound = outbound); the DCO
adds the contributor's statement that they may submit them.

## 2026-10-05

**The first public release is v1.0.0.** *Maintainer.* "If we are using versions then it
needs to make sense so that the final release is v1.0.0." 0.2.0 was the last version of the
personal tool. There are no 0.x releases between it and the public launch: release-please is
pinned with `release-as: 1.0.0`, builds for the pre-release security review are
`v1.0.0-rc.N` pre-releases (never sent to the stores), and the first store upload is
`v1.0.0`. After it ships, the pin is removed and versions follow the commits (SemVer). See
[30](30-release-pipeline/SPEC.md) and `docs/stores.md`.

**English is the only interface language required at launch.** *Correction by the agent.*
The maintainer never asked for a Spanish interface. Their Puerto Rico quote (2026-10-01)
was about not assuming English is the reader's language, and "I was only using Spanish as
an example" (2026-10-02) said the same. An agent session added "(English and Spanish
first)" and "the interface stays in English and Spanish at launch" to those entries and
wrote them up as the maintainer's; both parentheticals were the agent's, not the
maintainer's. From now on: every interface string lives in `_locales/en`, which must be
complete. Other locales, including the existing `_locales/es`, are optional and may be
partial; a missing key falls back to English per key, as browsers do. New slices add
English strings only. Store listings, the privacy policy, release notes and docs ship in
English at launch; other languages come from community translators. Supporting readers of
any language (base languages, the respelling tables, swaps on their pages) is unchanged:
that is what the product does, not a translation of its interface. Where a slice spec
still lists Spanish copy as a must-have or an acceptance criterion, this entry overrides it.

## 2026-10-04

**Pronunciations come from Wiktionary, written by rule, not from the model.** *Maintainer.*
Reported: это saved as "eh-TO"; it is EH-ta. Measured: on 40 everyday Russian words the three
free models got the stress right on 60 to 75 % (the stress-marked spelling and the respelling
each wrong a quarter of the time, so preferring either can't fix it), and even when told the
stress they wrote wrong respellings on 15 to 20 %. English Wiktionary's IPA had the stress right
on all 40, and covers nearly every language with lexical stress. "Find a fix that scales":
for a target with lexical stress (`spec/pronunciation.json`), Kotiko reads the IPA on the word's
Wiktionary page when the word is added, and writes the respelling from it with one table per
base language (`ipa` in `spec/lang/<base>/respelling.json`), adding the stress mark for Russian,
Ukrainian and Belarusian; a background pass does the same once for saved words. No language
needs a pack of its own: every target Wiktionary covers works, and a base needs one table. A
word Wiktionary lacks, or whose pronunciations disagree on the stress (homographs: замок), keeps
the model's, labelled AI-generated; the learner's own pronunciation is never replaced. This
sends the word, and only the word, to the Wikimedia Foundation (en.wiktionary.org): the
maintainer agreed ("go for it"), and slice 28's inventory and policy say so. It builds slice
49 section 4a early and changes it: the respelling is written by rule rather than regenerated by
the model. See [49](49-dictionary-verification/SPEC.md).

## 2026-10-02

**Three independent security reviews before the stores, and every claim needs proof.**
*Maintainer.* "We also need a full security run with 3 independent reviewers all bringing
reports back and you reviewing them, ensuring they bring proof of any claims. That is very
important before it hits the store." Before the first upload to the Chrome Web Store or
Firefox Add-ons, three reviewers who don't see each other's work each review the whole
release candidate and report. Every finding, and every "no issue", carries proof:
`path:line`, a reproduction or failing test, and the observed result. The lead reviewer
reruns each proof; only confirmed findings count. Medium and above are fixed with
regression tests and rechecked by a fresh reviewer before the upload. This is a release
gate; the outside review gold asks for (53) is still wanted. See
[54](54-pre-release-security-review/SPEC.md) and [30](30-release-pipeline/SPEC.md).

**Every language works without its own pack.** *Maintainer.* "I was only using Spanish as
an example. This has been so helpful for me and I want to be sure it is useful around the
globe. I am not asking for you to create every lang or only Spanish. If it is a custom
pack for every lang then that seems like too much." Kotiko works for readers of any
language from the first release through what is shared: the browser's word splitting,
casing and language names; the model answering in the learner's language; stopword lists
for about 60 languages imported in one step from stopwords-iso; and one shared table each
for word boundaries and capitals, a few lines for each language whose default needs one.
English and Spanish keep the extras already written for them (the respelling key, welcome
words, preview sentences); no other language needs a folder of its own for the release, and
more Full bases come only from native speakers who contribute them. The planned "Good"
level (nine hand-written bases) and the per-base `detect.json` are withdrawn. The interface
stays in English and Spanish at launch, with other languages from community translators
(*agent's wording, not the maintainer's; corrected 2026-10-05: only English is required*).
See [50](50-ui-localization-and-base-language/SPEC.md) §5.

**@KotikoBot is the maintainer's own Telegram bot; there is no public shared bot.**
*Maintainer.* "I don't want to deal with the folks and their accounts." The Telegram bot
stays part of each person's self-hosted server: everyone who runs a server creates their
own bot in @BotFather (the README suggests a name like `yourname_kotiko_bot`).
@KotikoBot is reserved for the maintainer's server and as a demonstration. This confirms
the earlier decision against a hosted service: no accounts, no shared word storage, no
lookups paid for others. See [41](41-telegram-improvements/SPEC.md).

**The project's domain is kotiko.org, on Cloudflare.** *Maintainer.* The docs site lives at
`https://kotiko.org/` (other languages, such as `/es/`, when translators add them); the extension's docs links and the OpenRouter
sign-in callback use it. Cloudflare's proxy adds the security headers GitHub Pages can't,
which gold's `hardened_site` needs. See [44](44-docs-site/SPEC.md) and
[53](53-openssf-best-practices/SPEC.md).

**Kotiko passed the first name screen.** *Maintainer.* No registered or pending KOTIKO
trademark in the US, and no KOTIKO product in language learning, browser extensions or
Telegram bots; risk looks low. The EUIPO search and a same-day store check remain before
the first submission ([04](04-rename-to-kotiko/SPEC.md) section 8).

**Goal: the OpenSSF Best Practices badge at silver.** *Maintainer.* Register for passing
the day the repository goes public (a private repository can't earn it, and the badge's
repository URL can only change every 180 days, so register under the final
`ScriptKittyOS/kotiko`), then work toward silver. Gold is limited by time, more
contributors and an outside security review. See [53](53-openssf-best-practices/SPEC.md).

**Pronunciation is its own field, written for the learner, and audio ships before release.**
*Maintainer.* Reported: the hover showed "pazhaluysta" for пожалуйста, which is said
"pa-ZHAL-sta" (and спасибо is "spa-SEE-ba"). Cause: one `romanization` field asked the
model for "Latin pronunciation" with no rules, so it returned a spelling transliteration,
inconsistently. Decided: split it into `romanization` (the standard Latin-letter spelling,
for typing and search) and `pronunciation` (a learner respelling with syllables and the
stressed one in capitals, written in the conventions of the learner's base language, so a
Spanish speaker gets a Spanish-style respelling). The hover shows the word with its stress
mark, then the pronunciation, then the romanization. The prompt gets exact rules and
examples and the golden set checks stress and vowel reduction; dictionary data (slice 49)
checks the model where available, and the hover marks unchecked pronunciations as
AI-generated. Browser audio (slice 34) moves from P1 to P0. Saved words get their
pronunciation refreshed once. See [07](07-word-model-v2/SPEC.md), [09](09-shared-word-spec-and-prompt/SPEC.md),
[19](19-word-popover/SPEC.md), [34](34-pronunciation-audio/SPEC.md), [36](36-grammar-and-senses/SPEC.md)
and [49](49-dictionary-verification/SPEC.md).

## 2026-10-01

**The mascot is a black kitten named Mira, and the name story is the maintainer's.**
*Maintainer.* Kotiko comes from Russian котик ("kitty"), slightly bent the way a learner
bends a word. The kitten mascot is named Mira, whose name hides "look" (Spanish),
"wonderful" (Latin) and "of the world / of peace" (Russian мира). The full story is in
[05](05-brand-identity/SPEC.md), its single source, and is used as written. The product name
stays Kotiko; "Mira" is the character, not the product, and she is named only after install
(docs, the welcome tab's About), never in store listings: the rename was to get out of the
"Mira" crowd in those stores. The Spanish story is written by a native writer from a brief
(open with the Russian and Latin meanings; let the Spanish one land last), not translated.

**The name is Kotiko.** *Maintainer.* Chosen after "Mira" was withdrawn. Slice 04 renames the
code, data paths, service, extension and repository from Slovo to Kotiko, with the same safe
data migration. The images that showed the name "Mira" (the mockup sheet and its source
file) are deleted; the maintainer is making new artwork with the Kotiko name. Entries below
this one use "Mira", the working name at the time; read it as Kotiko. The name's story and
its collision screen are open ([05](05-brand-identity/SPEC.md), [04](04-rename-to-kotiko/SPEC.md)).

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
all text in translation files from the first release (English and Spanish first; *the
parenthetical is the agent's, not the maintainer's; corrected 2026-10-05: only English is
required*). This
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
with orange eyes and a purple outline (`brand/source/mira-original.png`, since deleted),
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
[04](04-rename-to-kotiko/SPEC.md).

**Not a product; a free open-source tool from ScriptKittyOS.** *Maintainer.* No paid tier,
no hosted accounts. Optimise for people running it themselves with as little setup as
possible.

**Any language, mixed however the learner likes.** *Maintainer.* One language, a chosen
set, or all of them. A new language starts the moment its first word is added.

**Default model: free OpenRouter models, not a local model.** *Maintainer.* The local Ollama
model on the maintainer's machine isn't suited to this. Any OpenAI-compatible API stays
possible.

**Encoded-path auth bypass fixed immediately.** *Synthesis.* `/%61pi/words` skipped the
token check ([06 F01](../docs/research/06-adversarial-qa.md)). Fixed in commit 2693809 before
the plan was written: deny by default, only `/health` is open, bodies are parsed after auth
and capped at 64 KB. The rest of that work is in [01](01-api-auth-hardening/SPEC.md).
