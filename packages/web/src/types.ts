// The SDK's public types. Everything an app passes to boot or reads back.

import type { Mode, ModeTokens, TokenName } from "@themarr/tokens";

/** How a token is written into a CSS custom property. */
export type Format = "oklch" | "hsl-triple" | "hex" | "rgb-triplet";

/** One CSS custom property that takes a token. */
export interface MapEntry {
  /** A custom property name, such as "--brand". */
  var: string;
  /** Ignored for `radius`, which is always `<value><unit>`. */
  format: Format;
}

/** Token → the app's own custom properties. */
export type TokenMap = { readonly [K in TokenName]?: readonly MapEntry[] };

/**
 * How the app marks dark mode:
 * - `{ class: "dark" }`: a class on the selector's element;
 * - `{ attr: "data-theme", value: "dark" }`: an attribute;
 * - `"media"`: the system setting (`prefers-color-scheme`).
 */
export type DarkStrategy = { class: string } | { attr: string; value: string } | "media";

/** The options that decide the CSS text (boot and renderCss). */
export interface RenderOptions {
  /** The element the variables go on. Default ":root". */
  selector?: string;
  /** Default "media". */
  dark?: DarkStrategy;
  /** Force one palette on the selector, whatever the app's mode. */
  mode?: Mode;
  /** The app's own variables. The `--themarr-<token>` variables are always set too. */
  map?: TokenMap;
}

/** @internal A minimal fetch, so tests can give their own. */
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>;
/** @internal */
export interface FetchInit {
  method: "GET";
  credentials: "omit" | "include";
  redirect: "error";
  headers: Record<string, string>;
  signal: AbortSignal;
}
/** @internal */
export interface FetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

/** @internal The browser objects the SDK uses, so tests can give fakes. */
export interface Env {
  document?: EnvDocument | undefined;
  window?: EnvWindow | undefined;
  /** Read lazily: the browser may refuse access (private mode, blocked storage). */
  storage?: (() => EnvStorage | undefined) | undefined;
}
/** @internal */
export interface EnvStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
/** @internal */
export interface EnvSheet {
  replaceSync(text: string): void;
}
/** @internal */
export interface EnvElement {
  id: string;
  textContent: string | null;
  tagName: string;
  setAttribute(name: string, value: string): void;
  remove(): void;
}
/** @internal */
export interface EnvDocument {
  adoptedStyleSheets?: EnvSheet[];
  head: { appendChild(el: EnvElement): unknown } | null;
  createElement(tag: "style"): EnvElement;
  getElementById(id: string): EnvElement | null;
  visibilityState?: string;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}
/** @internal */
export interface EnvWindow {
  CSSStyleSheet?: new () => EnvSheet;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

export interface BootOptions extends RenderOptions {
  /** The app's ID in themarr: lower-case letters, digits and single hyphens. */
  app: string;
  /** Themarr's address, https only, such as "https://themarr.coolroo.dev". */
  url: string;
  /** boot resolves within this time. Default 1000. */
  timeoutMs?: number;
  /** Also ask for the signed-in person's theme (/v1/me). Default true in a browser, false in Node. */
  personal?: boolean;
  /** Check again when the tab gets focus. Default true (browser only). */
  refreshOnFocus?: boolean;
  /** The nonce for the fallback <style> element (strict CSP without constructable sheets). */
  nonce?: string;
  /** Stops boot; it resolves "unreachable". */
  signal?: AbortSignal;
  /** Called after a refresh changes the result (new theme, theme removed). */
  onChange?: (result: BootResult) => void;
  /**
   * The in-app drawer: a small themarr button that opens a sidebar to
   * preview and keep themes. Off by default; browser only.
   */
  drawer?: boolean | DrawerOptions;
  /** @internal Tests: a fetch to use instead of globalThis.fetch. */
  _fetch?: FetchLike;
  /** @internal Tests: browser objects to use instead of the globals. */
  _env?: Env;
  /** @internal Tests: the focus debounce. Default 250. */
  _debounceMs?: number;
  /** @internal Tests: how long the drawer page has to say "ready". Default 10000. */
  _drawerReadyMs?: number;
}

/** Where the drawer's button sits. */
export type DrawerPosition = "bottom-right" | "bottom-left";

/** The drawer option of boot. */
export interface DrawerOptions {
  /** Default "bottom-right". The drawer opens on the same side. */
  position?: DrawerPosition;
}

/**
 * - `applied`: a theme was found (and, in a browser, its stylesheet is on the page);
 * - `unset`: themarr answered, but no theme is set for this app (or the theme
 *   has no palette for the forced mode): the app keeps its own look;
 * - `unreachable`: themarr did not answer in time, or answered with an error:
 *   the app keeps its own look, and the SDK warned once in the console.
 */
export type Status = "applied" | "unset" | "unreachable";

/** Which layer the theme came from. */
export type Source = "enforced" | "local" | "saved" | "default" | "app" | "global" | "public";

/** The theme as the server sends it (GET /v1/apps/{app}/theme). */
export interface WireTheme {
  version: number;
  modes: Mode[];
  tokens: Partial<Record<Mode, ModeTokens>>;
}

export interface BootResult {
  status: Status;
  /** Per mode the theme has: token → CSS value (oklch for colours, such as for charts). */
  tokens?: Partial<Record<Mode, { [K in TokenName]?: string }>>;
  version?: number;
  source?: Source;
  /** The theme as received; renderCss reads it. */
  theme?: WireTheme;
  /** For "unreachable": why. */
  reason?: string;
  /** Ask themarr again now (as on focus). Resolves when the page is updated. */
  refresh(): Promise<void>;
  /** Remove the stylesheet and the listeners: the app's own look returns. */
  dispose(): void;
}

export type { Mode, TokenName };
