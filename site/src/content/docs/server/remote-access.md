---
title: Using the server from another machine
description: Reach your Kotiko server from a laptop safely, over Tailscale or your own network.
---

The server listens only on its own machine (`localhost`) by default. To use Kotiko on a laptop
with a server at home:

1. Set `BIND` in `server/.env` to the server's [Tailscale](https://tailscale.com) IP address,
   or to `0.0.0.0` on a network you trust.
2. Restart the server.
3. In Kotiko's **Settings**, **Your Kotiko server**, use `http://<that address>:4747`.

Tailscale encrypts the traffic. On a plain local network the access key travels unencrypted,
and the server warns about that when it starts.

## Names and proxies

The server answers only to `localhost`, IP addresses and its own machine's name, so a website
can't reach it through DNS rebinding. To reach it by another name (a Tailscale MagicDNS name,
a reverse proxy), add that name to `ALLOWED_HOSTS` in `.env`, separated by commas. Behind a
proxy, set `PUBLIC_URL` to the address Kotiko should use. See the
[configuration reference](/server/configuration/).
