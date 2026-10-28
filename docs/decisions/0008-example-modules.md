# 0008: Example pages are plain HTML and CSS, with a generated registry and a mount helper

Date: 2026-10-28. Task: T-087. Asked by: the plan
([Themarr plan: SDK, boot and drawer](https://docs.coolroo.dev/doc/themarr-plan-sdk-boot-and-drawer-a7euDJdAHN),
section "Example pages"): real app screens copied into themarr, to show any
theme before an assignment; "add one when we rip out the UI of an app we
want to implement". Decided by the themarr lead for T-087.

## Decision

- **An example is plain HTML and CSS, with no scripts and no framework.** One
  folder each, `packages/examples/<id>/`: `example.json` (id, name,
  sourceApp, description, modes, size), `page.html` (a static fragment,
  sample data only) and `page.css` (colours only from
  `var(--themarr-<token>)`). The plan named `Page.tsx`; plain markup works in
  any admin UI (T-119), in a shadow root on any page, and in tests without a
  DOM library.
- **Colours come only from tokens.** Required tokens are used with no
  fallback. `tag` and `tag-foreground` (optional, decision 0005) are written
  `var(--themarr-tag, var(--themarr-accent))` and
  `var(--themarr-tag-foreground, var(--themarr-accent-foreground))`, and
  people and tags must use them. `color-mix()` of tokens is allowed (a
  translucent search field on a brand bar).
- **A lint holds the rules** (`scripts/lint.ts`): no colour literals, only
  `--themarr-*` variables, a short list of elements and attributes, no
  scripts, styles, links, images, URLs or event handlers, `type="button"` on
  every button, `.page` at the size in `example.json`. The generator refuses
  an example that breaks one, and the tests run it on every folder.
- **The registry is generated.** `npm run generate -w @themarr/examples`
  reads the folders and writes `src/registry.generated.ts` (metadata, HTML
  and CSS as strings). A test fails when it is stale, as for the token
  manifest. The admin build runs generate first: adding an example is adding
  a folder and rebuilding. The plan named `import.meta.glob`; a generated
  file works without Vite and is checked in tests.
- **`mountExample(host, example, theme, mode)` draws an example** in the
  host's open shadow root. The CSS is a `:host` base, a reset of every
  `--themarr-*` variable to `initial`, the theme's variables from the SDK's
  `renderCss` (selector `:host`, the forced mode), then `page.css`. The
  reset keeps the admin UI's own theme from showing through (custom
  properties inherit into shadow trees) and lets a theme without `tag` fall
  back to `accent`. It returns `applied`, `missing-mode` (the theme has no
  palette for that mode: the UI says so) or `no-theme`.
- **One constructed stylesheet per shadow root**, adopted where the browser
  allows it; else a `<style>` element with an optional nonce. No new npm
  package.

## Rejected

- **A React component per example (`Page.tsx`), found with
  `import.meta.glob`:** ties examples to one framework and to Vite, needs a
  DOM library in tests, and lets an example run code.
- **An iframe per example:** a full document and a request each, and the
  theme must cross a frame boundary; a shadow root isolates the CSS enough.
- **Inline styles in the markup:** the lint could not tell a token from a
  literal as easily, and states (`.is-active`) would repeat colours.
- **Fallback colours in `page.css`** (`var(--themarr-primary, #4f46e5)`):
  a theme always has every required token, and a missing mode must look
  unthemed, not like a made-up theme.
