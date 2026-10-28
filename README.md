# themarr

One place to keep the homelab's themes. Apps embed a small TypeScript SDK that
asks themarr for their theme while they boot, before they draw:

- a theme is set: the app starts already in it;
- nothing is set: the app starts on its own defaults;
- themarr can't be reached: after at most one second the app starts on its own
  defaults and warns in the console.

A theme is built from one accent colour (the admin UI makes the light and dark
palettes with Material Color Utilities) or set colour by colour by hand. People
can preview and choose themes inside each app through a small drawer, and admins
can set or enforce themes per user and group.

**Status:** being built (board tasks T-085 to T-090, T-114 to T-120). Nothing is
deployed.

## Parts

| Part | Where | Language |
|---|---|---|
| Server: store, API, TLS | `cmd/themarr`, `internal/` | Go, standard library |
| Token schema, names, fixtures | `packages/tokens` | JSON Schema, TypeScript |
| SDK: boot hook, drawer | `packages/web` | TypeScript, no dependencies |
| Palette from an accent | `packages/palette` | TypeScript |
| Admin UI | `packages/admin` | TypeScript |
| Example app screens | `packages/examples` | TypeScript |

## Tests

```sh
scripts/test.sh       # gofmt, vet, go test -race, in golang:1.27.1-alpine3.24
scripts/test-ts.sh    # npm ci, type check, node --test, in node:24.22.1-bookworm-slim
```

Docs: `docs/architecture.md`, `docs/decisions/`. The plan for the owner is in
Outline: [Themarr plan](https://docs.coolroo.dev/doc/themarr-plan-2vsZbriBuK).
