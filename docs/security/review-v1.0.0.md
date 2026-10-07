<!--
SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
SPDX-License-Identifier: Apache-2.0
-->

# Security review of v1.0.0

The pre-release security review (slice 54) of Kotiko's first store release. Three reviewers
attacked the first release candidate independently, and the lead reran every proof. The
fixes went through three more candidates, each checked by a fresh reviewer, until a
reviewer confirmed the last round of fixes and found nothing new at medium or above. Every
confirmed finding is fixed by a pull request with a regression test, or recorded below as
an accepted risk with a reason and an issue.

Gate: closed 2026-10-07 by Claude (lead reviewer), fixes confirmed on v1.0.0-rc.4

## Scope and candidates

- **In scope:** `extension/`, `server/`, `spec/`, `scripts/`, `.github/`, the zips built from
  each tag, and the store listings and privacy policy, read against the code.
- **Candidates:** every tag is signed with the release key
  `SHA256:HqIaFq/thUm844NjYC3a+4Br40cqD2yJHEq1L2iiw4E`, and `scripts/verify-tag.sh` passes on
  each.

  | Tag | Commit | Reviewed by | Result |
  |---|---|---|---|
  | `v1.0.0-rc.1` | `cf7378e` | A, B and C (the full review) | 27 findings, 3 of them medium |
  | `v1.0.0-rc.2` | `9b5a6df` | D (fixes, with bypass attempts) | 5 new findings (D-01 to D-05) |
  | `v1.0.0-rc.3` | `088bbea` | E (fixes, page-side checks, the signing scheme) | 7 new findings (E-01 to E-07) |
  | `v1.0.0-rc.4` | `01312d2` | F (E's fixes only) | E's fixes hold; 2 informational findings (F-01, F-02), accepted |

- **Dates:** 2026-10-06 to 2026-10-07.

## Reviewers and independence

- **A:** a hostile web page or model answer.
- **B:** a network neighbour, another local account, a Telegram stranger.
- **C:** the supply chain and the release.
- **D, E and F:** each confirmed the previous round's fixes on the next candidate.
- **Lead:** Claude (Opus 5.5), the coding agent. It is none of the reviewers. The
  maintainer, Ayla Croft, is the final reader.

All six reviewers are AI agents (Claude). Each started in a fresh context, with no access to
the others' notes, and worked in its own clean checkout of its tag (`kotiko-sec-a` to
`kotiko-sec-f`), with its own report folder and its own port range. Every finding and every
"no issue" answer needed proof. The rules forbade real keys, the maintainer's data, the
maintainer's running server, any outward action (no pushes, issues, store, OpenRouter or
Telegram traffic), and the maintainer's identity in any request.

## Findings on rc.1 (reviewers A, B and C)

The lead reran every proof on `cf7378e` and saw the claimed result. None was rejected, and
none was left needing proof. Two pairs are duplicates: A-03 = C-04 and B-09 = C-09. No
finding is critical or high.

| ID | Finding | Severity | Outcome | Fix |
|---|---|---|---|---|
| A-01 | A page reads the learner's word list by planting hidden text and reading Kotiko's swaps (60,652 words recovered in about 4.2 s) | Medium | Fixed: only visible text is swapped; at most 500 words a page view, each in at most 3 languages | #32, #37 |
| B-01 | Another local account receives the server token by listening on `[::1]:4747` | Medium | Fixed: the server holds both loopbacks, and the extension never sends the token; it signs each request (after D-01 and E-01) | #29, #31, #35, #38 |
| C-01 | Release authority is documented but not enforced by repository settings | Medium | Fixed in settings and CI; second-maintainer review is an accepted risk (below) | settings, #28 |
| A-02 | A page's `<html lang>` text appears verbatim in the popup | Low | Fixed | #32 |
| A-03 / C-04 | A page can switch Kotiko off, and detect it where it's paused, off or on a sensitive site | Low | Fixed | #32 |
| A-04 | Page script opens the word card with a synthetic click and probes it with `window.find` | Low | Fixed: untrusted events are ignored, and the card opens only on a word the learner sees (after E-05) | #32, #37 |
| A-05 | Any page can use up a pending "Connect OpenRouter" sign-in | Low | Fixed | #31 |
| A-06 | After "Delete everything", a planted 0.2-style server and token are adopted | Low | Fixed | #31, #32 |
| A-07 | Lookups to paid providers carry no output-token cap | Low | Fixed, in the extension and the server (after D-03) | #31, #34 |
| B-02 | Someone who can write in the data folder chooses the token, or links `kotiko.db` elsewhere | Low | Fixed: the server refuses to start | #29 |
| B-03 | The copy of the words from before the rename stays readable after the move, and `--delete-data` keeps it | Low | Fixed | #29 |
| B-04 | The refused-Host log limiter resets at 1,000 names | Low | Fixed | #29 |
| B-05 | A user name and password in `LLM_URL` are logged at start | Low | Fixed: such addresses are refused | #29 |
| B-06 | No warning when a provider key goes over plain HTTP to another machine | Low | Fixed (and for an upper-case scheme, D-04) | #29, #31, #34 |
| C-02 | A signed rc tag re-pointed as the final tag verifies | Low | Fixed | #28 |
| C-03 | Release tag names can be squatted, and the docs say a bad tag can be deleted | Low | Fixed in settings: only the release manager creates `v*` tags and can delete a wrong one | settings, #28 |
| A-08 | Content scripts can force syncs past the throttle | Info | Fixed | #31 |
| A-09 | Release zips ship the `__kotiko` test hook | Info | Fixed: stripped at build, and the build fails if it remains | #31 |
| B-07 | At debug level, the model's words are logged without `LOG_LOOKUPS` | Info | Fixed | #29 |
| B-08 | `SECURITY.md` and the requirements describe a project with no releases | Info | Fixed | #28 |
| B-09 / C-09 | Weak `API_TOKEN` values are accepted, and wrong tokens aren't throttled | Info | Fixed: a startup warning, and a lockout after 10 wrong tokens a minute from another computer | #29, #35 |
| C-05 | The store check passed on any line starting with the closing phrase | Info | Fixed (and against disguises, D-05 and E-06) | #28, #34, #38 |
| C-06 | AMO receives a zip repacked by web-ext, not the attested one | Info | Fixed: the release zip is uploaded unchanged | #28 |
| C-07 | Detected browser languages reach `storage.sync` before the learner confirms them | Info | Fixed | #31 |
| C-08 | Unseeded and date-dependent tests can fail a release at random (rc.1's did) | Info | Fixed | #28, #30, #31, #32 |
| C-10 | Cloudflare injects scripts into the published site | Info | Fixed in Cloudflare: email obfuscation, NEL, Web Analytics and RUM off; HSTS, CSP and security headers on | settings |
| C-11 | The Firefox and Chrome data declarations disagree about the API key | Info | Fixed: Firefox declares `authenticationInfo` | #28 |

## Findings on rc.2 (reviewer D)

D confirmed 20 of the 27 rc.1 findings fixed outright, rebuilt both zips byte for byte from
the tag, and found:

| ID | Finding | Severity | Outcome | Fix |
|---|---|---|---|---|
| D-01 | A cached server proof let a port squatter receive the token after the server stopped (the lead reproduced 3 tokens received); this reopened B-01 | Low | Fixed: the extension never sends the token; it signs each request and checks a signed answer | #35 |
| D-02 | Shared loopback rate limits let another local program, or a page in Firefox, lock the extension out | Low | Fixed: loopback requests without a forwarding header are exempt; the proof route refuses non-JSON before counting | #35 |
| D-03 | The server's model client sent no output-token cap for `LLM_MODEL` models | Low | Fixed | #34 |
| D-04 | An upper-case `HTTP://` scheme skipped the plain-HTTP warning | Info | Fixed | #34 |
| D-05 | A status line disguised with lookalike letters fooled the store check | Info | Fixed | #34 |

## Findings on rc.3 (reviewer E)

E confirmed D's findings and every rc.1 proof it reran fixed (including the token squatter
in Chromium and Firefox: 0 tokens received), measured the A-01 limits against the privacy
policy, and found:

| ID | Finding | Severity | Outcome | Fix |
|---|---|---|---|---|
| E-01 | A signed request caught while the server was down could be replayed after a restart if the client's clock ran ahead | Low | Fixed: each request is bound to the server's boot | #38 |
| E-02 | Behind a reverse proxy, a stranger could keep the owner's other devices locked out; some forwarding headers weren't recognised | Low | Fixed: more headers recognised; opt-in `TRUSTED_PROXY_HEADER` counts proxied clients apart | #38 |
| E-03 | An API key in `LLM_URL`'s query string was logged | Low | Fixed | #38 |
| E-04 | Text hidden by `filter`, `clip-path` or `mask` was still swapped | Low | Fixed: such text, and text under 10 % opacity, isn't swapped | #37 |
| E-05 | A page could get the word card opened by a hover over a stretched, nearly transparent swap, then read it (the lead reproduced it) | Low | Fixed: the card opens only on a word the learner sees, where it is drawn | #37 |
| E-06 | Fourteen more disguised status lines fooled the store check | Info | Fixed | #38 |
| E-07 | The open routes answered other spellings of their paths | Info | Fixed | #38 |

## Final confirmation (reviewer F, rc.4)

F reran E's proofs, adapted to rc.4, and tried a bypass of each:

| ID | Verdict on rc.4 | What F saw |
|---|---|---|
| E-01 | Fixed | A request caught while the server was down, replayed 0.6 to 1 s after a restart at 0, 30, 90 and 119 s of clock skew, gets `401 stale_boot`; so does the very request D's squatter caught. Boot ids differ on every start, and the open proof route's boot id can't be used without the token |
| E-02 | Fixed, within the documented limits | With `TRUSTED_PROXY_HEADER`, a stranger is locked out and the owner gets through, also when the stranger prepends a fake address. Without it, the shared bucket is documented. Ten rarer forwarding headers are still not recognised, which `configuration.md` says |
| E-03 | Fixed | No form of a query-string key reaches the log, at debug level too; requests still carry the query |
| E-04 | Fixed for the three tricks found; others remain (F-01) | `filter: opacity(0)`, `clip-path` and a transparent mask reveal 0 of 300 words. A transparent text colour, text turned away, and `contrast(0)` still reveal 300, under the 500 cap |
| E-05 | Fixed for the stretched swap; the documented case remains | The hover and clickjack tricks keep the card closed. A disguised word kept under the pointer still opens it on a rest or a click |
| E-06 | Fixed for every known disguise; 8 new ones pass (F-02) | All 30 of D's and E's cases read open; 8 new, contrived ones read closed |
| E-07 | Fixed | Of 287 unsigned requests in 41 spellings, only the exact `GET/HEAD /health` and `POST /api/v1/proof` answer |

The token squatter gets 0 copies of the token (D's proof), every suite passes (`npm test`
2,081, `mix test` 1,205 and 23 properties, Playwright security and full-stack), and the
rc.4 zips rebuild byte for byte from the tag.

**F-01 and F-02 are informational**, so under the stop rule they are accepted risks (below)
with issues: SCR-836 (treat a transparent text colour and text turned away as hidden) and
SCR-837 (read the report the way a CommonMark renderer shows it). The privacy policy is
now version 6, which names every way a page can hide text that Kotiko still swaps.
v1.0.0 differs from rc.4 only in documentation (this report, the privacy policy's wording
and other docs) and the release notes.

One slip: a misquoted test setting sent two of F's test lookups ("shukran", "gato") to
OpenRouter's public endpoint, with no key, token or identity. OpenRouter refused them
(`401`), and F fixed the setting at once.

## Accepted risks

- **No second-maintainer review (C-01, in part).**
  - What is enforced:
    - pull requests only, with the required checks and CodeQL results;
    - the scans read their settings from the base commit;
    - store uploads wait for the maintainer's approval in the `release` environment;
    - only the release manager creates release tags.
  - What is not enforced:
    - a second maintainer's review: one maintainer is active, and the approval rule would
      block every merge;
    - a pull request can also edit the workflow files that run on it.
  - Revisit when the second maintainer reviews regularly (SCR-763).
- **What a page can still learn (A-01, A-04 and E-04, what remains).**
  - A site sees the swaps it shows: at most 500 words a page view, each in at most 3
    languages.
  - A site that reloads itself, or that the learner visits often, learns more over time
    (SCR-763).
  - Tiny, background-coloured, blurred or covered text on screen still counts as visible.
  - While the learner has a word card open, `window.find` can test guesses against its text.
  - A word disguised in the background colour, under the learner's resting pointer, can
    still have its card opened.
  - The privacy policy (version 5) says each of these.
  - The rule for `clip-path` and `mask` is deliberately cautious and may hold back some
    visible text on real sites (SCR-816).
- **Text a page hides in ways Kotiko doesn't detect (F-01)**: a transparent text colour,
  text turned away, `contrast(0)` or `brightness(0)`. It is still swapped, and its card
  can still be opened by a page that keeps it under the pointer. This stays under the
  500-word cap, and the privacy policy says so (SCR-836).
- **The store's report check can still be fooled (F-02)** by eight contrived ways of
  writing a report. Each needs write access to the repository, and the `release`
  environment's approval by the maintainer is the second lock (SCR-837).
- **A squatter that wins a race after the server crashes** can read the body of one write
  sent within 30 s of the last proof. It never gets the token, and it can't replay a request
  to the server.
- **The proof route allows offline guessing of a weak chosen token** (B-01). The token the
  server generates makes this harmless; a weak chosen token gets a warning at every start.
  Programs on the same computer, which aren't rate-limited, can guess the same way.
- **Behind a reverse proxy without `TRUSTED_PROXY_HEADER`**, one stranger's lockout refuses
  every proxied client for that minute. A proxy that adds no forwarding header makes its
  clients look local. Both are documented in `configuration.md`.
- **Clocks:** signed requests need the extension's and the server's clocks within 120 s of
  each other. Kotiko says so when they aren't.

## Coverage

On rc.1 every reviewer answered all nine areas. Reviewer B marked page isolation as partly
checked and supply chain as lightly checked, outside its focus, where A and C went deep.

| Area | A | B | C | Lead and later reviewers |
|---|---|---|---|---|
| 1. Secrets | checked | checked | checked | B-01 and B-05 reproduced; D-01, E-01 and E-03 found and fixed |
| 2. Page isolation | checked | partly (existing suites only) | checked (C-04) | A-01, A-03 and A-04 reproduced; E measured every A-01 variant against the documented limits; E-04 and E-05 found and fixed |
| 3. Injection | checked, including prompts | checked; prompts not checked | checked | A-02 reproduced; prompt injection rests on A alone (no finding) |
| 4. Messaging | checked | checked (sender kinds, 15 cases) | checked | A-08 reproduced |
| 5. Network | checked | checked | checked | B-01 reproduced over `[::1]`; D-02 and E-02 found and fixed |
| 6. Server | checked (no issues) | checked | checked | B-02 to B-07 reproduced; E-07 found and fixed |
| 7. Resource exhaustion | checked | checked (B-04) | checked | B-04 reproduced |
| 8. Supply chain and build | checked (A-09) | lightly (audits, pinning) | checked | A-09, C-02, C-05, C-06 and C-08 reproduced; D and E rebuilt the zips byte for byte from rc.2 and rc.3 |
| 9. Privacy | checked | checked (server side) | checked | C-07, C-10 and C-11 reproduced; the live site checked in Chromium and Firefox |

**Checked later, after rc.1 couldn't:**
- Firefox at runtime (E: the token squatter, A-01, A-03 and A-04);
- the published release assets and their provenance (D and E);
- the page-side bypass variants D couldn't run (E), and new ones on rc.4 (F).

**Not checked by any reviewer:**
- the attestation's Sigstore chain and Rekor inclusion (gh 2.45 has no `attestation`
  command; the provenance subjects and the DSSE signature were checked);
- `install-service.sh` install mode, and the systemd `UMask`;
- B-02 with files owned by a second account (simulated with the same uid);
- a real reverse proxy (simulated with forwarding headers);
- macOS, Windows and WSL;
- live Telegram, OpenRouter, Wiktionary and store traffic, which the rules forbade (stubs
  and fakes only).

The reviewers' reports follow unchanged. Their proof files stayed in their own checkouts,
uncommitted; the regression tests in the fix pull requests replace them.

## Appendix

### Reviewer A, on v1.0.0-rc.1 (a hostile web page or model answer)

# Kotiko v1.0.0-rc.1: security review, reviewer A

<!-- Saved by the lead from Reviewer A's hand-back message, unchanged: the reviewer's sandbox refused report files. Proof logs: poc-playwright.log, poc-node.log, poc-routes.log, poc-bot.log, mix-test.log, npm-test.log, build1.log, server.log in this folder. -->

- **Commit:** `cf7378e` (tag `v1.0.0-rc.1`), clean detached checkout at `/home/aylac/Projects/personal-projects/kotiko-sec-a`. The only change is the untracked `test/security/poc/` folder.
- **Starting attacker:** a hostile web page, and a hostile or confused model answer. All nine threat areas are covered.
- **Independence:** I worked alone. I read no other reviewer's checkout or folder, didn't touch the maintainer's live checkout or server, and did nothing outward-facing.
- **Environment:**
  - Node 22: `npm ci` reported 0 vulnerabilities.
  - Playwright's bundled Chromium with the unpacked extension.
  - Elixir 1.19.2 / OTP 28.
  - The fixture server ran on 127.0.0.1:41234.
  - My local Kotiko server ran on 127.0.0.1:41587 and was stopped by PID afterwards.

## Summary

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | |
| High | 0 | |
| Medium | 1 | A-01 |
| Low | 6 | A-02, A-03, A-04, A-05, A-06, A-07 |
| Informational | 2 | A-08, A-09 |

**The main problem: any web page can silently read the learner's word list (A-01).** It plants hidden dictionary text and reads back the `<kotiko-w>` swaps. This contradicts the privacy policy's "They can't see … your word list".

Also proven:
- A page can put its own text into Kotiko's popup.
- A page can detect Kotiko on sites where it's paused.
- A page can probe the closed shadow root of the word card.
- A page can spoil a pending OpenRouter sign-in.
- After "Delete everything", code running in the content-script world can point Kotiko at its own server.

These held up, each with proof:
- Key and token isolation.
- The message router.
- Hostile model answers are rendered as text only.
- CSV and Anki exports.
- Server auth, the Host check and body limits.
- The bot's sender allowlist.
- Reproducible zips.

**How to run the proofs** (from the checkout root):
```
npx playwright test -c test/security/poc/playwright.config.mjs        # 11 tests, all pass
node --test test/security/poc/a-llm-limits.test.mjs test/security/poc/a-exports.test.mjs
node test/security/poc/a-routes.mjs
(cd server && MIX_ENV=test mix test ../test/security/poc/a_bot_stranger_test.exs)
npx playwright test -c test/security/poc/playwright.e2e.config.mjs privacy connect popover   # project specs, 21/21 pass
```

---

## Findings

### A-01: A web page can read the learner's whole word list from text nobody sees (Medium)

**Severity:** Medium. What it means for the learner:
- Any site, or any third-party script it loads, gets the learner's meanings, target words and languages.
- It takes about 4 seconds, even with a 60,000-word dictionary.
- The learner does nothing and sees nothing.

What it contradicts:
- The privacy policy: `docs/privacy/en.md:105-108`, shipped as `extension/privacy/en.md:105-108`: "They can't see the original words, their meanings or your word list".
- The threat model asset: "the word list … reveals which languages they study" (`docs/security/assurance-case.md:49-50`).

**Location**
- `extension/content/engine.js:92-127` (`swap`): each match becomes `<kotiko-w lang=…>` with the target word as its `textContent` (`:98`, `:119`).
  - The walk (`:160`, `:180-182`) skips only tags and editables. It never skips hidden subtrees.
  - Nothing caps how many concepts one page view can reveal.
- `extension/content.js:233-266` (`plan`): matches any text node, visible or not.
- `docs/security/assurance-case.md:178` ("Pages can see swapped words") understates the risk.
- `test/e2e/popover.spec.mjs:89` is named "page scripts see no vocabulary", but it only checks attributes.

**Proof:** `test/security/poc/a-hostile-page.spec.mjs`, tests A-01 and A-01b.
- The page has one visible sentence and a `display:none` div.
  - A-01: 30 guesses, each in 3 sentences.
  - A-01b: all 60,652 lowercase words from `/usr/share/dict/american-english`.
- The page's own script reads `#probe kotiko-w` (`textContent` and `lang`) and maps each swap back to the guess it planted.

**Observed:**
```
A-01 page-world loot: {"please":["пожалуйста [ru]"],"thanks":["спасибо [ru]","谢谢 [zh]"],"dog":["犬 [ja]"],"book":["كتاب [ar]"],"good":["хорошо [ru]"],"water":["agua [es]"],"castle":["замок [ru]"]}
A-01 probe visible to the learner: false
A-01b dictionary size: 60652; recovered in 4178 ms: {"book":["كتاب [ar]"],"castle":["замок [ru]"],"dog":["犬 [ja]"],"dogs":["犬 [ja]"],"good":["хорошо [ru]"],"please":["пожалуйста [ru]"],"thanks":["спасибо [ru]"],"water":["agua [es]"]}
```
- Every meaning the learner has was recovered, and nothing else.
- Repeating a guess in different sentences ("mix within the page") also reveals each language the learner has for that concept.

**Fix**
- Swap only rendered text: use `checkVisibility({contentVisibilityAuto, opacityProperty, visibilityProperty})`, swapping as text comes into view.
- Cap the number of distinct concepts swapped per page view (a spec rule).
- Correct `docs/privacy/en.md` §"What websites can see" and assurance-case §7.

