# @themarr/palette

A seeded theme's tokens, light and dark, from one accent seed, an optional
tag seed, a scheme style and a contrast level, through Material Color
Utilities 0.4.0 (spec 2021). The admin UI runs it while the owner edits and
sends the finished tokens; the server never makes a palette (decision 0003).

```ts
import { makeSeededTheme } from "@themarr/palette";

const theme = makeSeededTheme({
  id: "ocean", name: "Ocean",
  seeds: { primary: "#0B7A75", tag: "#FF6F59" },   // tag is optional
  schemeStyle: "vibrant", contrast: 1,              // tonal|vibrant|expressive|neutral; 0|1|2
  overrides: { dark: { card: "#101820" } },         // optional, per mode
});
// validateTheme(theme).ok === true; every foreground reaches 4.5:1
```

Also `makeColors` (both modes as `#RRGGBB`), `findOverrides` (what a stored
theme changed), `colorToken`, `toModeTokens`.

The role mapping (Material → themarr) is in `src/index.ts`; the golden
fixtures `packages/tokens/fixtures/valid/seeded-*.json` are its output.
Status colours and the tag seed use fixed tonal palettes, tones 40 on 100
(light) and 80 on 20 (dark).

Node can't load Material Color Utilities as published (ten imports without
`.js`); tests run with `node --import @themarr/palette/node-hook`, a resolve
hook limited to that package. Bundlers need nothing.
