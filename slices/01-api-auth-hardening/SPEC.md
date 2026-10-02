# 01 · API auth hardening

| | |
|---|---|
| **Status** | In progress (deny-by-default auth done in 4705cb0; the rest proposed) |
| **Priority** | P0 (before public release) |
| **Size** | S (a day or two) |
| **Depends on** | None |
| **Unblocks** | [11](../11-local-first-mode/SPEC.md) (pairing string), [28](../28-privacy-and-store-readiness/SPEC.md), [40](../40-server-packaging-docker/SPEC.md), [48](../48-multi-user-and-classroom/SPEC.md) |
| **Sources** | [06 F01, F21, F27, F34, F36, section 4 item 1](../../docs/research/06-adversarial-qa.md); [04 S24, S25, S26](../../docs/research/04-architecture-release.md); [03 C4, C6](../../docs/research/03-browser-extension.md); [DECISIONS: Encoded-path auth bypass fixed immediately](../DECISIONS.md) |

## Problem

The server holds a learner's whole vocabulary and spends their model quota. Before
4705cb0 a percent-encoded path such as `GET /%61pi/words` reached every word route with
no token, because the auth plug matched the raw path while routing matched the decoded
one ([06 F01](../../docs/research/06-adversarial-qa.md), reproduced, critical).

**Already fixed (commit 4705cb0, 2026-10-01).** `authorize/2` now denies by default:
only the exact raw path `["health"]` is open, everything else needs
`Authorization: Bearer <API_TOKEN>` (`server/lib/slovo/router.ex:86-101`), compared with
`Plug.Crypto.secure_compare` (`router.ex:96`). `Plug.Parsers` runs after auth with
`length: 64_000` (`router.ex:7-9`), so strangers can't make the server parse large bodies
([06 F21](../../docs/research/06-adversarial-qa.md), body part). What remains:

- **DNS rebinding.** Bandit doesn't check `Host`. A web page on `evil.example` can rebind
  its name to `127.0.0.1` and reach the server same-origin. It still lacks the token, so
  today it learns only that Kotiko runs (`/health`), but any future unauthenticated route
  (Telegram pairing, slice 41) would be exposed ([06 F01](../../docs/research/06-adversarial-qa.md) impact, [04 S26](../../docs/research/04-architecture-release.md)).
- **Weak or hand-made tokens.** The setup asks people to run `openssl rand -hex 24`
  (`README.md:37`, `server/.env.example:3`). Nothing enforces a length; any non-empty
  string works (`server/lib/slovo/application.ex:7-8`). A whitespace-only `API_TOKEN`
  passes the presence check because trimming happens later ([06 F34](../../docs/research/06-adversarial-qa.md), read from `server/config/runtime.exs:3-10`).
- **Silent network exposure.** The README suggests `BIND=0.0.0.0` "on a trusted network"
  over plain HTTP (`README.md:177-179`); nothing warns that the token then crosses the LAN
  in cleartext ([06 F36](../../docs/research/06-adversarial-qa.md), [04 S25](../../docs/research/04-architecture-release.md)).
- **500 on a huge id.** `DELETE /api/words/99999999999999999999999` returns 500
  (`router.ex:62`, [06 F27](../../docs/research/06-adversarial-qa.md), reproduced).
- **No regression tests** for any of this; F01 would come back with one careless edit.

## Goals

- Every request is authenticated except `GET /health`, under every path spelling, proven
  by a test matrix.
- Requests whose `Host` isn't one the server answers to are refused.
- A fresh server has a strong token without the user running `openssl`, and a short or
  blank token can't be configured.
- The server says plainly at startup who can reach it and whether that is safe.
- Malformed ids never cause a 500.

## Non-goals

- Keeping the token out of content scripts' reach in the extension: slices [11](../11-local-first-mode/SPEC.md) and [28](../28-privacy-and-store-readiness/SPEC.md).
- HTTPS termination. The server stays HTTP; remote access is documented through Tailscale
  (`tailscale serve`) or a reverse proxy (slice [44](../44-docs-site/SPEC.md), compose example in slice [40](../40-server-packaging-docker/SPEC.md)).
