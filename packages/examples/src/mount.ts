// Mount an example in a shadow root, drawn with one mode of one theme.
//
// The shadow root keeps the example's CSS away from the page around it. Its
// styles are: a small :host base, a reset of every --themarr-* variable (so
// the page's own theme never shows through), the theme's variables for the
// mode (the SDK's renderCss on ":host"), then the example's page.css.

import { cssVar, MODES, TOKEN_NAMES } from "@themarr/tokens";
import { renderCss, type Mode, type WireTheme } from "@themarr/web";
import type { Example } from "./types.ts";

/**
 * - `applied`: the theme has this mode; the example shows its palette;
 * - `missing-mode`: the theme has no palette for this mode. The example is
 *   drawn with no theme variables; say so, for example "no light palette:
 *   apps keep their own look";
 * - `no-theme`: no theme was given; the example is drawn with no theme variables.
 */
export type MountStatus = "applied" | "missing-mode" | "no-theme";

/** The part of a CSSStyleSheet the helper uses. */
export interface ExampleSheet {
  replaceSync(text: string): void;
}

/** The part of a ShadowRoot the helper uses. */
export interface ExampleRoot {
  innerHTML: string;
  adoptedStyleSheets?: ExampleSheet[];
}

/** The part of an HTMLElement the helper uses. */
export interface ExampleHost<R extends ExampleRoot = ExampleRoot> {
  readonly shadowRoot: R | null;
  attachShadow(init: { mode: "open" }): R;
}

export interface MountOptions {
  /**
   * The nonce for the <style> element. Used only where the browser cannot
   * adopt a constructed stylesheet into the shadow root, under a strict CSP.
   */
  nonce?: string;
  /** @internal Tests: the CSSStyleSheet constructor (default the global one; null: always a <style>). */
  _Sheet?: (new () => ExampleSheet) | null;
}

export interface MountResult<R extends ExampleRoot = ExampleRoot> {
  status: MountStatus;
  /** The example's id. */
  example: string;
  mode: Mode;
  /** The open shadow root that holds the example. */
  root: R;
}

const NONCE_PATTERN = /^[A-Za-z0-9+/=_-]+$/;

/** Every --themarr-* variable made invalid, so nothing from the page around the host leaks in. */
const RESET = `:host {\n${TOKEN_NAMES.map((n) => `  ${cssVar(n)}: initial;`).join("\n")}\n}\n`;

/** The sheet the helper made for each root, reused on a re-mount. */
const sheets = new WeakMap<object, ExampleSheet>();

function globalSheet(): (new () => ExampleSheet) | null {
  return (globalThis as { CSSStyleSheet?: new () => ExampleSheet }).CSSStyleSheet ?? null;
}

/** The full CSS text the helper puts in the root, and the status. */
export function exampleCss(
  example: Pick<Example, "css">,
  theme: WireTheme | undefined,
  mode: Mode,
): { css: string; status: MountStatus } {
  if (!(MODES as readonly unknown[]).includes(mode)) throw new TypeError(`[themarr] bad mode "${String(mode)}"`);
  const vars = theme === undefined ? "" : renderCss({ theme }, { selector: ":host", mode });
  const status: MountStatus = theme === undefined ? "no-theme" : vars === "" ? "missing-mode" : "applied";
  const base = `:host {\n  display: block;\n  color-scheme: ${mode};\n}\n`;
  return { css: `${base}${RESET}${vars}${example.css}`, status };
}

function adopt(root: ExampleRoot, css: string, Sheet: (new () => ExampleSheet) | null): boolean {
  if (Sheet === null || root.adoptedStyleSheets === undefined) return false;
  try {
    const sheet = sheets.get(root) ?? new Sheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
    sheets.set(root, sheet);
    return true;
  } catch {
    // A sheet from another document, or no constructable sheets: use a <style>.
    return false;
  }
}

/**
 * Draw `example` in `host`'s open shadow root (made on the first call, then
 * reused), with `theme`'s palette for `mode`. A second call on the same host
 * replaces the content and the styles. `theme` is the wire shape the SDK gets
 * (`{version, modes, tokens}`); a stored theme has the same fields.
 *
 * Throws a TypeError for a bad mode or nonce. The host belongs to the helper:
 * other content in its shadow root is replaced.
 */
export function mountExample<R extends ExampleRoot>(
  host: ExampleHost<R>,
  example: Example,
  theme: WireTheme | undefined,
  mode: Mode,
  opts: MountOptions = {},
): MountResult<R> {
  if (opts.nonce !== undefined && !NONCE_PATTERN.test(opts.nonce)) throw new TypeError("[themarr] bad nonce");
  const { css, status } = exampleCss(example, theme, mode);
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  if (adopt(root, css, opts._Sheet === undefined ? globalSheet() : opts._Sheet)) {
    root.innerHTML = example.html;
  } else {
    const own = sheets.get(root);
    if (own !== undefined && root.adoptedStyleSheets !== undefined) {
      root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== own);
    }
    sheets.delete(root);
    const nonce = opts.nonce === undefined ? "" : ` nonce="${opts.nonce}"`;
    root.innerHTML = `<style${nonce}>\n${css}</style>\n${example.html}`;
  }
  return { status, example: example.id, mode, root };
}
