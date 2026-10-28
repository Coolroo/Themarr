# Architecture

Themarr is a Go server, a TypeScript SDK that apps embed, an admin UI and a set
of example app screens. The owner's plan, with diagrams and every decision, is
in Outline: [Themarr plan](https://docs.coolroo.dev/doc/themarr-plan-2vsZbriBuK).
This page keeps the facts an agent needs while coding; it grows with the code.

## Request paths

- **Boot (public):** browser → NPM (homepi, Authelia bypass for
  `GET|HEAD /v1/apps/{app}/theme`, `GET|HEAD /v1/themes/{id}/tokens` and
  `GET|HEAD /v1/catalog` only) → tls-gateway (mutual TLS, client
  certificate `tls-gateway`) → themarr `:8443`.
- **Signed in:** the same path with Authelia in front; themarr trusts
  `Remote-User` and `Remote-Groups` only on that hop, and only on routes that
  need them (admin, `/v1/me/...`, `/v1/policies`).
- **Boot (personal):** the SDK also asks `GET /v1/me/apps/{app}/theme`
  with the person's Authelia cookie (credentialed CORS, registered app
  origins only). NPM must keep Authelia (any signed-in user) in front of
  `/v1/me/`; if Authelia redirects, the SDK uses the public answer.
- **Drawer (decision 0009):** an app booted with `drawer: true` shows a
  themarr button. For a signed-in person (the personal answer was 200 or
  204) it frames `GET /drawer?app=<id>`, behind Authelia; the page saves
  same-origin and tells the SDK what to preview with `postMessage`. For a
  guest the SDK draws a local panel from the public `GET /v1/catalog` and
  `GET /v1/themes/{id}/tokens`, and keeps a choice in localStorage only.
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
| `internal/server` | The CN gate, public routes (theme, tokens, catalog), admin routes, write checks, audit lines, last checks, the `/drawer` page and its framing rule (`drawer.go`) |
| `internal/store` | The JSON file, snapshots, `Update(expectedVersion, fn)`, the store's rules |
| `internal/theme` | A theme's shape and its validator, a port of `packages/tokens/src/validate.ts` against the embedded manifest |
| `internal/strictjson` | Strict body decoding (from Enforcarr) |
| `internal/webui` | The admin UI and the drawer page from `embed.FS`. git holds placeholder `dist/index.html` and `dist/drawer.html` for the Go tests (`dist/` is gitignored: `git add -f`); the image embeds the built UI (below) |
| `internal/testutil` | Per-test CAs and certificates (from Enforcarr) |
| `internal/identity` | Who is asking: the `Source` interface and its first module, `Authelia` (`Remote-User`, `Remote-Groups`) |
| `internal/prefs` | `prefs.json`: saved choices (user → app → theme) and user and group policies, with the store's write rules |
| `internal/prefs/prefsapi` | The `/v1/me/...` and `/v1/policies` routes, mounted through `Options.Routes` |
| `internal/resolve` | The layered resolver: one function per layer, in `resolve.Layers` (decision 0007) |

- **The token manifest** is embedded from `internal/theme/manifest.json`, a
  copy of `packages/tokens/tokens.manifest.json` (go:embed can't reach
  outside the package). `TestManifestCopyMatchesSource` fails when they
  differ: after regenerating the tokens package, copy the file again. The
  theme tests run every golden fixture in `packages/tokens/fixtures`.
- **Seams for per-user themes.** `server.Options` takes a `Resolver`
  (which theme an app gets on the public route, from one store snapshot:
  `resolve.Public`), an `Identify` (who the caller is: an
  `identity.Source`'s `Identify`; default `RemoteHeaders`, which is
  `identity.Authelia`), extra `Routes` (mounted behind the same gate and
  headers: `prefsapi`) and `ThemeInUse` (a policy names the theme, so its
  delete is 409). `cmd/themarr/main.go` wires them. Exported helpers for
  route packages: `Problem`, `ProblemWith`, `WriteJSON`, `RequestID`,
  `CheckWrite` (Origin, Sec-Fetch-Site, If-Match with a tag prefix),
  `ReadJSON`, `NoBody`, `NoneMatch`, and `ProblemRecorder` (a writer that
  learns the problem code, for audit lines). `store.WriteAtomic` is the
  store's atomic file write, which `prefs` uses too.
- **Adding an identity module:** implement `identity.Source`, keep its
  checks strict (refuse, never merge, a repeated header), and pass it to
  both `server.Options.Identify` and `prefsapi.Config.Identity` in
  `main.go`. **Adding a layer:** write one `resolve.Layer` function and
  put it in `resolve.Layers`.
- **Snapshots.** Readers take the current `*store.Data` without locking;
  a write copies it, applies the change, checks the rules, saves, then
  publishes the new snapshot. A snapshot is never changed after that.

## The admin UI and the drawer page (TypeScript, decision 0010)

`packages/admin`: Preact, bundled by esbuild; `packages/palette` makes a
seeded theme's tokens with Material Color Utilities (decision 0003).

- **Build:** `npm run build -w @themarr/admin` (the Dockerfile's `ui` stage)
  regenerates the example registry, builds the SDK, and writes
  `internal/webui/dist`: `index.html`, `drawer.html`,
  `assets/app-<hash>.{js,css}`, `assets/drawer-<hash>.{js,css}` (and their
  `.LEGAL.txt`), `sdk/themarr.js`, `sdk/themarr.d.ts`. Run it in a copy
  (`themarr-build.sh ts build`): in a checkout it overwrites the placeholders.
- **Routes in the browser:** `/` and `/themes`, `/editor/new`,
  `/editor/<id>`, `/apps`, `/people`, `/examples?theme=&example=`,
  `/add?app=`. The server answers each with `index.html`.
- **Code:** `src/api.ts` (the client: ETags, If-Match, refusals, reload on
  an ended session), `src/data.tsx` (one snapshot at one store version, the
  writes), `src/logic/*.ts` (pure: editor model, contrast rows, picker,
  resolution, people, drawer, routes; the tests run them), `src/pages/*`,
  `src/components/*` (the swatch `ThemePicker`, `ExampleFrame`, dialogs),
  `src/drawer/*` (the drawer page), `src/styles.css`.
- **CSP:** no inline script or style; data colours are custom properties
  set through the CSSOM. The drawer page loads only
  `/assets/drawer-<hash>.{js,css}` (Authelia allows that one pattern for
  every signed-in user); the build checks both.
- **Themed by itself:** the UI boots the SDK for app id `themarr` and reads
  `--themarr-*` with its own fallbacks; dark mode follows the system.

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

A second file, `prefs.json`, in the same folder, holds what people and
admins choose (decision 0007), with its own version (ETags `"p<version>"`):

```json
{"format": 1, "version": 4,
 "choices": {"alice": {"board": "ocean"}},
 "policies": {"users": {"bob": {"theme": "night", "kind": "enforced"}},
              "groups": {"family": {"theme": "forest", "kind": "default"}}}}
```

The same rules hold: atomic writes, one writer at a time, `If-Match`, and a
file that can't be read stops the start. Unlike the store, a prefs write
conflicts only with changes to its own part (`prefs.Part`: the policies,
or one person's choice for one app; the versions of the last change of
each are kept in memory), and a write that changes nothing is not
written (T-115). Names are Authelia's; themarr
never stores who is in which group. Theme ids here may name a theme deleted
later; the resolver skips them.