**Regression test:** A-01 and A-01b, asserting that hidden or off-screen probes get no swaps and that at most N distinct concepts are revealed.

---

### A-02: The page's `<html lang>` text appears verbatim in Kotiko's popup (Low)

**Severity:** Low. A page can put any text it likes into Kotiko's trusted popup, for example a fake "key leaked, paste a new one at …" notice.
- Text only: no markup and no script.
- The learner has to open the popup on that page.

**Location** (the path the text takes):
1. `extension/content.js:122-128` (`declaredLanguage`) reads the raw `lang` attribute, unbounded.
2. `extension/lib/page-lang.js:36-39` returns it as `lang: declared` with reason `declared_other`.
3. `extension/content.js:380-387` (`pageStatus`) sends it to the popup.
4. `extension/popup.js:521-531`, line `:527`, renders it with `name(l) = I18n.languageName(l) ?? l`.
5. `extension/lib/i18n.js:150-161`: `languageName` returns null for a non-tag, so the raw string is shown, twice.

**Proof:** `a-hostile-page.spec.mjs`, test A-02.
- The page is `<html lang="Kotiko security notice: your OpenRouter key leaked. Paste a new key at evil.example/kotiko to keep using Kotiko">` with the body "12345 67890".
- The test opens the real `popup.html`. The only change is that `tabs.query({active})` returns that tab, which is what a toolbar click on that tab would give.
- A screenshot is saved as `a-02-popup.png` under `test-results/sec-a/`.

**Observed:**
```
A-02 page-status reply: {"base":null,"reason":"declared_other","lang":"Kotiko security notice: your OpenRouter key leaked. Paste a new key at evil.example/kotiko to keep using Kotiko","words":0}
A-02 popup #pageLangText: "This page is in Kotiko security notice: your OpenRouter key leaked. Paste a new key at evil.example/kotiko to keep using Kotiko, which isn't one of your languages. Kotiko leaves it alone. I read Kotiko security notice: … too"
```

**Fix**
- Canonicalise the declared tag in the content script: `Intl.getCanonicalLocales`, at most 35 characters. Treat an invalid tag as undeclared.
- The popup should never fall back to the raw string.

**Regression test:** a jsdom popup test with a non-tag `lang`, plus a `page-lang` unit test asserting that `lang` is canonical or null.

---

### A-03: A page can switch Kotiko off with one event, and detect it where it's paused or on sensitive sites (Low)

**Severity:** Low.
- **Teardown:** any page can stop Kotiko by dispatching `kotiko:handoff`. Pages can already opt out with `data-kotiko-skip`, so this alone matters little.
- **Detection:** a page can tell Kotiko is installed even where the learner paused it, or where Kotiko steps back (banks and other sensitive sites). It sees either the handoff event, or the injected CSS on a `<kotiko-w>` element it creates itself.
  - This contradicts the policy's "To stop this on a site, pause Kotiko there" (`docs/privacy/en.md:105-109`).
  - It helps fingerprinting.

**Location**
- `extension/content.js:469-472`: `onHandoff` tears down on any foreign `detail`.
- `extension/content.js:531-532`: dispatches and listens on `document`, before any check for paused or sensitive sites.
- `extension/content.css:7-20`: the `kotiko-w` style (`cursor: help`, dotted underline) is injected into every page.

**Proof:** `a-hostile-page.spec.mjs`, test A-03.
- The page fires the handoff event, then adds new text.
- Then `pausedHosts: ["localhost"]` is set, and a second page listens for the event from `<head>` and styles its own `<kotiko-w>`.

**Observed:**
```
A-03 swaps before the event: 7; after: 0; swaps in text added afterwards: 0
A-03 paused host: computed style of a page-made <kotiko-w>: help dotted
A-03 paused host: swaps 0 handoff events seen by the page: ["muxeu41q-gvpqmtyjhyo"]
```

**Fix**
- Hand off through a channel pages can't forge, for example `storage.session` or the background calling `tabs.sendMessage`.
- Expose nothing page-visible (no event, no CSS) on paused or sensitive hosts. Insert the CSS only when swapping starts.
- Mention detectability in the privacy policy.

**Regression test:** A-03.

---

### A-04: Page script can open the word card with a synthetic click and probe its closed shadow root with `window.find` (Low)

**Severity:** Low. The closed shadow root is not a confidentiality boundary:
- The card opens without the learner, because its handlers never check `isTrusted`.
- `window.find()` then answers yes or no about any text in the card: romanization, pronunciation, note, meanings in other base languages, and the "Also" words in other languages.

This contradicts "can't see … their meanings" (`docs/privacy/en.md:107`). It needs guesses, but with a dictionary it is cheap.

**Location**
- `extension/content/popover.js:666-684` (`onClick`, which opens the card at `:683`) and `:687-701` (`onKeyDown`: a synthetic "s" also speaks). Neither checks `isTrusted`.
- `extension/content/popover.js:211`: the shadow root is closed, but it lives in the page's document, where `window.find` searches it.

**Proof:** `a-hostile-page.spec.mjs`, test A-04. On a swapped "Please", the page calls `window.find("pozhaluysta")` before and after `dispatchEvent(new MouseEvent("click",{bubbles:true}))`.

**Observed:**
```
A-04 page-world result: {"open":true,"shadowRoot":null,…,"romanization":true,"notThere":false,"romanizationBeforeOpen":false}
A-04 card open (read through CDP): true
```

**Fix:** add `if (!e.isTrusted) return;` to `onClick`, `onPointerOver`, `onPointerDown` and `onKeyDown`.

**Regression test:** A-04, expecting the card to stay closed.

---

### A-05: Any page can use up a pending "Connect OpenRouter" sign-in (Low)

**Severity:** Low. This is a denial of service on sign-in; no key is stolen and PKCE holds. While a sign-in is pending:
- Any page can navigate to `https://kotiko.org/connect/?code=<junk>`.
- The background deletes the stored verifier before it tries the exchange.
- So the learner's real code is then refused with a misleading "This sign-in has expired".

**Location**
- `extension/background.js:1736-1758` (`oauth.code`): `store.secrets.remove("pkce:pending")` runs at `:1743`, before the exchange.
- `extension/content/connect.js:16-31`: any `?code=` on that path is sent.
- `extension/lib/pkce.js:74-81`: there is no per-sign-in nonce.

**Proof:** `a-hostile-page.spec.mjs`, test A-05.
- kotiko.org is stood in by `context.route`, and the key exchange is stubbed in the worker. Only `real-code-0123456789` is accepted.
- An extension page sends `oauth.start`, a localhost page navigates to the junk callback, and then the real callback arrives.

**Observed:**
```
A-05 junk callback says: "Kotiko couldn't finish connecting to OpenRouter. …"
A-05 real callback says: "This sign-in has expired. Open Kotiko's settings and select Connect OpenRouter again."
A-05 codes sent to OpenRouter: ["junk-from-a-page"] secrets: {}
```

**Fix:**
- Add a random `state` to `callback_url` (`…/connect/?s=<random>`), and use up the verifier only when it matches.
- Or delete the pending entry only after a successful exchange or on expiry.

**Regression test:** A-05, expecting the real code to succeed.

---

### A-06: After "Delete everything", content-world code can plant a server and token that Kotiko adopts as trusted (Low, defence in depth; the lead may raise it)

**Severity:** Low. The precondition is code running in Kotiko's content-script world; no page reached that world in any of my tests. But:
- It breaks the stated guarantee "Even if a page subverted Kotiko's own script … puts back anything it changes" (`docs/security/requirements.md:62-65`; `docs/security/assurance-case.md:179-186`).
- The impact is that everything the learner types next, and their lookups, go to the attacker's server.

**Location**
- `extension/background.js:1120-1137` (`wipeEverything`: sets `readyP = null` and clears `storage.local`).
- `extension/background.js:1941-1943`: `if (wiped) return;`, so nothing is put back while wiped.
- `extension/background.js:77-103` (`ready`): a fresh store runs `Local.migrate` with `legacy: ext.storage.local`.
- `extension/lib/local-mode.js:57-95` (`migrate`):
  - It reads `token` and `serverUrl` from `storage.local` (`:59`).
  - If there is a token, it stores it as the server secret and sets the server URL, `wordsHome: "server"` and `lookup.kind: "server"` in the trusted copy (`:63-67`, `:86`).
  - The "fresh" mark only gates `adoptOnce`, not this.

**Proof:** `test/security/poc/a-content-world.spec.mjs`, test A-06.
1. An extension page sends `data.deleteAll`.
2. In the content-script world (reached over CDP, as `privacy.spec.mjs` does), the test writes `{token: <attacker token>, serverUrl: "http://localhost:41234/kotiko"}`.
3. The learner opens the popup and adds "my secret diary word". The worker's `fetch` calls are recorded.

**Observed:**
```
A-06 before: {"wordsHome":"local","server":{"url":"http://localhost:4747"},"keys":{"server":false,"providers":{}}}
A-06 deleteAll: {"ok":true,"server":null}
A-06 what the worker sent to the attacker's address: [{"url":"http://localhost:41234/kotiko/api/v1/words","method":"POST","body":"{\"text\":\"my secret diary word\",\"preview\":true,\"base_langs\":[\"en\"]}"},{"url":"http://localhost:41234/kotiko/api/v1/llm/status","method":"GET","body":null}]
A-06 settings after the add: {"wordsHome":"server","server":{"url":"http://localhost:41234/kotiko"},"lookup":"server","keys":{"server":true,"providers":{}}} secrets: {"secrets":{"server":"test-t…stuv"}}
```

**Fix:**
- After a wipe, recreate the store at once with an empty legacy area, so a store born from a wipe never reads `storage.local`.
- Read 0.2 `token`/`serverUrl` only on a real update from a version before 0.3 (`onInstalled` `reason: "update"`).

**Regression test:** A-06, asserting the defaults stay and nothing is sent to the planted host.

**Not tested:** whether a service-worker restart while wiped (which resets the in-memory `wiped` flag) lets a later storage change trigger the same adoption with no learner action. The code suggests it does.

---

### A-07: Lookups to paid providers have no output-token cap (Low)

**Severity:** Low.
- A hostile or confused model, for example one stuck repeating itself, can generate up to the model's maximum output on every lookup, billed to the learner's key.
- This applies to OpenAI, Anthropic, Gemini, Groq and custom endpoints.
- Only OpenRouter catalogue models that list `max_tokens` get the spec's cap of 1200.
- The 25 s deadline cuts the client off, but providers still bill tokens generated after a disconnect.

**Location**
- `extension/lib/llm/client.js:275`: `max_tokens` is sent only when `caps.max_tokens` is set.
- `extension/lib/llm/catalog.js:75`: `defaultCaps` sets `max_tokens: false`; see also `:30`.

**Proof:** `node --test test/security/poc/a-llm-limits.test.mjs`, one lookup per preset against a stub model that answers prose.

**Observed:** `max_tokens` was `1200` for openrouter and `null` for openai, anthropic, gemini, groq, ollama, lmstudio and custom. Each preset made one chat request per add.

**Fix:** always send an output cap (`max_tokens`, or `max_completion_tokens` for OpenAI reasoning models) from the spec's policy.

**Regression test:** extend the per-preset test in `test/unit/llm-client.test.mjs`.

---

### A-08: Content-world code can force unthrottled syncs (Informational)

The `sync` route accepts `force: true` from content scripts, which skips the 5 s page throttle. Content-world code can therefore make the learner's server send its full word list in a tight loop. The server has no rate limit for token holders. As with A-06, this needs content-world code.

**Location:** `extension/background.js:1470-1476`; `extension/lib/sync-controller.js:142-148`.

**Proof:** `a-content-world.spec.mjs`, test A-08. **Observed:** `plain 0, force:true 20 (in 61 ms)` for 20 messages of each kind.

**Fix:** honour `force` only from senders of kind `page`.

**Regression test:** A-08.

---

### A-09: The release zips ship the `globalThis.__kotiko` test hook (Informational)

The hook exposes `seed` (which writes the trusted settings copy), `toServer`, `toLocal`, `getStore` and more. No page or content script can reach the worker's global (see A-ISO and the route table). Only someone with DevTools on the extension could use it, but it is test code in production.

**Location:** `extension/background.js:1992`.

**Proof:**
- Ran `node scripts/build-extension.mjs --version 1.0.0 --out …` twice.
- Inspected the zips with Python `zipfile`.

**Observed:** `__kotiko hook shipped: True` in both the Chrome and the Firefox zip.

**Fix:** define the hook only when a test flag is set, or strip it at build time.

**Regression test:** in `test/unit/build-extension.test.mjs`, assert there is no `__kotiko` in the zip's `background.js`.

---

## Coverage matrix

### 1. Secrets: checked; no exposure to pages or content scripts (defence-in-depth gap A-06)

- **Content-script world:** `test/e2e/privacy.spec.mjs` passes. It shows the content-script world reads neither the key nor the token; `storage.session` is refused; and Kotiko's IndexedDB is not visible.
- **Page world (A-ISO):**
  - `chrome.runtime` is undefined.
  - There are no `kotiko*` globals.
  - `fetch` of `chrome-extension://…/manifest.json`, `background.js` and `lib/settings.js` is refused.
- **Exports:** `test/unit/backup.test.mjs` "no export holds a key or a token" passes. Together with the settings, local-mode, privacy and sync suites: 163/163.
- **Server logs:** sent a key-shaped bearer and the word "sobaka" to the live server on :41587. A grep of its log for the token, `LLM_API_KEY`, the key and "sobaka" found nothing.
- **Repository history:** `gitleaks detect --config .gitleaks.toml` reported "144 commits scanned … no leaks found".
- **OAuth:** the exchange goes only to the fixed `KEYS_URL`, with `credentials: "omit"` (A-05).
- **Not checked:** Firefox, dynamically.

### 2. Page isolation: checked; A-01, A-03 and A-04 found

- **A-ISO:** the page can't load, frame or message the extension. A frame of `dashboard.html` becomes `chrome-error://chromewebdata/`, and a script tag pointing at the extension fires `error`.
- **Project spec `popover.spec.mjs`:** 9/9 pass (top layer above hostile CSS, closed shadow root, no `data-*`).
- **Project spec `privacy.spec.mjs`:** "page scripts see the swaps but no original word" passes, ×2.
- **Not checked:** timing side channels; Firefox.

### 3. Injection: checked; no markup or script injection, CSV formula or SQL issue found; A-02 found (text spoofing)

- **Hostile model answer (A-INJ):** a stubbed model returned `<img src=x onerror=…><svg onload=…>` in the note, romanization and language fields, and as the native word.
  - Popup line: "Added agua (AH-gwah) = water · Spanish", with 0 markup elements.
  - Word card: the payload shows as text, there are 0 img, svg or script elements, and the page's `__pwned` stays null.
  - Dashboard: 0 markup elements; the payload shows as text.
  - The payload in the native field was dropped by the word spec.
- **Lint:** `npx eslint extension` exits 0, including `no-unsanitized` and the `innerHTML` ban.
- **HTML sinks:** a grep for `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `srcdoc`, `createContextualFragment` and `setHTMLUnsafe` in `extension/` finds nothing. The only `DOMParser` (`bulk/sheet.js:111`) parses into an inert document and keeps `textContent`.
- **CSV and Anki (`a-exports.test.mjs`):** every cell starting with `= + - @ TAB CR` is defused with a `'` prefix. The Anki export uses `#html:false` with tabs and newlines flattened.
- **Prompts:** page text never reaches a prompt, because no content-reachable route calls the model. `recent` holds language tags only (`lib/wordspec.js:776`).
- **SQL:** every `Repo.query!` in `server/lib` uses `?`-bound values. `language_tags.ex:183` interpolates column names that come from code, not from input. Server suite: 1106 tests, 0 failures.
- **Telegram:** `sendMessage` sets no `parse_mode` (`telegram.ex:32`), so replies are plain text.
- **Not checked:**
  - The respell prompt as a stored prompt-injection path (read only).
  - Cells with a leading space or a full-width `＝` in a real spreadsheet.
  - The welcome tab with a hostile answer, dynamically (lint only).

### 4. Messaging: checked; A-08 found

- **Routes (`a-routes.mjs`):** 1 `onMessage` listener and 44 routes.
  - From extension pages: 40 routes.
  - From pages and content scripts: `sync`.
  - From content scripts: `sensitiveSites` and `neverSwap`.
  - From the docs site: `oauth.code`.
- **Other entry points:** none. A grep for `onMessageExternal`, `onConnect`, `connectNative`, `externally_connectable`, `web_accessible` and window `message` listeners finds nothing.
- **Privileged messages:** `privacy.spec.mjs` shows every privileged type is answered with "forbidden" when sent from content.
- **Docs route:** `connect.spec.mjs` 4/4 pass, including "another site's `/connect/?code=` is ignored".
- The content script's own `onMessage` (`content.js:391-405`) accepts messages only from senders without a tab.
- `neverSwap` is capped at 5,000 entries × 200 characters (`settings.js:178`).

### 5. Network: checked; no SSRF reachable from a page or a model answer

- No content-reachable route takes a URL.
- `oauth.code` uses a fixed URL.
- Wiktionary uses a fixed host with `encodeURIComponent` (`background.js:660`).
- The LLM client uses `credentials: "omit"`.
- **Privacy spec:** the "planted address" and "rewritten settings" tests pass.
- **A-PRIV:** visiting a page with marker text, path and query made 0 worker requests, and the fixture log was empty.
- **Server TLS:** no `verify_none` or `transport_opts` anywhere in `server/lib`.
- **Not checked:** whether `Authorization` is dropped when the learner's own server redirects cross-origin.

### 6. Server: checked; no issues

Curl results against the live server on :41587:

| Request | Result |
|---|---|
| No token | 401 |
| Cross-site `text/plain` POST | 401 |
| CORS preflight | 401, no `Access-Control-*` headers |
| `Host: evil.example` with a valid token | 421 |
| Valid request | 200 |
| `/%68ealth/../api/v1/words` and `/health/../…` | 401 |
| `POST /health` | 401 |
| 70 KB body with token | 413 |
| 70 KB body without token | 401 |
| Two `Authorization` headers | 401 |
| Token in the query string | 401 |

- **File permissions:** the data folder was made 0700 at start; the db, `-wal` and `-shm` files are 0600.
- **Tests:** `mix test` 1106 tests, 0 failures. `a_bot_stranger_test.exs` 3/3:
  - A stranger's Add/Skip button presses make no Telegram call, and the word stays pending.
  - A stranger in a group gets no reply and spends no model request.
  - An update with no sender is ignored.
- **Not checked:** binding beyond loopback, and `ALLOWED_HOSTS=*`.

### 7. Resource exhaustion: checked; A-07 and A-08 found

- A-01b: a 60,652-word hidden page was processed in about 4.2 s without the engine standing down. A page can only load its own tab.
- Syncs triggered by a page are throttled ("plain 0" in A-08).
- Content scripts can't add words, so a page can't trigger lookups.
- A confused model answering prose costs 1 request per add.
- Server bodies over 64 KB get 413.
- **Not checked:** huge imports and bulk adds dynamically; the perf suite.

### 8. Supply chain and build: checked; A-09 found

- `npm audit`: 0 vulnerabilities. `mix hex.audit` and `mix deps.audit`: clean. gitleaks: clean.
- **Workflows:** every action is pinned by SHA; no `pull_request_target` or `workflow_run`; CI has `contents: read`.
- **Zips:**
  - Built twice with identical SHA-256: Chrome `0582ec92…`, Firefox `4bbc3516…`.
  - 123 files each; no tests, maps or tools.
  - No `web_accessible_resources` or `externally_connectable`.
  - CSP `script-src 'self'`.
  - `web-ext lint`: 0 warnings.
- **Not checked:** osv-scanner (not installed); the GitHub environment and approval settings.

### 9. Privacy claims: checked; A-01, A-03 and A-04 contradict `docs/privacy/en.md` §"What websites can see"; A-06 contradicts `requirements.md:62-65`

- **Holds:** "page text never leaves your browser" (A-PRIV).
- **Holds:** online voices are off by default (`speak.js:72`).
- **Holds:** keys and exports, as in area 1.
- **Not checked:** the store listing text, line by line.

### Other observations (not findings)

- On the first full `npm test` run, 1 of 1973 tests failed: `test/dom/welcome.test.mjs:221` got `['es','en']` and expected `['es']`. Three reruns of that file alone passed 25/25, so it looks flaky under load.
- The test name "page scripts see no vocabulary" (`popover.spec.mjs:89`) overstates what it checks.

## Proof files (in the checkout, uncommitted)

All in `/home/aylac/Projects/personal-projects/kotiko-sec-a/test/security/poc/`:
- `playwright.config.mjs` and `global-setup.mjs`: run the proofs with the fixture server on :41234.
- `playwright.e2e.config.mjs`: runs the project's own e2e specs on :41234.
- `a-hostile-page.spec.mjs`: A-01, A-01b, A-02, A-03, A-04, A-05, A-INJ, A-PRIV, A-ISO.
- `a-content-world.spec.mjs`: A-06, A-08.
- `a-llm-limits.test.mjs`: A-07.
- `a-exports.test.mjs`: the CSV and Anki checks.
- `a-routes.mjs`: the message route table.
- `a_bot_stranger_test.exs`: the bot stranger checks; run from `server/`.

### Reviewer B, on v1.0.0-rc.1 (network, local process, Telegram stranger)

# Slice 54 security review: report B

<!-- Saved by the lead from Reviewer B's hand-back message, unchanged: the reviewer's sandbox refused report files. -->

