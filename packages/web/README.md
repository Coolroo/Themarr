# @themarr/web

The boot hook. An app awaits `boot` before it draws, so it starts in its
theme with no flash. One ESM file with no dependencies, plus a `.d.ts`; it
runs in browsers and in Node (24+, for server-rendered apps).

- A theme is set: `boot` applies it and resolves `applied`.
- Nothing is set: `unset`; the app keeps its own look. No warning.
- Themarr can't be reached: after at most `timeoutMs` (default 1000) it
  resolves `unreachable`, the app keeps its own look, and the console gets one
  line: `[themarr] unreachable (<url>, <app>): <reason>; using app defaults`.

`boot` never throws and always resolves within `timeoutMs`.

## Getting the file

There is no npm registry. Build, then copy both files into the app at
`vendor/themarr/`:

```sh
scripts/test-ts.sh build        # from the repo root; writes packages/web/dist/
cp packages/web/dist/themarr.js packages/web/dist/themarr.d.ts <app>/vendor/themarr/
```

Both files start with the version and "do not edit; copy a new release
instead". `scripts/build.ts` and [decision 0006](../../docs/decisions/0006-sdk-build.md)
say how they are made.

## A single-page app

```ts
// main.tsx, before createRoot(...).render(...)
import * as themarr from "./vendor/themarr/themarr.js";

const theme = await themarr.boot({
  app: "vibe-kanban",                     // the app's ID in themarr
  url: "https://themarr.coolroo.dev",     // https only
  selector: "html:not([data-theme-variant])",
  dark: { class: "dark" },                // or { attr: "data-theme", value: "dark" }, or "media"
  map: {
    background: [{ var: "--_background", format: "hsl-triple" }],
    primary: [{ var: "--brand", format: "hsl-triple" }],
  },
});
// theme.status: "applied" | "unset" | "unreachable"
// theme.tokens?.dark?.primary: "oklch(…)" for charts and canvas
createRoot(el).render(<App />);
```

### Options

| Option | Default | What |
|---|---|---|
| `app` | required | The app's ID: lower-case letters, digits, single hyphens |
| `url` | required | Themarr's address. `https://` only; no user, query or fragment |
| `timeoutMs` | `1000` | One deadline for every request at boot (and at each refresh) |
| `selector` | `":root"` | Where the variables go. A list (`a, b`) works |
| `dark` | `"media"` | How the app marks dark mode: `{class}`, `{attr, value}` or `"media"` |
| `mode` | none | `"light"` or `"dark"`: put that palette on `selector` only, whatever the app's mode (dark-only apps) |
| `map` | none | Token → the app's own variables (below) |
| `personal` | `true` in a browser, `false` in Node | Also ask for the signed-in person's theme |
| `refreshOnFocus` | `true` | Ask again when the tab gets focus or becomes visible |
| `nonce` | none | For the fallback `<style>` element (strict CSP) |
| `signal` | none | Stops boot; it resolves `unreachable` |
| `onChange` | none | Called after a refresh changes the result |

A bad option (an `http://` url, a bad app ID, a map variable that is not
`--name`) resolves `unreachable` at once, without a request, and the warning
names the option.

### The map and the formats

Every token is always set as `--themarr-<token>`, colours in `oklch`, so plain
CSS can write `var(--themarr-primary, <default>)`. The map adds the app's own
variables, each in the format the app's CSS expects:

| Format | Example | For CSS like |
|---|---|---|
| `oklch` | `oklch(0.628 0.2577 29.23)` | `color: var(--x)` |
| `hsl-triple` | `217.2 91.2% 59.8%` | `hsl(var(--x))` (shadcn, vibe-kanban) |
| `hex` | `#3b82f6` | `color: var(--x)` |
| `rgb-triplet` | `59, 130, 246` | `rgb(var(--x))` (theme.park) |

- oklch: L 0..1 and C to 4 decimals, H in degrees to 2; a grey has C and H 0.
  hsl-triple: to 1 decimal.
- Alpha: `oklch(… / 0.5)`, `H S% L% / 0.5`, `#rrggbbaa`. `rgb-triplet` has no
  alpha.
- `radius` is always `<value><unit>` (`10px`, `0.5rem`); a format on it is ignored.
- A token the theme lacks (`tag`, `tag-foreground` are optional) sets nothing:
  the app's own value stays.

### Modes and the CSS

The SDK writes one rule per mode the theme has:

| `dark` | Light rule | Dark rule |
|---|---|---|
| `{class: "dark"}` | `:root:not(.dark)` | `:root.dark` |
| `{attr: "data-theme", value: "dark"}` | `:root:not([data-theme="dark"])` | `:root[data-theme="dark"]` |
| `"media"` | `@media (prefers-color-scheme: light) { :root }` | `@media (prefers-color-scheme: dark) { :root }` |

A theme without a mode gets no rule for it: in that mode the app keeps its own
look. With `mode`, only that palette is written, on `selector`; if the theme
lacks it, nothing is applied and the status is `unset`.

The CSS goes in as **one constructable stylesheet**, last in
`document.adoptedStyleSheets`. Without constructable sheets it is a
`<style id="themarr">` at the end of `<head>`, with `nonce`. The app's own
CSS is never touched: removing the sheet gives the app its own look back.

### The result

```ts
interface BootResult {
  status: "applied" | "unset" | "unreachable";
  tokens?: { light?: {...}; dark?: {...} };   // token → CSS value (oklch, radius as px/rem)
  version?: number;
  source?: "enforced" | "local" | "saved" | "default" | "app" | "global" | "public";
  theme?: WireTheme;                           // the answer as received
  reason?: string;                             // for "unreachable"
  refresh(): Promise<void>;                    // ask again now
  dispose(): void;                             // remove the sheet and the listeners
}
```

