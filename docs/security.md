# Security model

Themarr runs in every themed app's first second and holds nothing secret:
themes are colours, and the store names apps and their origins. What it must
protect is **who may change a theme** (a hostile theme could make an app
unreadable, or hide a warning colour), **the identity headers** it trusts for
that, and **its own availability** (each app waits for it at boot, up to the
SDK's timeout). This file lists the threats and the rule or test that keeps
each defence true, what themarr assumes about the hops before it, what is
still open, and the security reviews.

| Threat | Defence | Kept true by |
| --- | --- | --- |
| Any home-CA client (npm-homepi, enforcarr, a card agent's certificate) calling themarr directly and forging `Remote-User`/`Remote-Groups` | Only `CN=tls-gateway` from a verified chain gets in; read from `r.TLS.VerifiedChains`, never from what the client sent (`PeerCertificates`). The pin proves only that the request came through tls-gateway: it holds only while tls-gateway's themarr port accepts no client but NPM (a hard deployment requirement, below) | `internal/server` TestGate, TestExtraRoutesAreGated; `internal/tlsutil` TestVerifiedCN; `cmd/themarr` TestServe (real TLS: other CN 403, no certificate and another CA's certificate refused in the handshake) |
| A client without a certificate, or from another CA | `RequireAndVerifyClientCert` with the home CA as the only pool, TLS 1.3 only | `internal/tlsutil` TestServerConfig; `cmd/themarr` TestServe |
| Certificate checks turned off | No non-test file may mention `InsecureSkipVerify`, `VerifyPeerCertificate` or `VerifyConnection` | `internal/tlsutil` TestNoCertificateChecksTurnedOff (fails the build) |
| A path NPM and Authelia read one way and Go another (`/v1/apps/board%2Ftheme` is the public bypass to Authelia, the admin route `GET /v1/apps/{id}` to Go; also `%3F`, `%5C`, `..%2F`, `%25`) | Any percent-escape in the path, or a character Go would have escaped (`RawPath` set), is 404 in the gate, before routing; no themarr route or page needs one | TestEscapedPathsAre404 (the T-115 reviewer's examples) |
| Forged identity headers on the public path (the Authelia bypass lets anybody send them) | Public routes never read `Remote-*`; the answer is the same with or without them | TestPublicIgnoresRemoteHeaders |
| A signed-in non-admin changing themes | Every admin route needs the admin group in `Remote-Groups` (exact match after splitting on commas); a repeated `Remote-User` or `Remote-Groups` is refused, not merged | TestAdminNeedsIdentityAndGroup |
| Cross-site request forgery against an admin's Authelia session | Writes need exactly one `Origin` equal to themarr's own, exactly one `Sec-Fetch-Site: same-origin`, `Content-Type: application/json` (not a simple-request type), and `If-Match`; no CORS on admin routes | TestWriteChecks |
| Lost updates between two admin tabs | Every write names the store version it read (`If-Match`); a stale one gets 412; writes are serialised by one mutex | TestStaleWriteAfterAnotherWrite, TestConcurrentWrites; `internal/store` TestConcurrentWrites, TestStaleVersionConflicts |
| A crash or full disk corrupting the store | Temp file in the same directory, fsync, rename, fsync of the directory; a failed write leaves the snapshot and the file as they were; temp files of a crashed write (older than a minute) are removed at start | `internal/store` TestWriteAndReload, TestFailedWriteChangesNothing, TestUnwritableDirKeepsTheSnapshot, TestStaleTempFilesAreRemovedAtStart |
| Starting on a damaged store and overwriting it | A store file that doesn't parse, has another format, unknown fields, an invalid theme or a dangling reference stops the start; the file is left as it is | `internal/store` TestCorruptFileIsRefusedAndKept; `cmd/themarr` TestCorruptStoreStopsStartAndIsKept |
| A malformed or hostile theme reaching apps | The server validates every theme with the token rules of `packages/tokens` (strict objects, known tokens only, sRGB colours in range, hex agreeing with components); bodies are one object, valid UTF-8, no repeated keys, bounded size and depth | `internal/theme` TestValidFixtures, TestInvalidFixtures (the shared golden fixtures), TestRulesBeyondTheFixtures, TestUnacceptableJSON; TestPutThemeRefuses |
| An app origin no browser sends (`https://*.coolroo.dev`, `https://a;b`, quotes, non-ASCII, `https://h:`) stored, then put into a header | `store.ValidOrigin` is the strict `https://host[:port]` pattern: a lower-case DNS host name, a port of 1-65535 without leading zeros and never 443; admins get 422 | `internal/store` TestValidOrigin; TestApps |
| The public answer leaking more than colours | The public body is `version`, `modes` and `tokens` only (decision 0004): no name, source, seeds, assignments, apps or origins | `internal/theme` TestPublicHoldsColoursOnly; `internal/server` TestPublicBodyHoldsColoursOnly |
| Anonymous load on the public routes | The catalog's body and ETag, and each theme's public body, are made once per store snapshot, not per request | TestPublicAnswersAreCachedPerSnapshot |
| Enumerating registered apps | An unknown app id is answered exactly like a registered app without an assignment (global default or 204) | TestNothingSetIs204, TestResolutionOrder |
| Memory growth from made-up app ids | The last check is kept only for registered apps, asked again under the lock the app delete's forget takes, and dropped when an app is deleted | TestLastCheck |
| Theme bodies in logs | One audit line per write attempt: who, what, result, never the body | TestAuditLine |
| Refused requests filling the log (a wrong client CN, a refused write repeated, TLS handshake errors) | Each kind passes `server.LogCap`: 60 lines a minute, then one "log lines dropped" line with the count; writes that change something are always logged | TestLogCap, TestRefusalLinesAreCapped; `internal/prefs/prefsapi` TestQuietAuditLinesAreCapped |
| The admin UI framed (clickjacking) or loading foreign code | `X-Frame-Options: DENY` and `frame-ancestors 'none'` everywhere but `/drawer` (below); the UI's CSP allows its own origin only; API answers `default-src 'none'` | TestCommonHeaders; `internal/webui` TestServesIndexWithCSP |
| The admin page reloading for ever (themarr down, or session storage blocked) | A reload when the session ends, at most once in 15 s (a guard in session storage); without session storage, no automatic reload: the page asks the admin to reload | `packages/admin` "doesn't reload again right after a reload", "never reloads without session storage for the guard" |
| Admin answers cached by a proxy or the browser | `Cache-Control: no-store` on everything but the public routes and the UI | TestCommonHeaders |
| Plain HTTP on the network | The API listener is TLS only; the plain health listener must be a loopback IP (config validation), is never published, and serves only `GET /healthz` | `internal/config` TestValidateRefuses; `cmd/themarr` TestHealthcheck, TestHealthListenerServesOnlyHealthz |
| Slow or huge requests holding connections | Read-header, read, write and idle timeouts; 16 KiB of headers; body limits of 128 KiB (themes) and 32 KiB (others); at most 500 themes and 200 apps | `cmd/themarr/main.go`; TestPutThemeRefuses; `internal/store` TestRulesAreKept |
| A compromised dependency | No Go modules beyond the standard library; a static binary on an empty image, run as user 65532; `.dockerignore` keeps a checkout's `node_modules`, `dist`, `.git` and worktrees out of the image | `go.mod` (no requirements); `Dockerfile`; `.dockerignore` |

### Per-user themes (decision 0007)

`/v1/me/...` and `/v1/policies` read the identity headers, so they must
never be on the Authelia bypass. Tests are in `internal/prefs/prefsapi`
unless named otherwise.

| Threat | Defence | Kept true by |
| --- | --- | --- |
| Another site reading a person's theme with their Authelia cookie (credentialed CORS) | `/v1/me/apps/{app}/theme` echoes `Access-Control-Allow-Origin` with `Allow-Credentials: true` only when the one `Origin` is exactly one of *that* app's registered origins; anything else (another app's origin, themarr's own, `null`, a suffix, two `Origin` headers, an unregistered app) gets no CORS headers, so the browser keeps the answer from the script. The answer is colours, `source` and `locked` only | TestMeThemeCORS, TestMeThemeBody |
| A shared cache serving one origin's CORS answer, or one person's theme, to another | `Vary: Origin` and `Cache-Control: private, no-cache` on every answer of the route | TestMeThemeBody, TestMeThemeCORS |
| CORS spreading to the write and admin routes | Only the `/v1/me/.../theme` GET sets CORS; the preference and policy routes never do | TestMeThemeCORS |
| Cross-site request forgery against a person's saved choice or an admin's policies | The admin write checks (`server.CheckWrite`): exactly one `Origin` equal to themarr's own, `Sec-Fetch-Site: same-origin`, `Content-Type: application/json`, `If-Match` | TestWriteChecks |
| A person changing someone else's choice | The preference routes take the user from `Remote-User` only; the path names no user | TestPreferenceRoutes |
| A person escaping an enforced theme | The enforced layer is first and returns `locked: true` (the SDK then ignores the local override); saving a choice while locked is `409 locked` | `internal/resolve` TestPrecedence, TestGroupEnforcedBeatsUserDefault; TestLockedPreference, TestMeThemeLayers |
| A non-admin writing policies | Every policy route needs the admin group, as the admin routes do | TestPolicyRoutes |
| A store version taken for a prefs version (a write that passes `If-Match` without having read the prefs) | Prefs tags are `"p<version>"`; a store tag is `400 bad_if_match` on prefs writes and the other way round | `internal/server` TestCheckWritePrefix; TestWriteChecks |
| Lost updates on the prefs file | `If-Match` against the last change of the write's own part (the policies, or one person's choice for one app), one writer at a time; a stale write is 412; a tag newer than the file is 412 | TestConcurrentPreferenceWrites; `internal/prefs` TestConcurrentWrites, TestStaleVersionConflicts, TestPartsConflictOnlyWithThemselves |
| A signed-in person starving everyone else's writes (identical saves in a loop made every admin policy write and every other save 412) or wearing the disk | Other people's saves and policy writes never make a write stale; a write that changes nothing is not written (200, the current ETag); each person may save 10 times at once, then 2 times a second (`429 rate_limited`, `Retry-After`) | TestSavesDontStarveOthers, TestNoOpSaveWritesNothing, TestSaveRateLimit; `internal/prefs` TestNoOpUpdateWritesNothing |
| A crash or a damaged prefs file | The store's atomic write (`store.WriteAtomic`); a file that doesn't parse, has unknown fields, another format, a bad name or kind stops the start and is left as it is; temp files of a crashed write are removed at start | `internal/prefs` TestWriteAndReload, TestUnwritableDirKeepsTheSnapshot, TestCorruptFileIsRefusedAndKept, TestStaleTempFilesAreRemovedAtStart; `cmd/themarr` TestCorruptPrefsStopsStartAndIsKept |
| Signed-in users growing the prefs file | Choices only for registered apps (checked again under the prefs lock); a deleted app's choices go with it (and at start); at most 1000 users with choices, 200 choices each, 1000 policies per scope; bodies at most 32 KiB | `internal/prefs` TestRulesAreKept, TestDropChoices; TestPreferenceRoutes, TestWriteChecks, TestAppDeleteDropsChoices; `internal/server` TestAppDeletedHook; `cmd/themarr` TestDropChoices |
| A policy or choice naming a deleted theme | Deleting a theme a policy names is `409 in_use`; whatever still names a missing theme (a saved choice, or a policy written during the delete) is skipped by the resolver | TestThemeDeleteInUse; `internal/server` TestThemeInUseOutsideTheStore; `internal/resolve` TestMissingThemeIsSkipped |
| Policies reaching anonymous visitors through forged headers | The public route resolves without identity; policies and choices never apply there | TestPublicRouteIgnoresPolicies; `internal/resolve` TestNobodyGetsOnlyTheAppLayers |
| Preference and policy bodies in logs | One audit line per write attempt: user, action, target, status, code, prefs version; never the body. Refused and unchanged writes' lines are capped (above) | TestAuditLines, TestQuietAuditLinesAreCapped |

### The in-app drawer (decision 0009)

Server tests are in `internal/server`; SDK tests in
`packages/web/test/drawer`.

| Threat | Defence | Kept true by |
| --- | --- | --- |
| Another site framing a signed-in themarr page (clickjacking an admin's session) | Only GET and HEAD of `/drawer` may be framed (`frameable`), and only by the exact origins registered for the app in `?app=` (`frame-ancestors`, no wildcard); a missing, repeated, invalid or unregistered app, or one without origins, gets `frame-ancestors 'none'` and `X-Frame-Options: DENY`; every other answer keeps `DENY` and `'none'`. A registered origin itself may still frame it ("Still open") | TestDrawerFrameAncestorsAreTheAppsOrigins, TestDrawerWithoutARegisteredAppIsNeverFramed, TestOnlyTheDrawerIsFramable, TestFrameable, TestDrawerWithoutAPageIs404AndDenied; `cmd/themarr` TestServe |
| A header injected through an app's origin | Origins are stored only in the strict `https://host[:port]` pattern (`store.ValidOrigin`), and checked again against it before they go into the header | `frameOrigin` in `internal/server/drawer.go`; TestDrawerFrameAncestorsAreTheAppsOrigins; `internal/store` TestValidOrigin |
| A signed-in person learning which origins an app is registered on | `/drawer?app=<id>` names them in `frame-ancestors`, to any signed-in user (anonymous visitors get Authelia's sign-in). Accepted: they are the app's own public URLs, not secrets | contract.md, "The drawer page" |
| The app (or a script on it) using the person's rights | Every save happens inside themarr's page, same origin, with the write checks; the app only previews and refreshes on the page's messages; no write route has CORS | TestWriteChecks; the SDK has no write call (`src/drawer/frame.ts`) |
| A forged message changing the app's theme (another window, another origin, a navigated iframe) | The SDK accepts a message only when `event.origin` is themarr's exact origin, `event.source` is its own iframe's window, and the data is exactly one protocol shape (a preview's theme through the token rules); anything else is ignored | "ignores messages from another origin, another window, or of another shape"; `protocol.test.ts` |
| The SDK's messages read by another frame | It posts only to its own iframe, with `targetOrigin` themarr's exact origin, never `*` | "answers ready with hello, posted to the exact themarr origin", "keepLocal keeps the theme..." |
| The drawer page talking to the wrong window | The page posts `ready` (it carries nothing) to `window.parent` with `"*"`; it takes `hello` only when `event.source === window.parent`, `parseAppMessage` passes and the app is the one in `?app=`; it keeps that `event.origin` (the browser framed the page only for the app's registered origins) and posts every later message only to it | `packages/admin/src/drawer/Drawer.tsx` (read in the T-115 review; the parser has tests, the wiring has none) |
| The drawer page navigating the app | `sandbox` without `allow-top-navigation` on the iframe | "frames /drawer?app=<id> with a sandbox that can't navigate the app" |
| A preview outliving the drawer, or kept without consent | A preview is a second CSS text in this tab only; `clearPreview` and closing remove it; nothing is stored or sent | "preview changes this tab only; ...", "Reset and closing restore..." |
| A locked person keeping another theme through the drawer | `keepLocal` is ignored while locked (boot also ignores the local override then) | "a locked person can preview but not keep" |
| Theme names or app CSS injecting into the drawer, or the drawer breaking the app | All drawer DOM is in one shadow root; names go in as text only; colours only as checked `#RRGGBB` custom properties; styles as a constructable sheet or a nonce'd `<style>` | "lists the catalog: ... names as text", "uses a <style> with the nonce ..." |
| The catalog leaking more than names and colours, or reading forged identity | `/v1/catalog` holds id, name, version, modes, swatch colours and favourites only, and never reads `Remote-*` | TestCatalogShapeAndSort, TestCatalogIgnoresRemoteHeaders |

### The SDK in an app's page or server

Tests are in `packages/web/test`.

| Threat | Defence | Kept true by |
| --- | --- | --- |
| An app's render options ending a `<style>` it renders on its server (`dark.value: "</style><script>..."`), or a comment hiding the rest of the rule | `checkRender` refuses `<`, a backslash, control characters and CSS comments (`/*`, `*/`) in the selector and in `dark.value`; the selector also braces, `;` and `@`, the value also quotes and `>` | css.test.ts "checkRender" (the T-115 reviewer's cases), "never lets a rendered sheet close a <style>" |
| A theme answer changing an object's prototype (`"__proto__"` as a mode or token key) | The wire check copies with `Object.fromEntries` (own keys only); the token rules then refuse a `__proto__` mode, and drop one in a mode's tokens | wire.test.ts "never lets a __proto__ key change a prototype" |

## What themarr assumes about the hops before it

- **tls-gateway's themarr port accepts only NPM's client certificate.**
  This is a hard deployment requirement (home-server T-090). The CN pin
  proves only "this request came through tls-gateway"; tls-gateway proves
  nothing about who sent it unless its themarr listener requires mutual
  TLS and lets in only NPM's certificate (`npm-homepi`). Without that, any
  home-CA client (a card agent, enforcarr) could reach themarr through
  tls-gateway with forged `Remote-User` and `Remote-Groups` and act as an
  admin.
- **tls-gateway is the only holder of the `tls-gateway` client key.** The
  CN pin is only as strong as that key. The home CA must never issue
  another certificate with that CN (`/etc/paseo/cert-names-denied`).
- **NPM and Authelia set the identity headers.** On routes behind
  Authelia, NPM's `auth_request` snippet overwrites `Remote-User` and
  `Remote-Groups` with Authelia's answer, so a browser can't supply its
  own. The T-115 review found that NPM also overwrites (empties or drops)
  them on the bypassed paths, the safe direction; public routes ignore
  them anyway.
- **Group names hold no comma.** Authelia sends `Remote-Groups` as one
  comma-separated list, and themarr splits it on commas: a group named
  `a,b` would read as the groups `a` and `b` (so a group named
  `x,admins` would make its members admins). The homelab's user store
  must never have a group name with a comma.
- **The Authelia bypass covers only** `GET|HEAD /v1/apps/{app}/theme`,
  `GET|HEAD /v1/themes/{id}/tokens` and `GET|HEAD /v1/catalog`
  (decision 0009). Everything else, the UI included, needs
  a session; admin routes need the admins group with two-factor.
  `/v1/me/` and `/drawer` need a session of any user; `/v1/policies` is an
  admin route (admins, two-factor). A bypass rule that matched `/v1/me/`
  would let anybody forge `Remote-User` there. The drawer page's assets
  (`/assets/drawer-<hash>.{js,css}`) need a session of any user, not the
  admins group (home-server T-090).
- **The Authelia session cookie reaches themarr from app pages.** Apps on
  `*.coolroo.dev` are same-site with themarr, so `credentials: "include"`
  sends the cookie. When Authelia answers instead of themarr (no session),
  it has no CORS headers and the SDK falls back to the public route.

## Still open

- **A registered origin may frame the drawer (clickjacking).** A script on
  a registered app origin can show themarr's page inside that app to a
  signed-in person and overlay it. For an admin with a two-factor session,
  one click on "Everyone on <app>" sets the app's theme for everyone, and
  one on "Save as new theme" stores a theme; for anyone, one click saves
  their own choice. Each write still needs a click inside the page, and
  the app origin is one the admins registered. A fix needs a step the
  framing page can't overlay (a confirmation, or a visibility check such
  as IntersectionObserver v2), and is not in 0.1.0.
- **A registered origin is trusted with its users' themes.** A script on a
  registered app origin (an XSS there) can read the signed-in person's
  theme for that app, and nothing else: colours, `source` and `locked`.
- **Theme names may hold bidirectional or zero-width characters.** Names
  are 1-80 printable characters, and Go counts those as printable, so an
  admin could name a theme to look like another. Only admins name themes,
  and names are shown as text only.
- **Prefs versions per part live in memory.** After a restart, any prefs
  tag older than the file's version is 412 once (the page reads again).
- **Certificate rotation needs a restart.** The server certificate and the
  client CA are read at start (as in Enforcarr).
- **Base images are pinned by tag, not by digest** (`node:24.22.1-bookworm-slim`,
  `golang:1.27.1-alpine3.24`). Digest pinning is a homelab-wide task
  (home-server T-070).

## Review

The T-115 review of 0.1.0 (2026-10-28) had two adversarial reviewers: one
for the server (the gate, the identity headers, the store and prefs, the
public routes), and one for the browser side and the deployment (the SDK,
the drawer and its messages, the admin UI, the image, NPM, Authelia and
tls-gateway). Neither found a way to forge an identity past the gate, to
write without the admin group or the write checks, or to read more than
colours and theme names on the public path. Their findings, each fixed in
0.1.0 with a regression test unless said otherwise:

| Finding | Severity | Fixed in |
| --- | --- | --- |
| A person saving the same choice in a loop bumped the one prefs version and rewrote `prefs.json` each time, so every admin policy write and every other save failed with 412 | medium | faa8945: per-part `If-Match`, no-op saves not written, 10 saves at once then 2 a second per person |
| Go routed an escaped segment (`%2F`, `%3F`, `..%2F`) as one, while NPM and Authelia match the decoded path | low | 43b7a65: any escape in the path is 404 before routing |
| `/v1/catalog` was built and hashed again for every anonymous request | low | 75f98ed: public answers cached per store snapshot |
| Refused writes (any signed-in person), wrong-CN requests and TLS handshake errors wrote one log line each | low | 9ff2db3: 60 lines a minute per kind, then a summary line |
| `dark.value` let `<` through, so a server-rendered `<style>` could be closed early; comments were allowed in selectors and values | low | f9cdb5d |
| The image's build context took a checkout's `node_modules`, `dist`, `.git` and worktrees | low | 21b24e4: `.dockerignore` (not tested by a docker build here) |
| tls-gateway's themarr port (mutual TLS, NPM only), the Authelia rule for the drawer's assets, and the setup scripts | deployment | home-server T-090 (the deploy files, a separate change) |
| `store.ValidOrigin` accepted origins no browser sends (`*`, `;`, quotes, non-ASCII, an empty port) | info | 88435e4: the strict `https://host[:port]` pattern |
| Deleting an app left its saved choices (they counted to limits and came back); a last check could outlive the delete | info | abd5507 |
| A crash left `.themarr.json.*.tmp` and `.prefs.json.*.tmp` behind | info | 5dd0653: removed at start |
| The SDK's wire check could take a `"__proto__"` key as a prototype | info | 7cb6b59 |
| Without session storage, the admin page's reload guard could not stop a reload loop | info | 792aeb3: the page asks the admin to reload instead |
| This file: the CN pin's limit, NPM's header handling, the drawer page, the groups' commas, theme names | info | this change |

Left open, with reasons: the drawer's clickjacking by a registered origin,
bidirectional and zero-width characters in theme names, and digest
pinning ("Still open").
