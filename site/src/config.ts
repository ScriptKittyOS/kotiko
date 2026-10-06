// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Site-wide values that change when Kotiko reaches the stores (slice 44).
//
// Each store's listing URL is null until the listing is live. While it is null, the install
// page and the home page say "Coming soon to …" instead of linking. When a listing goes
// live, put its URL here: that one line is the whole change.
export const stores = {
  chrome: null as string | null, // Chrome Web Store (Chrome, Edge, Brave and other Chromium browsers)
  firefox: null as string | null, // Firefox Add-ons (addons.mozilla.org), desktop and Android
};

export const site = {
  origin: "https://kotiko.org",
  repo: "https://github.com/ScriptKittyOS/kotiko",
  releases: "https://github.com/ScriptKittyOS/kotiko/releases",
  issues: "https://github.com/ScriptKittyOS/kotiko/issues",
};

// The OpenSSF Best Practices badge (https://www.bestpractices.dev/projects/15259). The site
// loads nothing from other hosts, so it shows the level as text instead of the live image
// the README uses: when the entry reaches a new level, change `level` here.
export const openssf = {
  level: "silver" as "passing" | "silver" | "gold",
  url: "https://www.bestpractices.dev/projects/15259",
};
