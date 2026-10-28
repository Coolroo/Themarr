# 0001: A Go server, TypeScript for everything that runs in a browser

Date: 2026-10-28. Task: T-116. Asked by: the owner, decision 1 of the plan
(2026-10-24, [Themarr plan: summary](https://docs.coolroo.dev/doc/themarr-plan-summary-UUGI0CdvZs)):
"Go server on Enforcarr's pattern, TypeScript SDK and admin UI."

## Decision

- **The server is Go, standard library only**, built like Enforcarr: a static
  binary on a scratch image, `crypto/tls` for mutual TLS, `net/http` for the
  routes, RFC 9457 problem details with a stable `code`, strict JSON, tests in
  Docker (`scripts/test.sh`). Enforcarr's `tlsutil` and `testutil` are copied,
  not imported (Enforcarr is a private module).
- **The SDK, the admin UI, the palette and the example screens are
  TypeScript.** They run in browsers, and the palette needs Material Color
  Utilities, which exists only in TypeScript (decision 0003).
- **One contract between them: `packages/tokens`.** The token list lives in
  TypeScript (`src/tokens.ts`). Two files are generated from it and checked in:
  `tokens.manifest.json`, which the Go server embeds, and
  `schema/theme.schema.json`. A test fails when either differs from the code.
  The golden fixtures in `packages/tokens/fixtures/` are read by the Go tests
  and the TypeScript tests, so both sides must accept and refuse the same
  themes with the same error codes.
- **TypeScript runs without a build step in tests.** Node 24 strips types, so
  `node --test` runs `.ts` files directly. Code uses erasable syntax only (no
  `enum`, `namespace` or parameter properties); `tsc --noEmit` with
  `erasableSyntaxOnly` enforces it.
- **Pinned tools for `packages/tokens`:** `typescript` 5.9.3 (released
  2025-09-30) and `@types/node` 24.19.2 (2026-10-09, for `node:test` and
  `node:fs` types; it brings `undici-types` 7.24.6, 2026-03-25). Both are
  development dependencies; the package has no runtime dependency. TypeScript
  6 and 7 exist; 5.9 is the last line whose defaults and options every agent
  here knows, and nothing in this repo needs the newer ones yet.

## Rejected

- **TypeScript on the server (Node):** a second runtime to patch on the host,
  and a weaker standard library for mutual TLS and certificate checks than Go's.
  The server's job (store, check, serve JSON) needs no browser code.
- **Go everywhere (palette in Go):** no maintained Go port of Material Color
  Utilities exists (decision 0003), and the SDK must run in the browser anyway.
- **A JSON Schema library in Go to share the schema:** a dependency for a
  check that is a page of code. The server checks themes against the embedded
  manifest and the fixtures instead.
- **A test framework (vitest, jest):** `node --test` does the job with no
  download.