- **Reviewer:** B (an AI agent working alone, in its own session)
- **Starting attacker:** someone on the same network, a malicious process or another account on the same computer, and a Telegram stranger
- **Candidate:** `v1.0.0-rc.1`, commit `cf7378e` (detached checkout `/home/aylac/Projects/personal-projects/kotiko-sec-b`)
- **Date:** 2026-10-06
- **Environment:** Linux 6.14, Erlang 28.1.1, Elixir 1.19.2, Node 22, Playwright Chromium 1243 and Firefox 1543
- **How I ran things:** the proofs ran against my own server instances started from the checkout, on ports 42001 to 42007. Each instance had its own temporary data folder and its own env file under `scratchpad/sec-b/runN/`. Model providers were faked with `test/helpers/fixture-server.mjs` (port 42100) and `test/security/poc/b-fake-llm.py` (port 42110). Telegram was faked with `Kotiko.TelegramStub` / `Req.Test`. I did not connect to the maintainer's server on `127.0.0.1:4747`, I read no `.env`, and nothing left the machine apart from `npm ci`, `mix deps.get` and `mix deps.audit` fetching packages and the advisory database. At the end I stopped every server I had started, killing each one by its PID. Some Chrome processes from other sessions (their profiles are `/tmp/puppeteer_dev_chrome_profile-*`) listen on ports in the 42xxx range; they are not mine and I left them alone.

**Findings by severity:**
- **Critical:** 0
- **High:** 0
- **Medium:** 1
  - B-01: another local account can take the extension's server token by listening on `[::1]:4747`, even while Kotiko is running.
- **Low:** 5
  - B-02: anyone who can write in the data folder chooses the API token, and a planted `kotiko.db` symlink sends every word to a world-readable file without warning.
  - B-03: after the Slovo-to-Kotiko copy, the old world-readable database stays, and `--uninstall --delete-data` doesn't remove it.
  - B-04: the limiter on refused-Host log lines stops working after 1,000 names, so any client can write unlimited log lines.
  - B-05: a username and password in `LLM_URL` or `TRANSCRIBE_URL` are written to the log at info level.
  - B-06: no warning when a model or transcription key is sent over plain HTTP to another machine.
- **Informational:** 3
  - B-07: the learner's words reach the log at debug level without `LOG_LOOKUPS` (docs and code disagree).
  - B-08: `SECURITY.md` and the requirements still describe a pre-1.0 project with no releases.
  - B-09: weak `API_TOKEN` values are accepted, and nothing limits wrong-token attempts.

**Not checked:**
- B-02 with files owned by a different account. There is no second account and no `newuidmap` here; that part comes from reading the code only.
- B-01 with the real extension in Firefox. Firefox page loads and `fetch` reached the squatter, but I loaded the extension only in Chromium.
- Prompt injection, and deep page-isolation attacks (DOM attributes, timing, shadow root). I relied only on the existing e2e and unit suites passing.
- Anki's own handling of a first data row that starts with `#`.
- An oversized server response crashing the extension (`background.js:596`). I read the code but did not run it.
- `install-service.sh` install mode.
- Real Wiktionary, Telegram, OpenRouter or store traffic, which the rules forbid.

## Summary

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | |
| High | 0 | |
| Medium | 1 | B-01 |
| Low | 5 | B-02, B-03, B-04, B-05, B-06 |
| Informational | 3 | B-07, B-08, B-09 |

