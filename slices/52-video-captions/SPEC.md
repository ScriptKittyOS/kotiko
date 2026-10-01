# 52 · Video captions

| | |
|---|---|
| **Status** | Proposed |
| **Priority** | P2 (later) |
| **Size** | M (about a week) |
| **Depends on** | [15-framework-safe-swapping](../15-framework-safe-swapping/SPEC.md); uses [31](../31-density-and-amount/SPEC.md) for caption amount |
| **Unblocks** | None |
| **Sources** | [03 B4, A4, A5, open question 5](../../docs/research/03-browser-extension.md) |

## Problem

Captions are a strong learning surface: short, spoken, repeated, and read with the audio. Today
they work badly (03 B4, read from the code):

- **Flicker.** YouTube renders caption segments as DOM text that changes several times a second.
  Mira swaps them after a 250 ms timer (`extension/content.js:169`), so each line appears in
  English and then jumps.
- **Churn.** Rolling automatic captions rebuild their segments as words arrive; each rebuild is
  matched again, and the next update lands on a node Mira replaced (the 06 F02 pattern).
- **Too dense to follow.** Captions disappear in seconds; the page density rules (none today,
  31 later) don't fit a line on screen for two seconds.
- **Browser-rendered captions** (`<track>` with WebVTT) aren't in the DOM at all, so they are
  never swapped.

## Goals

- Caption lines are swapped before they are painted, with no visible English-then-foreign flash.
- A word swapped in a line stays swapped while that line is on screen, even as the line grows.
- Captions get their own, lighter amount, and their own setting.
- YouTube and native `<track>` captions are supported; adapters make other players addable.

## Non-goals

- Subtitle files, dual-subtitle displays or a caption overlay of Mira's own.
- Audio, dubbing or pausing the video automatically.
- Streaming services whose terms or DRM make DOM changes unwise; adapters are added only for
  players whose captions are ordinary DOM text.

## User stories

- As a learner watching a YouTube video with English captions, one word per line appears in my
  language, steady, without flashing.
- As a learner who finds swapped captions distracting, I turn captions off without affecting pages.
- As someone watching a video with my own subtitle track, Mira swaps those cues too.

## Specification

File: `extension/content/captions.js`, loaded with the other content files and inert unless an
adapter matches.

### Setting

`captions: "off" | "light" | "page"` in slice 39's `s:amount` group, next to Amount; default **"light"**.
"page" uses the page's Amount (31). Per-site overrides come from 38. The popup shows a captions
row only on pages where an adapter is active ("Captions: Off · Light · Same as page").

### Adapters

```ts
type CaptionAdapter = {
  id: string;
  matches(location: Location): boolean;
  container(): Element | null;            // where caption lines appear
  lineOf(node: Node): Element | null;     // the element for one caption line
  trackLang(): string | null;             // caption language, if the player exposes it
};
```

| Adapter | Matches | Container and line | Language |
|---|---|---|---|
| YouTube | `youtube.com`, `m.youtube.com`, `youtube-nocookie.com` embeds (via 42) | `.ytp-caption-window-container`; line = `.caption-visual-line`, segments `.ytp-caption-segment` | `lang` on the caption window when present; otherwise the heuristic below |
| Native tracks | any page with a `<video>` whose `textTracks` has a showing track of kind subtitles or captions | the track's cues (no DOM) | `track.language` |

Further adapters (Vimeo, Coursera, Udemy, TED, generic video.js) are contributed with a fixture.

### DOM captions: synchronous path

When an adapter is active, slice 15's observer routes mutations inside `container()` to
`captions.handle()` **synchronously in the observer callback**, regardless of batch size, so the
swap lands in the same frame the caption appears. Caption containers are exempt from slice 15's
churn budget; the revert budget still applies.

