# 0000: One repo, Go at the root, npm workspaces for TypeScript

Date: 2026-10-28. Task: T-114. Asked by: the owner (the plan in Outline,
[Themarr plan](https://docs.coolroo.dev/doc/themarr-plan-2vsZbriBuK)).

## Decision

- One private repo, `Coolroo/themarr`, holds the server, the SDK, the admin UI
  and the example modules, so a change to the token schema and its users lands
  in one commit.
- The Go module is at the root (`github.com/Coolroo/themarr`), laid out like
  Enforcarr (`cmd/`, `internal/`, `docs/`, `scripts/test.sh`).
- TypeScript packages are **npm workspaces** under `packages/`. npm ships with
  Node, so the build needs no other package manager to download. (The plan
  named pnpm; npm workspaces do the same job with one tool less.)
- TypeScript tests use Node's built-in runner (`node --test`), with no test
  framework, unless a package shows a real need.
- Pinned images: `golang:1.27.1-alpine3.24` (as Enforcarr) and
  `node:24.22.1-bookworm-slim`.

## Rejected

- Two repos (server, SDK): token changes would need two coordinated releases.
- pnpm: a second tool to fetch and pin, for features this repo doesn't use.
