#!/bin/sh
# Install the locked npm packages, type-check and test every workspace inside
# the pinned Node image, so nothing needs Node installed. Run from the repo root:
#   scripts/test-ts.sh                    npm ci, typecheck, test
#   scripts/test-ts.sh build              npm ci, then npm run build
# HEAVY_LOCK=/path/to/lock waits on that lock first (one heavy job at a time);
# MEMORY caps the container (default 2g); NODE_IMAGE picks another image.
set -eu
NODE_IMAGE="${NODE_IMAGE:-node:24.22.1-bookworm-slim}"
LOCK=""
[ -n "${HEAVY_LOCK:-}" ] && LOCK="flock $HEAVY_LOCK"
if [ "$#" -gt 0 ]; then STEPS="npm run $*"; else STEPS="npm run typecheck && npm test"; fi
INSTALL="npm ci --no-audit --no-fund"
[ -f package-lock.json ] || INSTALL="npm install --no-audit --no-fund"
MSYS_NO_PATHCONV=1 $LOCK docker run --rm --memory "${MEMORY:-2g}" \
  -v "$(pwd):/src" -w /src \
  -v themarr-npm-cache:/root/.npm \
  -e npm_config_update_notifier=false \
  "$NODE_IMAGE" sh -c "$INSTALL && $STEPS"
