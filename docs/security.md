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
| The admin UI framed (clickjacking) or loading foreign code | `X-Frame-Options: DENY` and `frame-ancestors 'none'` everywhere; the UI's CSP allows its own origin only; API answers `default-src 'none'` | TestCommonHeaders; `internal/webui` TestServesIndexWithCSP |
| Admin answers cached by a proxy or the browser | `Cache-Control: no-store` on everything but the public routes and the UI | TestCommonHeaders |
| Plain HTTP on the network | The API listener is TLS only; the plain health listener must be a loopback IP (config validation), is never published, and serves only `GET /healthz` | `internal/config` TestValidateRefuses; `cmd/themarr` TestHealthcheck, TestHealthListenerServesOnlyHealthz |
| Slow or huge requests holding connections | Read-header, read, write and idle timeouts; 16 KiB of headers; body limits of 128 KiB (themes) and 32 KiB (others); at most 500 themes and 200 apps | `cmd/themarr/main.go`; TestPutThemeRefuses; `internal/store` TestRulesAreKept |
| A compromised dependency | No Go modules beyond the standard library; a static binary on an empty image, run as user 65532 | `go.mod` (no requirements); `Dockerfile` |

## What themarr assumes about the hops before it

- **NPM and Authelia set the identity headers.** On routes behind Authelia,
  NPM's `auth_request` snippet overwrites `Remote-User` and `Remote-Groups`
  with Authelia's answer, so a browser can't supply its own. On the public
  bypass it doesn't, which is why public routes ignore them.
- **tls-gateway is the only holder of the `tls-gateway` client key.** The CN
  pin is only as strong as that key. The home CA must never issue another
  certificate with that CN (`/etc/paseo/cert-names-denied`).
- **The Authelia bypass covers only** `GET|HEAD /v1/apps/{app}/theme` and
  `GET|HEAD /v1/themes/{id}/tokens`. Everything else, the UI included, needs
  a session; admin routes need the admins group with two-factor.

## Still open

- **Certificate rotation needs a restart.** The server certificate and the
  client CA are read at start (as in Enforcarr).
- **Per-user themes (T-089)** add credentialed CORS for registered app
  origins and a `/drawer` that may be framed by them; both need their own
  rows here, and the `frameable` hook in `internal/server` must stay limited
  to `/drawer`.
- **Review.** An adversarial security review comes before v0.1.0 (T-115).
