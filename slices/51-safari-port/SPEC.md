# 51 · Safari port

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P2 (later) |
| **Size** | L (several weeks) |
| **Depends on** | [45-firefox-android](../45-firefox-android/SPEC.md) (touch and small-screen work); uses [11](../11-local-first-mode/SPEC.md), [28](../28-privacy-and-store-readiness/SPEC.md), [30](../30-release-pipeline/SPEC.md) |
| **Unblocks** | None |
| **Sources** | [03 C8, section 3 "Mobile", open question 7](../../docs/research/03-browser-extension.md); [05 S39, open question 7](../../docs/research/05-learner-ux.md) |

## Problem

Mira has no presence on Apple devices. Safari on macOS and iOS can run WebExtensions, but
only inside an app built with Xcode and distributed through the App Store (or, on macOS,
a notarized app), which needs a paid Apple Developer Program membership
([03 C8](../../docs/research/03-browser-extension.md)). iPhone and iPad users have no other
way to run a Mira-like extension in Safari, and Chrome on iOS has no extensions at all.

The extension code today is plain MV3 with no build step (`extension/manifest.json`), which
is the easiest starting point for Apple's converter. Several APIs behave differently in
Safari (from MDN browser-compat-data, checked 2026-10-01):

| API | Safari behaviour | Effect on Mira |
|---|---|---|
| `storage.sync` | Doesn't sync; acts like `local` | Settings stay per device (slice 39) |
| `storage.session` | Supported (16.4) | Fine |
| `setAccessLevel` | Supported (17.1) | Not needed: slice 11 keeps secrets in IndexedDB |
| `unlimitedStorage` | Unlimited from Safari 16 | Fine |
| `contextMenus` | macOS only | Hidden on iOS (slice 33) |
| `commands` | macOS; iOS 15+ with a hardware keyboard | Shortcuts optional |
| Host permissions | Granted per site by the user, with "Always allow on every website" as a choice | Onboarding must ask for it clearly |

## Goals

- Mira for Safari on macOS and iOS (iPhone and iPad), built from the same `extension/`
  source with no fork.
- Local mode works fully on both; a server works over HTTPS.
- The containing app is minimal: it explains how to turn the extension on, and nothing else.
- A CI job builds the Xcode project on every release, so the Safari build can't silently rot.
- Store listings and privacy labels consistent with slice 28.

## Non-goals

- Features that exist only in the containing app (a native word manager, widgets).
- iCloud sync of words: future work.
- visionOS.

## User stories

- As an iPhone reader, I want my words swapped in Safari like on my laptop.
- As a Mac user who prefers Safari, I want the same extension as in Chrome.
- As a maintainer, I want the Safari build to come from the same source and the same
  release tag.

## Specification

### 1. Project layout

- `safari/` at the repo root holds the Xcode project created once by
  `xcrun safari-web-extension-converter extension/ --app-name Mira --bundle-identifier com.scriptkittyos.mira --swift --copy-resources` (flags to confirm against the current Xcode;
  medium confidence), then edited so the extension target references `../extension` as a
  folder reference instead of a copy. One source of truth.
- Targets: macOS app plus extension, iOS app plus extension (the converter's
  multiplatform template). Minimum OS: macOS 14 with Safari 17.1 and iOS 17.1, so the
  Popover API and every API slice 11 uses are present.
- The containing app shows: what Mira is, one screen with steps to enable it (Safari
  Settings, Extensions on macOS; Settings, Apps, Safari, Extensions on iOS, wording to
  check on current iOS), and a button that opens the welcome page. SwiftUI, no network
  access, no data collection.

### 2. Code differences, all feature-detected

- Background: Safari supports MV3 service workers (medium-high confidence for Safari
  17+); keep `background.service_worker` and test that alarms and the job queue (slice 11)
  resume when Safari suspends the worker, which it does aggressively on iOS.
- `browser` namespace: already handled by `globalThis.browser ?? globalThis.chrome`
  (`extension/background.js:3`).
- Site access: on install nothing is allowed. Slice 28's access card is the main path;
  the welcome page's last step asks the user to choose "Always allow on every website",
  with a screenshot, because otherwise Mira asks site by site.
