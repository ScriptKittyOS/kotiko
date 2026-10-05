// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Slice 30 §8, §11: release notes from CHANGELOG.md, the checks before tagging, and the
// security-review gate in front of the store uploads (slice 54).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  changelogSection, checkChangelog, compatibilityLine, releaseBody, unreleased,
} from "../../scripts/release-notes.mjs";
import { closedReviews } from "../../scripts/check-security-gate.mjs";

// What CHANGELOG.md looks like after release-please's PR, with the plain-language notes moved in.
const RELEASED = `# Changelog

All notable changes to Kotiko.

## Unreleased

## [0.3.0](https://github.com/ScriptKittyOS/kotiko/compare/v0.2.0...v0.3.0) (2026-11-02)

- Add a whole list at once.

### Features

* **extension:** bulk add ([ff493a9](https://github.com/ScriptKittyOS/kotiko/commit/ff493a9))

## 0.2.0 (2026-10-01)

- Any language, mixed however you like.

## 0.1.0

- First version.
`;

test("the section for a version is found under any of the header styles", () => {
  assert.match(changelogSection(RELEASED, "0.3.0"), /^- Add a whole list at once\.\n\n### Features/);
  assert.equal(changelogSection(RELEASED, "0.2.0"), "- Any language, mixed however you like.");
  assert.equal(changelogSection(RELEASED, "0.1.0"), "- First version.");
  assert.equal(changelogSection("## v1.0.0\n\nhi\n", "1.0.0"), "hi");
  assert.equal(changelogSection(RELEASED, "0.3"), null);
  assert.equal(changelogSection(RELEASED, "0.0.3"), null, "dots aren't wildcards");
  assert.equal(changelogSection("## 0.3.0.1\n\nx\n", "0.3.0"), null);
});

test("a released CHANGELOG passes the checks before tagging", () => {
  assert.deepEqual(checkChangelog(RELEASED, "0.3.0"), []);
  assert.equal(unreleased(RELEASED), "");
});

test("tagging is refused without a section, with leftovers under Unreleased, or with breaking changes and no upgrade notes", () => {
  assert.match(checkChangelog(RELEASED, "0.4.0")[0], /no section for 0\.4\.0/);
  const leftovers = RELEASED.replace("## Unreleased\n", "## Unreleased\n\n- Something new.\n");
  assert.match(checkChangelog(leftovers, "0.3.0").join("\n"), /still has entries under "## Unreleased"/);
  const breaking = RELEASED.replace("### Features", "### ⚠ BREAKING CHANGES\n\n* **server:** drop /api/words\n\n### Features");
  assert.match(checkChangelog(breaking, "0.3.0").join("\n"), /Upgrade notes/);
  const withNotes = breaking.replace("### Features", "### Upgrade notes\n\nRun the migration.\n\n### Features");
  assert.deepEqual(checkChangelog(withNotes, "0.3.0"), []);
  assert.match(checkChangelog(RELEASED, "v0.3.0")[0], /isn't a release version/);
});

test("release candidates are tagged before their CHANGELOG section exists", () => {
  assert.deepEqual(checkChangelog("# Changelog\n\n## Unreleased\n\n- wip\n", "0.3.0-rc.1"), []);
});

test("the compatibility line covers the same minor and one older", () => {
  assert.equal(compatibilityLine("0.3.0"), "Extension 0.3 works with server 0.2 and 0.3.");
  assert.equal(compatibilityLine("0.3.4"), "Extension 0.3 works with server 0.2 and 0.3.");
  assert.equal(compatibilityLine("1.0.0"), "Extension 1.0 works with server 1.0.");
});

test("the release body is the section plus the footer with store links and verification", () => {
  const body = releaseBody({
    changelog: RELEASED, version: "0.3.0", repo: "ScriptKittyOS/kotiko",
    chromeUrl: "https://chromewebstore.google.com/detail/abc", firefoxUrl: "https://addons.mozilla.org/firefox/addon/kotiko/",
  });
  assert.ok(body.startsWith("- Add a whole list at once."));
  assert.ok(!body.includes("## [0.3.0]"), "GitHub shows the tag as the title");
  assert.match(body, /\[Chrome Web Store\]\(https:\/\/chromewebstore\.google\.com\/detail\/abc\)/);
  assert.match(body, /\[Firefox Add-ons\]\(https:\/\/addons\.mozilla\.org\/firefox\/addon\/kotiko\/\)/);
  assert.match(body, /git pull/);
  assert.match(body, /Extension 0\.3 works with server 0\.2 and 0\.3\./);
  assert.match(body, /sha256sum -c SHA256SUMS/);
  assert.match(body, /gh attestation verify kotiko-chrome-0\.3\.0\.zip --repo ScriptKittyOS\/kotiko/);
  assert.match(body, /gh attestation verify kotiko-firefox-0\.3\.0\.zip --repo ScriptKittyOS\/kotiko/);
  assert.match(body, /blob\/v0\.3\.0\/docs\/verify\.md/);
  assert.match(body, /no third-party code/);
});

test("without store links the footer says they come after the first review", () => {
  const body = releaseBody({ changelog: RELEASED, version: "0.3.0", repo: "ScriptKittyOS/kotiko" });
  assert.match(body, /Chrome Web Store \(link added after the first review\)/);
});

test("a release candidate's body says it isn't in the stores", () => {
  const body = releaseBody({ changelog: "# Changelog\n", version: "0.3.0-rc.2", repo: "o/r" });
  assert.match(body, /^Release candidate 2 of Kotiko 0\.3\.0/);
  assert.match(body, /isn't sent to the stores/);
  assert.match(body, /kotiko-chrome-0\.3\.0-rc\.2\.zip --repo o\/r/);
  assert.throws(() => releaseBody({ changelog: RELEASED, version: "0.9.0", repo: "o/r" }), /no section/);
});

test("the store gate opens only with a closed security review report", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kotiko-gate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(closedReviews(join(dir, "missing")), []);
  writeFileSync(join(dir, "review-v0.3.0-rc.1.md"), "# Review\n\nGate: open, waiting for fixes\n");
  writeFileSync(join(dir, "notes.md"), "Gate: closed\n");
  writeFileSync(join(dir, "review-latest.md"), "Gate: closed\n");
  writeFileSync(join(dir, "review-v0.3.0-rc.2.md"), "# Review\n\nThe gate is not closed yet; it says Gate: closed only at the start of a line.\n");
  assert.deepEqual(closedReviews(dir), []);
  writeFileSync(join(dir, "review-v0.3.0-rc.2.md"), "# Review\n\n**Gate: closed** 2026-11-02 by the lead; fixes confirmed on v0.3.0-rc.2\n");
  assert.deepEqual(closedReviews(dir), ["review-v0.3.0-rc.2.md"]);
});
