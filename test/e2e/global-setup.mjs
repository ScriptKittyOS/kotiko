// SPDX-FileCopyrightText: 2026 ScriptKittyOS and the Mira contributors
// SPDX-License-Identifier: Apache-2.0

// Starts the fixture server once for the whole run. Workers inherit its address through
// the environment.
import { startFixtureServer } from "../helpers/fixture-server.mjs";

export default async function globalSetup() {
  const srv = await startFixtureServer();
  process.env.FIXTURE_URL = srv.url;
  process.env.FIXTURE_TOKEN = srv.token;
  return () => srv.close();
}