The one medium finding: a browser connects to `http://localhost:4747` (the extension's default address, and the address the docs give) over IPv6 `::1` first, but the server listens only on IPv4 `127.0.0.1`. Any other process or account on the computer can therefore listen on `[::1]:4747` and receive the extension's bearer token, even while the real server is running. I proved this with the real extension in Chromium.

Everything else in my attacker's area held up when tested.
- **Authentication:** every method and every path spelling gets 401 without the token, and only `GET`/`HEAD /health` are open.
- **Host check:** it works over HTTP/1.0, HTTP/1.1, h2c and absolute-form requests.
- **Body caps:** they apply before anything is read.
- **Telegram:** a stranger gets no reply and causes no model call and no database change.
- **Log redaction:** keys and tokens were redacted in every shape I tried.
- **Network traffic:** the server makes no outbound connection except to the model URL it was given (traced with strace).
- **Builds:** the zips are reproducible.
- **Dependency audits:** clean.

## Findings

### B-01: Another local account can take the extension's server token by listening on `[::1]:4747`, even while Kotiko is running

**Severity: Medium.** The attacker needs only an unprivileged process or account on the same computer, the learner using the default `http://localhost:4747` address, and IPv6 loopback (on by default in Linux and macOS). The attacker gains the bearer token within one sync (at most a minute). With it they can read, change and delete every word through the real server, and they also receive the text of every add. This breaks the requirement "Other accounts on the computer can't read your words" and the claim "A strong token, kept private" (`docs/security/requirements.md:25`, `:20`). By CVSS (local attack vector, low privileges, high confidentiality and integrity impact) it would score higher. I rate it Medium because it needs a second local account or a compromised local service.

**Location**
- `extension/lib/local-mode.js:25`: `DEFAULT_SERVER = "http://localhost:4747"`. Also `extension/welcome.js:502` (`url || "http://localhost:4747"`) and the placeholders at `extension/popup.html:142`, `extension/welcome.html:123` and `extension/dashboard.html:203`.
- `site/src/content/docs/server/index.md:64` tells users to enter `http://localhost:4747`.
- `server/lib/kotiko/config.ex:19` (`@default_bind "127.0.0.1"`), `:353` and `:369-384`. `BIND=localhost` also resolves to IPv4 only. `server/.env.example:45` has `BIND=127.0.0.1`.
- `extension/background.js:446-475`: `connection()` and `request()` send `Authorization: Bearer <token>` on the first request, before any check that the peer is the user's Kotiko server. The token is bound to the address, and the attacker answers at that same address.

**Proof**
1. `test/security/poc/b-v6-squatter.py 42001` listens on `[::1]:42001` while my Kotiko server is on `127.0.0.1:42001`.
2. `node test/security/poc/b-localhost-which.mjs 42001` loads `http://localhost:42001/health` in real Chromium and Firefox, then makes a same-origin `fetch` with a token.
3. `node test/security/poc/b-extension-v6-squat.mjs 42001 <real token> <squatter.log>` loads the **unpacked extension** in Chromium, runs `server.connect` with `http://localhost:42001` and the real server's token (as the dashboard does), forces a sync, and then reads what the squatter logged.

**Observed**
```
LISTEN 0 1024   127.0.0.1:42001  0.0.0.0:*      <- Kotiko
LISTEN 0 5          [::1]:42001     [::]:*      <- squatter
chromium: /health -> {"name":"not-kotiko","squatter":true} | API with token -> 200 {"name":"not-kotiko","squatter":true}
firefox: /health -> {"name":"not-kotiko","squatter":true} | API with token -> 200 {"name":"not-kotiko","squatter":true}
curl: {"name":"not-kotiko","squatter":true}
SQUATTER got GET /api/v1/words Host=localhost:42001 Authorization='Bearer extension-token-0123456789abcdef'
# real extension:
server.connect -> {"ok":true,"wordsHome":"server","sync":{"code":"not_kotiko_server"}}
squatter received the real token in 3 request(s):
  SQUATTER got GET /api/words Host=localhost:42001 Authorization='Bearer LuJrNY…(real token)'
  SQUATTER got GET /api/words Host=localhost:42001 Authorization='Bearer LuJrNY…(real token)'
  SQUATTER got GET /api/v1/words?status=active,paused Host=localhost:42001 Authorization='Bearer LuJrNY…(real token)'
```
On this machine `getent ahosts localhost` returns only `127.0.0.1`. The browsers resolve `localhost` themselves and tried `::1` first. The extension notices that the peer isn't Kotiko (`not_kotiko_server`), but only after it has already sent the token.

Related cases I did not run separately:
- When the server isn't running, a squatter can also take `127.0.0.1:4747`.
- In local mode, the Ollama and LM Studio presets (`localhost:11434` and `localhost:1234`) reach a `[::1]` squatter the same way. Those presets carry no key, but the squatter receives the typed text and can return model answers. The answers are still validated.

**Fix**
- **Server:** by default, listen on both loopback families (`127.0.0.1` and `::1`, or a `BIND=localhost` that binds every address it resolves to).
- **Extension:** make the default and the docs `http://127.0.0.1:4747` (the pairing string already uses that, `exposure.ex:70`). Optionally, have `normalizeServerUrl` map `localhost` to `127.0.0.1`.
- **Defence in depth:** before sending the token to a new address, have the server prove it knows the token without revealing it. For example, the extension sends a nonce, the server answers with HMAC(token, nonce), and only then does the extension send the token. This also covers squatting while the server is stopped.
- **Regression tests:**
  - An ExUnit socket test: with the default config, a second listener on `::1:<port>` fails with `eaddrinuse`.
  - A unit test: `DEFAULT_SERVER`'s host is a literal loopback IP.
  - A Playwright test built from `b-extension-v6-squat.mjs`: the squatter must log no token.

### B-02: Anyone who can write in the data folder chooses the API token, and a planted `kotiko.db` symlink sends every word to a world-readable file without warning

**Severity: Low.** The attacker needs a data folder that another account can write to (a shared or group folder, `/tmp/...`, or a folder that was ever `0777`) and access before a server start. They gain full API access with a token they chose, and every word written to a file they can read. The requirements describe the shared-folder risk as "Others can then see the files' names, not what's in them" (`docs/security/requirements.md:89`), which understates it.

**Location**
- `server/lib/kotiko/token.ex:27-43`: `resolve/2` adopts whatever `api-token` holds, with no check of the file's owner.
- `server/lib/kotiko/private.ex:48-60`: `create/1` treats `eexist` as `:ok`, including when the path is a symlink.
- `server/lib/kotiko/private.ex:88-102`: `restrict/1` leaves symlinks alone.
- `server/lib/kotiko/data_dir.ex:243-277` and `:282-298`: only warnings, and the start continues.

**Proof:** `test/security/poc/b-data-dir-plant.sh <workdir> 42002 scratchpad/sec-b/bin/start-server.sh`. Before the start, the script plants `api-token` (contents chosen by the attacker) and `kotiko.db -> ../elsewhere/loot.db` (mode 0666) in a `0777` folder. It then starts the server with umask 077, uses the planted token and adds one word.

**Observed**
```
[warning] Other users of this computer could open Kotiko's files in .../run2/data (api-token). Made them private ...
[warning] Other users of this computer can open the data folder .../run2/data. ...
== API with the planted token:
200
add: 200
== where the words went:
-rw-rw-rw- loot.db   -rw-rw-rw- loot.db-shm   -rw-rw-rw- loot.db-wal
== readable by anyone:
ensecret[{"enabled":true,"case":"any","text":"secret",...}]activemanual2026-10-07T00:59:38...
```
No warning mentions the database symlink. The version where the planted files belong to another account (chmod then fails with EPERM, and the server only warns) is **not checked** by running: there is no second account and no `newuidmap`. It comes from reading `private.ex:111-116`.

**Fix**
- Refuse to start, with a message saying how to fix it, when:
  - the data folder or any of Kotiko's files is owned by another uid;
  - `kotiko.db`, `api-token` or a backup is a symlink whose target is outside the folder or readable by others;
  - the folder is writable by group or others.
- Alternatively, open `api-token` with `O_NOFOLLOW` and check its owner and mode with `fstat`.
- Fix requirements.md:89.
- **Regression tests:** ExUnit tests that start against a folder holding a symlinked `kotiko.db`, and against a group-writable folder, and expect a refusal.

### B-03: After the Slovo-to-Kotiko copy, the old world-readable database stays, and `--uninstall --delete-data` doesn't remove it

**Severity: Low (privacy).** This affects upgrades from a 0.2 Slovo install whose `slovo.db` was created under umask 022. Another account that can traverse `~/.local/share` can read every word the learner had, and `--delete-data` gives the impression that the data is gone. The old `api-token` is copied as the live token (it was 0600 here).

**Location**
- `server/lib/kotiko/data_dir.ex:414-442`: the legacy folder is never touched.
- `server/lib/kotiko/data_dir.ex:217`: `make_private` runs only on the target.
- `server/lib/kotiko/data_dir.ex:518-532`: the token is copied, so the old and live tokens are the same.
- `server/install-service.sh:114-140`: `delete_data_folder` covers only the current folder.

**Proof:** `test/security/poc/b-legacy-folder.sh <workdir> 42003 <kotiko.db>`. The script builds a fake HOME with `.local/share/slovo/slovo.db` at mode 0644, boots the server with that HOME, then runs `install-service.sh --uninstall --delete-data` with that HOME. No unit was installed, so no `systemctl` call was made.

**Observed**
```
[info] Copied your API token from .../slovo/api-token ...
[info] Moved your words from .../slovo/slovo.db to .../kotiko/kotiko.db (5 words)
== after the copy, the old folder: -rw------- api-token  -rw------- MOVED-TO-KOTIKO.txt  -rw-r--r-- slovo.db
== live token == old token? yes
== --uninstall --delete-data: Deleted .../kotiko/kotiko.db, .../kotiko/api-token, the folder .../kotiko
== left behind: -rw------- api-token  -rw------- MOVED-TO-KOTIKO.txt  -rw-r--r-- slovo.db
words still readable by others: 5
```

**Fix**
- Run `Private.restrict/1` on the legacy `slovo.db*` and `api-token` after the copy, or remove the old token once the copy is verified.
- Have `--delete-data` also delete those files when `MOVED-TO-KOTIKO.txt` is there.
- **Regression tests:** a migration test asserting the legacy files are 0600; an extension to `scripts_test.exs` for `--delete-data` with a legacy folder.

### B-04: The limiter on refused-Host log lines stops working after 1,000 names, so any client can write unlimited log lines

**Severity: Low.** The attacker needs one of these:
- a TCP connection to the server: any local process, or the network when `BIND` isn't loopback;
- a web page that points a wildcard DNS name at 127.0.0.1. I did not try this path in a browser.

The attacker gains log or journal flooding, and the log handler then drops other lines. This defeats the code's stated aim: "at most once an hour per name so a scanner can't flood the log".

**Location:** `server/lib/kotiko/plug/host_check.ex:253-254` and `:345-375`. At `:364` the table is cleared once it reaches 1,000 names, so names already seen log again.

**Proof:** `python3 test/security/poc/b-host-log-flood.py 42001 <server.log> 3 1001` sends three rounds of the same 1,001 names, paced under the logger's burst limit.

**Observed**
```
requests=3003 status_of_last=HTTP/1.1 421 Misdirected Request log_lines_added=2998 (a working limiter would add at most 1001) in 18.9s
```
An unpaced run added only 1,001 lines, because the log handler's overload protection dropped the rest.

**Fix**
- When the table is full, stop logging new names for the rest of the hour and log one summary line with the count, rather than clearing the table.
- **Regression test:** 3 × 1,001 hosts give at most 1,001 lines plus one summary line.

### B-05: A username and password in `LLM_URL` or `TRANSCRIBE_URL` are written to the log at info level

**Severity: Low.** The attacker needs read access to the server log (journald, or a log the user pastes into an issue). They gain the credentials for the user's model proxy. This breaks "Keys and tokens stay out of the logs, at every level" (`requirements.md:43`).

**Location**
- `server/lib/kotiko/config.ex:436-456`: userinfo in the URL is accepted.
- `server/lib/kotiko/application.ex:132-141`: `model_line/0` logs the full URL.
- `server/lib/kotiko/log/redact.ex:137-142` and `:164-170`: not covered.

**Proof:** the run4 env had `LLM_URL=http://proxyuser:Pr0xy-Pa55-SECRET@127.0.0.1:42100/llm/v1`, then `grep -n SECRET server.log`. Also `b_config_probe.exs`.

**Observed**
```
40:  Model:     http://proxyuser:Pr0xy-Pa55-SECRET@127.0.0.1:42100/llm/v1, 1 model from LLM_MODEL
LLM_URL with credentials in it: starts. warnings=[] llm_url=https://user:pa55word@llm.example/v1
```

**Fix:** refuse userinfo in `LLM_URL`, `TRANSCRIBE_URL` and `PUBLIC_URL`, or strip it before logging and add it to `Redact.put_secrets`. **Regression test:** config and startup-summary tests asserting the password never appears.

### B-06: No warning when a model or transcription key is sent over plain HTTP to another machine

**Severity: Low.** The attacker needs a position on the network path and a learner who chose an `http://` provider on another host. They gain the provider key and the typed text. The server token gets a warning (`sendsInClear`, and the `BIND` warning), but provider keys get none.

**Location**
- **Server:** `server/lib/kotiko/config.ex:436-456` and `:492-493`; `transcriber.ex:76-80`; `llm/client.ex` `headers/0`.
- **Extension:** `extension/background.js:1398`; `lib/llm/client.js:104-108`. `sendsInClear` is used only at `popup.js:1013`, `welcome.js:1147` and `dashboard.js:2817`.

**Proof:** `cd server && MIX_ENV=prod mix run --no-start ../test/security/poc/b_config_probe.exs`

**Observed**
```
LLM key over plain HTTP to a remote host: starts. warnings=[] llm_url=http://203.0.113.7/v1
transcription key over plain HTTP to a remote host: starts. warnings=[] ... transcribe_url="http://203.0.113.8/v1/audio/transcriptions"
```

**Fix:**
- **Server:** log a startup warning for a key sent to non-loopback, non-Tailscale `http://`.
- **Extension:** show the same warning under the custom provider address, using `ServerUrl.sendsInClear`.
- **Regression tests:** a config test and a jsdom test.

### B-07: The learner's words reach the log at debug level without `LOG_LOOKUPS` (docs and code disagree)

**Severity: Informational.** `LOG_LEVEL=debug` is needed. `docs/reference/configuration.md:197` and `ARCHITECTURE.md:160` claim words are never logged without `LOG_LOOKUPS`.

**Location:** `server/lib/kotiko/router.ex:110` and `router_v1.ex:264`.

**Proof:** run5 had `LOG_LEVEL=debug` and `LOG_LOOKUPS=false`, with a fake model answering a Latin-script `ru` word. I then sent `POST /api/words {"text":"mytypedprivatetext"}`.

**Observed**
```
[debug] Couldn't save [%{native: "PRIVATEWORDXYZ", reason: "script_mismatch", base_lang: "en", gloss: "MYSECRETGLOSS"}]
```
The typed text itself was not logged. The model's answer was.

**Fix:** guard the line with `Kotiko.LLM.log_lookups?/0`, or narrow the docs. **Regression test:** `capture_log` at debug level contains neither field.

### B-08: The security policy and requirements still describe a pre-1.0 project with no releases

**Severity: Informational.**

**Location:** `SECURITY.md:5` ("Kotiko is before 1.0") and `docs/security/requirements.md:108` ("There are no releases yet"). Meanwhile `extension/manifest.json:5` has `"version": "1.0.0"` and `server/mix.exs:11` has `version: "1.0.0"`.

**Proof and observed:** the `grep -n` output above.

**Fix:** update both files; add a check to `check-versions.mjs`.

### B-09: Weak `API_TOKEN` values are accepted, and nothing limits wrong-token attempts

**Severity: Informational.** This applies only when the owner chooses the token and binds to a network. The no-rate-limit part is documented as a residual risk.

**Location:** `server/lib/kotiko/config.ex:389-402`, `token.ex:11`, `router.ex:209-219`.

**Proof:** `b_config_probe.exs` and `python3 test/security/poc/b-auth-rate.py 42001 16 10`.

**Observed**
```
API_TOKEN of 24 a's: starts. warnings=[]
API_TOKEN 'password' x3: starts. warnings=[]
{401: '19725/s'}
```

**Fix:** warn on a token with low variety, and optionally add a failure backoff when `BIND` isn't loopback. **Regression test:** a config test for the warning.

## Coverage matrix

| # | Area | Status | Evidence (what, how, result) |
|---|---|---|---|
| 1 | Secrets | **Checked with proof**. B-01, B-05, B-09 | <ul><li>**Token file:** a fresh start under umask 022 gave `api-token`, `kotiko.db`, `-wal` and `-shm` at 600 and the folder at 700 (`stat`).</li><li>**`run.sh`** (temp copy with a fake `mix`): `.env` 664 became 600, `umask=0077`, `ERL_CRASH_DUMP_SECONDS=0`.</li><li>**`NAME_FILE`** (`b_config_probe.exs`): two-line, fifo, `/dev/zero` symlink, 70 KB, missing and short files are all refused; a 0644 file gets a warning; no secret appears in any output (`grep -c SECRET` gives 0).</li><li>**Redaction** (`b_redact_test.exs`): a Telegram URL, `inspect(%Req.Request{})`, an Erlang `~p` long term, a report, a charlist and a URL-encoded value were all redacted, with no fragments.</li><li>**Redirects:** a cross-host 307 from the model URL arrived without `Authorization` (Req 0.7.4).</li></ul> |
| 2 | Page isolation | **Partly checked** | <ul><li>Playwright `privacy.spec` + `popover.spec`: 17 passed.</li><li>`npm test`: 1,973 passed, 0 failed.</li><li>Deeper DOM, timing and shadow-root attacks: **not checked**.</li></ul> |
| 3 | Injection | **Checked with proof**; prompts **not checked** | <ul><li>**SQL:** the only interpolated SQL uses fixed identifiers (`word_model_v2.ex:89`, `language_tags.ex:52`/`:183`). About 35 malformed authenticated inputs gave no 500.</li><li>**CSV/Anki** (`b-export-injection.mjs`): cells starting with `= + - @ \t \r` get `'` prepended and are quoted; Anki writes `#html:false`.</li><li>**Logs:** Host log lines are escaped (`"evil\e[31mred..."`, `"a\"; [error] fake line"`).</li><li>**HTML sinks:** none found by grep (`bulk/sheet.js:111` uses `DOMParser` and reads `textContent`, which is inert). `npx eslint extension` exits 0.</li><li>**Anki first data row starting with `#`:** not checked (no Anki).</li></ul> |
| 4 | Messaging | **Checked with proof** | <ul><li>`b-sender-kinds.test.mjs`: 15/15. Another extension, its own URL claimed by another id, no id, prefix tricks, `file:`, `about:blank`, `data:` and a tab-less http sender all get no kind. `kotiko.org` look-alikes, http, userinfo and another port get no `docs` kind.</li><li>`test/bg/privacy.test.mjs` "every other type refuses them": pass.</li><li>Content-script routes are only `sync`, `sensitiveSites` and `neverSwap`. `oauth.code` also checks `isCallback`.</li><li>No `externally_connectable` and no `web_accessible_resources`.</li></ul> |
| 5 | Network | **Checked with proof**. B-01, B-06 | <ul><li>**Default bind:** 127.0.0.1 only. With `BIND=0.0.0.0` the server logs the plain-HTTP warning; through the LAN IP `/health` gives 200 and the API gives 401.</li><li>**TLS:** Req refuses a self-signed `openssl s_server` (`selfsigned_peer`).</li><li>**Outbound connections:** `strace -f -e connect` over boot plus a lookup showed only `127.0.0.1:42110` (the configured `LLM_URL`).</li><li>**Wiktionary:** the title is percent-encoded (`pronounce.ex:620`).</li><li>**Not checked:** an uncapped `res.text()` at `background.js:596`.</li></ul> |
| 6 | Server | **Checked with proof**. B-02, B-04 | <ul><li>**Auth:** 14 path spellings (`/%61pi`, `//api`, `/%2e/`, `/health/..`) and 8 methods on `/health` give 401. `bearer`, a double space, `Basic`, a wrong or truncated token, or two `Authorization` headers give 401.</li><li>**Host check:** `evil.com`, `foo.localhost`, `0x7f000001`, `127.1`, `localhost.evil.com` and `127.0.0.1.nip.io` give 421; h2c with `:authority` `evil.com` gives 421; no Host or two Hosts gives 400; absolute-form requests use the URI host.</li><li>**Body caps:** an unauthenticated 50 MB body (plain or chunked) gets 401 after 0 bytes uploaded; 65 KB authenticated gets 413 (v1 and legacy); the batch route gets 413; `text/plain` gets 415.</li><li>**Repeated parameters:** the last value wins; `lang[]`, `status[]` and `include[]` give 400; legacy `/api/words?lang[]` ignores the filter (harmless).</li><li>**Legacy delete:** `/api/words/<20 digits>` gives 404.</li><li>**Bot** (`b_bot_stranger_test.exs`): every stranger update (text, `/list`, `/remove`, `/bases`, `/add` in a group, voice, Add/Del buttons, no `from`) gave `telegram calls: []`, 0 model calls and no database change. With no allowlist the bot only replies with the sender's ID.</li><li>**`install-service.sh` install mode:** not run.</li></ul> |
| 7 | Resource exhaustion | **Checked with proof** | <ul><li>17,000 half-sent request lines: the owner still got 200, and all were closed with 408 after 60 s.</li><li>A flood of about 14k unauthenticated `/health` requests per second moved the owner's median latency from 0.6 ms to 10.3 ms.</li><li>Nested JSON (64 KB, and 1 MB on the batch route) was rejected fast.</li><li>A batch of 500 maximum-size words gave 200 in 0.22 s.</li><li>Extension imports (`b-import-caps.mjs`): over 5 MB gives `too_big`, over 20 MB gives `too_big`, 20,001 words gives `too_many`, and 2 MB of nested arrays is rejected in 152 ms.</li></ul> |
| 8 | Supply chain and build | **Checked with proof** (lightly) | <ul><li>`npm audit`: 0. `mix hex.audit`: clean. `mix deps.audit`: "No vulnerabilities found".</li><li>Every action is pinned by SHA; no `pull_request_target`; CI has `contents: read`; `eval.yml` runs only on `workflow_dispatch` with inputs passed through `env`.</li><li>Zips built twice gave identical SHA-256 (Chrome `0582ec92…`, Firefox `4bbc3516…`), 123 files each, nothing stray.</li><li>`mix test`: 1,108 tests and 23 properties, 0 failures.</li></ul> |
| 9 | Privacy | **Checked with proof** (server side) | <ul><li>"No telemetry" confirmed by strace.</li><li>The model receives the typed text, base languages, prompt, key, the user agent and `x-title: Kotiko` (also sent to non-OpenRouter providers; harmless).</li><li>The log claim holds for typed text (see B-07 for the model's words).</li><li>The requirement "Other accounts can't read your words" is broken by B-01, B-02 and B-03.</li><li>Not checked at runtime: extension local-mode traffic (I relied on `privacy.test.mjs`), and Wiktionary, Telegram and OpenRouter traffic.</li></ul> |

## Proof-of-concept files

All are in `/home/aylac/Projects/personal-projects/kotiko-sec-b/test/security/poc/`, local and uncommitted:
- `b-v6-squatter.py`, `b-localhost-which.mjs`, `b-extension-v6-squat.mjs`: B-01
- `b-data-dir-plant.sh`: B-02
- `b-legacy-folder.sh`: B-03
- `b-host-log-flood.py`: B-04
- `b_config_probe.exs`: B-05, B-06, B-09 and the `NAME_FILE` checks
- `b-fake-llm.py`: B-07 and the privacy capture
- `b-auth-rate.py`: B-09
- `b_bot_stranger_test.exs`: bot (symlinked into `server/test/security_poc/`)
- `b_redact_test.exs`: redaction (symlinked into `server/test/security_poc/`)
- `b-sender-kinds.test.mjs`: messaging
- `b-export-injection.mjs`: CSV and Anki
- `b-import-caps.mjs`: import caps
- `b-slow-headers.py`: slow connections
- `b-health-flood.py`: `/health` flood

The server launch helpers are in `scratchpad/sec-b/bin/` (`start-server.sh` and `start-traced.sh`).

## Not checked

- B-02 with files owned by a different account (no second account or `newuidmap`).
- B-01 with the real extension in Firefox (only Firefox page loads and `fetch` were run); macOS; Windows with WSL.
- Prompt injection, and deep page-isolation attacks (I relied on the existing suites).
- Anki's handling of a first data row starting with `#`.
- An oversized server response crashing the extension (`background.js:596`).
- `install-service.sh` install mode, and the systemd `UMask` at runtime.
- Real Wiktionary, Telegram, OpenRouter and store traffic (forbidden by the rules).

### Reviewer C, on v1.0.0-rc.1 (supply chain and release)

# Slice 54 security review: Reviewer C report

<!-- Saved by the lead from Reviewer C's hand-back message, unchanged: the reviewer's sandbox refused report files. -->

- **Candidate:** `v1.0.0-rc.1`, commit `cf7378e1b97e25043f322182e8f0f39e6dc90b44` (annotated tag, SSH-signed: `Good "git" signature for dev@scriptkittyos.com with ED25519 key SHA256:HqIaFq/thUm844NjYC3a+4Br40cqD2yJHEq1L2iiw4E`).
- **Reviewer:** C (starting attacker: supply chain and release). I worked alone, in `/home/aylac/Projects/personal-projects/kotiko-sec-c` (detached at the tag) and the `sec-c` scratch folder only. I read no other reviewer's checkout or notes and did nothing outward-facing. GitHub access was read-only `gh`/`gh api` calls, plus read-only HTTPS GETs of `kotiko.org`.
- **Environment:** Node v22.23.2, Elixir 1.19.2 / OTP 28.1, Playwright 1.63.0 (Chromium), gitleaks 8.30.1 and OSV-Scanner 2.6.0. I downloaded both tools myself into `sec-c/tools/` and checked them against the SHA-256s CI pins (`OK` / `OK`).
- **Release status:** the GitHub pre-release for `v1.0.0-rc.1` does not exist. Release run 37553786338 failed in `build` at `npm run coverage` (`not ok 5 - a word on the never-swap list stays, on every page, until it is taken off`, `# fail 1`), so it published no zips, SHA256SUMS, SBOM or attestations. I compared local builds instead (area 8); see C-08.

**PoCs** (local, uncommitted, in `test/security/poc/`):

| File | What it shows |
|---|---|
| `server-probe.sh` | Black-box checks of auth, Host, body limits, CORS and failed-auth throttling against a local test server |
| `fake-provider.mjs` | A fake OpenAI-compatible provider that logs every request and returns a chosen (hostile) answer |
| `routes-audit.mjs` | Loads the real `background.js`, lists every message type with its allowed senders, and sends each one from five senders that must be refused |
| `page-handoff.spec.mjs` + `playwright.config.mjs` | C-04, and a markup `native` rendered as text |
| `gate-false-positive.sh` | C-05 |
| `sync-browser-langs.mjs` | C-07 |

Run the Playwright PoC with `npx playwright test -c test/security/poc/playwright.config.mjs`. Scratch outputs are in the `sec-c` folder: `server-probe.out`, `server.log`, `provider.jsonl`, `npm-test.log`, `build1/`, `build2/`, `build3/`, `build-fresh/`, `amo/`, `tagpoc/`, `prsim/`, `allrefs/`, `site-fetch/`.

## Summary

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | |
| High | 0 | |
| Medium | 1 | C-01 |
| Low | 3 | C-02, C-03, C-04 |
| Informational | 7 | C-05 to C-11 |

In short: the dependencies are clean (OSV, npm audit, hex.audit and deps.audit all report zero), and no secret appears in any ref, PR ref or zip. The zips rebuild byte for byte. The CI workflows pin every action by SHA, use no `pull_request_target`, and have no script-injection sinks. Messaging, the server's auth and Host check, and TLS verification all held up under testing. The weak spots are release governance (one maintainer account can release alone, a signed tag can be replayed under another name, tag names can be squatted) and a few privacy or verification claims that are stricter than the code.

---

## Findings

### C-01 · Release authority is documented but not enforced by repository settings · Medium

**Why medium:** the protections the docs rely on are not switched on: reviewed changes to signing keys, review on every PR, and a maintainer approving store uploads. One compromised maintainer account or write-scoped token can add its own signing key and get a signed, attested GitHub release. Once store secrets exist, it can also upload to the stores with nobody approving.

**Requires:** write access, meaning one maintainer account or token. Collaborators today are `HackTuah` (admin) and `minitru` (maintain).

**Locations**
- `.github/allowed_signers:8`: "Adding or removing a key is a reviewed pull request."
- `docs/security/assurance-case.md:68` ("Review by a maintainer") and `:142` ("review on every pull request").
- `docs/security/assurance-case.md:103` and `docs/stores.md:98-104`: the `release` environment with required reviewers.
- `.github/workflows/release.yml:256` and `:322` (`environment: release`), `store-status.yml:54`, `eval.yml:31`.
- `ci.yml:42`: gitleaks reads `.gitleaks.toml` from the PR's tree.
- `dependency-scan.yml:266`: `osv-scanner.toml` comes from the PR's tree.

**Proof**

Read-only API calls:
```sh
gh api repos/ScriptKittyOS/kotiko/rulesets/24531669 --jq '.rules[] | select(.type=="pull_request") .parameters'
gh api repos/ScriptKittyOS/kotiko/environments --jq '[.environments[].name]'
gh api repos/ScriptKittyOS/kotiko/actions/permissions
gh pr list --repo ScriptKittyOS/kotiko --state merged --limit 30 --json number,author,mergedBy,reviews \
  --jq '.[] | "\(.number) author=\(.author.login) mergedBy=\(.mergedBy.login) reviews=\(.reviews|length)"'
```

A PR switches off its own required secret scan. This ran in a local clone (`sec-c/prsim`); nothing was pushed:
```sh
printf 'const t = "ghp_<36 random alphanumerics>";\n' > leak.js && git add leak.js && git commit -s -m "add helper"
gitleaks git --log-opts=HEAD --redact --config .gitleaks.toml --exit-code 1 .     # what ci.yml:42 runs
sed -i 's/^stopwords = \["0123456789"\]/&\npaths = ['"'"'''leak\\.js'"'"''']/' .gitleaks.toml && git commit -asm "tidy gitleaks config"
gitleaks git --log-opts=HEAD --redact --config .gitleaks.toml --exit-code 1 .
```

**Observed**
```
{"allowed_merge_methods":["merge","squash","rebase"],...,"require_code_owner_review":false,...,"required_approving_review_count":0,...}
["github-pages"]                    <- no release / store-status / eval environment exists
{"enabled":true,"allowed_actions":"all","sha_pinning_required":false}
27 author=HackTuah mergedBy=HackTuah reviews=0    <- PR #27 added the release signing key to allowed_signers
... 22 of 23 merged PRs have 0 reviews (#20 has 1)
--- 1. PR adds a token; .gitleaks.toml as on main:  exit=1  leaks found: 1
--- 2. same PR also edits .gitleaks.toml:            exit=0  no leaks found
```

What these settings allow:
1. A maintain-role account can merge its own PR alone, including changes to `allowed_signers`, `release.yml` and `verify-tag.sh` (what verify-tag trusts "from main"). After that, `git tag -s` with its own key is accepted: build, attest, non-prerelease GitHub release.
2. GitHub creates a missing environment on first use with no protection rules. `publish-chrome` and `publish-firefox` would then run without approval. Today they skip only because no CWS or AMO secrets exist; that changes as soon as the secrets are added, especially if they go in as repository secrets.
3. The required `secrets` and `osv-scanner` checks read their allowlists (`.gitleaks.toml`, `.gitleaksignore`, `osv-scanner.toml`) and `scripts/check-*.mjs` from the PR itself.

**Fix**
- Main ruleset: `required_approving_review_count: 1`, `require_code_owner_review: true`, and CODEOWNERS on `.github/**`, `scripts/verify-tag.sh`, `scripts/check-security-gate.mjs`, `.gitleaks*`, `osv-scanner.toml` and `extension/manifest.json`. If only one person is active, record that as an accepted risk in GOVERNANCE instead of claiming review.
- Keep "Actions can approve PRs" off.
- Create the `release`, `store-status` and `eval` environments now: required reviewers; `v*` tags only for `release`, `main` only for the other two. Store secrets go only into those environments.
- Turn on `sha_pinning_required`.

**Regression test:** a read-only settings check (`scripts/check-repo-settings.mjs`, run by the release checklist or a weekly job). It fails unless the review count is at least 1, code-owner review is on, `release` exists with a reviewer and a `v*`-only policy, and SHA pinning is required. Today it fails on all four.

### C-02 · `verify-tag.sh` doesn't check the signed tag's own name, so a signed rc can be replayed as a final release · Low

**Why low:** anyone with write access can create `refs/tags/vX.Y.Z` pointing at the release manager's signed `vX.Y.Z-rc.N` tag object. verify-tag then reports `prerelease=false`, and the full release path runs (non-prerelease GitHub release, release PR relabelled, store-gate, store jobs) without the release manager ever signing a release. The code shipped is still code the release manager signed as a candidate, which limits the gain. Because tags are permanent (C-03), the replay also burns the version name.

**Requires:** write access.

**Locations:**
- `scripts/verify-tag.sh:48-54`: the name is parsed from the ref only.
- `:57-59`: the tag object is read, but its `tag` header is never compared.
- `:84` (the commit), `:104-107` (only the core version is compared).
- `.github/workflows/release.yml:76`.

**Proof** (local clone, real signed rc.1 tag object, real `.github/allowed_signers`):
```sh
git clone -q --no-checkout <kotiko-sec-c> tagpoc && cd tagpoc
git fetch -q <kotiko-sec-c> 'refs/tags/v1.0.0-rc.1:refs/tags/v1.0.0-rc.1'
git checkout -q -f db62607
git -c commit.gpgsign=false merge -q --no-ff -m "sim: merge release PR" cf7378e   # ruleset allows "merge"
git update-ref refs/remotes/origin/main HEAD
git update-ref refs/tags/v1.0.0 "$(git rev-parse refs/tags/v1.0.0-rc.1)"           # creation isn't blocked
git cat-file -p refs/tags/v1.0.0 | sed -n 1,4p
bash <kotiko-sec-c>/scripts/verify-tag.sh v1.0.0 --signers <kotiko-sec-c>/.github/allowed_signers --keys <kotiko-sec-c>/.github/release-keys.asc
```

**Observed**
```
object cf7378e1b97e25043f322182e8f0f39e6dc90b44
type commit
tag v1.0.0-rc.1
tagger Ayla Croft <dev@scriptkittyos.com> 1791334034 -0400
Good "git" signature for dev@scriptkittyos.com with ED25519 key SHA256:HqIaFq/thUm844NjYC3a+4Br40cqD2yJHEq1L2iiw4E
version=1.0.0
prerelease=false
EXIT=0
```

A defence-in-depth gap: `verify-tag.sh:115` outputs `commit=`, but the build job never compares it with what it checks out. The "tags are permanent" ruleset blocks tag updates today, so I found no TOCTOU path.

**Fix:**
- After `verify-tag.sh:59`: `[ "$(git cat-file tag "refs/tags/$tag" | sed -n 's/^tag //p')" = "$tag" ] || die …`.
- Expose `commit` as a job output and fail the build when `git rev-parse HEAD` differs from it.
- Add the same check to `tag-release.sh` and to verify.md's manual steps.

**Regression test:** a throwaway repo with a test key, signed `v9.9.9-rc.1`, and `refs/tags/v9.9.9` pointing at it. `verify-tag.sh v9.9.9` must exit 1.

### C-03 · Anyone with write access can permanently squat release tag names; the docs say a bad tag can be deleted, but it can't · Low

**Why low:** the "tags are permanent" ruleset blocks update and deletion of all tags with no bypass actors, but nothing restricts creation. Any account with write access can push `v1.0.0` first (unsigned, or the C-02 replay). The real signed `v1.0.0` can then never be pushed, and the version is burned until an admin edits the ruleset. docs/stores.md tells maintainers to recover by deleting the tag, which the ruleset refuses.

**Requires:** write access.

**Locations:** ruleset 24531685; `docs/stores.md:107-111` and `:243-244`.

**Proof:**
```sh
gh api repos/ScriptKittyOS/kotiko/rulesets/24531685 --jq '{conditions,bypass_actors,rules}'
sed -n 241,245p docs/stores.md
```

**Observed**
```
{"bypass_actors":[],"conditions":{"ref_name":{"exclude":[],"include":["~ALL"]}},"rules":[{"type":"update"},{"type":"deletion"},{"type":"non_fast_forward"}]}
  Delete the tag (`git push origin :refs/tags/vX.Y.Z` and `git tag -d vX.Y.Z`; the ruleset
  lets maintainers do this), fix the key, run `scripts/tag-release.sh` again.
```
There is no `creation` rule, and the empty bypass list means deletion is refused for everyone, maintainers included.

**Fix:** add a `v*` tag ruleset with the `creation` rule and a bypass for release managers only. Either let release managers bypass deletion too, or change stores.md:243 to say a wrong tag can't be deleted and the version must be bumped.

**Regression test:** the C-01 settings check also asserts a `creation` rule on `v*` with the release-manager bypass.

### C-04 · Pages can detect Kotiko even where it's paused or off, and can switch Kotiko off on themselves · Low

**Why low:** `content.js` dispatches a `kotiko:handoff` CustomEvent on the page's own `document` and tears down on any such event with a different detail. Page script can therefore:
- learn Kotiko is installed on every http(s) page, including paused sites, sensitive sites, and with Kotiko switched off;
- remove all swaps on its own page.

The privacy policy says pausing a site or turning Kotiko off stops sites from telling that you use Kotiko. The impact is a one-bit fingerprint, with no access to words or secrets.

**Requires:** nothing beyond being a web page.

**Locations:**
- `extension/content.js:531-532`: dispatches, then listens on `document`.
- `:470-472`: `onHandoff` tears down on any other detail; `:474-480`.
- The claim: `docs/privacy/en.md:104-109` and `docs/privacy/inventory.md` §2.

**Proof:** `npx playwright test -c test/security/poc/playwright.config.mjs` runs `page-handoff.spec.mjs` with the repo's e2e fixtures and the unpacked extension in Chromium. A page listener is registered before load; then the page dispatches its own event.

**Observed**
```
BEFORE {"swaps":2,"seen":[{"detail":"muxegkdw-0kdg1j2tlwca","trusted":false}],"imgs":0,"pwned":null,"texts":["perro","дом<img src=x onerror=window.__pwned=1>"]}
AFTER page dispatched kotiko:handoff {"swaps":0}
SWITCHED OFF {"swaps":0,"seen":["string"]}
SITE PAUSED {"swaps":0,"seen":["string"]}
  2 passed (5.2s)
```
The same run shows the markup `native` rendered as text: no `<img>` element, and `__pwned` stays null.

**Fix:** drop the page-visible DOM event for the handoff. Options:
- signal through `chrome.storage.session` or a runtime message keyed by tab;
- have the old instance tear down when `ext.runtime.id` becomes undefined, which `contextValid()` already checks.

If a DOM signal has to stay, dispatch nothing while the page is paused, off or sensitive.

**Regression test:** in `privacy.spec.mjs`, a page sees no `kotiko:*` event while Kotiko is off or the site is paused, and a page-dispatched `kotiko:handoff` leaves the swap count unchanged.

### C-05 · The store gate accepts an open review when any line starts with the gate phrase · Informational

**Why:** `CLOSED_RE` matches a line that starts with the word Gate, a colon and "closed", anywhere in a `review-v*.md`. That includes appended reviewer reports (spec §5 appends them unchanged) and "not yet" notes. The `release` environment approval would be the second lock, once it exists (C-01).

**Location:** `scripts/check-security-gate.mjs:25,36`; `release.yml:250`.

**Proof:** `test/security/poc/gate-false-positive.sh <empty dir>` writes three reports that all say the gate is open.

**Observed:**
- the plain "open" text: exit 1;
- text with an appended `- Gate: closed is what the lead writes at the end; not yet.`: `Security review closed: review-v1.0.0-rc.1.md`, exit 0;
- `**Gate:** closed? No: two medium findings are still open.`: exit 0.

**Fix:** require one exact form, above a fixed `## Appendix` heading:
```
^Gate: closed (\d{4}-\d{2}-\d{2}) by .+, fixes confirmed on (v\d+\.\d+\.\d+-rc\.\d+)$
```
Also require that no "open" line is present, and optionally that the rc's core version matches the tag's.

**Regression test:** the three texts above, as unit tests of `closedReviews()`, each expecting `[]`.

### C-06 · The Firefox package AMO receives is a fresh web-ext zip, not the released, attested zip · Informational

**Why:** `docs/verify.md:3` says the GitHub zips are "the exact packages sent to the Chrome Web Store and Firefox Add-ons". `docs/reproducible-builds.md:3-4` says a rebuild gives "the same bytes as … the stores". But `release.yml:363,372` unzips the release zip and runs `web-ext sign --source-dir`, which repacks it with current timestamps (`web-ext/lib/cmd/sign.js:2,45` calls `build`). The files inside are the same, but AMO's copy can't be matched to SHA256SUMS or the attestation.

**Proof:**
```sh
unzip -q build1/kotiko-firefox-1.0.0-rc.1.zip -d amo/src
npx --no-install web-ext build --no-config-discovery --source-dir amo/src --artifacts-dir amo/a --filename a.zip
npx --no-install web-ext build --no-config-discovery --source-dir amo/src --artifacts-dir amo/b --filename b.zip
sha256sum build1/kotiko-firefox-1.0.0-rc.1.zip amo/a/a.zip amo/b/b.zip
```

**Observed**
```
4bbc3516743bc79b415f0fe1b31c5e2853abc3debe754bb9fc0815946e4b9cd4  build1/kotiko-firefox-1.0.0-rc.1.zip
6e5842e05ecb0efca4b94cb6eb411110efbc83fc3667365814c1b6c2b7d037eb  amo/a/a.zip
a5e34f5fd3a7f5dcc48ee52f8709dad77e983926171cf811d5a387893c08ee5b  amo/b/b.zip
same file list
```

**Fix:** upload the exact zip through AMO's v5 upload API, or reword both docs to "the same files, repacked by web-ext".

**Regression test:** a release step that hashes the file actually uploaded and compares it with SHA256SUMS, or a docs grep if the wording changes instead.

### C-07 · The browser's languages reach storage.sync right after install, but the inventory says they never leave the device · Informational

**Why:** a fresh install sets the base languages from the browser's languages and writes them, with `baseLangsDetected`, to `storage.sync`. The browser syncs that to the learner's Google or Mozilla account before the learner has confirmed anything. This contradicts:
- `docs/privacy/en.md:38` (listed under "What stays on your device");
- `docs/privacy/inventory.md:31` ("Leaves the device? Never").

The policy's "Browser sync" section does name "the languages you read in".

**Locations:** `extension/background.js:1261-1267`, `:215-218` (`saveUi` writes `storage.sync`), `:163`.

**Proof:** `node test/security/poc/sync-browser-langs.mjs` runs the real background.js with Accept-Languages `en-US, de-CH, ja, tr` and fires `onInstalled({reason:"install"})`.

**Observed:**
```
storage.sync after install: {"seedSalt":"f57fc02f36b68128b2ff620437f3f25f","ui":{"uiLang":"auto","baseLangs":["en","de","ja"],"baseLangsDetected":["en","de","ja"],"baseLangsConfirmed":false}}
```

**Fix:** either sync only once the learner has confirmed and leave out `baseLangsDetected`, or correct the inventory and policy wording.

**Regression test:** in `test/bg/privacy.test.mjs`, `storage.sync.ui` has no `baseLangsDetected` after install, or a wording test that matches the behaviour chosen.

### C-08 · The release build runs unseeded property tests and flaky tests, so a tag's release can fail at random (rc.1 did) · Informational

**Why:** this hurts the availability of the release pipeline, which is how security fixes ship. `release.yml:123` runs `npm run coverage`, and `test/helpers/properties.mjs:14-18` picks a random seed each run. The rc.1 run failed on a flaky DOM test. My own full run failed two different tests:
- `test/dom/welcome.test.mjs:221`, which passed 25/25 on rerun;
- a reproducible property failure: `validateWordsResponse` throws when `contentType` is an object whose `toString` isn't callable (`extension/lib/validate-words.js:146`). `fetch` headers can't produce that input, so this is robustness only, not exploitable.

**Proof:**
```sh
FC_SEED=504574479 FC_PATH="5:0:2:78:77:77" node --test --import ./test/helpers/assert-mode.mjs test/unit/properties/validate-words.test.mjs
node -e 'require("./extension/lib/validate-words.js"); try{globalThis.WordValidator.validateWordsResponse({contentType:{toString:false}})}catch(e){console.log("THREW",e.constructor.name,e.message)}'
gh run view 37553786338 --repo ScriptKittyOS/kotiko --log-failed | grep -E "not ok|# fail"
```

**Observed:**
```
Counterexample: [{"contentType":{"toString":false}}]   # fail 2
THREW TypeError Cannot convert object to primitive value
not ok 5 - a word on the never-swap list stays, on every page, until it is taken off
# fail 1
```

**Fix:**
- At validate-words.js:146, use `typeof raw?.contentType === "string" ? raw.contentType : ""`.
- Set a fixed `FC_SEED` in the release job; keep random seeds in CI and the weekly run.
- Quarantine or fix the timing-dependent DOM tests.

**Regression test:** pin the counterexample as a unit test.

### C-09 · No throttling of failed API-token attempts on the server · Informational

**Why:** a client on the network can try tokens without limit, and nothing is logged per failure. Tokens are at least 24 characters (`server/lib/kotiko/token.ex:11`), and generated ones are strong, so the real risk is only a weak token the learner chose.

**Location:** `server/lib/kotiko/router.ex:209-219` (`authorize`), `:221` (`deny`).

**Proof:** `BASE=http://127.0.0.1:47999 TOKEN=… test/security/poc/server-probe.sh` against my local test server.

**Observed:** `20 wrong tokens in a row, status codes: 401 … 401` (20 × 401, no 429).

**Fix:** a per-IP failure counter in ETS (for example, 429 with `retry-after` after 10 failures a minute) plus a rate-limited log line.

**Regression test:** ExUnit sends 11 bad tokens from one `remote_ip` and expects 429 on the 11th, while a good token still works from another IP.

### C-10 · Cloudflare changes the published site: the policy page served differs from the repository's text · Informational

**Why:** Cloudflare sits in front of kotiko.org and changes what visitors get:
- it injects `/cdn-cgi/scripts/…/email-decode.min.js` into `/privacy/`;
- it replaces the contact addresses with `[email protected]` for visitors without JavaScript;
- it adds a NEL `report-to` header pointing to `a.nel.cloudflare.com`.

So the checklist item "kotiko.org/privacy/ serves the same text as docs/privacy/en.md" is false as served. Any future Cloudflare injection would reach pages the repository's tests never see. `/connect/` is unaffected: 0 scripts, meta CSP `default-src 'none'`, `no-referrer`, no `set-cookie`.

**Proof:**
```sh
curl -sS https://kotiko.org/privacy/ | grep -oE '<script[^>]*src="[^"]*"'
curl -sS https://kotiko.org/privacy/ | grep -oE '.{0,20}__cf_email__.{0,60}'
grep -rn "cdn-cgi\|email-decode" site/src
curl -sSI https://kotiko.org/connect/ | grep -i report-to
```

**Observed:**
- `<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"`
- `[email&#160;protected]`
- no hits in the repository
- the `cf-nel` `report-to` header

**Fix:** turn off Email Obfuscation (and keep Rocket Loader and auto analytics off), and optionally NEL.

**Regression test:** a post-deploy or weekly site check that fails on any `cdn-cgi` script or `__cf_email__`, and diffs the served policy text against the repository.

### C-11 · The two store data declarations disagree on the API key · Informational

**Why:** the Chrome privacy form ticks Authentication information: Yes (`store/chrome-web-store.md:79`). The Firefox manifest declares `data_collection_permissions.required: ["none"]` (`store/firefox-amo.md:31`), and Mozilla's categories include authentication information. firefox-amo.md already rates this "Confidence: medium", so this is a store-review risk, not a code risk.

**Proof:**
```sh
grep -n "Authentication information" store/chrome-web-store.md
node -p 'JSON.stringify(require("./extension/manifest.json").browser_specific_settings.gecko.data_collection_permissions)'
```

**Observed:** `79:| Authentication information | **Yes** |…` and `{"required":["none"]}`.

**Fix:** settle it with AMO before submission. If AMO counts the key, declare `"optional": ["authenticationInfo"]` and request it when a key is first saved.

**Regression test:** `store-readiness.test.mjs` asserts the two declarations agree.

---

## Coverage matrix

All nine areas: **checked with proof**. The evidence for each follows.

### 1. Secrets
- **History:** gitleaks 8.30.1 with `.gitleaks.toml` and `.gitleaksignore` over `--all` of a fresh `git clone --mirror` (5 heads, 31 `refs/pull/*`, 1 tag; 225 commits): `no leaks found`, exit 0.
- **Default rules only** (no allowlist, no ignore file): 15 hits. The three values without the `0123456789` stopword are test fakes: `sk-or-v1-from-the-env-0123456789`, `whisper-key-0123456789`, `sk-or-v1-abcdef0123456789`. The only `.env*` ever committed is `server/.env.example`, and all its values across history are empty or public defaults.
- **Zips:** `gitleaks dir` over both unpacked zips found nothing.
- **Storage:** e2e `privacy.spec.mjs` passed. Content scripts can't read the key or token, `storage.session` is refused, and `kotikoStores: []`.
- **Backups:** `backup.js:359-360` is an allowlist with no key or token.
- **Server logs:** at `LOG_LEVEL=debug`, after an add containing a marker, a provider-down add and 20 bad tokens, `server.log` has 0 hits for the token, the key or the markers. Extension `console.*` calls log messages only.
- **Server files:** started with `umask 022`, the data dir is `700` and `kotiko.db*` are `600`.

### 2. Page isolation
- `popover.spec.mjs` and `privacy.spec.mjs` passed: swaps carry only `class,dir,lang,translate`, no original word, and the card's shadow root is closed.
- My handoff PoC found C-04.
- The manifest has no `web_accessible_resources` and no `externally_connectable`.
- The content script's `onMessage` accepts only `sender.id === runtime.id && !sender.tab` (`content.js:391`).

### 3. Injection
- **DOM:** `npx eslint extension` (with `no-unsanitized` as errors) exits 0. The only HTML-parsing sink is `bulk/sheet.js:111`, which uses an inert `DOMParser(...).body.textContent`. My e2e shows a markup `native` rendered as text.
- **Hostile model answer through the server** (fake provider): both formula forms were dropped (`bad_form`); markup and formulas in other fields were stored as plain strings.
- **CSV:** `export-files.js:17,36` prefixes `'` to leading `= + - @ \t \r`; observed `"'=HYPERLINK(…)"`, `"'+SUM(1,1)"`, `'-2+3`.
- **Anki:** `#html:false`, with tabs and newlines flattened; formulas are left as is. Anki doesn't evaluate them; a spreadsheet opening the .txt would.
- **SQL:** Ecto, parameterised. `mix sobelow` gives `SCAN COMPLETE` with no findings.
- **Prompts:** model output is bounded by `spec/rules.json` and checked by the word spec, and the model can't make requests, so injected instructions can't exfiltrate anything.
- **Logs:** no typed text logged (area 1).

### 4. Messaging
- `routes-audit.mjs` on the real background: 44 types. `content` may send `neverSwap, sensitiveSites, sync`; `docs` may send `oauth.code`; `page` gets the other 41.
- Another extension, a `file://` content script and a sender with no tab: all 44 refused.
- A kotiko.org page other than `/connect/` sending `oauth.code` gets "Not the callback page." A lookalike host doesn't get `oauth.code`.
- No `onConnect`, `onMessageExternal` or port handlers.
- e2e: every privileged type sent from the content-script world answers `forbidden`.
- PKCE S256, with the verifier kept in the background. `connect.spec.mjs` 4/4 passed: a code with no pending sign-in is refused, and another site's `/connect/?code=` isn't read.

### 5. Network
- Hosts in the zip match inventory §4. `store-readiness.test.mjs` and `bg/privacy.test.mjs`: 24/24 passed.
- The provider client uses `credentials: "omit"` (`client.js:123`).
- Keys go only to the address a Kotiko page bound (`background.js:328-346`). e2e: settings rewritten from a content script send nothing to the new address.
- `normalizeServerUrl` refuses userinfo, query, fragment and non-http(s) (`url.js:50-83`). The plain-http warning works (e2e).
- **Server TLS:** a request to a local self-signed HTTPS server gave `Fatal - Bad Certificate selfsigned_peer`; the http control call worked. No `verify_none` anywhere in `server/lib`.
- Server provider requests carry `x-title: Kotiko`, the Kotiko user-agent and Bearer auth, to `LLM_URL` only.
- The SSRF surface is the provider or server address that the learner or operator types; content scripts can't change it.

### 6. Server
`server-probe.sh` against my local server (port 47999, temp data, fake provider):

| Request | Result |
|---|---|
| `/health` without a token | 200 (it shows the version; documented) |
| `/api/v1/words`, `/api/words`, `/%61pi/words` without a token | 401 |
| Wrong token, token in the query, lowercase `bearer` | 401 |
| Good token | 200 |
| `Host: evil.example`, `localhost.evil.example`, `127.0.0.1.nip.io` | 421 |
| `Host: LOCALHOST.` | 200 |
| 2 MB body without a token | 401 (not parsed) |
| 100 KB JSON with a token | 413 |
| 1.5 MB to `/batch` | 413 |
| Form body | 415 |
| 20-digit id | 404 |
| Preflight from `Origin: https://evil.example` | 401, no `access-control-*` headers |

- Wrong tokens aren't throttled (C-09).
- **Bot:** `bot_test.exs:175` (strangers ignored) passed. The full server suite: `23 properties, 1106 tests, 0 failures`.
- `run.sh:15` (`umask 077`) and `:24-27` (chmod `.env` to 600) were read, not run.

### 7. Resource exhaustion
- `npm run perf`: all 21 rows within budget, for example `precedence.pick.100k` 410 ms against a 500 ms budget, `dashboard.open.20k` 221 ms against 800, and 250 KB of page text.
- Limits in code: `bulk/parse.js:19-20` (5 MB, 5000 rows), `backup.js:24-25` (20 MB, 20k words), `add-queue.js:29` (20 jobs), `rules.json` (`max_vocabulary` 20k, `max_words` 5, `max_input_chars` 200), and the server's 413s above.
- Content scripts can't queue lookups, so a page can't burn quota. A page that reloads itself triggers one `sync` per load (`content.js:528`).
- Read but not run: a stranger flooding the bot while `ALLOWED_TELEGRAM_IDS` is empty (one reply per message).

### 8. Supply chain and build
- **Advisories:** OSV-Scanner over all three lockfiles: `No issues found` (389 + 381 + 35 packages). npm audit 0 (root and site), `mix hex.audit` clean, `mix deps.audit` clean.
- **Lockfiles:** every root and site package comes from `registry.npmjs.org` with a `sha512` integrity, except the intended adbkit link to `scripts/no-adbkit` (a stub that throws). No root install scripts (the site has esbuild and fsevents). `shell-quote` is 1.11.0.
- `web-ext sign` reaches the network without touching the stub.
- `mix.lock`: 35 hex entries, no git or path deps.
- **Workflows:**
  - every `uses:` is pinned to a SHA (except the local reusable workflow);
  - no `pull_request_target`, `workflow_run` or `issue_comment` trigger;
  - no `github.event.*` text interpolated into `run:`; inputs and tag names go through `env:`;
  - `permissions: {}` or `contents: read` at the top level, with write scopes only on the release-please, attest, github-release and Pages-deploy jobs;
  - the release uses no caches, and the jobs that hold store credentials use `npm ci --ignore-scripts`.
- Several CI jobs omit `persist-credentials: false`. Their token is read-only on a public repo and no `.git` is uploaded, so this isn't a finding.
- Gaps: C-01, C-02, C-03, C-05.
- **Package:** each zip has 123 files, equal to the tracked `extension/` files minus `ui/tools/` and dotfiles, plus the license files. Every file is byte-identical to the source except the rewritten manifest. No source maps, tests or remote code.
- **Manifest:** CSP is `script-src 'self'; object-src 'self'`. Permissions are `storage, alarms, unlimitedStorage, scripting`, with `<all_urls>` as host permission and content-script match, plus `kotiko.org/connect/*`. All are used (`scripting` only by `injectOpenTabs`, `background.js:1345-1359`). `web-ext lint`: 0 errors, 0 warnings.
- **Reproducibility:**
  - the release isn't published, so I couldn't compare with its SHA256SUMS;
  - four local builds (normal, `--skip-lint`, `TZ=Asia/Tokyo LC_ALL=C`, a fresh clone at the tag) were identical: chrome `0582ec926118adbe526ee4430f7514f0521476355ab9af8363e237ff2d529794`, firefox `4bbc3516743bc79b415f0fe1b31c5e2853abc3debe754bb9fc0815946e4b9cd4`;
  - the AMO upload is a different zip (C-06);
  - `sync-extension.mjs --check`: 28 files match; `check-forbidden-files.mjs`: clean.

### 9. Privacy
- **Lookups** send the typed text, `base_langs`, `hint_lang` and up to 5 recent languages (`background.js:723`). No page URL or text reaches them.
- **OpenRouter headers** (HTTP-Referer GitHub URL, X-Title Kotiko) match the policy.
- **Wiktionary** gets only the encoded word and `Api-User-Agent` (`background.js:658-662`).
- **Server:** no typed text logged without `LOG_LOOKUPS`.
- **Connect page (live):** no scripts, `default-src 'none'`, `no-referrer`, no cookies.
- **Store listing:** the permission rows match the manifest (test passed).
- Mismatches: C-04, C-07, C-10, C-11.
- Not checked: Firefox's cookie behaviour for the background fetches.

## Not checked
- **Release assets:** none were published (C-08). Once they exist:
  ```sh
  sha256sum -c SHA256SUMS --ignore-missing          # against build-fresh/
  gh attestation verify … --signer-workflow ScriptKittyOS/kotiko/.github/workflows/release.yml --source-ref refs/tags/v1.0.0-rc.1
  ```
- **Firefox runtime behaviour:** credentials on background fetches, and content scripts writing `storage.sync`, which the inventory already says Firefox can't close. All e2e runs were Chromium.
- `run.sh` and `install-service.sh` end to end: I started the server with `mix run` directly so as not to touch any `.env`.
- Live Telegram: ExUnit stubs only, by rule.

## Note for the lead
Because of C-05, the combined `docs/security/review-v1.0.0-rc.*.md` opens the store gate if any appended report has a line that *starts* with the gate phrase. Every mention in this report is mid-line on purpose.

### Reviewer D, on v1.0.0-rc.2

## 1. Header

- **Reviewer:** D, the fourth and independent reviewer, slice 54.
- **Candidate:** `v1.0.0-rc.2`, commit `9b5a6dfc6910452a7160e95016e5e405d33615f4`. The tag is annotated and SSH-signed; `verify-tag.sh` reports a good signature.
- **Date:** 2026-10-07.
- **Environment:**
  - Ubuntu 24.04, Linux 6.14; Node v22.23.2; Elixir 1.19.2 / OTP 28.1.1.
  - Playwright 1.63.0 with its Chromium build 1243 and Firefox build 1543 (Firefox 155.0).
  - gitleaks 8.30.1, a copy of reviewer C's binary whose SHA-256 matches the one `ci.yml` pins.
  - gh 2.45.0, which has no `attestation` command.
- **How I worked:**
  - Everything ran in `/home/aylac/Projects/personal-projects/kotiko-sec-d`. The only change there is the untracked `test/security/poc/`: the A/B/C proofs copied in, plus my `d-*` files.
  - My servers used ports 44001–44005, a fake model on 44100 and fixture servers on 44234–44237. Data folders were under `scratchpad/sec-d/`.
  - I stopped each server by PID. At the end nothing of mine listens on 44000–44999. Four `chrome` listeners remain (44227, 44277, 44319, 44739); they belong to days-old chromium-1208 processes from other sessions, so I left them alone.
  - I never connected to :4747. I read no `.env`. GitHub access was read-only `gh api` / `gh release`, plus one anonymous `curl` of kotiko.org.
  - npm and Playwright installs aside, nothing left localhost.
- **Suites on rc.2:**
  - `npm test`: 2046 tests, 2045 pass, 0 fail.
  - `mix test`: 1163 tests and 23 properties, 0 failures.
  - `test/security/page.spec.mjs`: 9/9.
  - e2e `connect`, `loopback`, `data` and `privacy`: 16/16.
- **Part of the review was not run.** A safety classifier stopped one of my responses while I was writing extra page-side bypass proofs. I didn't redo that work in another form. Section 6 lists exactly what is therefore not checked; please give it to another reviewer.

## 2. Findings rechecked

Regression test files marked "(CI)" run in `ci.yml`: `npm run coverage`, `npm run e2e` (which includes `test/security/*.spec.mjs`), and `mix test`.

| ID | Orig. | Verdict | Proof (command → what I saw) | Regression test(s) |
|---|---|---|---|---|
| **A-01** | Med | **Partly.** The original attack (text hidden by style) is fixed. Visible-but-tiny, same-colour and multi-reload variants are **not checked** (section 6). | A's `a-hostile-page.spec.mjs` A-01 → `page-world loot: {}`. A-01b with 60,652 hidden words → `recovered … {}`. Repo `page.spec.mjs` A-01 ×3 pass (display:none, visibility, opacity:0, off-screen, sr-only 1px, height:0, content-visibility, `hidden`, far away → 0 swaps; per-view cap of 500 concepts holds). By design (`content.js:74-80` and the commit message) the cap is per page view only, so it doesn't bound what several reloads reveal. | `test/security/page.spec.mjs`, `test/dom/content.test.mjs`, `test/e2e/corpus.spec.mjs` (CI) |
| **B-01** | Med | **Partly.** The original attack is fixed: the server now holds both loopbacks, and `localhost` is pinned to 127.0.0.1. The proof check can still be bypassed: **D-01**. | `ss` shows `127.0.0.1:44001` and `[::1]:44001` both held by Kotiko; a squatter's `bind` on either fails with `[Errno 98] Address already in use`, even with SO_REUSEPORT. Squatter on 127.0.0.1 with the server stopped and a fresh worker: repo `loopback.spec` passes, and my step 3 gives `not_kotiko_server` when no proof is cached. But with a proof cached, see D-01: `squatter … with the real token: 3`. | `server/test/kotiko/listener_test.exs`, `boot_test.exs`, `router_proof_test.exs`; `test/e2e/loopback.spec.mjs`; `test/unit/properties/url.test.mjs` (CI) |
| **C-01** | Med | **Partly.** CI half: fixed. Settings: improved, but some stated protections are still not enforced (documented as residual in `assurance-case.md:216`). | `actions/permissions` → `sha_pinning_required: true`. Environments `release` (reviewer HackTuah, `v*` tags only) and `eval` (reviewer, `main`) now exist. `store-status` exists with no reviewer. All have `prevent_self_review: false` and `can_admins_bypass: true`. Main ruleset still has `required_approving_review_count: 0` and `require_code_owner_review: false`. PR simulation (local clone): a PR that adds a `ghp_` token, allowlists it in `.gitleaks.toml`, adds it to `.gitleaksignore` and marks it `gitleaks:allow` → old way exit 0, `no leaks found`; rc.2 `ci.yml` steps (`base-file.sh` from base, tree copies removed, `--ignore-gitleaks-allow`) → exit 1, `leaks found: 1`. A PR can still edit the workflows themselves (acknowledged in commit b675f39). | `test/unit/pr-checks-base.test.mjs` (CI). No read-only repo-settings check exists (C-01 suggested one). |
| A-02 | Low | **Fixed** | A's proof → `page-status reply: {"base":null,"reason":"unknown","lang":null}`. Node check of `canonical` plus `languageName`: a private-use tag (`en-x-keyleakd-…`) makes `DisplayNames` throw, so the name is null and the line is dropped. `tlh` → "Klingon" (a real name only). | `test/unit/page-lang.test.mjs`, `test/dom/popup.test.mjs`, `page.spec.mjs` (CI) |
| A-03 = C-04 | Low | **Fixed** for the tested vectors | A's proof → `swaps before the event: 7; after: 11` (no teardown). C's `page-handoff.spec` → `seen:[]`, swaps unchanged after the page's own event; `SWITCHED OFF {"swaps":0,"seen":[]}`, `SITE PAUSED {"swaps":0,"seen":[]}`. Repo page.spec: no event and no stylesheet when paused or off. | `page.spec.mjs`, `test/dom/content.test.mjs`, `test/bg/inject.test.mjs` (CI) |
| A-04 | Low | **Fixed** for synthetic events. A learner's own trusted click is **not checked** (section 6). | A's proof → `{"open":false,…,"romanization":false}`, `card open: null`. All popover listeners are wrapped in `learner()` (`popover.js:789-803`). | `test/dom/popover.test.mjs`, `page.spec.mjs` (CI) |
| A-05 | Low | **Fixed** | A's original proof → `codes sent to OpenRouter: []`; the junk code is no longer exchanged. Its "real" step fails only because the PoC lacks the new per-sign-in state. Repo e2e "a page that opens the callback with a junk code doesn't spoil the learner's sign-in" passes. | `test/e2e/connect.spec.mjs`, `test/bg/settings.test.mjs`, `test/dom/pages.test.mjs` (CI) |
| A-06 | Low | **Fixed**, including the worker restart A left untested | My `d-content-world.spec.mjs` (A's proof adapted; any `/kotiko` request counts as the attack): `requests to the planted server after the add: []`, `wordsHome":"local"`, `secrets:{}`. The same holds with the worker stopped through CDP `ServiceWorker.stopAllWorkers` while wiped and the keys planted again. | `test/bg/settings.test.mjs`, `test/bg/backup.test.mjs`, `test/e2e/data.spec.mjs` (CI) |
| A-07 | Low | **Fixed** in the extension. The server has the same gap: **D-03**. | A's `a-llm-limits.test.mjs`, extended to record `max_completion_tokens` → openrouter, anthropic, gemini, groq, ollama, lmstudio and custom send `max_tokens: 1200`; openai sends `max_completion_tokens: 1200`. | `test/unit/llm-client.test.mjs` (CI) |
| A-08 | Low | **Fixed** | `d-content-world.spec.mjs`: 20 content-world syncs each with `{}`, `force:true`, `force:"true"`, `force:1` and `reason:"manual",force:true` → 1 word-list GET each. Control: an extension page sending `force:true` ×5 → 5. | `test/bg/background.test.mjs` (CI) |
| B-02 | Low | **Fixed** (same-account simulation; another account not checked) | B's plant script → `The server can't start: … other users … can write in the folder … kotiko.db is a link (to …loot.db)`. Variants: a symlinked `api-token` in a 0700 folder is refused. An empty 0770 or 1777 folder is made 0700 with a warning, and the server starts. A hard-linked `kotiko.db` starts, but chmod 600 applies to the shared inode, so `loot.db` becomes `-rw-------`. | `server/test/kotiko/private_test.exs`, `data_dir_test.exs`, `boot_test.exs`, `token_test.exs` (CI) |
| B-03 | Low | **Fixed** | B's legacy script with a fake HOME → old `slovo.db` `-rw-------` after the copy. `--uninstall --delete-data` → `Deleted …/slovo/slovo.db`, `…/api-token`, `the folder …/slovo`. No unit was installed, so `systemctl` was never called. | `server/test/kotiko/data_dir_test.exs`, `scripts_test.exs`, `boot_test.exs` (CI) |
| B-04 | Low | **Fixed** | `b-host-log-flood.py 44001 … 3 1001` → `requests=3003 … log_lines_added=1000` plus one line `Refused requests for 1000 different host names this hour; not logging new ones`. | `server/test/kotiko/plug/host_check_test.exs` (CI) |
| B-05 | Low | **Fixed** | Config probe: `LLM_URL` with user:pass is refused (`LLM_URL (value hidden)`). Variants also refused: user only, empty password, `HTTPS://`, `%40` in the password, a backslash trick, `TRANSCRIBE_URL`, `PUBLIC_URL`. (A key in the query string is accepted; outside this finding's scope.) | `server/test/kotiko/config_test.exs`, `startup_summary_test.exs` (CI) |
| B-06 | Low | **Partly**: fixed, with one bypass, **D-04** | Plain-HTTP warning now appears for a remote IPv4 host, a remote IPv6 host, a LAN address, `localhost.evil.example`, `127.0.0.1.nip.io` and `TRANSCRIBE_URL`; none for loopback. But `HTTP://203.0.113.7/v1` → `warnings=[]`, and Req sends that URL in the clear (`Req GET HTTP:// … status: 200`). | `config_test.exs`, `test/dom/welcome.test.mjs`, `test/dom/dashboard.test.mjs` (CI) |
| C-02 | Low | **Fixed** | Local clone. `refs/tags/v1.0.0` → the rc.2 tag object: `verify-tag: refs/tags/v1.0.0 holds a tag object signed as v1.0.0-rc.2 … exit=1`. Lightweight `v1.0.0` at the same commit: `missing or lightweight`, exit=1. Control `v1.0.0-rc.2`: exit 0, `prerelease=true`. `release.yml:109-120` now fails the build if HEAD isn't the verified commit. | `test/unit/release-tags.test.mjs` (CI) |
| C-03 | Low | **Fixed** (settings) | Ruleset 24620963, "release tags: only the release manager creates them": `creation` on `refs/tags/v*`, bypass OrganizationAdmin. "Tags are permanent" now has the same bypass. `docs/stores.md:126-128` and `:285` now say only the release manager can delete a wrong tag. | None (a settings check was suggested but doesn't exist) |
| A-08 | — | (see above) | | |
| A-09 | Info | **Fixed** | Released rc.2 zips and my rebuilds: 0 occurrences of `__kotiko` in any `.js`; 124 files; no `test/` or `.map`. | `test/unit/build-extension.test.mjs` (CI) |
| B-07 | Info | **Fixed** | Live run with `LOG_LEVEL=debug`, `LOG_LOOKUPS=false` and a fake model answering `PRIVATEWORDXYZ`/`MYSECRETGLOSS` (script_mismatch), through `/api/words` and `/api/v1/words` → 0 log hits; only `[warning] Couldn't save a word: script_mismatch`. | `server/test/kotiko/router_v1_test.exs` (CI) |
| B-08 | Info | **Fixed** | `SECURITY.md:5` now describes 1.0.0 and release candidates; "There are no releases" is gone from `requirements.md` and `SECURITY.md`. | `test/unit/check-versions.test.mjs` (CI) |
| B-09 = C-09 | Info | **Fixed**, with a new side effect (**D-02**, second vector) | 10 wrong tokens → `401 ×10`, then `429 429`. The right token from 127.0.0.1 now gets `429 rate_limited auth_failures`; from `[::1]` it gets 200. Log: `10 wrong API tokens from 127.0.0.1 in a minute`. Weak-token warnings appear for "a"×24, "password"×3, "abc"×8 and `Passw0rd!`×3, but not for `abcdefghijklmnopqrstuvwx` or `kotiko-token-2026-my-own` (heuristic: fewer than 10 distinct characters). | `server/test/kotiko/router_throttle_test.exs`, `token_test.exs`, `config_test.exs` (CI) |
| C-05 | Info | **Fixed** for the original proof; a cosmetic bypass exists, **D-05** | C's `gate-false-positive.sh` → all three texts exit 1. My 16-case `gate-variants.mjs`: two gate lines, closed only in the appendix, wrong core version, impossible date, U+2028, lone CR and an HTML-commented open line all stay open. Exact line and CRLF close it, as intended. A lookalike, zero-width or fullwidth-colon "open" line plus the real closed line → closed (D-05). | `test/unit/security-gate.test.mjs` (CI) |
| C-06 | Info | **Fixed** (code; no live AMO upload) | `scripts/amo-submit.mjs` hashes the zip against SHA256SUMS and passes that exact file (`xpiPath: zip`) to `signAddon`; `release.yml:393`. The unit test passes in `npm test`. | `test/unit/amo-submit.test.mjs` (CI) |
| C-07 | Info | **Fixed** | C's `sync-browser-langs.mjs` → `storage.sync after install: {"seedSalt":"…"}`; no `ui`/`baseLangsDetected`. | `test/bg/privacy.test.mjs`, `test/bg/welcome.test.mjs`, `test/dom/welcome.test.mjs` (CI) |
| C-08 | Info | **Fixed** | `validateWordsResponse({contentType:{toString:false}})` → no throw: `{"ok":false,"code":"not_kotiko_server",…}`. The property test passes; C's FC_PATH no longer replays because the test changed. `release.yml:101` has `FC_SEED: "20261006"`. The rc.2 release run succeeded. | `test/unit/sync-libs.test.mjs`, `test/dom/content.test.mjs` (CI) |
| C-10 | Info | **Still works** | `curl -sS https://kotiko.org/privacy/` → `<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"`, `__cf_email__` ×2, `[email protected]` ×2, a `nel`/`report-to` header pointing at `a.nel.cloudflare.com`. `/connect/` also sends the NEL header. | None |
| C-11 | Info | **Fixed** | `data_collection_permissions` → `{"required":["authenticationInfo"]}`; the Chrome form row says Authentication information: Yes. | `test/unit/store-readiness.test.mjs` (CI) |

## 3. Variant and bypass attempts

- **B-01, server stopped while a proof is cached:** the squatter **gets the token**. This is D-01.
- **B-01, squatter on [::1] or 127.0.0.1 while the server runs:** both binds refused.
- **B-01, fresh worker, squatter while the server is stopped:** refused (`not_kotiko_server`; repo `loopback.spec` passes).
- **C-01:** a PR's own `.gitleaks.toml`, `.gitleaksignore` and inline `gitleaks:allow` together no longer switch off its scan (exit 1). `osv-scanner.toml` was read from the workflow (`dependency-scan.yml:51-74` uses the base copy) but not simulated.
- **C-02:** annotated replay and lightweight tag are both refused.
- **C-05:** results in the table; disguised "open" lines are D-05.
- **A-06:** the worker-restart variant is fixed.
- **A-08:** four `force` spellings are all throttled.
- **B-02:** symlinked token refused; hard link neutralised; group-writable or sticky empty folders made private.
- **B-05:** all eight userinfo spellings refused.
- **B-06:** the upper-case scheme bypasses the warning (D-04).
- **A-02:** canonicalisation edge cases (node level) leave no raw text.
- **A-07:** the server side is still uncapped (D-03).
- **New `/api/v1/proof` route:**
  - It answers only `{"proof":…}` with `no-store` and has no CORS headers.
  - It passes through HostCheck and is limited to 30 per minute per address.
  - Its counter counts malformed requests too (D-02).
  - It is an offline oracle for weak owner-chosen tokens; the config warning says so but misses some weak shapes (B-09 row).
  - Generated tokens are not brute-forceable.
- **A-01, A-03, A-04 page-side variants:** not run (section 6).

## 4. New issues

- **D-01, Low: the cached server proof lets a squatter receive the token after the server stops.**
  - **Location:** `extension/background.js:500` (`proven`, kept for the worker's life), `:521-523`, `:578-579` (cleared only when a fetch throws), `:481` (`connection()`). `server.connect` doesn't clear `proven` either.
  - **Proof:** `node test/security/poc/d-b01.mjs 44001 <token> <server pid> <dir>` with the real extension in Chromium.
    1. Connect `http://localhost:44001`; the proof POST is followed by authorised GETs.
    2. SIGKILL the server (as in a crash or restart); `d-squatter.py` binds 127.0.0.1 and ::1 within milliseconds.
    3. Sync twice, then send `server.connect` again.
  - **Observed:**
    ```
    2. sync … worker requests: ["GET http://127.0.0.1:44001/api/words auth=yes"]
    3. fresh server.connect to the squatter -> {"ok":true,…,"sync":{"code":"not_kotiko_server"}}
    squatter log lines: 3; with the real token: 3
    ```
    The squatter also keeps the port, so the real server then refuses to start (`eaddrinuse`).
  - **Why it matters:** this is exactly the case `background.js:486-491` and `loopback.spec` say is covered ("on 127.0.0.1 while Kotiko's server is stopped"). The window is the worker's lifetime after a good proof; page loads keep it alive while the learner browses.
  - **Fix:**
    - Clear `proven` on `server.connect` and on any answer that isn't Kotiko's.
    - Prove again for each sync, or better, stop sending the bearer altogether: send `HMAC(token, nonce‖method‖path)` per request.
  - **Test:** a `loopback.spec` case: prove, stop the server, start the listener, sync; the listener must log no token.

- **D-02, Low: rate limits shared across loopback clients can lock the extension out.**
  - **Location:** `server/lib/kotiko/router.ex:48-63` (counter at `:50`, before the nonce is validated), `:29-30` (a body with no Content-Type isn't parsed or refused), `server/lib/kotiko/auth_throttle.ex`. Every local client is the one address 127.0.0.1, which is now the extension's default.
  - **Proof (a):** `node test/security/poc/d-proof-lockout.mjs firefox 44001`. A page served as `https://attacker.example` (by `page.route`) sends 35 `fetch(…/api/v1/proof,{method:"POST",mode:"no-cors",body:new Blob(["x"])})`.
    - Observed: `firefox page fetches resolved: 35`, then the extension-style proof gets `429 … "too_many_proofs"`.
    - The same page in Chromium: `0 resolved … Failed to fetch` (blocked by Chromium's local network access rules).
    - Effect: while such a page is open in Firefox, the extension can't prove, so it can't sync once its worker restarts. Caveat: Playwright's Firefox 155 build; release Firefox's local network access behaviour not checked.
  - **Proof (b):** curl as another local process: 10 wrong bearers lock 127.0.0.1, so the right token gets `429 auth_failures` (table, B-09 row). Any other local account can keep the extension locked out at 10 requests a minute. A web page can't send a Bearer header without a preflight; that is from reading the code, not tested.
  - **Fix:**
    - Refuse `/api/v1/proof` without `Content-Type: application/json` (415) before counting, and count only well-formed nonces.
    - Consider not throttling loopback for the proof, or keying the auth lockout per connection rather than per loopback address.
  - **Test:** an ExUnit case: 31 POSTs with no Content-Type, then a JSON proof gets 200.

- **D-03, Low (same class as A-07): server lookups have no output-token cap for `LLM_MODEL` models.**
  - **Location:** `server/lib/kotiko/llm/client.ex:32` (cap sent only when `caps.max_tokens`), `server/lib/kotiko/llm/catalog.ex:118` (`max_tokens: false` by default).
  - **Proof:** run5 server with `LLM_MODEL=fake/model` and the fake model in `FAKE_DUMP` mode; add "hello".
  - **Observed:** the request body is `{'model': 'fake/model', 'response_format': {'type': 'json_object'}, 'temperature': 0.2}`, with no `max_tokens`.
  - **Fix:** always send the spec's policy cap, with a per-provider field as the extension now does.
  - **Test:** in `router_v1_test` / client tests, assert the cap is in the body.

- **D-04, Info: an upper-case `HTTP://` scheme skips the plain-HTTP key warning (B-06 bypass).**
  - **Location:** `server/lib/kotiko/config.ex:651`, which matches `"http://" <> _` case-sensitively, while `:476` accepts the scheme case-insensitively through `URI.parse`.
  - **Proof:** `d_config_probe.exs` → `D B-06 HTTP upper-case: starts. warnings=[]`; Req GET `HTTP://127.0.0.1:44001/health` → 200.
  - **Fix:** use `URI.parse(url).scheme == "http"`.
  - **Test:** add the case to `config_test.exs`.

- **D-05, Info: the store-gate check ignores a disguised "open" line.**
  - **Location:** `scripts/check-security-gate.mjs:35` (`ANY_GATE_RE` is ASCII-only).
  - **Proof:** `node scratchpad/sec-d/gate-variants.mjs scripts/check-security-gate.mjs` → CLOSED for an "open" line written with a Cyrillic а, a leading zero-width space, or a fullwidth colon, next to the exact closed line.
  - **Impact:** small. Whoever can do this can already write the closed line; it only lets a report read as open to a human while it passes.
  - **Fix:** NFKC-normalise and strip format characters before matching, or refuse non-ASCII in any line matching `/ate\W*:/i` above the appendix.
  - **Test:** add the three cases to `security-gate.test.mjs`.

## 5. Release assets, Firefox, C-10

- **Release:** `gh release view v1.0.0-rc.2` shows a pre-release published 2026-10-07T15:26:20Z by github-actions[bot]. Release run 37643348121 succeeded.
  - Assets: the Chrome zip, the Firefox zip, `kotiko-server-1.0.0-rc.2.cdx.json` and `SHA256SUMS`.
  - `sha256sum -c SHA256SUMS` → all three `OK`.
- **Attestations:** `gh attestation verify` isn't available in gh 2.45.0, so they were **not cryptographically verified**.
  - Read-only `gh api …/attestations/sha256:<hash>` returns 1 attestation per asset. Each is SLSA provenance v1 whose subjects are all four files with matching SHA-256s.
  - Workflow `.github/workflows/release.yml` @ `refs/tags/v1.0.0-rc.2`, resolved commit `9b5a6df`.
  - To verify, with gh ≥ 2.49: `gh attestation verify <file> -R ScriptKittyOS/kotiko --signer-workflow ScriptKittyOS/kotiko/.github/workflows/release.yml --source-ref refs/tags/v1.0.0-rc.2`.
- **Reproducible:**
  - `node scripts/build-extension.mjs --version 1.0.0-rc.2` (normal, and `--skip-lint` with `TZ=Asia/Tokyo LC_ALL=C`) gives Chrome `ebe3fcca…c394` and Firefox `30e363a9…ac18`.
  - Both match the release (`sha256sum -c` from the build folder: OK OK).
- **Firefox:** I didn't drive the extension in Firefox at runtime, so its behaviour there is **not checked**. The only Firefox runtime result is D-02 (a page reaches 127.0.0.1 and uses up the proof limit).
- **C-10:** still present (table row). Cloudflare email obfuscation and NEL are still on for kotiko.org; there is no repository fix, since it's a dashboard setting.

## 6. Not checked, and why

- **Page-side bypass variants, because of the safety stop:**
  - A-01 with visible-but-tiny, same-colour, low-opacity, overlaid or giant-block text; across 3+ reloads or iframes; and the 3-languages-per-concept cap beyond the repo test.
  - A-04 with a learner's real (trusted) click or Enter followed by `window.find`.
  - A-03 detection vectors on paused hosts beyond the event and stylesheet.
  - A-02 in the rendered popup with private-use tags (checked at node level only).
  - Please have these run by another reviewer.
- **A-05's original PoC "real code" step** wasn't adapted to the new state parameter; I relied on the repo e2e test (passed) and the observed `codes sent: []`.
- **B-02 with another account owning the files:** there is no second uid. The owner check was read in the code, not run.
- **C-06 actual AMO upload, and C-01 store-secret placement:** no store access.
- **osv-scanner PR simulation:** workflow read only.
- **Cryptographic attestation verification:** gh too old.
- **Extension runtime in Firefox; macOS or Windows.**

PoC files (uncommitted) are in `/home/aylac/Projects/personal-projects/kotiko-sec-d/test/security/poc/`, mainly `d-content-world.spec.mjs`, `d-b01.mjs`, `d-squatter.py`, `d-proof-lockout.mjs`, `d_config_probe.exs`, `d-data-dir-plant.sh`, `d-legacy-folder.sh` and the configs `playwright.repo.config.mjs` / `playwright.c.config.mjs`.

Logs and other outputs are in `/tmp/claude-1000/-home-aylac-Projects-personal-projects-language-reducer-ext/ac04218e-92fd-4240-946f-66694948a37f/scratchpad/sec-d/`: `poc-a.log`, `npm-test.log`, `mix-test.log`, `rel/`, `build1/`, `build2/`, `prsim/`, `tagpoc/`, `gate-variants.mjs`, `run*/server.log`, `squatter.log`, `site/`.

### Reviewer E, on v1.0.0-rc.3

## 1. Header

- **Reviewer:** E
- **Candidate:** `v1.0.0-rc.3` (`088bbea`), clean detached checkout at `/home/aylac/Projects/personal-projects/kotiko-sec-e`. The only change is the untracked folder `test/security/poc/`.
- **Date:** 2026-10-07
- **Environment:** Ubuntu 24.04.5 (Linux 6.14), Node v22.23.2, Elixir 1.19.2 / OTP 28, Playwright 1.63.0, Chromium 153.0.8010.12, Firefox 155.0 (Playwright builds), gh 2.45.0.
- **Ports and data:** my servers ran on 47001–47003, the fake model on 47100, the fixture server on 47234, other helpers on 47200–47302. Temp data was under `scratchpad/sec-e/run*`.
- **Clean-up:** every process I started was stopped by PID. Nothing listens in 47000–47999 now. I left the BEAM process that was already running before my session alone, and never connected to :4747.
- **Off-limits respected:** I read no `.env`. Nothing went to GitHub, Linear or Cloudflare beyond read-only `gh` calls, one curl run against kotiko.org, and one real-browser load of those pages.
- **Scratch outputs:** `scratchpad/sec-e/` holds `npm-test.log`, `mix-test.log`, `pw-repo.log`, `a01.log`, `page.log`, `lockout.log`, `replay-skew.log`, `signed-probe.log`, `ff/out.txt`, `site/`, `rel/` and `build/`.

**Summary:** the token never reaches a squatter, and every rc.1 and rc.2 proof I reran now fails as it should. I found 7 new issues: 5 Low (E-01 to E-05) and 2 Informational (E-06, E-07). The most important is E-05: a page can still get the word card opened and read, with only a mouse rest from the learner.

## 2. Verdicts

| ID | Verdict | Proof (command → what I saw) | Regression test(s) |
|---|---|---|---|
| D-01 | **partly**. The token is fixed. Two things remain: an add sent within 30 s of a proof reaches the squatter (documented), and a caught request can be replayed after a restart when the client's clock runs ahead (E-01) | See "D-01 detail" below the table | `poc/e-squat-variants.mjs`, `poc/e-replay-skew.mjs`, `poc/e-firefox.mjs`; repo `test/e2e/loopback.spec.mjs` (3/3 pass) |
| D-02 | **fixed** | See "D-02 detail" below the table | `poc/d-proof-lockout.mjs`, `poc/e-page-proof.mjs`, `poc/e-lockout.sh` |
| D-03 | **fixed** | The fake model received `{'model':'fake/model','response_format':{'type':'json_object'},'max_tokens':1200,'temperature':0.2}`. Every server call goes through `llm.ex` `attempts/6` with `spec/models.json` caps (lookup 1200, respell 4000) | `poc/b-fake-llm.py` (FAKE_DUMP) |
| D-04 | **fixed** | `HTTP://`, `HtTp://`, a leading space, `TRANSCRIBE_URL` in capitals, a decimal IP and `[::ffff:…]` all warn. The loopback control does not warn | `poc/d_config_probe.exs` (I added an E section) |
| D-05 | **partly** (E-06) | D's 16 variants are all correct. 14 of my 15 new disguises are wrongly read as closed | `poc/e-gate-variants.mjs` |
| C-10 | **fixed** | See "C-10 detail" below the table | `poc/e-site-browser.mjs` |
| A-01 hidden text | **fixed**, within the documented limits | A's proofs: hidden loot `{}`; the 60,652-word hidden dictionary recovered `{}`. Visible-but-invisible text is still swapped (E-04) | `poc/a-hostile-page.spec.mjs`, `poc/e-a01-variants.spec.mjs`; repo `test/security/page.spec.mjs` |
| A-02 | **fixed** | 17 tags in the rendered popup (section 3): no raw tag text appears and no language line is shown | `poc/e-page.spec.mjs` "A-02" |
| A-03 | **fixed** | Paused, off and a sensitive site (`www.example.bank`) look identical to a browser without the extension (section 3) | `poc/e-page.spec.mjs` "A-03" |
| A-04 | **partly** (E-05) | Synthetic events of 16 kinds leave the card closed. A page that stretches a swap over the screen gets the card opened by a mouse rest or any click | `poc/e-page.spec.mjs` A-04, A-04b, A-04c |
| A-05 | **fixed** | Junk callbacks with no state, a wrong state and an empty state: none was sent to OpenRouter. The real code with the state was. Observed: codes sent `["real-code-0123456789"]`, key saved | `poc/e-a05.spec.mjs`; repo `connect.spec.mjs` 5/5 |
| A-06 | **fixed** | A's proof: `A-06 after: {}`. The planted token isn't adopted and the attacker's server gets 0 requests | `poc/a-content-world.spec.mjs` |
| A-08 | **fixed** | `plain 0, force:true 0` for 20 content-script syncs | `poc/a-content-world.spec.mjs` |
| C-02 | **fixed** | `refs/tags/v1.0.0` pointing at the signed rc.3 tag object fails `verify-tag.sh` with exit 1: "holds a tag object signed as v1.0.0-rc.3, not v1.0.0". The real rc.3 tag exits 0 | Clone in `scratchpad/sec-e/tagpoc` |
| C-05 | **fixed** | C's three texts all exit 1 | `poc/gate-false-positive.sh` |
| C-07 | **fixed** | `storage.sync after install: {"seedSalt":"…"}`, with no languages | `poc/sync-browser-langs.mjs` |

**D-01 detail.**
- **D's proof:** `node poc/d-b01.mjs 47001 <token> <pid> <dir>` gave `squatter log lines: 4; with the real token: 0`. The squatter got only signed `GET /api/words` and 3 proof nonces.
- **127.0.0.1-only squatter, add 1.5 s after the server stops:** the add body `{"text":"W1-SECRET-DIARY-WORD",…}` reached the squatter. The proof was still under 30 s old, so this is the documented residual. The token never did.
- **Same, add after 31 s:** 0 words reached the squatter.
- **::1-only squatter:** 0 requests reached it.
- **Forged `X-Kotiko-Server`:** the answer was refused, and only proof requests followed.
- **Replay after a restart:** every caught request got `401 … error="stale"` when the clocks agree.
- **Firefox:** 4 requests, 0 with the token, 0 with the word.

**D-02 detail.**
- **D's proof:** Firefox resolved 35 no-cors POSTs; Chromium blocked them (Private Network Access). The proof afterwards still answered `200 200 200`.
- **What a page can send:** Firefox never delivers a JSON content type from a page. A no-cors Blob arrives with no type, a header arrives as `text/plain;charset=UTF-8`, and `sendBeacon` with JSON triggers a preflight that is refused.
- **12 wrong tokens from 127.0.0.1:** all `401`; the right signed request after them got `200`.
- **The same with `X-Forwarded-For`:** `401`×10 then `429 429`; the extension's signed request without the header still got `200`.

**C-10 detail.**
- I ran one curl over `/`, `/privacy/`, `/connect/` and `/server/` with `Accept: text/html`, and loaded the same pages in real Chromium and Firefox.
- No `cdn-cgi`, `cloudflareinsights` or `__cf_email__` text appears, and both contact addresses show in plain text.
- The browsers made requests to `{"kotiko.org":32}` (Chromium) and `{"kotiko.org":29}` (Firefox) only. There were no cookies and no `report-to` or NEL headers.
- Security headers on every page: `strict-transport-security: max-age=31536000` (no `includeSubDomains`), `x-frame-options: DENY`, `x-content-type-options: nosniff`, `referrer-policy: no-referrer`.
- The CSP on the docs pages is `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; … frame-ancestors 'none'`. On `/connect/` it is `default-src 'none'; …`.
- Observation: the docs pages allow inline scripts.

## 3. Scope 2 results

### A-01 counts

The proof is `npx playwright test -c test/security/poc/playwright.config.mjs e-a01`, 19/19 passing. Each count is what the page's own script read back from `kotiko-w`. The learner had 300 concepts, and the probe held them among 300 decoys.

| Setup | Concepts revealed | Matches the docs? |
|---|---|---|
| Control (visible) | 300/300 | yes |
| `font-size:1px`, 100 words per paragraph | 0 | stricter than the docs |
| `font-size:1px`, one paragraph of 600 words (several lines tall) | 300 | yes ("tiny") |
| `height:1px; overflow:hidden` | 0 | yes |
| `height:1px`, overflow visible | 300 | yes (the text really shows) |
| Same colour as the background | 300 | yes ("colour of the background") |
| `color:transparent` | 300 | yes, the same class as above |
| `opacity:0.01` | 300 | yes ("can't make out") |
| Under an opaque fixed overlay | 300 | yes ("under something else") |
| Behind an opaque cover (`z-index:-1`) | 300 | yes ("under something else") |
| `filter:opacity(0)` | **300** | **no** (E-04) |
| `clip-path:inset(100%)` | **300** | **no** (E-04) |
| `mask-image` fully transparent | **300** | **no** (E-04) |
| `transform:scale(0.02)` | 0 | yes |
| One screen below the fold | 300 | yes ("near it") |

The cap tests used 1,200 learner concepts:
- **One giant block of 3,000 words:** 500 in one view, which matches the cap.
- **3 reloads, each showing only the words not yet learned:** 500, then 499, then 201, so 1,200 of 1,200 in 3 views. This matches the documented "learn more over time".

Frames and languages:
- **Same-origin, srcdoc and `about:blank` iframes:** 0 / 0 / 0. The content script isn't injected into frames.
- **One concept in 6 languages, 120 sentences:** each view showed exactly 3 languages. Across 3 reloads plus 4 other paths, all 6 of 6 came out. The per-view cap holds and the "over time" leak is documented.

How this compares with the documents:
- The 500 and 3 caps hold.
- `docs/privacy/en.md:113` says "never text the page hides". `assurance-case.md:215` says "not clipped away". Both are contradicted by `filter:opacity(0)`, `clip-path:inset(100%)` and `mask-image` (E-04).
- The other residuals match what those documents say.

### A-04: the word card

- **Synthetic events:** 16 kinds (pointer, mouse, `click()`, keys, focus) leave the card closed, and `window.find` finds no card-only text.
- **After the learner's real click,** the page finds the card's text. On "Пожалуйста": `pozhaluysta`, `pa-ZHAL-sta`, `pa-ZHA-lu-sta` and the language name. On "спасибо", the "Also" line's other-language word too: `谢谢`, `xièxie`.
- **Guess rate while a card is open:** about 18,500 to 33,700 `window.find` guesses per second.
- **After Escape:** nothing from the card is found.
- **Clickjack variant:** the page restyles its own `kotiko-w` to be fixed, full screen and `opacity:.001`.
  - A click on the page's "Continue reading" button opens the card, and the page reads it.
  - A mouse that merely rests on the page (A-04b) opens it too.
  - A-04c: the page reads the card within one frame, then shows its own top-layer popover. Kotiko's card closes, so the learner sees almost nothing.
  - This is E-05.

### A-03: detection where Kotiko doesn't swap

Vectors tried:
- `kotiko:*` and 13 other event types on window and document, plus `voiceschanged`;
- a MutationObserver over the whole document from document start;
- `styleSheets`, `adoptedStyleSheets`, `<style>` and `<link>` counts;
- the computed style of page-made `kotiko-w` and `kotiko-popover`;
- new window globals and `kotiko`/`slovo` keys;
- Resource Timing entries;
- `document.fonts`, local and session storage, `customElements`;
- html and body attributes, animations, injected elements;
- long tasks and the largest frame gap, timing over 5 s on a 1,500-paragraph page.

Results:
- **Paused, off and the sensitive site** are identical to a Chromium without the extension. The only difference was the sensitive host's own favicon URL, which is an artefact of the different host. Frame gaps were 17–33 ms against 17 ms without the extension.
- **Kotiko swapping** differs in mutations, the adopted sheet, the `kotiko-w` style and the elements, as documented.
- **Firefox, paused host:** 0 swaps, no events, default style, 0 sheets.

### A-02: lang tags in the rendered popup

Tags tried: `x-kotiko-key-leaked`, `en-x-pastekey-atevil`, `qaa`, `qaa-x-security`, `art-x-fakewarn`, `i-klingon`, `tlh`, `zxx`, `und`, `mis`, `EN_us`, `en-US-u-co-phonebk`, `zh-Hant-x-fake`, `sgn-x-a`, `root`, an 8-letter tag, and a 45-character tag.

- Malformed tags give `status.lang = null`. Valid ones are canonicalised.
- The popup showed no language line for any of them.
- The raw tag text never appeared in the popup. The one exception is `und`, whose letters occur inside other popup words; there was no language line for it either.

## 4. New issues

### E-01: Low. A request caught while the server was down can be replayed after a restart if the client's clock runs ahead

- **Where:** `server/lib/kotiko/request_auth.ex:127`. The time check is `abs(now - h.ts) > @window or h.ts < started()`, and `started` is whole seconds taken at `init` (`:67`).
- **What it contradicts:** `docs/security/assurance-case.md:195` ("It can't play any request to the server later") and the http-api.md "Signed requests" section.
- **Proof:** `node test/security/poc/e-replay-skew.mjs 47001 <token> <rundir>`.
  - A signed `GET /api/v1/words?status=active,paused` is made while the server is stopped, with ts ahead by 0/30/90/119 s.
  - The server restarts (about 0.6 s) and the request is played to it.
  - **Observed:** 0 s ahead gives `401 stale`. 30, 90 and 119 s ahead each give `200 words=1 {"words":[{"id":"01a117a7…`, so the squatter receives the learner's word list.
  - **Edge case:** requests stamped in the start second are not "older than the start", and the port opened 0.42–1.02 s after it.
- **Who it affects:** loopback users share one clock, so only the sub-second race applies. A remote server (Tailscale) with the laptop's clock ahead is exposed.
- **Fix:** bind requests to a per-boot server epoch.
  - The proof answer carries a random boot id, MAC-protected, and the client signs it into the canonical request.
  - Alternatively, persist the nonce set across restarts, or refuse `ts > started` that come from before the listener opened.
  - At minimum, refuse `ts` more than a few seconds in the future.

### E-02: Low. Behind a reverse proxy on the same machine, a stranger can keep the owner's extension locked out

- **Where:** `server/lib/kotiko/rate_limit.ex` `peer/1` (one `{:proxied, …}` bucket for all proxied clients).
- **What it contradicts:** `docs/reference/http-api.md:57-58` and `docs/reference/configuration.md:122-123` say "never the extension". That is only true for an extension on the same computer that connects directly. `assurance-case.md` does admit "the owner's other devices included".
- **Proof:** `test/security/poc/e-lockout.sh 47001 <tokenfile>`.
  - 12 wrong tokens with `X-Forwarded-For: 203.0.113.9` gave `401`×10 then `429`.
  - The right signed request with `X-Forwarded-For: 198.51.100.7` (the extension coming through the proxy) got **429**, and so did `Bearer`.
  - Repeating 10 bad tokens a minute keeps the owner out indefinitely.
  - Related: headers outside the list (`X-Client-IP`, `X-Original-Forwarded-For`, `X-Cluster-Client-IP`, `Fastly-Client-IP`, …) make proxied strangers look `:local`. They then got `401`×12 with no limit.
- **Fix:**
  - Correct both docs.
  - Key the proxied bucket on the forwarded client address when the proxy is configured as trusted (a `TRUSTED_PROXIES` setting), or exempt requests whose signature verified, so a valid signed request is never locked.
  - Document that a proxy which adds no header disables the limit.

### E-03: Low/Informational. An API key in `LLM_URL`'s query string is accepted silently and written to the log at info

- **Where:** `server/lib/kotiko/application.ex:129` (`"Model: #{model_line()}"`); `config.ex` accepts the query.
- **What it contradicts:** "Keys and tokens stay out of the logs" (`requirements.md:43`).
- **Proof:** a server with `LLM_URL=http://127.0.0.1:47100/llm/v1?key=sk-query-secret-123` logged `40:  Model:     http://127.0.0.1:47100/llm/v1?key=sk-query-secret-123, …`. `d_config_probe.exs` shows "starts. warnings=[]".
- **Fix:** refuse a query string in `LLM_URL` and `TRANSCRIBE_URL`, or redact it before logging and add it to `Redact.put_secrets`.

### E-04: Low. Text made invisible with `filter`, `clip-path` or `mask` is still swapped

- **Where:** `extension/content/engine.js:47` and `:289`. `checkVisibility` checks the `opacity` property only. The size check uses the box, which ignores `filter:opacity(0)`, `clip-path`, `mask` and stacking behind the body.
- **What it contradicts:** `docs/privacy/en.md:113` ("never text the page hides") and `assurance-case.md:215` ("not clipped away").
- **Proof:** the `e-a01` variants: 300/300 concepts for `filter:opacity(0)`, `clip-path:inset(100%)` and `mask-image` transparent. Firefox gives the same for `filter:opacity(0)` (7/7 swaps).
- **Impact:** still capped at 500 per view, so this adds little beyond the already-documented "can't make out" cases. It is mainly a documentation accuracy issue.
- **Fix:** either treat a computed `filter` containing `opacity(0)`, `clip-path`, or `mask-image` and `mask` on the element or an ancestor as hidden, or reword both documents to "text the page shows in ways the learner may not see, including …".

### E-05: Low. A page can still get the word card opened, without a click, and read it

- **Where:** `extension/content/popover.js:791-800`. The `learner()` wrapper checks only `isTrusted`; `onPointerOver` (around `:602`) and `onClick` (`:666`) accept any trusted event whose target is a `kotiko-w`. The page owns those elements and can restyle them.
- **What it contradicts:** `docs/privacy/en.md:116` ("Sites can't open a word's card") and the intent of the A-04 fix.
- **Proof:** `e-page.spec.mjs` A-04b and A-04c. The page applies `#t kotiko-w:first-of-type{position:fixed!important;inset:0!important;…;opacity:0.001!important}`.
  - The learner's mouse rests on the page, or clicks the page's own button.
  - Observed: `{"cardOpen":true,"found":["pozhaluysta","pa-ZHAL-sta","pa-ZHA-lu-sta",…]}`.
  - A-04c: the page polls `kotiko-popover:popover-open`, reads within one frame, then shows its own popover. Observed: `{"read":["pozhaluysta","pa-ZHAL-sta"],"cardOpen":false}`.
- **Impact:** with guesses, the page can read the card's fields at about 20,000 guesses per second. That includes the "Also" line's other-language words, which bypasses the 3-language cap for that concept. It can cycle the stretched swap across all swaps.
- **Fix:**
  - Accept the pointer or click only when its point falls inside the word's own text rects: `Range(kotiko-w text).getClientRects()`.
  - Also require that the element and its ancestors aren't near-transparent and the element's box isn't far larger than its text.
  - Optionally ignore swaps whose computed `position` is fixed or absolute.
  - Regression test: A-04b and A-04c expect the card to stay closed.

### E-06: Informational. The store gate check (D-05) still reads 14 disguises of an "open" line as closed

- **Where:** `scripts/check-security-gate.mjs:50` (`ANY_GATE_RE` leading class `[\s\p{P}>+]*`) and `:67` (the first `## Appendix` line counts even inside an HTML comment or a code fence).
- **Proof:** `node test/security/poc/e-gate-variants.mjs $PWD/scripts/check-security-gate.mjs`. These are all read as CLOSED:
  - `1. <W>: open`
  - `| <W> | open |`
  - `` `<W>: open` ``
  - `~<W>: open~`
  - `🚧 <W>: open`
  - `→ <W>: open`
  - `<b><W></b>: open`
  - `G&#97;te: open`
  - `$<W>$: open`
  - an appendix heading hidden in `<!-- -->` with an open line below it
  - an appendix heading inside a code fence
  - a closed line that exists only inside an HTML comment (invisible to a reader)
  - "Status: still OPEN" prose
- **Impact:** low. It needs write access, and the `release` environment approval is the second lock.
- **Fix:**
  - Strip HTML comments and code fences before scanning.
  - Treat any line containing the word (after `visible()`) anywhere as a candidate, not only at the start after punctuation.
  - Require the closed line to be visible in the rendered Markdown.

### E-07: Informational. The proof route and `/health` also answer other spellings

- **Where:** `server/lib/kotiko/router.ex:289` matches on `path_info`, which collapses empty segments.
- **What it contradicts:** `docs/reference/http-api.md:325` ("Only this exact path… any other spelling needs the token").
- **Proof:** in `e-signed-probe.mjs`'s unsigned sweep of 140 requests, the only non-401 answers were `GET/HEAD /health`, `POST /api/v1/proof`, `POST /api/v1/proof/`, `POST //api/v1/proof` and `GET/HEAD /health/`, each 200.
- **Impact:** harmless; it is the same open route.
- **Fix:** match on `request_path`, or fix the docs.

### Signed-request scheme: no weakness found beyond E-01 and the documented limit

The documented limit is that the answer's signature covers its status, not its body. Checks run with `node test/security/poc/e-signed-probe.mjs 47003 <token>`:

**The canonical string is unambiguous.** The `kotiko-req-v1`, `kotiko-resp-v1` and `kotiko-proof-v1:` prefixes are distinct, and nonces are base64url only, so the open proof can't mint a request or answer MAC.

**These are refused:**

| Attempt | Result |
|---|---|
| Replay of the same request | `401 replayed` |
| A changed query | `bad_mac` |
| GET sent as HEAD | `bad_mac` |
| `/api/v1/%77ords` sent for `/api/v1/words` | `bad_mac` |
| A trailing slash | `bad_mac` |
| Body changed in transit (as JSON or `text/plain`) | `body_mismatch` |
| An empty body signed, a body sent | `body_mismatch` |
| GET with an unsigned body | `body_mismatch` |
| ts +125 s or −125 s | `stale` (+119 s is accepted) |
| Two spaces after the scheme, reordered fields | `malformed` |
| A borrowed MAC | `bad_mac` |
| A lower-case scheme | plain 401 |

**Answers after acceptance are signed,** errors included: 404, 400, 413, 415, `body_mismatch` 401 and the nonce-full 429.

**Unsigned answers:** the 421 from the Host check and the refusals that come before acceptance. The extension treats every unsigned answer as `not_kotiko_server` (`background.js:612`).

**The nonce cache** fills only after a valid MAC, so only a token holder can fill it.

## 5. Release assets and Firefox

**Release `v1.0.0-rc.3`:**
- Published 2026-10-07T18:33:19Z as a prerelease by github-actions; the Release run (37667164578) succeeded.
- Assets: `kotiko-chrome-1.0.0-rc.3.zip`, `kotiko-firefox-1.0.0-rc.3.zip`, `kotiko-server-1.0.0-rc.3.cdx.json`, `SHA256SUMS`.
- `sha256sum -c SHA256SUMS`: OK for all three.

**Rebuild** (`node scripts/build-extension.mjs --version 1.0.0-rc.3 --out scratchpad/sec-e/build`, web-ext lint 0 warnings) matches byte for byte:
- chrome `090b648b4ebf052c6e6ef78e595e100f5079735626d46b13f995261059e66700`
- firefox `014ca31fe17d5dcae3431da49b54730dde06f949593c11eb07215a993e7e770a`

The shipped `background.js` has 0 occurrences of `__kotiko` in either zip.

**Provenance:** gh 2.45 has no `attestation` command, so I used `gh api repos/ScriptKittyOS/kotiko/attestations/sha256:<hash>`.
- Type: SLSA provenance v1, with the 4 subjects. Each subject digest matches the local file.
- Workflow `.github/workflows/release.yml` at `refs/tags/v1.0.0-rc.3`; resolved commit `088bbea08849cf4c224aca36f0e1365ccf4e8ffc`; Rekor log index 3133988852.
- The certificate is issued by `sigstore-intermediate`, with SAN `https://github.com/ScriptKittyOS/kotiko/.github/workflows/release.yml@refs/tags/v1.0.0-rc.3`.
- The DSSE signature verifies with the certificate's key (`Verified OK`).
- **Not verified:** the Fulcio chain to the Sigstore root, and Rekor inclusion. There was no cosign and no `gh attestation`.

**Firefox at runtime:** checked. `test/security/poc/e-firefox.mjs` loads the unpacked add-on as a temporary add-on in Playwright Firefox 155 over RDP and drives it from its own `privacy.html`.
- **D-01:** the squatter got 4 requests, 0 with the token, 0 with the word.
- **A-01:** `display:none` gave 0 swaps; `filter:opacity(0)` gave 7 (E-04).
- **A-04:** synthetic events left the card closed and `find` found nothing; a real click opened the card and `find("pozhaluysta")` was true.
- **A-03 (paused host):** 0 swaps, no events, default style, 0 sheets.

**Repo suites on rc.3:**
- `npm test`: 2,061 tests, 2,060 pass, 1 skipped, 0 fail.
- `mix test`: 23 properties, 1,187 tests, 0 failures.
- Playwright: all 20 of the requested repo tests passed: `test/security/page.spec.mjs` 9, `loopback` 3, `connect` 5, `fullstack` 3. That run also picked up my `test/security/poc/` folder, where the a-*.spec proofs fail on purpose because they assert the old vulnerabilities.

## 6. Not checked

- **The Sigstore chain and Rekor inclusion** of the attestation, for lack of tools (see section 5).
- **A real reverse proxy** (Caddy or nginx). It was simulated with forwarding headers on loopback.
- **A squatter running as a second OS account.** Squatters ran as the same user; there is no second account.
- **The E-01 skew case with two real machines.** It was simulated by stamping `ts` ahead on one machine.
- **The rest of Firefox:** the full A-01 variant matrix and the A-04 clickjack variants ran in Chromium only.
- **macOS, Windows and WSL.**
- **Real stores, OpenRouter, Telegram and Wiktionary,** all forbidden by the rules.

**Proof files** (untracked) are in `/home/aylac/Projects/personal-projects/kotiko-sec-e/test/security/poc/`:
- `e-squat-variants.mjs`, `e-squatter.py`, `e-replay-skew.mjs`, `e-sign.mjs`, `e-signed-probe.mjs`
- `e-lockout.sh`, `e-page-proof.mjs`, `e-logger.py`
- `e-a01-variants.spec.mjs`, `e-page.spec.mjs`, `e-a05.spec.mjs`, `e-common.mjs`
- `e-firefox.mjs`, `e-site-browser.mjs`, `e-gate-variants.mjs`
- `playwright.config.mjs` and `global-setup.mjs` (fixture server on 47234)
- copies of D's, A's and C's proofs

Run the page proofs with `npx playwright test -c test/security/poc/playwright.config.mjs e-`.

### Reviewer F, on v1.0.0-rc.4

## 1. Header

- **Reviewer:** F, the final confirmation reviewer.
- **Candidate:** `v1.0.0-rc.4` (`01312d2`). Clean detached checkout at `/home/aylac/Projects/personal-projects/kotiko-sec-f`. The only change there is the untracked folder `test/security/poc/`, which holds E's proofs (copied) and my `f-*` files.
- **Date:** 2026-10-07.
- **Environment:** Ubuntu 24.04.5, Node v22.23.2, Elixir 1.19.2 / OTP 28, Playwright 1.63.0 with its bundled Chromium.
- **Ports:** my servers used 49001–49007, the fake models 49100 and 49101, and the fixture server 49234. Nothing listens in 49000–49999 now.
- **Processes left alone:** two BEAM processes I didn't start (PID 3360366 from 14:20, and PID 4116146, which belongs to another Claude shell).
- **Off-limits respected:** I read no `.env`, never connected to :4747, and didn't touch the maintainer's checkout. Nothing on GitHub was changed; I only made read-only `gh` calls.
- **Scratch outputs:** `scratchpad/sec-f/` holds the logs named below.

## 2. Verdicts

| ID | Verdict | Proof (command and what I saw) | Bypass tried and its result | Regression test(s) |
|---|---|---|---|---|
| E-01 | **fixed** | `node test/security/poc/f-replay-skew.mjs 49001 run1/token run1` (E's proof moved to v2 signing). For each skew of 0, 30, 90 and 119 s ahead, the request caught while the server was down was played 0.6–1.0 s after the restart. Each got `401 Kotiko-HMAC error="stale_boot"` with no signed answer. A fresh request carrying the new boot id got `200` each time. **End to end:** the request D's squatter actually caught (`Kotiko-HMAC v2 … boot=NAiX5D…`) was replayed to the restarted server and got `401 stale_boot`. | **Boot id without the token:** the open proof route gives it to anyone (`200 boot=GQOa…`), but that doesn't help. Swapping it into a caught header gives `bad_mac`, and signing with a wrong token gives `bad_mac`. **Reuse across restarts:** 8 starts gave 8 different boot ids. **Clock checks:** a timestamp 121, 125 or 600 s ahead, or a day ahead, gets `stale`. 119 and 120 s ahead are accepted. 121 s behind gets `stale`. A replay with the same boot id gets `replayed`. | `poc/f-replay-skew.mjs`; repo `server/test/kotiko/router_signed_test.exs`, `test/unit/server-auth.test.mjs` |
| E-02 | **fixed** within documented limits | **Default setting:** `bash test/security/poc/f-lockout.sh 49002 run2/token`. A stranger sending `X-Forwarded-For` got `401`×10 then `429`. The extension on this computer still got `200`. The owner coming through the proxy still got `429`; `configuration.md:105-107` now says so. E's six unlisted headers are now recognised. **With `TRUSTED_PROXY_HEADER=x-forwarded-for`:** `f-lockout-trusted.sh 49003`. The stranger 203.0.113.9 was locked out (`401`×10, then `429`), while the owner 198.51.100.7 got **200**. The server log names each client "(through the reverse proxy)". | **Spoofing by prepending:** the stranger sends `XFF: 198.51.100.7`, the proxy appends `203.0.113.50`. Only .50 is locked, and the owner gets **200**. Many entries, spaces and a port give the same result. **Headers still not recognised:** `X-Envoy-External-Address`, `X-ProxyUser-Ip`, `Client-IP`, `X-Originating-IP`, `X-Remote-Addr`, `CF-Connecting-IPv6`, `X-Azure-ClientIP`, `X-Arr-ClientIP`, `X-Appengine-User-IP` and `Tailscale-Funnel-Request` each gave `401`×12 with no limit. `configuration.md:151-152` documents this. **Observation:** if a proxy puts its own `X-Forwarded-For` line before the client's line, the client picks the rightmost entry (case 4 locked the owner). nginx and Caddy send one merged line. | `poc/f-lockout.sh`, `poc/f-lockout-trusted.sh`; repo `rate_limit_test.exs`, `router_throttle_test.exs` |
| E-03 | **fixed** | Servers were started with `LLM_URL=…/llm/v1?key=sk-query-secret-123`, the percent-encoded `?key=sk%2Dquery%2Dsecret%2D123&x=1`, an unreachable model, and `TRANSCRIBE_URL=…?api_key=tr-query-secret-456&lang=auto`. All ran with `LOG_LEVEL=debug LOG_LOOKUPS=true`. **Logs:** a grep for every form of the secrets matched 0 lines. The summary shows `Model: http://127.0.0.1:49100/llm/v1?…`. **Requests still carry the query:** the fake model saw `POST /llm/v1/chat/completions?key=sk-query-secret-123`. | A fake provider that echoes the key in its error was logged as `"API key not valid for /llm/v1/chat/completions?key=[redacted]"`. Values decoded from `+` and percent forms are also redacted. **Residual:** a query value shorter than 8 characters isn't redacted (`redact.ex:24`, on purpose). | `poc/f-fake-llm-echo.py`; repo `startup_summary_test.exs`, `config_test.exs` |
| E-04 | **partly**: the three named tricks are fixed; other invisible-but-rendered text is still swapped (F-01) | `npx playwright test -c test/security/poc/f-playwright.config.mjs f-a01` (E's variants). `filter:opacity(0)`, `clip-path:inset(100%)` and a transparent mask each revealed **0 of 300**. Also 0: `filter:opacity(9%)`, and nested opacity .3×.3. The controls (plain text, `opacity(11%)`) revealed 300. | **Still 300 of 300**, and the screenshots show nothing drawn (one colour): `backface-visibility:hidden` with `rotateY(180deg)`, `-webkit-text-fill-color:transparent`, `color:transparent`, a `backdrop-filter:blur` cover, and a white `mix-blend-mode:lighten` cover. `filter:contrast(0)` and `brightness(0)` also give 300 with the text unreadable. Against `docs/privacy/en.md` §"What websites can see": the covers count as "under something else" and the filters roughly as "background colour". Transparent text contradicts "never … makes see-through". Back-face-hidden text matches none of the listed cases. All stay under the 500 cap. | `poc/f-a01-variants.spec.mjs`; repo `test/security/page.spec.mjs` E-04 (6 tests pass) |
| E-05 | **fixed** for the stretched, near-transparent swap; the documented residual remains | E's `e-page.spec.mjs -g A-04` on rc.4: the clickjack gives `cardOpen:false`, A-04b gives `cardOpen:false`, and A-04c gives `read:null`. The synthetic events still leave the card closed. | `f-page.spec.mjs`: the page moves the real-size word under the pointer on every pointermove. A **resting pointer, and also a click on the page's own button**, opened the card. The page then read `["pozhaluysta","pa-ZHAL-sta","pa-ZHA-lu-sta","Russian"]` with each of these disguises: the background colour, `color:transparent`, `-webkit-text-fill-color:transparent`, an opaque cover with `pointer-events:none`, and `filter:contrast(0)`. Back-face-hidden and `opacity:.09` stayed closed. `privacy/en.md:122-125` admits the background-colour and "under something else" cases, but says "while your pointer rests there". It doesn't mention clicks or transparent text colour. | `poc/f-page.spec.mjs`; repo `page.spec.mjs` E-05 (5 tests pass) |
| E-06 | **partly**: every old disguise is fixed; 8 new ones are read as closed (F-02) | E's `e-gate-variants.mjs` (15 cases) and D's `gate-variants.mjs` (15 cases), each given the absolute path of the checkout's script: every one is now read **open**. The controls are read closed. | `node test/security/poc/f-gate-variants.mjs <abs path>` renders each case with markdown-it-py (CommonMark, raw HTML on) and reads the text Chromium shows. **8 of 8 read CLOSED** (details in F-02). | `poc/e-gate-variants.mjs`, `poc/d-gate-variants.mjs`, `poc/f-gate-variants.mjs`; repo `test/unit/security-gate.test.mjs` |
| E-07 | **fixed** | `node test/security/poc/f-signed-probe.mjs 49002 <token>`: an unsigned sweep of 287 requests over 41 spellings × 7 methods. **Answered without a token:** only `GET/HEAD /health` and `POST /api/v1/proof`, the same two with a query string, and the absolute-form target `http://127.0.0.1:49002/health`; all are the same exact path. A `*` target got Bandit's `400`. **Now 401:** `/health/`, `//api/v1/proof`, `/api/v1/proof/`, `/%68ealth`, `/HEALTH`, `/health;x`, `/api//v1/proof`, `/api/v1/%70roof` and `/api/v1/words/../proof`. | The extra spellings above. Every signed-scheme check from E's probe still holds on v2: `replayed`, `bad_mac`, `body_mismatch`, `stale` and `malformed` all behave as before, and answers after acceptance are signed. | `poc/f-signed-probe.mjs`; repo `router_auth_test.exs`, `router_proof_test.exs` |

## 3. Suites and release

**Suites:**
- **`npm test`:** 2,082 tests, 2,081 pass, 1 skipped, 0 fail (`sec-f/npm-test.log`).
- **`mix test`:** 23 properties, 1,205 tests, 0 failures (`sec-f/mix-test.log`).
- **Playwright** (`test/security test/e2e/loopback.spec.mjs test/e2e/connect.spec.mjs test/e2e/fullstack.spec.mjs`): every repo test passed. That is `page.spec.mjs` 20/20, `loopback` 3/3, `connect` 5/5 and `fullstack` 4/4. The run also picked up `test/security/poc/`: 64 passed, and 8 failed by design, since A's old `a-*.spec` proofs assert vulnerabilities that are now fixed.
- **D's `d-b01.mjs`** (port 49007): `squatter log lines: 4; with the real token: 0`. The squatter got one v2-signed `GET /api/words` and 3 proof nonces. A fresh connect to the squatter was refused with `server_key_rejected`.

**Release `v1.0.0-rc.4`:**
- Published 2026-10-07T22:30:42Z as a prerelease by github-actions. Release run 37696167849 succeeded.
- `sha256sum -c SHA256SUMS` passes for all three assets.
- **Rebuild** (`node scripts/build-extension.mjs --version 1.0.0-rc.4 --out sec-f/build`, lint 0 errors and 0 warnings) matches byte for byte:
  - chrome `423aedbb836402d834c06241fbaae50a1305206fbbd2ee7b6365cdd570dcfc82`
  - firefox `3dca21cdbd540c7dc533b47db310984bffcca92bb9d00dfa075a4d84ff765e3b`
- Both shipped zips contain the fixes (`kotiko-req-v2`, `veil()`, `seen()`) and have 0 `__kotiko` in `background.js`.
- `scripts/verify-tag.sh v1.0.0-rc.4` gives exit 0, with a good signature from the release key.

## 4. New issues

**F-01, Informational (documentation accuracy; follows on from E-04).**
- **Where:** `docs/privacy/en.md:113-118` and the same lines in `extension/privacy/en.md`. The code is `extension/content/engine.js:300` (`ownOpacity`) and `:334` (`styleHides`).
- **Contradiction:** the policy says Kotiko never swaps text the page "makes see-through". But `color:transparent` and `-webkit-text-fill-color:transparent` each give 300 of 300 swaps with nothing drawn. `backface-visibility:hidden` on a flipped block also gives 300 of 300 with nothing drawn, and it isn't among the listed "can't make out" cases.
- **The same disguises open the word card** when the page keeps the word under the pointer. That works on a click as well as a resting pointer, and the policy mentions only a resting pointer.
- **Proof:** `poc/f-a01-variants.spec.mjs` and `poc/f-page.spec.mjs`, with screenshots in `sec-f/shots/`.
- **Impact:** still under the 500-word cap per view; this is a wording gap, not a new leak.
- **Suggested fix:** either treat a computed `color` or `-webkit-text-fill-color` with alpha 0, and `backface-visibility:hidden` under a transform, as hidden in both `ownOpacity` functions (the computed style is already read there), or reword the policy. The reworded policy would list transparent text colour and back-face-hidden text with "can't make out", and say "pointing at or clicking" for the card.

**F-02, Informational (E-06 continued: the store's release check).**
- **Where:** `scripts/check-security-gate.mjs`:
  - the entity table and `decode()`, lines 78–86. An unknown named entity becomes one stand-in character, so the word with an entity inside it no longer matches.
  - `hiddenLines()`, around lines 126–152. It ends every HTML block at a blank line, but CommonMark block types 1–5 (`<style>`, `<script>`, `<pre>`, `<?`, `<!X`, `<![CDATA[`) run past blank lines to their end marker.
  - `CLOSED_RE` (line 55). It lets the lead field be any text.
- **Proof:** `node test/security/poc/f-gate-variants.mjs <abs path>` printed CLOSED for all 8 cases. Below, `<W>` stands for the word; what a reader sees comes from rendering the Markdown.
  1. `Ga&shy;te` followed by ": open" on its own line: the reader sees the word followed by ": open".
  2. The same with `&ZeroWidthSpace;`.
  3. Emphasis inside the word, `G**a**te`, followed by ": open".
  4. A fake `## Appendix` inside a `<?` … `?>` block past a blank line, then a visible `<W>` line saying open, then the real appendix. The reader sees no fake heading and does see the open line.
  5. The closed line inside a `<style>` block past a blank line. The reader sees no closed line.
  6. The same inside `<![CDATA[`.
  7. The prose "The <W> is NOT closed yet" beside the closed line.
  8. A lead field reading "nobody yet, this is a draft and the review is NOT finished".
- **Impact:** needs write access, and the `release` environment approval is the second lock.
- **Suggested fix:**
  - Decode the full HTML5 entity list, or delete unknown entities rather than replace them.
  - Remove `*` and `_` emphasis runs inside words before matching.
  - Follow CommonMark's end conditions for HTML block types 1–5.
  - Limit the lead to a name pattern without commas.
  - Treat "not closed", "not finished" and "draft" beside the word as open.

## 5. Not checked, and notes

- **Accidental third-party traffic (my error).** One misquoted env file (an unquoted `&` in `LLM_URL`) left run5 on the default model provider, so 2 lookups ("shukran", "gato") went to OpenRouter's public endpoint. It answered `401 Missing Authentication header`. No real key, identity or token went with them. I stopped that server at once, quoted every value, and checked each later server's `Model:` line before sending anything.
- **Not run on rc.3 for comparison:** E's rc.3 runs are the baseline. My E-01, E-07 and lockout proofs use v2 signing and can't run against rc.3.
- **Repo e2e ports:** `fullstack.spec.mjs` starts its server on a random free port, outside my 49000 range. It can never be 4747.
- **Not run:**
  - a real reverse proxy (it was simulated with headers);
  - two real machines for clock skew;
  - Firefox for the E-04 and E-05 bypasses (Chromium only);
  - the Sigstore and Rekor provenance checks;
  - macOS, Windows and WSL.

**Proof files** (untracked) are in `/home/aylac/Projects/personal-projects/kotiko-sec-f/test/security/poc/`:
- `f-replay-skew.mjs`, `f-sign.mjs`, `f-signed-probe.mjs`
- `f-lockout.sh`, `f-lockout-trusted.sh`
- `f-fake-llm-echo.py`, `f-gate-variants.mjs`
- `f-a01-variants.spec.mjs`, `f-page.spec.mjs`
- `f-playwright.config.mjs` and `f-global-setup.mjs`
- E's and D's proofs, copied

**Logs** are in `/tmp/claude-1000/-home-aylac-Projects-personal-projects-language-reducer-ext/ac04218e-92fd-4240-946f-66694948a37f/scratchpad/sec-f/`.
