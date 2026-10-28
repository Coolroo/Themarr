# @themarr/admin

The admin UI (themes, the editor, apps, people, examples, "Add to an app")
and the drawer page (`/drawer`, inside the SDK's iframe). Preact, bundled by
esbuild. Decision [0010](../../docs/decisions/0010-admin-ui.md);
architecture: [docs/architecture.md](../../docs/architecture.md), "The admin
UI and the drawer page".

```sh
scripts/test-ts.sh          # typecheck; node --test: api, logic (editor, contrast, picker, ...)
scripts/test-ts.sh build    # writes internal/webui/dist (run it in a copy: it replaces the placeholders)
```

- The build regenerates the example registry and builds the SDK first, so
  a new example folder or SDK change needs nothing else.
- Every page must keep the CSP (`default-src 'self'`): no inline script, no
  `<style>`, no `style` attribute. Set data colours as custom properties
  through a Preact style object; read them in `src/styles.css`.
- The drawer page may load only `/assets/drawer-<hash>.{js,css}` (Authelia
  lets every signed-in user reach that pattern only); the build fails
  otherwise. It calls only `/v1/catalog`, `/v1/themes/<id>/tokens` and
  `/v1/me/...` for non-admins.
- Pure logic lives in `src/logic/*.ts` (no JSX, no DOM) so `node --test` can
  run it; components in `src/components`, pages in `src/pages`.
