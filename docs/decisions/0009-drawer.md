# 0009: The in-app drawer: an iframe for signed-in people, a local panel for guests, and public theme names

Date: 2026-10-28. Task: T-085. Asked by: the owner, round 2 and round 3 of
the plan (2026-10-24,
[Themarr plan: SDK, boot and drawer](https://docs.coolroo.dev/doc/themarr-plan-sdk-boot-and-drawer-a7euDJdAHN),
section The drawer); the lead's decisions for T-085 (2026-10-28).
Amends [0004](0004-public-read.md): theme names become public.

## Decision

- **Opt-in per app:** `boot({..., drawer: true | {position: "bottom-right" |
  "bottom-left"}})`. Browser only; in Node the option does nothing.
- **Two modes, chosen when the drawer opens:**
  - *Signed in* (the SDK's personal request `/v1/me/apps/{app}/theme`
    answered 200 or 204, so the person has an Authelia session): the drawer
    is an iframe of `https://themarr.coolroo.dev/drawer?app=<id>`,
    themarr's own page behind Authelia. Every save (the person's choice,
    an admin's assignment, theme edits) happens inside that page, same
    origin, with the admin write checks. The app never holds any right.
  - *Guest* (no session, such as Seerr's Plex users): the SDK draws a
    local panel itself, with no iframe. It lists `GET /v1/catalog`,
    previews a theme from `GET /v1/themes/{id}/tokens`, and keeps one in
    this browser only (the local override). It never writes to themarr.
- **The postMessage protocol, version 1** (`packages/web/src/drawer/protocol.ts`,
  imported by the drawer page too): `{themarr: 1, type, ...}` with exactly
  the listed fields. The SDK sends `hello`; the page sends `ready`,
  `preview`, `clearPreview`, `keepLocal`, `clearLocal`, `saved`, `close`.
  The SDK takes a message only when `event.origin` is themarr's exact
  origin, `event.source` is its own iframe's window, and the shape passes
  (a preview's theme through the token rules); anything else is ignored
  without a word. It posts with that exact origin as `targetOrigin`, never
  `*`.
- **Previews never persist.** A preview is a second CSS text that wins
  over the resolved theme in this tab only. `clearPreview`, keeping or
  saving a theme, and closing the drawer remove it.
- **Framing:** only `GET|HEAD /drawer` may be framed, and only by the
  exact origins registered for the app named by `?app=` (the app's
  `origins` in the store): `Content-Security-Policy: ... frame-ancestors
  <origins>`. A missing, repeated, invalid or unregistered app, or one with
  no origins, gets `frame-ancestors 'none'` and `X-Frame-Options: DENY`.
  Every other answer keeps `DENY` and `'none'`.
- **Theme names are public** on `GET|HEAD /v1/catalog`: each theme's id,
  name, version, modes and a swatch per mode (`primary`, `background`,
  `foreground`, optional `tag`, as `#RRGGBB`), sorted by name, plus the
  admins' favourites. Same rules as the other public routes: CORS `*`
  without credentials, `Cache-Control: no-cache`, a strong `ETag` and 304,
  never reads `Remote-*`. NPM's Authelia bypass must add this path.
- **One shadow root.** All the SDK's drawer DOM is in one
  `<themarr-drawer>` element with an open shadow root. Its look is neutral
  and does not take the app's theme. Its styles are a constructable sheet
  (or a `<style>` with the boot's `nonce`). Theme names go in as text,
  never as HTML.

## Why

- **The app must never hold rights.** An iframe of themarr's own page
  keeps the person's session and every write same-origin on themarr; a
  script on the app can't call the write routes (CORS and the
  `Origin`/`Sec-Fetch-Site` checks refuse it), and the page tells the app
  only what to preview and when to refresh.
- **Guests need a drawer without an iframe.** Behind Authelia, the
  `/drawer` page answers a guest with a sign-in redirect, which Authelia
  refuses to show in a frame. The guest panel needs only public data.
- **A guest drawer needs names.** Tiles without names are colours only;
  the owner's design puts each theme's name on its tile. Theme names are
  not secret: an admin chose them for people to read, they say nothing
  about users, groups, apps or origins, and anyone who uses an app already
  sees its theme. Decision 0004's rule "public means colours only" now
  reads "colours and theme names".
- **Exact registered origins, not `*.coolroo.dev`** (the plan's first
  idea): the app's origins are already in the store for `/v1/me`'s CORS,
  and an exact list keeps any other subdomain (a card agent's preview, a
  compromised service) from framing a signed-in page.
- **The drawer picks its mode at open time** from the last personal
  answer, so a person who signs in elsewhere gets the iframe the next time
  without a reload. When the iframe never says `ready` (10 s), the drawer
  offers "Sign in to themarr" in a new tab.

## Rejected

- **Writes from the SDK with the person's cookie** (credentialed CORS on
  the write routes): it would give every registered app's scripts the
  person's rights.
- **`frame-ancestors https://*.coolroo.dev`:** wider than needed; see above.
- **A guest catalog of colours only:** a grid of unnamed swatches is hard
  to use, and names are not secret.
- **The drawer's own CSS in the page** (a global `<style>`): the app's CSS
  could break it, and it could break the app.
