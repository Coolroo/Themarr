# 0003: Material Color Utilities makes the palette, in the admin UI, when a theme is saved

Date: 2026-10-28. Task: T-116. Asked by: the owner, who wants a theme from
"a single accent colour up to a full override" (the plan,
[Themarr plan: themes and tokens](https://docs.coolroo.dev/doc/themarr-plan-themes-and-tokens-rjQRVjvhk4)).

## Decision

- **A seeded theme's palette comes from Material Color Utilities**
  (`@material/material-color-utilities`, Apache-2.0, by Google). From one
  `primary` seed, a scheme style (`tonal`, `vibrant`, `expressive`, `neutral`)
  and a contrast level (`0` standard, `1` medium, `2` high, which are
  Material's 0, 0.5 and 1.0) it makes light and dark roles that meet Material's
  contrast targets.
- **It runs in the admin UI, at save time** (task T-119, `packages/palette`).
  The admin UI maps Material's roles onto themarr's token names, shows the
  result, lets the admin override any single token, and sends the finished
  tokens. **The server stores what it is sent and never generates a palette**;
  it only checks the theme (`validateTheme`'s rules, from the embedded
  manifest).
- **The source is kept with the theme** (`source.seeds`, `schemeStyle`,
  `contrast`), so the editor can open a seeded theme and make it again. The
  stored tokens are the truth; the seeds are a record of how they were made.
- **The tag seed is optional.** Without it, `tag` comes from Material's
  tertiary role; with it, `tag` comes from a tonal palette of that seed
  (decision 0005).
- **Success, warning and info** have no Material roles. The palette package
  makes them from fixed hues through Material's tonal palettes, with the same
  tones as `primary`, so they keep the same contrast in both modes.

## Why not on the server

- **No Go port exists.** Material Color Utilities is maintained in
  TypeScript, Java, Dart, C++ and Swift. Porting HCT, the scheme styles and
  the contrast curves to Go would be a large job that must follow every
  upstream release.
- **The server stays small.** It runs in every app's first second; a store
  and a check are all it needs. Generated colours never change after save, so
  there is nothing to compute at read time.

## Notes for T-119

- Version 0.4.0 (2026-01-21) is the current release and has no dependencies.
  Its ES modules import files without the `.js` extension, so plain Node
  can't load it without a bundler or a resolve hook. Pin the version, and
  record the reason in a decision record (the CLAUDE.md dependency rule).
- `packages/tokens/fixtures/valid/seeded-*.json` were made with 0.4.0, with
  this mapping (only a starting point; T-119 owns the real one):
  `background` surface, `card` and `surface-1` surfaceContainerLow, `popover`
  and `surface-2` surfaceContainer, `surface-3` surfaceContainerHigh, `muted`
  surfaceContainerHighest, `border` outlineVariant, `input` outline,
  `foreground` (and card-, popover-) onSurface, `muted-foreground`
  onSurfaceVariant, `primary`/`ring` primary, `secondary` secondaryContainer,
  `accent` primaryContainer, `tag` tertiary (or tone 40/80 of the tag seed),
  `destructive` error; each `-foreground` is the matching `on…` role; success
  `#2E7D32`, warning `#E8A317`, info `#0277BD` at tones 40/100 (light) and
  80/20 (dark); charts are primary, tag, info, success, warning.

## Rejected

- **Generating on the server through a TypeScript sidecar:** a second
  process and runtime for a job that happens once per save.
- **Our own palette maths (HSL steps):** easy, but without Material's
  perceptual model and contrast guarantees. The design's mock-up colours use
  simple maths; real themes don't.
- **Generating at read time in the SDK:** every app would carry the library,
  and the SDK must stay one small file with no dependencies.