```
handle(lineEl):
  text = lineEl's text (segments joined in order)
  if !englishCaptions(): return
  lineKey = adapterId + video id (from URL) + first 3 tokens of text   // stable as the line grows
  state = lines.get(lineKey) ?? { swapped: Map<tokenOffset, Choice> }
  matches = run 14 + 16 + 18 on text (page context from 18: same choices as the page)
  keep every match whose token offset is in state.swapped (sticky)
  budget per line = 1 for "light"; for "page": 1 at Light or Medium, 2 at Heavy,
                    every match at Everything
  add new matches by 31's ranking until the budget is spent, never adjacent
  apply to the segment text nodes through 15's swap (splitText, records), segment by segment
  lines.set(lineKey, state); evict lines not seen for 30 s
```

The sticky map is what prevents mid-line flips: when automatic captions extend "thank you for"
to "thank you for watching", the swap chosen for "thank you" stays and the budget counts it.
Per-word page caps (31) don't apply to captions; they are a stream.

**Language.** `englishCaptions()` uses the adapter's `trackLang()` when known. Otherwise it
collects caption text per video until it has 200 characters and runs slice 16's stopword
heuristic once; until then it swaps nothing. The result resets when the video changes (URL
`v=` parameter or `src`).

### Native text tracks

```
for each showing track of kind "subtitles" or "captions" with an English language:
  track.addEventListener("cuechange", () => {
    for cue of track.activeCues:
      if processed.has(cue): continue
      original.set(cue, cue.text); processed.add(cue)
      cue.text = swapPlain(cue.text)    // same pipeline, plain text only, light budget
  })
```

`swapPlain` returns text with swapped words and no markup. WebVTT can't carry `lang` per word or
Mira's styles, and cue text inside the browser's media controls can't host the popover; this is
accepted for native tracks. Turning captions off or disabling Mira restores `cue.text` from
`original` for every processed cue still held. The site may read `cue.text`; Mira's change is
visible to it, which is the same exposure as DOM swaps (28 discloses it).

### Interaction

The popover (19) opens on hover over a caption word as on pages. Click and tap on caption text
are left to the player (YouTube toggles playback on click, and lets users drag the caption box),
so captions open the popover on hover and by keyboard shortcut (33) only. No automatic pausing.

### Performance

`handle()` runs in the observer callback: budget **2 ms** per caption mutation at the 95th
percentile on the CI runner, measured on a recorded YouTube caption mutation stream (rolling
automatic captions, about 8 mutations a second).

### Accessibility

Captions are an accessibility feature. The captions setting is one tap from the popup on video
pages, and "off" fully restores the original captions. Swapped caption words keep `lang` so a
screen reader that reads captions switches voice (27).

## Acceptance criteria

- [ ] On the recorded YouTube stream fixture, no animation frame ever shows the English for a word
      that is swapped in that line (Playwright checks with `requestAnimationFrame` sampling).
- [ ] A swapped word stays swapped as its line grows, and each line has at most its budget of swaps.
- [ ] Non-English caption tracks are left alone.
- [ ] Native `<track>` cues are swapped on `cuechange` and restored when captions are turned off.
- [ ] Caption handling stays within 2 ms per mutation at p95.
- [ ] "Captions: Off" leaves captions untouched while pages are still swapped.

## Test plan

- **Playwright:** slice 02's `captions.html`, plus `captions-youtube.html` replaying a recorded
  YouTube caption DOM stream (manual and rolling automatic captions) and `captions-track.html`
  with a WebVTT file, both added by this slice.
- **Unit:** line keys, sticky decisions, budget per level, language heuristic.
- **Manual:** YouTube with manual English captions, automatic captions, a non-English video, and
  an embedded YouTube player inside an article (with 42).

## Rollout and migration

New feature, default "light". Changelog: "Mira now swaps a word or so in each YouTube caption line,
steadily and without flicker. Change it under Captions in the popup."

## Open questions

1. **Default for captions.** (03 open question 5.) Recommendation: on at Light; it is one of the
   most natural places to meet words, and the popup makes it one tap to turn off.

## Future work

- More adapters, each with a recorded fixture.
- Optional pause-on-popover for learners who want to study a line.
