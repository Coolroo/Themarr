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
| `X-Frame-Options` | `DENY` (a future `/drawer`, T-085/T-119, will be the one exception) |
| `Referrer-Policy` | `no-referrer` |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'`; the admin UI's pages get `default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'` |
| `Cache-Control` | `no-store`, except public routes (`no-cache`) and the UI (`no-cache`) |

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
| 400 | `invalid_json` | not one JSON object, invalid UTF-8, repeated keys, too deep, unknown or wrongly-cased field (apps, assignments, favourites) |
| 400 | `bad_if_match` | `If-Match` is not exactly one strong tag such as `"12"` (`*` and `W/` are refused) |
| 400 | `unexpected_body` | a DELETE with a body |
| 401 | `unauthenticated` | admin route without a usable `Remote-User` (missing, repeated, or not 1-128 of `A-Za-z0-9._@-`), or with `Remote-Groups` repeated |
| 403 | `client_not_allowed` | client certificate CN is not the configured one |
| 403 | `not_admin` | `Remote-Groups` doesn't hold the admin group (`admins`) |
| 403 | `bad_origin` | write without exactly one `Origin: https://themarr.coolroo.dev` |
| 403 | `cross_site` | write without exactly one `Sec-Fetch-Site: same-origin` |
| 404 | `not_found` | unknown route, theme or app; an app id that is not a valid id on the public route |
| 409 | `in_use` | deleting a theme an assignment names |
| 412 | `version_conflict` | `If-Match` is not the store's current version |
| 413 | `too_large` | body above 128 KiB (themes) or 32 KiB (others) |
| 415 | `unsupported_media_type` | write body without `Content-Type: application/json` (charset utf-8 at most) |
| 422 | `invalid_theme` | the theme breaks the token rules; `issues` lists them |
| 422 | `id_mismatch` | the body's `id` differs from the path's |
| 422 | `bad_id` | a theme id of `inherit` or `none` (reserved by assignments) |
| 422 | `invalid` | an app's fields are out of shape; a favourite listed twice |
| 422 | `unknown_theme`, `unknown_app` | an assignment or favourite names something that doesn't exist |
| 422 | `missing_field` | assignments without `global` or `perApp`; favourites without `favourites` |
| 422 | `too_many` | above 500 themes or 200 apps |
| 428 | `if_match_required` | write without `If-Match` |
| 500 | `store_failed` | the store file could not be written (the cause is logged, not returned) |

`issues` on `invalid_theme` is the validator's list, with the codes and JSON
Pointer paths of `packages/tokens` (`errorCodes` in its manifest):

```json
"issues": [{"code": "missing_token", "path": "/tokens/dark/primary", "message": "required token \"primary\" is missing"}]
```

## Public routes (no sign-in; decision 0004)

NPM bypasses Authelia for these, GET and HEAD only. themarr never reads
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

## Admin routes (Authelia, admins with two-factor)

themarr reads `Remote-User` and `Remote-Groups` (comma-separated, spaces
trimmed) only here, and trusts them only because the CN pin proves the
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
  case, no path), the origins its pages run on (for T-089's credentialed
  CORS).
- **Assignments**: `{"global": theme id | null, "perApp": {app id: theme id |
  "inherit" | "none"}}`. An app missing from `perApp` inherits.
- The last check is kept in memory only: it is empty after a restart.

## The admin UI

`GET /` and any path outside `/v1/` serve the admin UI from the binary
(`internal/webui`, an `index.html` fallback for the UI's own routes). It
uses the admin routes above from the same origin.

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
