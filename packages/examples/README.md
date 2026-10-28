# @themarr/examples

Real app screens, copied into themarr, so the owner can see a theme on them
before assigning it. The admin UI shows them on its Examples page and in the
pop-up of a theme card (T-119). Decision record:
[0008](../../docs/decisions/0008-example-modules.md).

An example is plain HTML and CSS: no scripts and no framework. Any page can
show it, in a shadow root, with any theme.

## The contract

One folder per example, named by its id, holding exactly three files:

```
packages/examples/<id>/
  example.json   id, name, sourceApp, description, modes, size
  page.html      static markup, sample data only
  page.css       colours only from var(--themarr-<token>)
```

**example.json**

```json
{
  "id": "vibe-kanban-board",
  "name": "vibe-kanban: board",
  "sourceApp": "vibe-kanban",
  "description": "One or two sentences: which screen, and what it shows.",
  "modes": ["light", "dark"],
  "size": { "width": 1100, "height": 700 }
}
```

- `id`: the folder's name; lower-case letters, digits and single hyphens.
- `sourceApp`: the app's ID in themarr.
- `modes`: the modes the real app has; the first is the mode it opens in.
  A dark-only app lists `["dark"]`.
- `size`: the design size in CSS pixels. `page.css` draws `.page` at exactly
  this `width` and `height`.

**page.html** is a fragment that starts with `<div class="page">`.

- Elements from a short list (`scripts/lint.ts`): layout elements, lists,
  `h2` to `h6` (no `h1`: the admin page has its own), `p`, `button`, `input`,
  `label` and inline SVG shapes.
- Attributes: `class`, `aria-*`, `role`, `type`, `title`, `placeholder`,
  `readonly` and a few SVG ones. No `style`, `id`, `href`, `src` or `on*`.
- Every `<button>` is `type="button"`; every `<input>` is `readonly`, with
  `type="search"` or `"text"` and an `aria-label`.
- SVG `fill` and `stroke` are `none` or `currentColor`; colour SVG from CSS.
- No URLs, no images, no fonts from the network. Use placeholder text
  (`[Game title]`), not real titles, names or people.

**page.css**

- Every colour is `var(--themarr-<token>)` with no fallback (every theme has
  every required token). No hex, `rgb()`, `hsl()`, `oklch()`, colour names or
  system colours. `transparent`, `currentColor` and `inherit` are fine, and so
  is `color-mix()` of tokens.
- People and tags (`class="tag"` or `class="avatar"`) use the second accent,
  which is optional, with its fallback:
  `background: var(--themarr-tag, var(--themarr-accent))` and
  `color: var(--themarr-tag-foreground, var(--themarr-accent-foreground))`.
- Sizes are free. Use `var(--themarr-radius)` (or `calc()` on it) for corners
  that follow the theme.
- No `:host` or `:root` (the mount helper owns them), no `url()`, `@import`
  or `@font-face`. Fonts: a local stack, such as
  `"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif`.
- Scope every selector under `.page` or a class of the page. Put resets in
  `:where(.page) ...` so they lose to the page's own classes.

## How to add an example

1. **Copy a screen from the app.** Open the screen in the app, and save its
   rendered markup and the CSS it uses (the browser's developer tools).
2. **Strip it to static HTML and CSS.** Remove scripts, event handlers,
   framework attributes, links and images. Replace real data with sample
   data and placeholders. Keep the structure and the sizes. Use real
   headings and `<button type="button">`.
3. **Replace every colour with a token.** Map each of the app's colours to the
   `--themarr-*` token with the same role (the vocabulary is
   `packages/tokens/tokens.manifest.json`): surfaces to `background`, `card`,
   `muted`, `surface-1..3`; text to `foreground` and the `*-foreground`
   tokens; brand to `primary`, `secondary`, `accent`; states to `success`,
   `warning`, `info`, `destructive`; posters and series to `chart-1..5`;
   people and tags to `tag`, with its fallback.
4. **Add example.json** in a new folder named by the id.
5. **Run generate:** `npm run generate -w @themarr/examples`. It checks the
   folder against every rule and rewrites `src/registry.generated.ts`; it
   stops with a list of problems if a rule fails. Commit the folder and the
   generated file together (a test fails when the file is stale).
6. **Rebuild** and run the tests (`scripts/test-ts.sh`). The admin build runs
   generate first, so the new example appears on the Examples page.

## The API

```ts
import { EXAMPLES, exampleById, mountExample } from "@themarr/examples";

const r = mountExample(hostElement, exampleById("vibe-kanban-board")!, theme, "dark");
// r.status: "applied" | "missing-mode" | "no-theme"
```

`mountExample(host, example, theme, mode, opts?)` draws the example in the
host's open shadow root (made on the first call, reused after), with the
theme's palette for `mode`. `theme` is the wire shape the SDK gets
(`{version, modes, tokens}`); a stored theme has those fields too. A second
call on the same host replaces the content and the styles.

- `applied`: the theme has the mode.
- `missing-mode`: the theme has no palette for the mode; the example is drawn
  with no theme variables. Show a note, such as "no light palette: apps keep
  their own look".
- `no-theme`: `theme` was `undefined`; drawn with no theme variables.

The shadow root gets, in order: `:host { display: block; color-scheme }`, a
reset of every `--themarr-*` variable to `initial` (so the page around the
host never shows through, and a theme without `tag` falls back to `accent`),
the theme's variables (the SDK's `renderCss` on `:host`), then `page.css`.
It uses one constructed stylesheet where the browser can adopt one, else a
`<style>` element (`opts.nonce` for a strict CSP). Bad `mode` or `nonce`:
`TypeError`.
