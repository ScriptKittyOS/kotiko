// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Kotiko contributors
// SPDX-License-Identifier: Apache-2.0

// Loads slice 11's background libraries in this realm, with the globals they read in the
// browser (KOTIKO_SPEC, KotikoLang, KotikoWordSpec, the policy, the catalog, the merge
// rules), for unit tests.
//
//   const L = loadLocalLibs();
//   L.Client.createClient({...}); L.Store.open({ indexedDB: new IDBFactory() });
import { requireExt } from "./load-script.mjs";

export function loadLocalLibs() {
  const spec = requireExt("spec/spec.js");
  // The address rules client.js uses (globalThis.ServerUrl), as the background loads them first.
  requireExt("lib/url.js");
  globalThis.KOTIKO_SPEC = spec;
  const Lang = requireExt("lib/lang.js").createLang(spec);
  globalThis.KotikoLang = Lang;
  globalThis.KotikoWordSpec = requireExt("lib/wordspec.js").createWordSpec(spec, Lang);
  const libs = {
    spec,
    Lang,
    WordSpec: globalThis.KotikoWordSpec,
    Merge: requireExt("lib/word-merge.js"),
    Policy: requireExt("lib/llm/policy.js"),
    Catalog: requireExt("lib/llm/catalog.js"),
    Client: requireExt("lib/llm/client.js"),
    Store: requireExt("lib/store.js"),
    Projection: requireExt("lib/projection.js"),
    Queue: requireExt("lib/add-queue.js"),
    Refresh: requireExt("lib/refresh-job.js"),
    Local: requireExt("lib/local-mode.js"),
    PKCE: requireExt("lib/pkce.js"),
  };
  globalThis.KotikoWordsV1 = requireExt("lib/words-v1.js");
  return libs;
}
