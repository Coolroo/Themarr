# 0004: Reading an app's theme is public, and returns colours only

Date: 2026-10-28. Task: T-116. Asked by: the owner, decision 4 of the plan
(2026-10-24, [Themarr plan: summary](https://docs.coolroo.dev/doc/themarr-plan-summary-UUGI0CdvZs)):
"Reading a theme is public; editing is admins only, two-factor."

Status: amended by [0009](0009-drawer.md) (2026-10-28, T-085): theme names
are public too, on `GET|HEAD /v1/catalog`, for the guest drawer. The
rest stands.

## Decision

- **`GET` and `HEAD /v1/apps/{app}/theme` need no sign-in.** NPM on homepi
  has an Authelia bypass for that one path pattern and those two methods
  only. Every other route stays behind Authelia; editing needs an admin with
  two-factor sign-in.
- **The answer holds colours only:** the theme's tokens for its modes, its
  modes, and its version (for the `ETag`). It never holds user names, groups,
  assignments, other apps, origins or the theme's source seeds. 204 when no
  theme is set. `Cache-Control: no-cache` with an `ETag`, and 304 on
  `If-None-Match`.
- **The server ignores `Remote-User` and `Remote-Groups` on public routes.**
  Those headers are trusted only on the signed-in hop and only on routes that
  need them; on the public path anybody could send them.
- **The hop is still mutual TLS.** Public means no sign-in, not plain HTTP:
  browser to NPM over HTTPS, NPM to tls-gateway, and tls-gateway to themarr
  with the `tls-gateway` client certificate, CN pinned.
- **Per-user themes add a signed-in route** (task T-089). The SDK asks the
  personal and the public routes at once; an anonymous user gets the public
  answer with no warning.

## Why

- **The theme is needed before anybody signs in.** Themarr is a boot hook:
  an app asks for its theme before it draws, which includes its sign-in page.
- **Some apps' users have no Authelia session.** Seerr's users sign in
  through Plex, so seerr-games (which inlines the theme on its server, through
  `https://themarr.coolroo.dev`) and its visitors never pass Authelia. Behind
  Authelia, their requests would get a redirect, and the app would fall back
  to its defaults.
- **Colours are not secret.** Anyone who opens the app sees them. What the
  route reveals beyond what the app shows is that an app ID exists, which the
  app's own URL already tells.

## Rejected

- **Everything behind Authelia:** breaks Seerr's Plex users and every sign-in
  page, and adds Authelia's latency to every app's first second.
- **A shared read token in each app:** a token shipped to browsers is public
  anyway, and it adds a secret to rotate in every app.
- **Return the whole theme record (source, name, assignments):** more than an
  app needs; the public answer carries only what the app will draw.
