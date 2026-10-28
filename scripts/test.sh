#!/bin/sh
# Format check, vet and Go tests (with the race detector) inside the pinned Go
# image, so nothing needs Go installed. Run from the repo root:
#   scripts/test.sh                       everything
#   scripts/test.sh ./internal/store/...  one package
# HEAVY_LOCK=/path/to/lock waits on that lock first (one heavy job at a time);
# MEMORY caps the container (default 2g); GO_IMAGE picks another image with gcc.
set -eu
GO_IMAGE="${GO_IMAGE:-golang:1.27.1-alpine3.24}"
PKGS="${*:-./...}"
LOCK=""
[ -n "${HEAVY_LOCK:-}" ] && LOCK="flock $HEAVY_LOCK"
MSYS_NO_PATHCONV=1 $LOCK docker run --rm --memory "${MEMORY:-2g}" \
  -v "$(pwd):/src" -w /src \
  -v themarr-gomod:/go/pkg/mod -v themarr-gocache:/root/.cache/go-build \
  -e CGO_ENABLED=1 -e GOFLAGS=-mod=mod \
  "$GO_IMAGE" sh -c "
    command -v gcc >/dev/null || apk add --no-cache gcc musl-dev >/dev/null
    unformatted=\$(gofmt -l .) && if [ -n \"\$unformatted\" ]; then echo \"gofmt needed:\"; echo \"\$unformatted\"; exit 1; fi
    go vet $PKGS && go test -race -count=1 $PKGS
  "
