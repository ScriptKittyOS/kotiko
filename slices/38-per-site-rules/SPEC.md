# 38 · Per-site rules

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P1 (soon after release) |
| **Size** | M (about a week) |
| **Depends on** | [18-language-precedence-and-mixing](../18-language-precedence-and-mixing/SPEC.md), [31-density-and-amount](../31-density-and-amount/SPEC.md); uses [16-what-not-to-swap](../16-what-not-to-swap/SPEC.md)'s sensitive-site list |
| **Unblocks** | None; its settings sync through [39-multi-device-sync](../39-multi-device-sync/SPEC.md) |
| **Sources** | [01 S13, S14, section 3 "Density"](../../docs/research/01-language-mixing.md); [03 B3, E4, open question 2](../../docs/research/03-browser-extension.md); [05 S33, S35](../../docs/research/05-learner-ux.md) |

## Problem

The only thing a learner can set per site is "pause". It is stored as a list of exact
hostnames (`extension/popup.js:208-213`) and checked against `location.hostname`
(`extension/content.js:11`, `content.js:145`). So:

- A learner who wants Spanish on a news site and Mandarin on Reddit can't have it
  ([01 S13](../../docs/research/01-language-mixing.md)).
- A dense technical site and a light blog get the same amount of swapping, though slice
  31 adds an Amount control.
- Pausing `www.example.com` doesn't pause `news.example.com`.
- Banking, health and webmail sites are swapped like any other ([03 E4, B3](../../docs/research/03-browser-extension.md)).
- A paused site leaves no trace, so learners forget they paused it ([05 S35](../../docs/research/05-learner-ux.md)).

## Goals

- Per site: swap on or off, which languages show (or a Focus language), and the Amount.
- Any field not set for a site follows the global setting, so changing global settings
  still reaches every site without an override.
- Rules cover a site and its subdomains by default.
- Slice 16's sensitive sites are paused by default, visibly, and one click overrides that.
- The common action, pausing a site, stays one click in the popup.
- One pure function computes the effective settings for a page, used by the content
  script, the popup and the badge.

## Non-goals

- The skip rules inside a page and the sensitive-site list itself: slice [16](../16-what-not-to-swap/SPEC.md).
- How languages are chosen and how much is swapped: slices [18](../18-language-precedence-and-mixing/SPEC.md)
  and [31](../31-density-and-amount/SPEC.md). This slice only feeds them per-site inputs.
- Rules per path or per page: future work.
- Syncing rules between browsers: slice [39](../39-multi-device-sync/SPEC.md).

## User stories

- As a learner of Spanish and Mandarin, I want Spanish only on my news site and Mandarin
  only on Reddit.
- As a learner, I want fewer swaps on documentation sites I read for work.
- As a learner, I want my bank never touched unless I say so.
- As a learner who paused a site last month, I want to see that it's paused when I'm on it.

## Specification

### 1. Data model

Stored under `siteRules` in the settings area slice 39 defines (`storage.local` until it
ships):

```json
{
  "siteRules": {
    "example.com":  { "swap": "off", "updatedAt": 1767225600000 },
    "reddit.com":   { "langs": { "focus": "zh" }, "updatedAt": 1767225600000 },
    "docs.rs":      { "amount": "light", "updatedAt": 1767225600000 },
    "mybank.com":   { "swap": "on", "updatedAt": 1767225600000 }
  }
}
```

| Field | Values | Absent means |
|---|---|---|
| `swap` | `"on"`, `"off"` | Follow global, including sensitive-site defaults |
| `langs` | `{focus: "<tag>"}` or `{show: ["<tag>", …]}` | Follow global language choice and Focus (slice 18) |
| `amount` | Slice 31's values: `"light"`, `"medium"`, `"heavy"`, `"everything"` | Follow global Amount |
| `exact` | `true` to match only this hostname | Matches the hostname and all its subdomains |
| `updatedAt` | ms timestamp | Needed for slice 39's merge |

- Keys are lowercase ASCII hostnames as `new URL(…).hostname` returns them (IDN in
  punycode), with a trailing dot removed and a leading `www.` removed when the rule is
  created from the popup. IP addresses and `localhost` match exactly.
- At most 500 rules; the 501st is refused with a message pointing to the Sites list.
  500 compact rules are about 30 KB, which fits slice 39's chunked `storage.sync` budget.
- `langs.show` naming a language that no longer has words is ignored at evaluation and
  pruned when the Sites list is opened, the same rule as global hidden languages today
  (`popup.js:96-99`).

### 2. Effective settings

A pure module, `siteRules.js`, loaded in the content script and the extension pages:

```
effective(global, siteRules, sensitiveList, hostname, tabOriginal)
  -> { swap: bool, reason, langs, amount, ruleKey }
```

Order, first match wins for `swap`:

1. Global "Swap words on pages" is off → `swap: false, reason: "global_off"`.
2. Slice 33's "show originals on this tab" is set → `false, "tab_original"`.
3. The matching rule has `swap` → that value, `reason: "site_rule"`.
4. The hostname is on slice 16's sensitive list → `false, "sensitive"` with its category.
5. Otherwise → `true, "default"`.