- Per-user tokens: slice [48](../48-multi-user-and-classroom/SPEC.md).
- General config validation and its error format: slice [29](../29-server-ops-hardening/SPEC.md),
  which calls the checks defined here.
- Input text length: slice [09](../09-shared-word-spec-and-prompt/SPEC.md) (200 characters).

## User stories

- As a self-hoster, I want the server to make its own strong token so setup is one step shorter.
- As someone who exposed the server to my LAN, I want a clear warning and a pointer to a
  safer setup.
- As a learner, I want no website I visit to be able to talk to my Kotiko server.

## Specification

### 1. Authentication (done; keep and test)

- `authorize/2` stays first after `:match` and before `Plug.Parsers`. Only
  `%{path_info: ["health"]}` with method GET or HEAD skips the token. (Today any method on
  `/health` is let through to routing, where only GET matches; restricting it here makes
  the rule explicit.)
- New routers (slice 07's `/api/v1`) are mounted under the same plug, never with their
  own skip rules. If the API moves to `forward "/api/v1", to: Kotiko.API.V1`, auth stays in
  the parent pipeline.
- `Authorization` must be exactly one header of the form `Bearer <token>`. Today's
  behaviour for a lowercase `bearer` and duplicate headers is already a 401 ([06 summary](../../docs/research/06-adversarial-qa.md)); tests pin it.
- 401 body becomes slice 25's shape and code: `{"error": {"code": "server_key_rejected", "message": "..."}}`
  with `WWW-Authenticate: Bearer`.
- No CORS headers, ever. The `Authorization` header forces a preflight that the server
  doesn't answer, which is what blocks drive-by requests from web pages ([04 S26](../../docs/research/04-architecture-release.md)).
  The extension doesn't need CORS because it has host permissions ([03 C4](../../docs/research/03-browser-extension.md));
  if Firefox's revocable host permission turns out to need it, slice 28 handles it with a
  permission prompt, not with `Access-Control-Allow-Origin`.

### 2. Host allowlist (DNS rebinding)

A plug, `Kotiko.Plug.HostCheck`, runs before `authorize` on every request, `/health`
included.

- Parse the `Host` header (or `:authority`), drop the port, lowercase, strip the trailing
  dot and IPv6 brackets.
- **Allowed**: `localhost`; any IP literal (IPv4 or IPv6); any name in `ALLOWED_HOSTS`
  (comma-separated, e.g. `kotiko.tail1234.ts.net,kotiko.home.example`); the system hostname
  and `<hostname>.local`. IP literals are always allowed because DNS rebinding needs a
  domain name; an attacker can't make a browser send `Host: 192.168.1.5` from their page.
- **Refused**: anything else, with `421 Misdirected Request` and
  `{"error": {"code": "server_address_invalid", "message": "This Kotiko server doesn't answer to <name>. Add it to ALLOWED_HOSTS in .env.", "details": {"reason": "host_not_allowed"}}}`.
  Logged at info once per name per hour (names only, no paths).
- Missing `Host` (HTTP/1.0 tools): allowed only from a loopback peer address.
- `ALLOWED_HOSTS=*` disables the check, with a startup warning, for unusual proxy setups.

### 3. Token: generated, minimum length, rotation

- **Source order**: `API_TOKEN` from the environment if set and non-blank after trimming;
  otherwise `<data_dir>/api-token`; otherwise generate one.
- **Generation**: 32 bytes from `:crypto.strong_rand_bytes/1`, Base64url without padding
  (43 characters). Written to `<data_dir>/api-token` with mode 0600 (created with
  `File.open/2` under a restrictive umask, then `File.chmod/2`), followed by a newline.
- **Minimum**: 24 characters after trimming. Shorter (including whitespace-only) fails
  boot through slice 29's config error: "API_TOKEN is too short (12 characters). Use at
  least 24, or delete it from .env and Kotiko will make a strong one for you." ([06 F34](../../docs/research/06-adversarial-qa.md))
- **Startup line** (info): "API token: from .env" or "API token: saved in
  /home/ana/.local/share/kotiko/api-token". The token itself is printed only when standard
  output is a terminal (interactive `./run.sh`) and the token was just generated; it is
  never written to journald.
- **Mix tasks** (and release equivalents in slice 40):
  - `mix kotiko.token` prints the token and the pairing string (below).
  - `mix kotiko.token --rotate` writes a new token file and tells the user to restart and
    update the extension. If `API_TOKEN` is set in `.env`, it refuses and says to edit
    `.env` instead.
- `.env.example` changes `API_TOKEN=` to a commented line: "Optional. Leave empty and
  Kotiko creates a strong token in the data folder." `README` drops the `openssl` step.

### 4. Pairing string

So the extension (slice 11's server connection, slice 22's onboarding) can take one
pasted value instead of a URL and a token:

```
kotiko-pair:1:<base64url(JSON {"url": "http://100.101.102.103:4747", "token": "..."})>
```

- `url` is built from `PUBLIC_URL` if set, else from `BIND` and `PORT`
  (`http://127.0.0.1:4747` for loopback; for `0.0.0.0`, the first non-loopback IPv4).
- Printed by `mix kotiko.token`, never logged.
- The extension parses it and fills both fields; a plain token still works. Parsing is
  slice 11's; the format is defined here.

### 5. Exposure warnings at startup

`Kotiko.Exposure.classify(bind_ip)` after slice 29 resolves `BIND`:

| Bind address | Level | Message |
|---|---|---|
| 127.0.0.0/8, ::1 | info | "Listening on this computer only (http://127.0.0.1:4747)." |
| 100.64.0.0/10, fd7a:115c:a1e0::/48 (Tailscale) | info | "Listening on your Tailscale network. Traffic is encrypted by Tailscale." |
| RFC 1918, fc00::/7, 169.254.0.0/16 | warning | "Listening on your local network over plain HTTP. Anyone on this network can see your token in transit. Use Tailscale or HTTPS: <docs link>." |
| 0.0.0.0, :: | warning | "Listening on every network interface over plain HTTP. ..." plus the same advice. |
| Public address | warning, repeated every 24 h | "This address is reachable from the internet over plain HTTP. ..." |

When `KOTIKO_IN_CONTAINER=1` (set by slice 40's image, where `BIND=0.0.0.0` is normal and
the compose file maps the port to `127.0.0.1`), the `0.0.0.0` warning is replaced by an
info line explaining that exposure depends on the port mapping.

### 6. Malformed ids

- Legacy `DELETE /api/words/:id`: `^\d{1,18}$` only, else 404 ([06 F27](../../docs/research/06-adversarial-qa.md)).
- v1 routes: UUID format check before any query (slice 07).
- A catch-all `Plug.ErrorHandler` in the router turns any unexpected exception into a 500
  with slice 25's error shape and an error reference, never a stack trace or an empty body.

### 7. Response hardening headers (P1, from slice 53)

Added by [53](../53-openssf-best-practices/SPEC.md) for silver's `hardening` answer; not a
release blocker. Every response, including 401, 404, 421, 500 and `/health`, carries:

- `x-content-type-options: nosniff`
- `content-security-policy: default-src 'none'; frame-ancestors 'none'` (the API serves
  JSON only, so nothing needs to load or frame it)
- `referrer-policy: no-referrer`
- `cache-control: no-store` (already on JSON responses; now on all)

They are set by one plug placed first in the router, before `Kotiko.Plug.HostCheck`
(`server/lib/kotiko/router.ex:11`), so even a rejected Host gets them, and on the
error-handler path. No `strict-transport-security`: the server speaks plain HTTP, and
whatever terminates HTTPS in front of it (Tailscale, a proxy) sets that header.

## Acceptance criteria

- [ ] The auth matrix passes: every route (GET, POST, DELETE, PATCH on `/api/words`,
      `/api/v1/words`, `/api/v1/words/:id`, `/api/v1/llm/status`, and an unknown path) ×
      {no header, wrong token, lowercase `bearer`, two headers, right token} × path
      spellings {`/api`, `/%61pi`, `/ap%69`, `/API`, `//api`, `/api/../api`,
      `/api/%2e%2e/api`, `/%2561pi`}. Nothing but `GET /health` and `HEAD /health` answers
      anything other than 401 or 404 without the right token.
- [ ] `/%68ealth` without a token is 401 (only the exact raw path is open).
- [ ] A request with `Host: evil.example` gets 421, with or without a token; `localhost`,
      `127.0.0.1:4747`, `[::1]` and a name in `ALLOWED_HOSTS` pass.
- [ ] No response from any route carries `Access-Control-Allow-Origin`.
- [ ] With no `API_TOKEN`, first boot creates a 43-character token file with mode 0600;
      a second boot reuses it.
- [ ] `API_TOKEN="   "` and `API_TOKEN=short` stop boot with the message in section 3.
- [ ] `mix kotiko.token --rotate` changes the token and old requests then get 401.
- [ ] The pairing string decodes to the configured URL and token.
- [ ] Startup logs the right exposure line for each bind class in section 5.
- [ ] `DELETE /api/words/99999999999999999999999` returns 404.
- [ ] An exception inside a route returns a 500 JSON error, not an empty body.
- [ ] (53) Every response in the auth matrix, including 401, 404, 421 and 500, carries the
      four headers in section 7.

## Test plan

- ExUnit `Kotiko.RouterAuthTest` with `Plug.Test`: the matrix is generated from lists, so a
  new route is added in one place. Encoded paths built with `Plug.Adapters.Test.Conn`
  so `path_info` stays raw, matching how Bandit delivers it.
- One integration test against a real Bandit listener on a random port (`port: 0`) with
  raw `:gen_tcp` requests, because `Plug.Test` decodes nothing and Bandit's own handling
  of `%2F` and `..` must be covered too.
- `Kotiko.Plug.HostCheckTest`: table of Host values.
- Token tests with a temp data dir: generation, permissions (`File.stat` mode), reuse,
  minimum length, rotation, `API_TOKEN` precedence.
- `Kotiko.ExposureTest`: classification table including IPv6.
- Manual: a DNS-rebinding check with a hosts-file entry `127.0.0.1 evil.test` and a
  browser request to `http://evil.test:4747/health` returns 421.

## Rollout and migration

- Existing installs keep their `API_TOKEN` from `.env`; if it is shorter than 24
  characters (none should be, since the README's `openssl rand -hex 24` gives 48), boot
  stops with the explanation. The changelog calls this out.
- People who reach the server by a DNS name (MagicDNS, a reverse proxy) must add it to
  `ALLOWED_HOSTS`; the 421 message says exactly that. Release notes list this first.
- Changelog: "Security: the server now refuses requests addressed to unknown host names
  (protection against DNS rebinding). If you reach Kotiko by a name such as a Tailscale
  MagicDNS name, add it to ALLOWED_HOSTS. Kotiko can now create its own API token: leave
  API_TOKEN empty."

## Open questions

1. **Allow every IP literal in `Host`?** It keeps LAN and Tailscale-by-IP setups working
   with no config and is safe against rebinding. Recommendation: yes.
2. **Refuse to start on a public bind address without HTTPS?** Recommendation: no, warn
   loudly; people behind a reverse proxy legitimately bind publicly inside a private network.

## Future work

- Failed-auth rate limiting per client address (brute force against a 256-bit token is
  infeasible, but it would quiet noisy scanners).
- Optional built-in HTTPS with a provided certificate.
- Per-user tokens with hashing: slice 48.
