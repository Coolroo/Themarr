# Architecture

Themarr is a Go server, a TypeScript SDK that apps embed, an admin UI and a set
of example app screens. The owner's plan, with diagrams and every decision, is
in Outline: [Themarr plan](https://docs.coolroo.dev/doc/themarr-plan-2vsZbriBuK).
This page keeps the facts an agent needs while coding; it grows with the code.

## Request paths

- **Boot (public):** browser → NPM (homepi, Authelia bypass for
  `GET|HEAD /v1/apps/{app}/theme` only) → tls-gateway (mutual TLS, client
  certificate `tls-gateway`) → themarr `:8443`.
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

## Data

One JSON file in the data folder (`/data` in the container,
`/mnt/ssd/appdata/themarr/data` on home-server). Themes are instance data and
never live in git.