The object is live: a refresh updates its fields, then calls `onChange`.

### Refresh on focus

When the tab gets focus or becomes visible (debounced), the SDK asks every
layer again and replaces or removes the sheet as the answers say. If themarr
is unreachable then, the page keeps what it has, and the SDK warns once per
outage. In a browser the requests carry no headers (see the contract); the
browser's HTTP cache revalidates with the ETag, and the sheet is replaced only
when the CSS changes. In Node the SDK sends `If-None-Match` itself.

## A server-rendered app (Next.js)

`boot` works without a `document`: it resolves, but applies nothing, asks
only the public route, and skips the local override. Put `renderCss` in the
page head; with no second argument it uses the options given to `boot`.

```tsx
// app/layout.tsx (App Router: a server component may be async)
import * as themarr from "../vendor/themarr/themarr.js";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await themarr.boot({ app: "seerr-games", url: "https://themarr.coolroo.dev", dark: { class: "dark" } });
  const css = themarr.renderCss(theme);   // "" when there is no theme
  return (
    <html>
      <head>{css && <style id="themarr" dangerouslySetInnerHTML={{ __html: css }} />}</head>
      <body>{children}</body>
    </html>
  );
}
```

With the Pages Router, call `boot` in `_document`'s `getInitialProps` and
render the `<style>` from its result. The CSS holds only numbers, hex and
units from a validated theme, and selectors checked at boot, so it is safe to
inline.

Unreachable warns with `console.warn` in the server's log. If the page also
calls `boot` in the browser (for refresh on focus), the browser's sheet takes
over the server's `<style id="themarr">`. `renderCss(result, opts)` takes the
render options (`selector`, `dark`, `mode`, `map`) explicitly, and throws a
`TypeError` on bad ones.

## Layers: personal, local, public

At boot the SDK asks, at the same time and under one deadline:

1. `GET {url}/v1/apps/{app}/theme`: the public theme, no cookie.
2. `GET {url}/v1/me/apps/{app}/theme`, with `credentials: "include"`: the
   signed-in person's theme (if `personal`). Without an Authelia session
   Authelia redirects; the SDK uses `redirect: "error"`, so that fails fast.
3. `GET {url}/v1/themes/{id}/tokens`: the local override, if this browser
   keeps one for the app.

It picks the first that applies:

1. personal, when it says `"locked": true` (an admin enforced it);
2. the local override;
3. personal;
4. public.

204 means nothing at that layer. Only the public answer decides
`unreachable`: a failed personal request means the person is not signed in,
with no warning. A local override that answers 404 is cleared, with no
warning; any other local failure is skipped.

### The local override (for the drawer)

The browser keeps one theme ID per app in `localStorage`, key
`themarr:<app>:local`. The drawer (T-085) writes it with:

```ts
import { getLocalOverride, setLocalOverride, clearLocalOverride } from "@themarr/web/local"; // in this repo
// or from the vendored file: themarr.getLocalOverride(...)

setLocalOverride("vibe-kanban", "synth");   // false if the ID is not a slug or storage is blocked
getLocalOverride("vibe-kanban");            // "synth" | null
clearLocalOverride("vibe-kanban");
await theme.refresh();                      // apply it now
```

## The wire contract

What the SDK expects from the server:

- `GET /v1/apps/{app}/theme`: `200` with
  `{"version": int, "modes": ["light"|"dark", …], "tokens": {"<mode>": {"<token>": <DTCG token>}}}`,
  `ETag`, `Cache-Control: no-cache`; `304` on `If-None-Match`; `204` (no
  body) when no theme is set. CORS `Access-Control-Allow-Origin: *`, no
  credentials, `Access-Control-Expose-Headers: ETag`.
- `GET /v1/themes/{id}/tokens`: the same `200` body for one theme; `404` when
  unknown.
- `GET /v1/me/apps/{app}/theme` (T-089): behind Authelia; the same body plus
  optional `"locked": true` and `"source": "enforced"|"saved"|"default"|"app"|"global"`;
  `204` when none. CORS must allow the app's origin with credentials.
- Tokens are DTCG objects as in `@themarr/tokens`: colours
  `{"$type": "color", "$value": {"colorSpace": "srgb", "components": [r, g, b], "hex": "#rrggbb", "alpha"?: a}}`,
  `radius` `{"$type": "dimension", "$value": {"value": n, "unit": "px"|"rem"}}`.
  The SDK checks every answer with `validateTheme`'s rules (the same as the
  server's) and refuses an invalid one; a token name it doesn't know is
  dropped, so a newer server can add tokens.
- **In a browser the SDK sends no request headers** (no `If-None-Match`, no
  `Accept`): any header outside the CORS safelist makes the browser send a
  preflight `OPTIONS`, which themarr and the Authelia bypass don't answer.

## Development

```sh
scripts/test-ts.sh            # npm ci, typecheck, node --test (fake fetch, fake DOM)
scripts/test-ts.sh build      # dist/themarr.js and dist/themarr.d.ts
```

| File | What |
|---|---|
| `src/boot.ts` | `boot`, `renderCss`, layers, deadline, refresh |
| `src/css.ts` | Options check, selectors, the CSS text |
| `src/color.ts` | sRGB → oklch, hsl-triple, hex, rgb-triplet |
| `src/wire.ts` | Checks an answer with `@themarr/tokens` |
| `src/sheet.ts` | The one stylesheet (constructable, or `<style>`) |
| `src/local.ts` | The local-override helpers |
| `src/drawer/` | The drawer (T-085) |

Tests inject a fetch (`_fetch`) and fake browser objects (`_env`); both are
private options.
