# 45 · Firefox for Android

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P1 (soon after release) |
| **Size** | M (about a week) |
| **Depends on** | [19-word-popover](../19-word-popover/SPEC.md), [11-local-first-mode](../11-local-first-mode/SPEC.md) |
| **Unblocks** | [51-safari-port](../51-safari-port/SPEC.md) |
| **Sources** | [03 C8, D2](../../docs/research/03-browser-extension.md); [05 S24, S33, S39, open question 7](../../docs/research/05-learner-ux.md); [04 S3](../../docs/research/04-architecture-release.md) |

## Problem

Phones are where a lot of reading happens, and Mira has no mobile story except adding
words through Telegram. Chrome for Android has no extensions and nothing suggests that
will change (high confidence, [03 C8](../../docs/research/03-browser-extension.md));
Firefox for Android runs MV3 extensions and is the realistic first target.

Today, on Firefox for Android (read from the code; not yet run on a device):

- The manifest declares only a desktop Gecko id (`extension/manifest.json:22`); there is
  no `gecko_android` entry, so AMO won't offer it on Android.
- The word details are a native `title` tooltip (`extension/content.js:96`), which touch
  screens never show.
- The popup is fixed at 300 px wide (`extension/popup.html:31`), and the "only" link
  appears on hover or focus only (`popup.html:99-100`), which touch never triggers.
- The only backend is a server at `http://localhost:4747` (`extension/background.js:5`),
  and on a phone `localhost` is the phone.
- There is no context menu or shortcut API on Firefox for Android (MDN browser-compat-data:
  `contextMenus`, `menus` and `commands` are unsupported there).

## Goals

- Mira installs from AMO on Firefox for Android and works in local mode with words typed
  as “word = meaning” or a provider key, with no server.
- Tapping a swapped word shows its details; tapping a link still follows the link.
- The popup, dashboard and welcome page are comfortable at 360 px wide with touch targets
  of at least 44 by 44 CSS px.
- Features that don't exist on Android are hidden, not broken.
- Swapping stays within a phone performance budget.

## Non-goals

- Chrome or Edge on Android (no or limited extension support), Kiwi (discontinued),
  Safari on iOS (slice [51](../51-safari-port/SPEC.md)).
- A native app.
- Changes to the popover's content: slice [19](../19-word-popover/SPEC.md). This slice
  specifies touch behaviour and placement on small screens.

## User stories

- As a learner reading news on my phone, I want my Spanish words swapped there too.
- As a learner, I want to tap a swapped word and see the word the page had ("dog", or
  "perro" on my Spanish pages), without accidentally opening a link.
- As a learner with a server at home, I want my phone to sync with it over Tailscale.

## Specification

### 1. Manifest and listing

- `browser_specific_settings.gecko_android.strict_min_version: "142.0"`, the first
  Android version that reads `data_collection_permissions` (slice 28).
