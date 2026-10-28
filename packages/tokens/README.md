# @themarr/tokens

The contract every other part of themarr follows: the token names, the theme
JSON Schema, a validator, the manifest the Go server embeds, and golden
fixtures. No runtime dependencies. Decisions: `docs/decisions/0002` (DTCG,
sRGB) and `0005` (sources, modes, `tag`).

## What is here

| Path | What |
|---|---|
| `src/tokens.ts` | The token list (`TOKENS`: name, group, kind, required, `on`), modes, source kinds, scheme styles, contrast levels, `cssVar(name)` → `--themarr-<name>` |
| `src/theme.ts` | The `Theme` type |
| `src/validate.ts` | `validateTheme(x)` → `{ok: true, theme}` or `{ok: false, errors, issues}`; `ERROR_CODES` |
| `src/contrast.ts` | WCAG contrast (`contrastRatio`, `themeContrasts`) for the tests and the admin UI |
| `src/manifest.ts`, `src/schema.ts` | Build the two generated files |
| `tokens.manifest.json` | Generated. Embedded by the Go server (T-086) |
| `schema/theme.schema.json` | Generated. JSON Schema draft 2020-12 |
| `fixtures/valid/*.json` | Themes every validator must accept |
| `fixtures/invalid/*.json` | One defect each; `EXPECTED.json` maps file → `{code, path}` |

After changing `src/tokens.ts` or the limits in `src/validate.ts`, run
`npm run generate -w @themarr/tokens` (any Node ≥ 22.18) and commit both
generated files; a test fails until you do.

## A theme

```json
{
  "id": "synth-fixture",
  "name": "Synth (Drives fixture)",
  "version": 1,
  "source": { "kind": "handmade" },
  "modes": ["dark"],
  "tokens": {
    "dark": {
      "primary": { "$type": "color", "$value": { "colorSpace": "srgb", "components": [0.3098, 0.8902, 0.8157], "hex": "#4FE3D0" } },
      "radius": { "$type": "dimension", "$value": { "value": 10, "unit": "px" } }
    }
  }
}
```

(`tokens.dark` must hold every required token; this shows two.) A seeded
source is `{"kind": "seeded", "seeds": {"primary": "#5146D9", "tag"?: "#…"},
"schemeStyle": "tonal", "contrast": 0}`.

## Tokens

All required in every listed mode, except `tag` and `tag-foreground`.

| Group | Tokens |
|---|---|
| surface | `background`, `card`, `popover`, `muted`, `surface-1`, `surface-2`, `surface-3`, `border`, `input` |
| text | `foreground`, `card-foreground`, `popover-foreground`, `muted-foreground` |
| brand | `primary`, `primary-foreground`, `secondary`, `secondary-foreground`, `accent`, `accent-foreground`, `ring` |
| second-accent (optional) | `tag`, `tag-foreground` |
| status | `destructive`, `success`, `warning`, `info`, each with `-foreground` |
| chart | `chart-1` … `chart-5` |
| shape | `radius` (dimension: `px` or `rem`) |

## Rules a second implementation must match (the Go server)

Run every fixture: each valid one passes, and each invalid one gives exactly
the one `{code, path}` in `EXPECTED.json`.

- Strict objects: unknown fields are `unknown_field` at every level.
- Paths are JSON Pointers (RFC 6901, `~0` and `~1` escapes); `""` is the theme.
- `id`: `limits.idPattern`, at most 64 characters.
- `name`: 1-100 Unicode code points (Go: `utf8.RuneCountInString`), at least
  one non-space character, no characters U+0000-U+001F or U+007F.
- `version`: an integer, 1 to 2^53-1.
- `hex`: `#rrggbb`, either case. `|component × 255 − byte| ≤ 0.5` per channel,
  or `hex_mismatch` (reported once per colour, at `…/$value/hex`).
- `modes` not an array: `bad_type`, and `tokens` is then checked only for the
  modes it holds.
- A `source.kind` other than the two: `bad_source_kind`, and no other source
  checks. A seeded source without `seeds.primary`: `missing_seed`.
- An invalid fixture holds one defect, so issue order matters only within
  this package's own tests.

`errors` (strings) read `<code> at "<path>": <message>`. Messages may change;
codes and paths are stable.
