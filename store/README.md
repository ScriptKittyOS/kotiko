# Store submissions

Everything needed to list Kotiko on the Chrome Web Store and Firefox Add-ons, from
[slice 28](../slices/28-privacy-and-store-readiness/SPEC.md). Nothing here uploads
anything: [slice 30](../slices/30-release-pipeline/SPEC.md) automates uploads, and the
ScriptKittyOS publisher accounts are the maintainer's to create (spec §9).

| File | What it is |
|---|---|
| [`chrome-web-store.md`](chrome-web-store.md) | Every field of the Chrome dashboard: single purpose, permission justifications (checked against the manifest by `test/unit/store-readiness.test.mjs`), remote code, data usage, certifications, reviewer notes |
| [`firefox-amo.md`](firefox-amo.md) | The Firefox manifest declarations and why, the AMO listing fields, source-code notes and reviewer notes |
| [`listing/en.json`](listing/en.json) | The long description, screenshot captions and promo tile text, per locale. The name and summary come from `extension/_locales/<locale>/messages.json` (`extStoreName`, `extDescription`) |
| [`assets.md`](assets.md) | Icon, screenshot and promo tile requirements; how to make the screenshots; what waits for the artist |

The privacy policy is [`docs/privacy/en.md`](../docs/privacy/en.md), written from
[`docs/privacy/inventory.md`](../docs/privacy/inventory.md), the list of everything Kotiko
keeps and sends. Change the inventory first, then the policy, then these forms.

Everything ships in English. Other languages arrive as translations: a
`listing/<locale>.json` with the same keys, a `docs/privacy/<locale>.md` (marked as a
translation of the English reference until a maintainer reviews it; run
`node scripts/sync-privacy.mjs` to copy it into the extension), and the locale's
`extStoreName` and `extDescription`.
