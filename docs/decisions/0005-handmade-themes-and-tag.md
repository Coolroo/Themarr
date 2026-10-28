# 0005: Hand-made themes, modes, and the optional tag accent

Date: 2026-10-28. Task: T-116. Asked by: the Drives session (2026-10-24),
for its Synth theme: turquoise, magenta and orange on dark indigo, dark only.
Recorded in the plan,
[Themarr plan: themes and tokens](https://docs.coolroo.dev/doc/themarr-plan-themes-and-tokens-rjQRVjvhk4).

## Decision

- **A theme's `source` is one of two kinds:**
  - `{"kind": "seeded", "seeds": {"primary": "#rrggbb", "tag"?: "#rrggbb"}, "schemeStyle": "tonal" | "vibrant" | "expressive" | "neutral", "contrast": 0 | 1 | 2}`:
    Material makes the palette from the seeds (decision 0003);
  - `{"kind": "handmade"}`: no generator, every token is set by hand. For
    themes made of several unrelated hues, such as Synth, which no single seed
    can produce.
  Any single token can be overridden in either kind; the stored tokens are
  what counts. A `handmade` source has no other fields (`seeds` on it is
  `unknown_field`).
- **`modes` lists the modes a theme has:** a non-empty subset of
  `["light", "dark"]`, each once. `tokens` holds exactly one object per listed
  mode and none for an unlisted mode (`mode_without_tokens`,
  `tokens_for_unlisted_mode`). A hand-made theme may be dark only, or light
  only. An app in a mode the theme lacks keeps its own look in that mode,
  with no warning (the SDK, T-118).
- **`tag` and `tag-foreground` are a second accent, for people and tags,**
  and the only optional tokens. Drives asked for them (Synth's magenta). An
  app without that role ignores them; when a theme has no `tag` and an app
  maps `tag`, the app's own value stays. A seeded theme gets `tag` from
  Material's tertiary role unless it has a `tag` seed.
- **Every other token is required in every listed mode**, including
  `card-foreground`, `popover-foreground`, `surface-1..3` and `chart-1..5`.
  An app that maps a token always gets a value, so no app or SDK needs
  fallback rules (such as "popover-foreground falls back to foreground"). The
  admin UI fills them, often as copies (Synth's `card` and `popover` are the
  same colour). The vocabulary, with groups and the required flag, is
  `packages/tokens/tokens.manifest.json`.
- **Every foreground has a base** (`on` in the manifest): `foreground` on
  `background`, and each `<x>-foreground` on `<x>`. The tests check 4.5:1
  (WCAG AA) for every pair in the golden fixtures; the admin UI warns on the
  same pairs. The server does not refuse a low-contrast theme: an admin may
  choose it.
- **Synth is a golden fixture, not a theme.**
  `fixtures/valid/handmade-synth-dark.json` (id `synth-fixture`) holds Drives'
  table; the foregrounds Drives left open (`tag`, `destructive`, `success`,
  `warning`, `info`) are dark inks that reach 4.5:1. The owner creates Synth
  in themarr later.

## Rejected

- **Seeded only, with overrides for Synth:** Synth would be "a seed plus
  thirty overrides", and the editor would offer to make the palette again
  over the hand-set colours.
- **Both modes always:** forces a hand-made light Synth that nobody asked for.
  Drives ships Synth as dark only.
- **`tag` required:** most apps have no such role, and seeded themes would
  carry a colour nobody chose.
- **`popover` and `card` foregrounds optional, falling back to
  `foreground`:** saves two values per mode, but moves a rule into every
  client; shadcn's own themes always set them.
- **A third source kind, "imported":** an import is either hand-made or
  seeded once it is in; the kind says how the editor treats it, not where it
  came from.
