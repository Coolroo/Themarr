# API contract

Everything themarr answers on its TLS listener (`:8443`). Clients never reach
it directly: browsers and apps call `https://themarr.coolroo.dev`, NPM sends
the request to tls-gateway, and tls-gateway calls themarr with its client
certificate. Code: `internal/server`. Token rules: `packages/tokens/README.md`.

## The gate (every request)

- TLS 1.3, server certificate from the home CA.
- A client certificate is required and Go verifies it against the home CA
  during the handshake; no certificate, or one from another CA, never gets
  an HTTP answer.
- The verified certificate's common name must be `tls-gateway` (setting
  `-client-cn`). Any other (`npm-homepi`, `enforcarr`, ...) gets
  `403 client_not_allowed`.

## Headers on every answer

| Header | Value |
|---|---|
| `X-Request-Id` | a new random id; the client's own is ignored. Problems repeat it as `request_id`. |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY`, except GET and HEAD of `/drawer` for a registered app with origins (below) |
| `Referrer-Policy` | `no-referrer` |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'`; the admin UI's pages get `default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'`; `/drawer` gets the same with its own `frame-ancestors` (below) |
| `Cache-Control` | `no-store`, except public routes (`no-cache`), the UI and `/drawer` (`no-cache`) |

## Errors

RFC 9457 `application/problem+json`:

```json
{"type": "about:blank", "title": "Forbidden", "status": 403,
 "code": "not_admin", "detail": "Only admins may use this route.",
 "request_id": "9f2c41d07ab35e10"}
```

`code` is stable; `detail` is for people and may change. A refused theme
also has `issues` (below). An unknown route, or a method a route doesn't
take, is `404 not_found`.

