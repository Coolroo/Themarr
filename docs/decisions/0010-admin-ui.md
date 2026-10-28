# 0010: The admin UI and the drawer page: Preact, bundled by esbuild, themed by themarr

Date: 2026-10-28. Task: T-119. Asked by: the owner (the plan,
[Themarr plan: summary](https://docs.coolroo.dev/doc/themarr-plan-summary-UUGI0CdvZs),
and the approved [Themarr design](https://claude.ai/artifact/6TyiEjCYBEH1WLzkpckzHe));
the stack is the lead's decision for T-119.

## Decision

- **Preact 10** (`preact` 10.29.8, MIT, released 2026-08-01) renders the
  admin UI (`packages/admin`) and the drawer page. Why: a 4 KiB runtime,
  JSX and hooks, ten years of releases, no dependencies. Preact 11 (2026-09)
  is newer than the two-week rule allows for a major line and brings nothing
  this UI needs.
- **esbuild bundles it** (`esbuild` 0.28.2, already pinned for the SDK,
  decision 0006), not Vite. The lead's brief named Vite; esbuild does every
  part the UI needs (TSX with `jsxImportSource: "preact"`, CSS bundling,
  content-hashed names, minifying, a metafile) with one package the repo
  already trusts. Vite 8 would add Rolldown, Lightning CSS, PostCSS and a
  dozen more packages (native binaries among them) for a dev server and HMR
  that can't run here anyway: there is no Node in the Paseo container, and
  the UI is useful only behind themarr's TLS listener and Authelia.
  `scripts/build.ts` is about 150 lines and checks its own output.
- **Material Color Utilities** (`@material/material-color-utilities` 0.4.0,
  Apache-2.0, released 2026-01-21) is the palette, in `packages/palette`
  (decision 0003). Its ES modules import ten files without `.js`; the
  bundle doesn't mind, and Node tests load it through a resolve hook
  (`packages/palette/src/node-hook.ts`, `module.registerHooks`) that adds
  `.js` to relative imports inside that package only. Type-checking uses
  `moduleResolution: "bundler"` for the same reason.
- **No other runtime dependency:** no router library (a 70-line history
  router), no CSS framework, no icon font, no state library.
- **The build** (`npm run build -w @themarr/admin`): it regenerates the
  example registry and builds the SDK first, then writes
  `internal/webui/dist/index.html`, `drawer.html`,
  `assets/app-<hash>.{js,css}`, `assets/drawer-<hash>.{js,css}` (each with
  a `.LEGAL.txt` of licence comments, never loaded) and `sdk/themarr.js` +
  `.d.ts` (the "Download" button). Two entry points, no shared chunks. Only
  these paths are replaced. The built files are not committed: git holds
  placeholders that the Go tests embed, and the Dockerfile's `ui` stage
  (node:24.22.1-bookworm-slim) builds the real ones before `go build`.
- **The drawer page loads only `^/assets/drawer-[A-Za-z0-9_-]+\.(js|css)$`.**
  Authelia lets any signed-in user reach `/drawer`, `/v1/me/...` and that
  pattern; everything else in the UI is admins-only. The build fails when
  `drawer.html` references anything else, or when those files could load
  another (`url()`, `@import`, `import()`, a worker). A non-admin's page uses
  only `/v1/catalog`, `/v1/themes/<id>/tokens` and `/v1/me/...`; an admin
  call that fails or is not JSON (Authelia's 403 or redirect) means "not an
  admin here": no Edit tab, no "Everyone on <app>".
- **CSP, `default-src 'self'` with no `'unsafe-inline'`:** the pages load
  one script and one stylesheet by URL; there is no inline script, no
  `<style>` and no `style` attribute in any markup. Colours that come from
  data (a theme's tokens in previews, swatches, tiles) are CSS custom
  properties set through the CSSOM (Preact's style object calls
  `style.setProperty`), which `style-src` doesn't govern; the stylesheet
  reads them (`--t-<token>`, `--sw-fill`). Examples are mounted with
  `mountExample` into shadow roots with constructed stylesheets
  (decision 0008). No fonts or images are fetched: system font stacks, inline
  SVG icons. The build fails if a bundle names any URL but the SVG/XML
  namespaces, so the UI calls only its own origin.
- **Themed by themarr:** before drawing, the UI calls the SDK's `boot` for
  app id `themarr` (`dark: "media"`). Every UI colour is
  `var(--themarr-<token>, <the design's colour>)`, with a second set of
  fallbacks under `prefers-color-scheme: dark`, so with no theme, or a theme
  without the current mode, the UI keeps its own look; dark mode follows
  the system. After each save the UI asks the SDK to refresh.
- **The API client** sends `If-Match` with the last `ETag` of the right kind
  (`"<n>"` store, `"p<n>"` prefs), keeps versions monotonic, reads all admin
  data at one store version (again if the ETags differ), says a clear
  sentence for each refusal, and on 412 or 404 reads the data again. A
  network error, a redirect (`redirect: "manual"`) or a non-JSON answer
  means the Authelia session ended: the page reloads, unless it reloaded in
  the last 15 s (then it says themarr can't be reached).
- **No dropdowns for themes** (the owner): a swatch button opens a popover
  of swatches (Inherit and None where they apply, favourites, every theme);
  hovering or focusing one grows it and opens a details card. Arrow keys
  move in the grid, Escape closes and returns the focus. Dialogs are native
  `<dialog>` elements (focus trap, Escape, focus return). Targets are 44 px.
  At phone width the navigation becomes a bottom bar and the popover a sheet.

## Rejected

- **Vite:** see above; nothing in this UI needs its dev server, and its
  dependency tree is the largest part of the supply chain we would add.
- **React:** ten times Preact's size for the same API here.
- **Lit or plain DOM:** no JSX; the editor's live state is far simpler with
  hooks.
- **A CSS framework (Tailwind):** its build step and class soup for a UI
  whose colours must all come from `--themarr-*` anyway.
- **`style` attributes with `'unsafe-inline'` in the CSP:** weakens the
  admin page's CSP for convenience; the CSSOM gives the same result.
- **Committing the built bundle:** generated files in git drift from their
  source; the image builds them.
