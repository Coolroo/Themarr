# 0002: Themes are DTCG 2025.10 tokens, colours in sRGB

Date: 2026-10-28. Task: T-116. Asked by: the plan
([Themarr plan: themes and tokens](https://docs.coolroo.dev/doc/themarr-plan-themes-and-tokens-rjQRVjvhk4)),
"Colours are stored as sRGB in the W3C design-token (DTCG 2025.10) shape."

## Decision

- **A token is a DTCG object** with `$type` and `$value`, and nothing else:
  - colour: `{"$type": "color", "$value": {"colorSpace": "srgb", "components": [r, g, b], "hex": "#rrggbb", "alpha"?: a}}`,
    components and alpha in 0..1;
  - `radius`: `{"$type": "dimension", "$value": {"value": n, "unit": "px" | "rem"}}`, n ≥ 0.
- **The colour space is always `srgb`.** Material Color Utilities works in
  sRGB (ARGB integers), every app's CSS takes sRGB, and the WCAG contrast
  formula is defined on sRGB. Wider spaces (Display P3, OKLCH) would give
  values that Material can't make and that most apps would clip.
- **Both `components` and `hex` are stored.** DTCG makes `hex` an optional
  fallback; we require it, because it is what people read and paste, and what
  the SDK's `hex` format sends. The validator checks that they agree: each
  component times 255 is within half a step (0.5) of its hex byte. So a theme
  can't say two colours at once.
- **Hex is `#rrggbb`, either case.** No shorthand (`#fff`), no `#rrggbbaa`:
  alpha has its own field.
- **The SDK formats tokens** (`hsl-triple`, `hex`, `rgb-triplet`, `oklch`) at
  boot (task T-118). Stored themes stay in one canonical form.
- **Strict objects.** A theme, a source, a token and a value refuse unknown
  fields (`unknown_field`). DTCG's `$description` and `$extensions` are
  refused too, for now: the server stores themes as given, and a field it
  doesn't know is a field nobody checks.
- **A theme is** `{id, name, version, source, modes, tokens}`: `id` a slug
  (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 64), `name` 1-100 code points, not
  blank, no control characters, `version` an integer ≥ 1. `tokens` holds one
  object per listed mode (decision 0005).
- **The schema and the checks:** `packages/tokens/schema/theme.schema.json`
  (draft 2020-12) holds every rule except the hex/components agreement, which
  JSON Schema can't express. `validateTheme` holds all of them, with stable
  error codes and JSON Pointer paths; the server returns the same codes.

## Rejected

- **Hex strings only** (`"primary": "#4FE3D0"`): simpler, but not DTCG, and it
  leaves no room for alpha or a later colour space without a format change.
- **OKLCH as the stored space:** good for editing by hand, but Material
  outputs sRGB, and a round trip through OKLCH rounds colours away from what
  Material made.
- **HSL triples, as shadcn's CSS uses:** a formatting choice of some apps,
  not a storage format; the SDK makes them.
- **DTCG groups (nested `{"color": {"primary": …}}`):** the token names are a
  fixed flat list, and flat keys map one to one onto CSS custom properties
  (`--themarr-<name>`).
