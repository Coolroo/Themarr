# Architecture

Themarr is a Go server, a TypeScript SDK that apps embed, an admin UI and a set
of example app screens. The owner's plan, with diagrams and every decision, is
in Outline: [Themarr plan](https://docs.coolroo.dev/doc/themarr-plan-2vsZbriBuK).
This page keeps the facts an agent needs while coding; it grows with the code.

## Request paths

- **Boot (public):** browser → NPM (homepi, Authelia bypass for
  `GET|HEAD /v1/apps/{app}/theme` and `GET|HEAD /v1/themes/{id}/tokens`
  only) → tls-gateway (mutual TLS, client certificate `tls-gateway`) →
  themarr `:8443`.
- **Signed in:** the same path with Authelia in front; themarr trusts
  `Remote-User` and `Remote-Groups` only on that hop, and only on routes that
  need them.
- **Health:** `127.0.0.1:8081/healthz`, plain HTTP, loopback only.

## Parts and owners (board tasks)

| Part | Paths | Task |
|---|---|---|
| Token schema, names, fixtures, decisions 0001-0005 | `packages/tokens/**`, `docs/decisions/**` | T-116 |
| Server: store, API, TLS | `cmd/**`, `internal/**` except `identity`, `resolve`, `prefs` | T-086 |
| SDK boot hook | `packages/web/**` except `src/drawer/**` | T-118 |
| Per-user themes | `internal/identity/**`, `internal/resolve/**`, `internal/prefs/**` | T-089 |
| Example modules | `packages/examples/**` | T-087 |
| SDK drawer | `packages/web/src/drawer/**` | T-085 |
| Palette and admin UI | `packages/palette/**`, `packages/admin/**` | T-119 |
| Security review, v0.1.0 | fixes anywhere | T-115 |

## The server (Go, standard library only)

Routes, headers and errors: [contract.md](contract.md). Threats and the tests
that hold each defence: [security.md](security.md).

| Package | What |
|---|---|
| `cmd/themarr` | Flags (env fallbacks), `-check`, `-healthcheck`, `-version`; the two listeners and shutdown |
| `internal/config` | Settings and their checks (health listener on loopback only, https origin) |
| `internal/tlsutil` | The listener's TLS config (1.3, client certificate required, home CA) and `VerifiedCN`; the guard test |
| `internal/server` | The CN gate, public routes, admin routes, write checks, audit lines, last checks |
| `internal/store` | The JSON file, snapshots, `Update(expectedVersion, fn)`, the store's rules |
| `internal/theme` | A theme's shape and its validator, a port of `packages/tokens/src/validate.ts` against the embedded manifest |
| `internal/strictjson` | Strict body decoding (from Enforcarr) |
| `internal/webui` | The admin UI from `embed.FS` (`dist/`: a placeholder until T-119) |
| `internal/testutil` | Per-test CAs and certificates (from Enforcarr) |

- **The token manifest** is embedded from `internal/theme/manifest.json`, a
  copy of `packages/tokens/tokens.manifest.json` (go:embed can't reach
  outside the package). `TestManifestCopyMatchesSource` fails when they
  differ: after regenerating the tokens package, copy the file again. The
  theme tests run every golden fixture in `packages/tokens/fixtures`.
- **Seams for per-user themes (T-089).** `server.Options` takes a
  `Resolver` (which theme an app gets, from one store snapshot), an
  `Identify` (who the caller is; default `RemoteHeaders`) and extra
  `Routes` (mounted behind the same gate and headers). `cmd/themarr/main.go`
  wires them. Exported helpers: `Problem`, `ProblemWith`, `WriteJSON`,
  `RequestID`.
- **Snapshots.** Readers take the current `*store.Data` without locking;
  a write copies it, applies the change, checks the rules, saves, then
  publishes the new snapshot. A snapshot is never changed after that.

## Data

One JSON file, `themarr.json`, in the data folder (`/data` in the
container, `/mnt/ssd/appdata/themarr/data` on home-server). Themes are
instance data and never live in git.

```json
{"format": 1, "version": 12,
 "themes": {"ocean": {"id": "ocean", "name": "...", "version": 3, "source": {}, "modes": [], "tokens": {}}},
 "apps": {"board": {"id": "board", "name": "Board", "origins": ["https://board.coolroo.dev"]}},
 "assignments": {"global": "ocean", "perApp": {"board": "none"}},
 "favourites": ["ocean"]}
```

`version` is the store version, the admin routes' `ETag` and `If-Match`. A
file themarr can't read stops the start and is left as it is.
