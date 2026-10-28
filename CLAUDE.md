# Working in this repo

Themarr keeps the homelab's themes and serves each app its theme. Apps take
it through a small SDK at boot. Keep it small, boring and verified: a theme
service runs in every app's first second.

The plan and the owner's decisions are in Outline:
[Themarr plan](https://docs.coolroo.dev/doc/themarr-plan-2vsZbriBuK). The
design (every screen) is
[Themarr design](https://claude.ai/artifact/6TyiEjCYBEH1WLzkpckzHe).

## Work tracking

Work is tracked on the home-server agent board (run `agent-board` from the
home-server repo; tasks T-085 to T-090 and T-114 to T-120). Claim there before
editing, with only the paths you will touch, and end every claim with done,
release or park.

## Layout

- `cmd/themarr`, `internal/...`: the Go server (one module at the root).
- `packages/*`: npm workspaces in TypeScript: `tokens` (schema, names,
  fixtures), `web` (the SDK), `palette`, `admin`, `examples`.
- `docs/`: architecture, contract, security, `decisions/NNNN-*.md`.
- `scripts/test.sh` (Go) and `scripts/test-ts.sh` (TypeScript) run everything
  inside pinned images, so nothing needs Go or Node installed.

## Rules

- **TLS everywhere, always verified.** The server serves TLS only. Never add
  `InsecureSkipVerify`, `VerifyPeerCertificate` or `VerifyConnection`; a test
  fails the build if any non-test Go file mentions them. Never add a plain
  `http://` URL, except the loopback health check.
- **Deny by default.** A route refuses unless every check holds: the client
  certificate's CN, the caller's group, the Origin, the content type and the
  version (`If-Match`).
- **Public means colours only.** The public theme route returns tokens and a
  version, nothing about users, apps' origins or assignments.
- **No secrets in logs or answers.** Keys live in files (`*_file`).
- **Every behaviour has a test.** Run both test scripts before every commit.
  Go test servers get their own CA per server (copy `testutil` from
  Enforcarr), never httptest's shared certificate.
- **Dependencies:** standard library and Node built-ins first. Each new
  module or npm package needs a reason in `docs/decisions/` and a release at
  least two weeks old. Pin exact versions.
- **The SDK has no runtime dependencies** and stays one file.
- **Commit by path** (`git commit -m "..." -- <paths>`), and `git add` new
  files first: a by-path commit leaves untracked files out. LF line endings
  (`.gitattributes`).
- **Builds in the Paseo sandbox:** one heavy job at a time. The scripts take
  `HEAVY_LOCK` (a lock file) and `MEMORY` (default 2g) for `docker run`.
