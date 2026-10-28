# Security model

Themarr runs in every themed app's first second and holds nothing secret:
themes are colours, and the store names apps and their origins. What it must
protect is **who may change a theme** (a hostile theme could make an app
unreadable, or hide a warning colour), **the identity headers** it trusts for
that, and **its own availability** (each app waits for it at boot, up to the
SDK's timeout). This file lists the threats and the rule or test that keeps
each defence true.

| Threat | Defence | Kept true by |
| --- | --- | --- |
| Any home-CA client (npm-homepi, enforcarr, a card agent's certificate) calling themarr directly and forging `Remote-User`/`Remote-Groups` | Only `CN=tls-gateway` from a verified chain gets in; read from `r.TLS.VerifiedChains`, never from what the client sent (`PeerCertificates`) | `internal/server` TestGate, TestExtraRoutesAreGated; `internal/tlsutil` TestVerifiedCN; `cmd/themarr` TestServe (real TLS: other CN 403, no certificate and another CA's certificate refused in the handshake) |
| A client without a certificate, or from another CA | `RequireAndVerifyClientCert` with the home CA as the only pool, TLS 1.3 only | `internal/tlsutil` TestServerConfig; `cmd/themarr` TestServe |
| Certificate checks turned off | No non-test file may mention `InsecureSkipVerify`, `VerifyPeerCertificate` or `VerifyConnection` | `internal/tlsutil` TestNoCertificateChecksTurnedOff (fails the build) |
| Forged identity headers on the public path (the Authelia bypass lets anybody send them) | Public routes never read `Remote-*`; the answer is the same with or without them | TestPublicIgnoresRemoteHeaders |
| A signed-in non-admin changing themes | Every admin route needs the admin group in `Remote-Groups` (exact match after splitting on commas); a repeated `Remote-User` or `Remote-Groups` is refused, not merged | TestAdminNeedsIdentityAndGroup |
| Cross-site request forgery against an admin's Authelia session | Writes need exactly one `Origin` equal to themarr's own, exactly one `Sec-Fetch-Site: same-origin`, `Content-Type: application/json` (not a simple-request type), and `If-Match`; no CORS on admin routes | TestWriteChecks |
| Lost updates between two admin tabs | Every write names the store version it read (`If-Match`); a stale one gets 412; writes are serialised by one mutex | TestStaleWriteAfterAnotherWrite, TestConcurrentWrites; `internal/store` TestConcurrentWrites, TestStaleVersionConflicts |
| A crash or full disk corrupting the store | Temp file in the same directory, fsync, rename, fsync of the directory; a failed write leaves the snapshot and the file as they were | `internal/store` TestWriteAndReload, TestFailedWriteChangesNothing, TestUnwritableDirKeepsTheSnapshot |
| Starting on a damaged store and overwriting it | A store file that doesn't parse, has another format, unknown fields, an invalid theme or a dangling reference stops the start; the file is left as it is | `internal/store` TestCorruptFileIsRefusedAndKept; `cmd/themarr` TestCorruptStoreStopsStartAndIsKept |
| A malformed or hostile theme reaching apps | The server validates every theme with the token rules of `packages/tokens` (strict objects, known tokens only, sRGB colours in range, hex agreeing with components); bodies are one object, valid UTF-8, no repeated keys, bounded size and depth | `internal/theme` TestValidFixtures, TestInvalidFixtures (the shared golden fixtures), TestRulesBeyondTheFixtures, TestUnacceptableJSON; TestPutThemeRefuses |
| The public answer leaking more than colours | The public body is `version`, `modes` and `tokens` only (decision 0004): no name, source, seeds, assignments, apps or origins | `internal/theme` TestPublicHoldsColoursOnly; `internal/server` TestPublicBodyHoldsColoursOnly |
| Enumerating registered apps | An unknown app id is answered exactly like a registered app without an assignment (global default or 204) | TestNothingSetIs204, TestResolutionOrder |
| Memory growth from made-up app ids | The last check is kept only for registered apps and dropped when an app is deleted | TestLastCheck |
| Theme bodies in logs | One audit line per write attempt: who, what, result, never the body | TestAuditLine |
| The admin UI framed (clickjacking) or loading foreign code | `X-Frame-Options: DENY` and `frame-ancestors 'none'` everywhere but `/drawer` (below); the UI's CSP allows its own origin only; API answers `default-src 'none'` | TestCommonHeaders; `internal/webui` TestServesIndexWithCSP |
| Admin answers cached by a proxy or the browser | `Cache-Control: no-store` on everything but the public routes and the UI | TestCommonHeaders |
| Plain HTTP on the network | The API listener is TLS only; the plain health listener must be a loopback IP (config validation), is never published, and serves only `GET /healthz` | `internal/config` TestValidateRefuses; `cmd/themarr` TestHealthcheck, TestHealthListenerServesOnlyHealthz |
| Slow or huge requests holding connections | Read-header, read, write and idle timeouts; 16 KiB of headers; body limits of 128 KiB (themes) and 32 KiB (others); at most 500 themes and 200 apps | `cmd/themarr/main.go`; TestPutThemeRefuses; `internal/store` TestRulesAreKept |
| A compromised dependency | No Go modules beyond the standard library; a static binary on an empty image, run as user 65532 | `go.mod` (no requirements); `Dockerfile` |

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
| Lost updates on the prefs file | One version, `If-Match`, one writer at a time; a stale write is 412 | TestConcurrentPreferenceWrites; `internal/prefs` TestConcurrentWrites, TestStaleVersionConflicts |
| A crash or a damaged prefs file | The store's atomic write (`store.WriteAtomic`); a file that doesn't parse, has unknown fields, another format, a bad name or kind stops the start and is left as it is | `internal/prefs` TestWriteAndReload, TestUnwritableDirKeepsTheSnapshot, TestCorruptFileIsRefusedAndKept; `cmd/themarr` TestCorruptPrefsStopsStartAndIsKept |
| Signed-in users growing the prefs file | Choices only for registered apps; at most 1000 users with choices, 200 choices each, 1000 policies per scope; bodies at most 32 KiB | `internal/prefs` TestRulesAreKept; TestPreferenceRoutes, TestWriteChecks |
| A policy or choice naming a deleted theme | Deleting a theme a policy names is `409 in_use`; whatever still names a missing theme (a saved choice, or a policy written during the delete) is skipped by the resolver | TestThemeDeleteInUse; `internal/server` TestThemeInUseOutsideTheStore; `internal/resolve` TestMissingThemeIsSkipped |
| Policies reaching anonymous visitors through forged headers | The public route resolves without identity; policies and choices never apply there | TestPublicRouteIgnoresPolicies; `internal/resolve` TestNobodyGetsOnlyTheAppLayers |
| Preference and policy bodies in logs | One audit line per write attempt: user, action, target, status, code, prefs version; never the body | TestAuditLines |

### The in-app drawer (decision 0009)

Server tests are in `internal/server`; SDK tests in
`packages/web/test/drawer`.

| Threat | Defence | Kept true by |
| --- | --- | --- |
| Another site framing a signed-in themarr page (clickjacking an admin's session) | Only GET and HEAD of `/drawer` may be framed (`frameable`), and only by the exact origins registered for the app in `?app=` (`frame-ancestors`, no wildcard); a missing, repeated, invalid or unregistered app, or one without origins, gets `frame-ancestors 'none'` and `X-Frame-Options: DENY`; every other answer keeps `DENY` and `'none'` | TestDrawerFrameAncestorsAreTheAppsOrigins, TestDrawerWithoutARegisteredAppIsNeverFramed, TestOnlyTheDrawerIsFramable, TestFrameable, TestDrawerWithoutAPageIs404AndDenied; `cmd/themarr` TestServe |
| A header injected through an app's origin | Origins are checked by the store's rules, and again against a strict `https://host[:port]` pattern before they go into the header | `frameOrigin` in `internal/server/drawer.go`; TestDrawerFrameAncestorsAreTheAppsOrigins |
| The app (or a script on it) using the person's rights | Every save happens inside themarr's page, same origin, with the write checks; the app only previews and refreshes on the page's messages; no write route has CORS | TestWriteChecks; the SDK has no write call (`src/drawer/frame.ts`) |
| A forged message changing the app's theme (another window, another origin, a navigated iframe) | The SDK accepts a message only when `event.origin` is themarr's exact origin, `event.source` is its own iframe's window, and the data is exactly one protocol shape (a preview's theme through the token rules); anything else is ignored | "ignores messages from another origin, another window, or of another shape"; `protocol.test.ts` |
| The SDK's messages read by another frame | It posts only to its own iframe, with `targetOrigin` themarr's exact origin, never `*` | "answers ready with hello, posted to the exact themarr origin", "keepLocal keeps the theme..." |
| The drawer page navigating the app | `sandbox` without `allow-top-navigation` on the iframe | "frames /drawer?app=<id> with a sandbox that can't navigate the app" |
| A preview outliving the drawer, or kept without consent | A preview is a second CSS text in this tab only; `clearPreview` and closing remove it; nothing is stored or sent | "preview changes this tab only; ...", "Reset and closing restore..." |
| A locked person keeping another theme through the drawer | `keepLocal` is ignored while locked (boot also ignores the local override then) | "a locked person can preview but not keep" |
| Theme names or app CSS injecting into the drawer, or the drawer breaking the app | All drawer DOM is in one shadow root; names go in as text only; colours only as checked `#RRGGBB` custom properties; styles as a constructable sheet or a nonce'd `<style>` | "lists the catalog: ... names as text", "uses a <style> with the nonce ..." |
| The catalog leaking more than names and colours, or reading forged identity | `/v1/catalog` holds id, name, version, modes, swatch colours and favourites only, and never reads `Remote-*` | TestCatalogShapeAndSort, TestCatalogIgnoresRemoteHeaders |

## What themarr assumes about the hops before it

- **NPM and Authelia set the identity headers.** On routes behind Authelia,
  NPM's `auth_request` snippet overwrites `Remote-User` and `Remote-Groups`
  with Authelia's answer, so a browser can't supply its own. On the public
  bypass it doesn't, which is why public routes ignore them.
- **tls-gateway is the only holder of the `tls-gateway` client key.** The CN
  pin is only as strong as that key. The home CA must never issue another
  certificate with that CN (`/etc/paseo/cert-names-denied`).
- **The Authelia bypass covers only** `GET|HEAD /v1/apps/{app}/theme`,
  `GET|HEAD /v1/themes/{id}/tokens` and `GET|HEAD /v1/catalog`
  (decision 0009). Everything else, the UI included, needs
  a session; admin routes need the admins group with two-factor.
  `/v1/me/` and `/drawer` need a session of any user; `/v1/policies` is an
  admin route (admins, two-factor). A bypass rule that matched `/v1/me/`
  would let anybody forge `Remote-User` there.
- **The Authelia session cookie reaches themarr from app pages.** Apps on
  `*.coolroo.dev` are same-site with themarr, so `credentials: "include"`
  sends the cookie. When Authelia answers instead of themarr (no session),
  it has no CORS headers and the SDK falls back to the public route.

## Still open

- **Certificate rotation needs a restart.** The server certificate and the
  client CA are read at start (as in Enforcarr).
- **The drawer page itself (T-119)** must keep the protocol's rules on its
  side: accept `hello` only from `window.parent` and through
  `parseAppMessage`, and post later messages only to the origin that hello
  came from (contract.md, "The drawer page"). Its rows here grow with it.
- **A registered origin may frame the drawer.** A script on a registered
  app origin can show themarr's page to a signed-in person inside that app
  and overlay it; every write still needs a click inside the page, and
  admin writes need two-factor.
- **Prefs writes share one version**, so two people saving at the same
  moment make one of them retry (412). Per-user versions can come later
  (decision 0007).
- **A registered origin is trusted with its users' themes.** A script on a
  registered app origin (an XSS there) can read the signed-in person's
  theme for that app, and nothing else: colours, `source` and `locked`.
- **Review.** An adversarial security review comes before v0.1.0 (T-115).