| Status | code | When |
|---|---|---|
| 400 | `invalid_json` | not one JSON object, invalid UTF-8, repeated keys, too deep, unknown or wrongly-cased field (apps, assignments, favourites, preferences, policies) |
| 400 | `bad_if_match` | `If-Match` is not exactly one strong tag such as `"12"` (store) or `"p7"` (prefs) (`*`, `W/` and the other kind's tag are refused) |
| 400 | `unexpected_body` | a DELETE with a body |
| 401 | `unauthenticated` | a route behind Authelia (admin, `/v1/me`, `/v1/policies`) without a usable `Remote-User` (missing, repeated, or not 1-128 of `A-Za-z0-9._@-`), or with `Remote-Groups` repeated |
| 403 | `client_not_allowed` | client certificate CN is not the configured one |
| 403 | `not_admin` | `Remote-Groups` doesn't hold the admin group (`admins`) |
| 403 | `bad_origin` | write without exactly one `Origin: https://themarr.coolroo.dev` |
| 403 | `cross_site` | write without exactly one `Sec-Fetch-Site: same-origin` |
| 404 | `not_found` | unknown route, theme, app or policy; an app id that is not a valid id on the public and `/v1/me` theme routes; an app that is not registered on the preference routes |
| 409 | `in_use` | deleting a theme an assignment or a user or group policy names |
| 409 | `locked` | saving a theme choice while an admin enforces a theme for this person |
| 412 | `version_conflict` | `If-Match` is not the current store version; on prefs writes, what the write changes (the policies, or this person's choice for this app) changed after the `If-Match` version, or that version is newer than the file's |
| 413 | `too_large` | body above 128 KiB (themes) or 32 KiB (others) |
| 415 | `unsupported_media_type` | write body without `Content-Type: application/json` (charset utf-8 at most) |
| 422 | `invalid_theme` | the theme breaks the token rules; `issues` lists them |
| 422 | `id_mismatch` | the body's `id` differs from the path's |
| 422 | `bad_id` | a theme id of `inherit` or `none` (reserved by assignments) |
| 422 | `invalid` | an app's fields are out of shape; a favourite listed twice; a policy `kind` other than `default` or `enforced` |
| 422 | `bad_name` | a policy's user or group name is not 1-128 of `A-Za-z0-9._@-` |
| 422 | `unknown_theme`, `unknown_app` | an assignment, favourite, saved choice or policy names something that doesn't exist |
| 422 | `missing_field` | assignments without `global` or `perApp`; favourites without `favourites`; a preference without `theme`; a policy without `theme` or `kind` |
| 422 | `too_many` | above 500 themes or 200 apps; above 1000 users with saved choices, or 1000 user (or group) policies |
| 428 | `if_match_required` | write without `If-Match` |
| 429 | `rate_limited` | a person saving their choices more than 10 times at once, then more than 2 times a second; `Retry-After` says how many seconds to wait |
| 500 | `store_failed` | the store or prefs file could not be written (the cause is logged, not returned) |

`issues` on `invalid_theme` is the validator's list, with the codes and JSON
Pointer paths of `packages/tokens` (`errorCodes` in its manifest):

```json
"issues": [{"code": "missing_token", "path": "/tokens/dark/primary", "message": "required token \"primary\" is missing"}]
```

## Public routes (no sign-in; decisions 0004, 0009)

NPM bypasses Authelia for these three, GET and HEAD only:
`/v1/apps/{app}/theme`, `/v1/themes/{id}/tokens` and `/v1/catalog`. The
deploy runbook's bypass rule must list all three, and nothing else
(never `/v1/me/`, `/drawer` or the UI). themarr never reads
`Remote-User` or `Remote-Groups` here: anybody can send them on this path.
Every answer, errors included, carries:

```
Access-Control-Allow-Origin: *
Access-Control-Expose-Headers: ETag, X-Request-Id
Cache-Control: no-cache
```

No `Access-Control-Allow-Credentials`, and no preflight (OPTIONS is not
served, and the Authelia bypass doesn't cover it): a browser client must
send only CORS-safelisted headers. In particular it must not set
`If-None-Match` itself; with `Cache-Control: no-cache` the browser's own
cache revalidates with the `ETag` and hands the script the cached 200.
Servers (Node) may send `If-None-Match`.

### `GET|HEAD /v1/apps/{app}/theme`

The theme an app gets: its own assignment, else the global default, else
none.

- **200** `application/json`, a strong `ETag`:

  ```json
  {"version": 3,
   "modes": ["light", "dark"],
   "tokens": {
     "light": {"background": {"$type": "color", "$value": {"colorSpace": "srgb", "components": [0.98, 0.98, 1], "hex": "#FAFAFF"}},
               "radius": {"$type": "dimension", "$value": {"value": 0.5, "unit": "rem"}}, "...": {}},
     "dark": {"...": {}}}}
  ```

  `version` is the theme's version (an integer). `modes` lists the modes
  the theme has; `tokens` has one object per listed mode, each token a DTCG
  token exactly as stored: colours `{"$type": "color", "$value":
  {"colorSpace": "srgb", "components": [r, g, b], "hex": "#rrggbb", "alpha"?:
  a}}` (components 0..1, hex in either case), `radius` `{"$type":
  "dimension", "$value": {"value": n, "unit": "px"|"rem"}}`. All tokens are
  present in every mode except, optionally, `tag` and `tag-foreground`.
  Nothing else: no id, name, source or seeds.
- **304** when `If-None-Match` names the current `ETag` (weak comparison, or
  `*`); no body.
- **204** when no theme applies (the app keeps its own defaults); no body,
  no `ETag`.
- **404** `not_found` when `{app}` is not a valid id (lower-case letters,
  digits and single hyphens, at most 64).

**Unknown apps** are answered like registered apps without an assignment:
the global default, or 204. The answer never tells whether an app id is
registered (no enumeration), and a new app shows the global theme before an
admin registers it. Only registered apps get a last check recorded.

The `ETag` is opaque. It changes when the theme changes, and when any write
changes the store (so a theme deleted and made again never reuses a tag).

### `GET|HEAD /v1/themes/{id}/tokens`

One theme by id, for a person's local override in the SDK (the browser keeps
only the theme id). The same 200 body, `ETag`, 304 and headers as above;
**404** `not_found` for an unknown id. It shows only what the app route
shows of any assigned theme (version, modes, tokens), so decision 0004
holds. NPM's Authelia bypass needs this path too (GET, HEAD).

### `GET|HEAD /v1/catalog`

Every theme's name and a few colours, for the SDK's drawer (a guest's
tiles; decision 0009). Theme names are public; nothing else about a theme
beyond the colours is.

- **200** `application/json`, a strong `ETag`:

  ```json
  {"themes": [
     {"id": "indigo", "name": "Coolroo Indigo", "version": 3, "modes": ["light", "dark"],
      "swatch": {"light": {"primary": "#5146D9", "background": "#FAFAFF", "foreground": "#18191D", "tag": "#E0662F"},
                 "dark":  {"primary": "#8C84FF", "background": "#121318", "foreground": "#ECECEF"}}}],
   "favourites": ["indigo"]}
  ```

  `themes` is sorted by name (case folded), then id. `swatch` has one
  entry per listed mode, each colour the token's `hex` in upper case
  (`#RRGGBB`, no alpha); `tag` only when the theme has that token.
  `favourites` lists the admins' favourite theme ids, in their order. No
  source, seeds, assignments, apps or origins.
- **304** when `If-None-Match` names the `ETag` (a hash of the body: it
  changes exactly when the body does).
- The same public headers as above. NPM's Authelia bypass needs this path
  (GET, HEAD).

## Admin routes (Authelia, admins with two-factor)

themarr reads `Remote-User` and `Remote-Groups` (comma-separated, spaces
trimmed) only here and on the per-user routes below, and trusts them only
because the CN pin proves the
request came through tls-gateway, behind Authelia. The caller must be in the
admin group (`-admin-group`, default `admins`).

Every answer carries `ETag: "<store version>"`: the version of the whole
store when it was read or written. Every write must send it back.

**Writes** (`PUT`, `DELETE`) also need, each exactly once:

- `Origin: https://themarr.coolroo.dev` (`-public-origin`);
- `Sec-Fetch-Site: same-origin`;
- `If-Match: "<store version>"` (from any earlier answer's `ETag`);
- for PUT, `Content-Type: application/json` and a body that is one JSON
  object with exactly the listed fields.

Each write attempt, refused or not, writes one audit line (JSON, stdout):
request id, user, action, target id, status, result (`ok`, `refused`,
`failed`), problem code, store version. Never a body or token.

| Route | Body | Answer |
|---|---|---|
| `GET /v1/themes` | | `{"themes": [Theme...]}` by id |
| `GET /v1/themes/{id}` | | `Theme` |
| `PUT /v1/themes/{id}` | `Theme` | 201 (new) or 200, the stored `Theme` |
| `DELETE /v1/themes/{id}` | none | 204; 409 `in_use` while assigned; also taken out of the favourites |
| `GET /v1/apps` | | `{"apps": [App...]}` by id |
| `GET /v1/apps/{id}` | | `App` |
| `PUT /v1/apps/{id}` | `App` | 201 (new) or 200, the `App` |
| `DELETE /v1/apps/{id}` | none | 204; its assignment and last check go too |
| `GET /v1/apps/{id}/last-check` | | `{"app": id, "lastCheck": null \| {"at": RFC 3339 UTC, "result": "applied" \| "unset", "theme"?: id}}` |
| `GET /v1/assignments` | | `Assignments` |
| `PUT /v1/assignments` | `Assignments` (both fields required) | 200, `Assignments` |
| `GET /v1/favourites` | | `{"favourites": [theme id...]}` |
| `PUT /v1/favourites` | `{"favourites": [theme id...]}` | 200, the same |

- **Theme**: the document `packages/tokens` defines (`id`, `name`, `version`,
  `source`, `modes`, `tokens`), checked by the same rules. The server owns
  `version`: a new theme gets 1 and a replaced one the stored version plus 1,
  whatever the body says. `inherit` and `none` are not theme ids.
- **App**: `{"id", "name", "origins"}`. `id` as above, `name` 1-80 printable
  characters, `origins` at most 10 distinct `https://host[:port]` (lower
  case, no path), the origins its pages run on (for `/v1/me`'s credentialed
  CORS).
- **Assignments**: `{"global": theme id | null, "perApp": {app id: theme id |
  "inherit" | "none"}}`. An app missing from `perApp` inherits.
- The last check is kept in memory only: it is empty after a restart.

## Per-user themes (decision 0007)

An app's theme for one person is the first layer that is set, top down:

1. **enforced**: an admin's enforced policy for the person, else for one of
   their groups. Nothing below can change it (`locked: true`).
2. *local override*: in the browser only (the SDK, `themarr:<app>:local`);
   the SDK ignores it when `locked` is true. The server never sees it.
3. **saved**: the person's own choice for this app (follows them across
   devices).
4. **default**: an admin's default policy for the person, else for one of
   their groups.
5. **app**: the app's assignment (`none` stops here: no theme), then
   **global**: the global default.
6. nothing (204): the app keeps its own look.

Conflicts: the person's own policy beats any group policy of the same
kind; among their groups, the group whose name sorts first (byte order,
so `Zed` before `alpha`) wins. Layers come first: a group's enforced
policy beats the person's own default. A layer whose theme no longer
exists is skipped. Policies apply to every app, registered or not, and
also to apps whose assignment is `none`.

The person is `Remote-User`, their groups `Remote-Groups`, read by the
identity module (`internal/identity`, Authelia) on the tls-gateway hop
only. themarr stores saved choices and policies in `prefs.json`, with its
own version: these routes' `ETag` and `If-Match` are `"p<version>"`, never
the store's `"<version>"`.

A prefs write checks `If-Match` against **its own part** only: a policy
write against the last change to any policy, a saved choice against the
last change to that person's choice for that app. So people saving their
own choices never make an admin's policy write, or each other's saves,
fail with 412; two admin tabs, or two tabs of one person on one app,
still do. The `ETag` is always the file's current version. A write that
changes nothing (the same choice, the same policy) is not written: it is
answered like a read, with the current `ETag`. After a restart, any tag
older than the file's version is 412 once.

### `GET|HEAD /v1/me/apps/{app}/theme` (any signed-in user)

Behind Authelia (a session, any user). The SDK calls it with
`credentials: "include"` and no request headers, so no preflight; themarr
doesn't answer OPTIONS.

- **200** `application/json`, a strong `ETag`: the public body plus where
  it came from:

  ```json
  {"version": 3, "modes": ["light", "dark"], "tokens": {"light": {}, "dark": {}},
   "locked": false, "source": "saved"}
  ```

  `source` is always one of `enforced`, `saved`, `default`, `app`,
  `global`; `locked` is true exactly when `source` is `enforced`.
- **304** when `If-None-Match` names the `ETag`. The tag covers the theme,
  the store version, `source` and `locked`.
- **204** when nothing applies for this person.
- **401** `unauthenticated` without a usable `Remote-User` (in practice
  Authelia answers first; the SDK then falls back to the public route).
- **404** `not_found` when `{app}` is not a valid id.

Headers on every answer of this route:

```
Cache-Control: private, no-cache
Vary: Origin
```

and, only when the request has exactly one `Origin` that is one of the
app's registered `origins` (exact match):

```
Access-Control-Allow-Origin: <that origin>
Access-Control-Allow-Credentials: true
Access-Control-Expose-Headers: ETag, X-Request-Id
```

Any other origin, an unregistered app, or no `Origin` gets no CORS headers
(the browser then refuses the answer to the script).

### `GET /v1/me/apps/{app}/preference`, `PUT /v1/me/apps/{app}/preference` (any signed-in user)

The person's saved choice for a registered app, for themarr's own drawer
page (same origin; no CORS). An app that is not registered is `404`.

- **GET** → `{"app": "board", "theme": "ocean" | null, "locked": false}`,
  `ETag: "p<version>"`. `locked`: an admin enforces a theme for this
  person, so a saved choice has no effect.
- **PUT** `{"theme": "<theme id>" | null}` → 200, the same body as GET and
  the new `ETag`. `null` clears the choice. Needs what admin writes need
  (below): `Origin`, `Sec-Fetch-Site: same-origin`, `Content-Type:
  application/json`, `If-Match: "p<version>"`. Refusals: `422
  unknown_theme`, `422 missing_field`, `409 locked` (setting a theme while
  locked; clearing is always allowed), `412 version_conflict` (this
  person's choice for this app changed since), `429 rate_limited` (each
  person: 10 saves at once, then 2 a second, refused attempts included).

A saved choice may later name a deleted theme: GET still shows it, and the
resolver skips it.

### Policies (admins with two-factor, like the admin routes)

| Route | Body | Answer |
|---|---|---|
| `GET /v1/policies` | | `{"users": {name: Policy}, "groups": {name: Policy}}` |
| `GET /v1/policies/users/{name}` | | `Policy`; 404 when none |
| `PUT /v1/policies/users/{name}` | `Policy` | 201 (new) or 200, the `Policy` |
| `DELETE /v1/policies/users/{name}` | none | 204; 404 when none |
| `GET`, `PUT`, `DELETE /v1/policies/groups/{name}` | as above | as above |

- **Policy**: `{"theme": "<theme id>", "kind": "default" | "enforced"}`,
  both required. The theme must exist (`422 unknown_theme`). `{name}` is a
  user or group name, 1-128 of `A-Za-z0-9._@-` (`422 bad_name`); a group
  whose name has other characters can't have a policy.
- Every answer carries `ETag: "p<version>"`; writes need the admin write
  checks with `If-Match: "p<version>"`.
- Deleting a theme a policy names is `409 in_use`. The check and the
  delete hold different locks, so a policy written at that same moment can
  still name the deleted theme; the resolver skips it.

Each write on these routes and on the preference route writes one audit
line (JSON, stdout): request id, user, action (`put_preference`,
`put_policy`, `delete_policy`), target (the app, or `users/<name>`,
`groups/<name>`), status, result, problem code, prefs version. Never a
body.

## The admin UI

`GET /` and any path outside `/v1/` serve the admin UI from the binary
(`internal/webui`, an `index.html` fallback for the UI's own routes). It
uses the admin routes above from the same origin.

## The drawer page (decision 0009)

`GET|HEAD /drawer?app=<id>` serves `internal/webui/dist/drawer.html` (a
placeholder until T-119 builds the page). NPM keeps Authelia in front of it
(any signed-in user, one factor; the admin controls inside it call the
admin routes, which need two-factor). It is the only answer that may be
framed:

- `?app=` names exactly one valid id of a registered app with origins →
  `Content-Security-Policy: default-src 'self'; base-uri 'none'; object-src
  'none'; form-action 'self'; frame-ancestors <the app's origins, space
  separated>`, and no `X-Frame-Options`.
- Anything else (no `app`, two, an invalid or unregistered id, an app
  with no origins) → the same policy with `frame-ancestors 'none'`, and
  `X-Frame-Options: DENY`. The page still loads on its own (a new tab).
- `Cache-Control: no-cache`. themarr reads no identity header here; the
  page's own calls (`/v1/me/...`, admin routes) do.

The SDK frames it in apps that boot with `drawer: true` and talks to it
with `postMessage`, protocol version 1 (`packages/web/src/drawer/protocol.ts`,
`packages/web/README.md`, "The drawer"). Every message is
`{"themarr": 1, "type": ..., ...}` with exactly these fields:

| From | `type` | Fields | The SDK |
|---|---|---|---|
| SDK | `hello` | `app`, `mode` (`light`\|`dark`, what the app shows), `current`: `{source, locked, version?, local?}` | sends it after each `ready`, and after each refresh it does for the page |
| page | `ready` | | answers `hello` |
| page | `preview` | `body` (the public theme body: `version`, `modes`, `tokens`), `mode?` | checks `body` with the token rules, shows it in this tab only |
| page | `clearPreview` | | shows the resolved theme again |
| page | `keepLocal` | `themeId` | sets the local override (not while locked), refreshes |
| page | `clearLocal` | | clears the local override, refreshes |
| page | `saved` | `scope`: `me`\|`app` | refreshes (`me` also clears the local override) |
| page | `close` | | closes the drawer and drops any preview |

`current.source` is the boot result's source (`enforced`, `local`,
`saved`, `default`, `app`, `global`, `public`) or `none`. The SDK accepts
a message only from themarr's exact origin and its own iframe's window,
and posts only with that exact origin as `targetOrigin`. The page does the
same in reverse: it posts `ready` (which carries nothing) to
`window.parent` with `targetOrigin` `"*"`, accepts `hello` only when
`event.source === window.parent` and `parseAppMessage` passes, keeps that
`event.origin` (the browser framed the page only for the app's registered
origins), and posts every later message with that exact origin.

## The health listener

`127.0.0.1:8081` (`-health-listen`, loopback only), plain HTTP, never
published: `GET /healthz` → `200 {"status":"ok"}`; anything else 404.
`themarr -healthcheck` calls it for the image's `HEALTHCHECK`.

## Settings

Flags, each with an environment fallback:

| Flag | Env | Default |
|---|---|---|
| `-listen` | `THEMARR_LISTEN` | `:8443` |
| `-health-listen` | `THEMARR_HEALTH_LISTEN` | `127.0.0.1:8081` (must be a loopback IP) |
| `-cert-file`, `-key-file` | `THEMARR_CERT_FILE`, `THEMARR_KEY_FILE` | `/certs/themarr.crt`, `/certs/themarr.key` |
| `-client-ca-file` | `THEMARR_CLIENT_CA_FILE` | `/certs/home-ca.crt` |
| `-client-cn` | `THEMARR_CLIENT_CN` | `tls-gateway` |
| `-data-dir` | `THEMARR_DATA_DIR` | `/data` |
| `-public-origin` | `THEMARR_PUBLIC_ORIGIN` | `https://themarr.coolroo.dev` |
| `-admin-group` | `THEMARR_ADMIN_GROUP` | `admins` |

`-check` validates the settings, loads the certificates and the store, and
exits. `-version` prints the version.