- Touch: slice 45's rules apply on iOS and iPadOS (`pointerType === "touch"`). iOS has no
  `contextmenu` on long-press inside links in the same way; the fallback setting from slice
  45 (first tap shows the word) is the default on iOS.
- Private browsing: Safari disables extensions in private windows unless the user allows
  them; nothing to do, but the docs say so.
- `storage.sync` doesn't sync: the settings page says "Settings stay on this device" as
  on Firefox for Android.
- IndexedDB persistence in Safari extensions: believed persistent with
  `unlimitedStorage` (medium confidence); the test plan includes a 7-day check because
  Safari evicts website storage after seven days without interaction, and the extension
  origin's exemption must be confirmed.

### 3. Distribution and accounts

- Apple Developer Program membership for ScriptKittyOS as an organization (US$99 a year;
  an organization enrolment needs a D-U-N-S number). The account holder is an org
  maintainer; others are added as App Store Connect users.
- **iOS and iPadOS**: App Store only (TestFlight for beta testers).
- **macOS**: Mac App Store, or a notarized app signed with a Developer ID downloaded from
  the docs site. Recommend the Mac App Store for automatic updates.
- **App privacy label**: "Data Not Collected", since nothing reaches ScriptKittyOS and
  text goes only to a provider the user configures. Medium confidence on how App Review
  reads user-configured providers; the review notes explain it as in slice 28.
- Listing: same name, short description and screenshots as slice 28, at Apple's sizes
  (6.9-inch and 13-inch iPad screenshots for iOS, 1280x800 or larger for macOS).

### 4. Build and release

- A macOS GitHub Actions job (slice 30) on release tags: `xcodebuild` for both platforms,
  archive, and upload to App Store Connect with an App Store Connect API key stored as a
  GitHub secret (via fastlane or `xcrun altool`/`notarytool`, whichever is current).
  Version numbers come from slice 03's single version source.
- Every PR touching `extension/manifest.json` also runs a build-only job, so a manifest
  key Safari rejects is caught early.
- Release lag: App Review typically takes one to three days; the changelog notes when the
  Safari build trails.

## Acceptance criteria

- [ ] The macOS and iOS apps build in CI from the release tag without manual steps.
- [ ] On an iPhone with Safari 17.1 or later, a starter pack swaps words on a news site
      after enabling the extension and allowing every website.
- [ ] Local mode with an OpenRouter key adds a word on iOS, including after Safari has
      suspended and resumed the background worker.
- [ ] Words and key survive 8 days without opening Safari (persistence check).
- [ ] On iOS, the first tap on a swapped word inside a link shows the popover and the
      second follows the link.
- [ ] Context menu and shortcuts work on macOS and are absent on iOS.
- [ ] The containing app makes no network requests (Xcode network instrument or a proxy).

## Test plan

- **CI** (slice 02 and 30): build both targets; run the extension's unit tests unchanged
  (they don't depend on Safari).
- **Manual, per release**: a checklist on one iPhone, one iPad and one Mac covering
  install, enabling, site access, local mode, server over HTTPS, popover by touch and by
  mouse, export (slice 12's download on iOS opens the share sheet; confirm the file saves).
- **Safari Technology Preview** run before major Safari releases, since extension
  behaviour changes there first.

## Rollout and migration

- New platform; no migration. Users moving from Chrome on a Mac use slice 12's export
  and import.
- Changelog: "Mira is now available for Safari on Mac, iPhone and iPad."

## Open questions

1. **Is Safari worth US$99 a year?** ([03 open question 7](../../docs/research/03-browser-extension.md))
   Recommendation: yes once Firefox for Android is stable, because iOS is otherwise
   unreachable; ask whether the org already has an Apple developer account.
2. **Mac App Store or Developer ID download on macOS?** Recommendation: the Mac App Store,
   for updates and one review process shared with iOS.

## Future work

- iCloud key-value sync for settings, through the containing app.
- A Share extension on iOS to add a word from any app ("Share, Add to Mira").
- Orion and other iOS browsers that run WebExtensions, if they become popular (low
  confidence on their current support).