`langs` and `amount` are the matching rule's values, or `null` when the rule doesn't set
them (or no rule matches). Slices 18 and 31 then use their global settings, so this
module never copies global values and can't go stale when they change.

**Matching rule**: the longest key that equals the hostname, or (if the rule is not
`exact`) that the hostname ends with after a dot. `news.example.com` matches
`news.example.com`, then `example.com`; it never matches `ample.com`.

**Frames**: a frame follows its top-level page. The content script in a frame asks the
background once for `sender.tab.url`'s hostname and uses that (slice 42 coordinates frame
setup).

### 3. Popup: "This site"

The pause control stays one click; customising is one disclosure away.

```
+------------------------------------------+
| This site · news.example.com             |
| Swap words here                  [ On ]  |
| > Customize this site                    |
|   Languages   [Same as everywhere  v]    |
|               Focus on Spanish           |
|               Only: [x] Spanish [ ] Japanese |
|   Amount      [Same as everywhere  v]    |
|   Applies to  (o) example.com and subdomains |
|               ( ) only news.example.com  |
|   Reset this site                        |
+------------------------------------------+
```

- The toggle writes `swap` on the rule for the registrable-looking key (the hostname
  minus `www.`; the "Applies to" radio lists that and each parent with at least two
  labels). No public suffix list is shipped; a rule on a two-label suffix such as
  `co.uk` is the user's explicit choice from the radio and is allowed.
- On a sensitive site the section reads "Paused here by default (banking). Swap here
  anyway" and the toggle creates `swap: "on"`.
- When any rule applies, the section header shows a small "Custom" tag, and the toolbar
  badge shows slice 20's paused state for `swap: false`.
- On pages Mira can't run on (browser pages, the stores, PDFs) the section is replaced by
  "Mira can't run on this page" ([03 B9](../../docs/research/03-browser-extension.md)).

### 4. Dashboard: Sites

A "Sites" view in slice 21's dashboard lists every rule and the sensitive defaults:

```
Sites                                   [Search sites...]
  example.com          Paused                        Edit  Remove
  reddit.com           Focus: Mandarin               Edit  Remove
  docs.rs              Amount: Light                 Edit  Remove
  mybank.com           Swapping (you allowed it)     Edit  Remove
  Paused by default: sites on the sensitive list (slice 16)  [Show]
```

Remove restores the global behaviour with a 10-second Undo (slice 21's toast).

### 5. Migration of `pausedHosts`

On update, each entry in `pausedHosts` becomes `{swap: "off", exact: true}` keyed by the
same hostname, so behaviour is unchanged; `exact` is kept because the user paused that
exact host. `pausedHosts` is then removed. The migration is idempotent.

### 6. Live updates and performance

`effective()` runs once per page load and again only when `siteRules`, global settings
or the sensitive list change; the content script compares the new result with the old and
re-applies only if this host's effective settings changed. Evaluation with 500 rules
takes under 1 ms (it checks at most one key per hostname label).

## Acceptance criteria

- [ ] A rule on `example.com` applies on `example.com`, `www.example.com` and
      `news.example.com`, and not on `ample.com` or `example.com.evil.net`.
- [ ] An `exact` rule applies only to its hostname.
- [ ] `langs.focus` on one site and none on another show different languages for the
      same word in two tabs at once.
- [ ] Changing the global Amount changes a site without an `amount` and not one with it.
- [ ] A sensitive site is paused on a fresh install, says why in the popup, and "Swap
      here anyway" swaps immediately without a reload.
- [ ] Pausing from the popup takes one click and the page unwraps within 300 ms.
- [ ] After update, every former `pausedHosts` entry is still paused and `pausedHosts` is gone.
- [ ] Frames on a paused site are not swapped.
- [ ] The 501st rule is refused with a clear message.

## Test plan

- **Unit** (slice 02's Node harness): table-driven tests for `effective()` covering every
  precedence step, subdomain matching, `exact`, IDN, IPs, pruning of missing languages,
  and the migration.
- **End-to-end** (Playwright): two fixture hosts mapped to the local test server (for
  example `a.test` and `sub.a.test`); pause from the popup; per-site focus; sensitive
  default with a fixture list; a frame inside a paused page.
- **Manual**: popup layout at 300 px width with long hostnames; screen reader labels on
  the toggle and radios.

## Rollout and migration

- Section 5's migration runs on update. No server change.
- The sensitive-site defaults apply to existing users too, so the changelog says so:
  "Mira now leaves sensitive sites such as banking and health alone unless you turn it on for them.
  New: choose languages and amount per site."

## Open questions

1. **Subdomains by default?** Recommendation: yes for new rules; most sites spread over
   `www.`, `news.` and `m.` hosts. Migrated pauses stay exact.
2. **Sensitive defaults for existing users.** Apply them on update (recommended, with the
   changelog line) or only for new installs?

## Future work

- Rules per path (for example a forum's code section).
- Import and export of site rules (they ride along in slice 12's `settings` block already).
- Suggesting a rule when the learner pauses the same site several times.
