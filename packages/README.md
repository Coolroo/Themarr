# packages

npm workspaces, one folder each:

- `tokens`: the theme JSON Schema, token names, golden fixtures (T-116)
- `web`: the SDK, `@themarr/web`: the boot hook (T-118, built: one file in `dist/`) and the drawer (T-085)
- `palette`: a seeded theme's tokens from Material Color Utilities (T-119, decision 0003)
- `admin`: the admin UI and the drawer page, built into `internal/webui/dist` (T-119, decision 0010)
- `examples`: example app screens, one folder of plain HTML and CSS per screen, and `mountExample` (T-087, built)
