# Themarr: a static Go binary on an empty base, running as a non-root user.
# Build:  docker build --build-arg VERSION=0.1.0 -t themarr-local:0.1.0 .
#
# Stage "ui" builds the admin UI and the drawer page (packages/admin,
# decision 0010) into internal/webui/dist; the Go stage embeds them. The
# files in git under internal/webui/dist are placeholders for the Go tests.
# Build from a clean checkout: COPY packages takes any node_modules with it.

FROM node:24.22.1-bookworm-slim AS ui
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci --no-audit --no-fund
# Regenerates the example registry, builds the SDK (packages/web/dist, served
# at /sdk/), then bundles the UI into internal/webui/dist.
RUN npm run build -w @themarr/admin

FROM golang:1.27.1-alpine3.24 AS build
WORKDIR /src
# No go.sum: the server uses the standard library only.
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
COPY --from=ui /src/internal/webui/dist ./internal/webui/dist
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/themarr ./cmd/themarr \
 && mkdir -p /out/data

FROM scratch
COPY --from=build /out/themarr /themarr
# The data directory, owned by the runtime user; bind-mount the host's over it.
COPY --from=build --chown=65532:65532 /out/data /data
USER 65532:65532
EXPOSE 8443
VOLUME /data
# Plain HTTP to 127.0.0.1:8081 inside the container only (never published):
# a TLS self-check would need a client certificate.
HEALTHCHECK --interval=60s --timeout=10s --start-period=10s --retries=3 CMD ["/themarr", "-healthcheck"]
ENTRYPOINT ["/themarr"]