- Mark the AMO listing as compatible with Firefox for Android; add two phone screenshots
  (slice 28's asset list).

### 2. Platform detection

`runtime.getPlatformInfo()` returns `os: "android"`. The background stores
`platform.mobile = true` in `storage.local` at startup; pages and content scripts read it.
Feature checks use the API's presence (`!!browser.menus`, `!!browser.commands`) so the
same code works on any browser that lacks them.

Hidden on mobile: slice 33's context menu and shortcuts, the settings "Shortcuts" row,
keyboard hints in toasts and onboarding, and the "Settings sync" meter (Firefox for
Android stores `storage.sync` locally only, per MDN; the settings page says "Settings
stay on this phone").

### 3. Touch behaviour on pages

Slice 19 already defines the touch rules: a tap on a swapped word outside a link or
button opens the popover, and inside a link a long press (500 ms) opens it while
`contextmenu` is suppressed only for Mira's own element. This slice verifies them on real
devices and adds what a phone needs:

- **Fallback for links.** Long-press suppression on Firefox for Android is medium
  confidence. If it misbehaves on a device, a setting "Show the word before following
  links" turns the first tap on a swapped word inside a link into "open popover" and the
  second tap into "follow". Default off on Android, on for iOS (slice 51).
- **Dismiss**: tap outside, or scroll more than 24 px. The Android back gesture is not
  intercepted (it would need history entries); scrolling closes the popover anyway.
- **Placement**: inside `visualViewport`, above the word when there is room, otherwise
  below; width `min(280px, 100vw - 16px)`; it follows pinch zoom by reading
  `visualViewport.scale` and `offsetTop`.
- Touch targets in the popover are at least 44 px high (slice 27).

### 4. Extension pages on a phone

Firefox for Android opens the popup as a full-screen sheet.

- The popup drops the fixed width when `platform.mobile`: `width: 100%`, max content width
  480 px centred, base font 16 px so inputs don't trigger zoom.
- Every control that appears on hover on desktop is always visible on mobile (the "only"
  link is fixed by slice 20 for all platforms; this slice checks it).
- The add box sits at the top; when the on-screen keyboard opens, the result line stays
  visible (scroll it into view on `visualViewport` resize).
- The dashboard (slice 21) uses one column; editing a word opens a full-screen sheet with
  a "Done" button at the top; bulk actions move to a bottom bar.
- The welcome page (slice 22) works in portrait at 360 px; "Connect OpenRouter" opens a
  tab and returns to the welcome tab when done. Base languages are detected the same way as
  on desktop ([50](../50-ui-localization-and-base-language/SPEC.md);
  `i18n.getUILanguage()` and `i18n.getAcceptLanguages()` follow the phone's Firefox
  language settings), and the confirmation chips wrap onto several lines at 360 px. Spanish
  strings, about a quarter longer than English, are part of the 360 px layout check.

### 5. Backends on a phone

- **Local mode** works fully: IndexedDB, direct provider calls, words typed with their
  meaning (slice 11).
  This is the recommended mobile setup and the docs say so first.
- **Server**: the server must be reachable from the phone. The settings page, when
  `platform.mobile`, replaces the default `http://localhost:4747` placeholder with
  "Your server's address, for example https://home.tailnet-name.ts.net" and links to the
  docs page on Tailscale HTTPS (slice 44). The http warning from slice 28 applies.
- **Sync** (slice 39): words sync with a server as on desktop; the periodic alarm runs
  every 5 minutes on mobile instead of every minute, plus on page load (at most every
  30 s) and when the popup opens, to save battery.
- **Telegram** stays the quick way to add words on the phone for server users ([05 S18](../../docs/research/05-learner-ux.md)).

### 6. Performance budget on a phone

On a mid-range Android phone (a 2022-era device with 6 GB of RAM, such as a Pixel 6a,
as the reference):

- The first viewport is swapped within 200 ms of the content script starting, with 2,000
  words, on an English page, on a Spanish page and on a Japanese page (whose tokenizing
  through `Intl.Segmenter` is the slowest path, slice 14).
- No main-thread task from Mira longer than 50 ms (slice 15's time-slicing).
- The projection read on page load costs under 30 ms for 2,000 words.

## Acceptance criteria

- [ ] The AMO listing offers Mira on Firefox for Android, and it installs on Firefox
      release for Android.
- [ ] With a few words typed as “word = meaning” and no server, a news article shows swaps
      on the phone, with the phone's Firefox in English and in Spanish (Spanish article,
      Spanish interface).
- [ ] Tapping a swapped word outside a link opens the popover; tapping one inside a link
      follows the link; long-pressing it opens the popover (or the fallback setting works).
- [ ] The popup, dashboard and welcome page have no horizontal scrolling at 360 px and
      every control is at least 44 px tall (automated layout check plus manual pass).
- [ ] No context-menu, shortcut or sync-meter UI appears on Android.
- [ ] The budget in section 6 holds on the reference device (manual measurement with
      Firefox's remote profiler, recorded in the PR).
- [ ] A server reached over Tailscale HTTPS syncs words to the phone.

## Test plan

- **Unit** (slice 02): platform detection and feature hiding; the touch decision table
  (target inside link or not, tap or long-press) as a pure function.
- **Layout**: extension pages loaded in desktop Firefox and Chromium at 360x780 with touch
  emulation in Playwright (Playwright cannot drive Firefox for Android), asserting no
  horizontal overflow and minimum target sizes.
- **Device**: `web-ext run --target=firefox-android` over adb on one phone and one tablet,
  Firefox release and Nightly, following a written checklist (install, local mode, tap
  and long-press, server over Tailscale, battery over an hour of reading).

## Rollout and migration

- Ships as an AMO compatibility flag on the existing add-on; desktop users are unaffected.
- Changelog: "Mira now runs on Firefox for Android. Tap a swapped word to see what it means."

## Open questions

1. **Release target.** Launch Android with the first store release, or follow shortly
   after (P1 as planned)? Recommendation: soon after, once the popover (slice 19) has
   been on desktop for a release.
2. **Long-press inside links.** Acceptable to override the link's long-press menu on
   swapped words only? Recommendation: yes, with the fallback setting ready.

## Future work

- Edge for Android, if its extension support grows (low confidence on its current state).
- A compact "reading mode" that swaps only in the article body on small screens.
