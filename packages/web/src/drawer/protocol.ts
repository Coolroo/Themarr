// The drawer's postMessage protocol, version 1 (decision 0009). The SDK
// frames themarr's /drawer page; the two talk only through these messages.
// themarr's drawer page (packages/admin, T-119) imports these types and
// parsers too, so both sides check the same shapes.
//
// Every message is a plain object {themarr: 1, type, ...} with exactly the
// fields listed here; anything else is ignored. The SDK accepts a message
// only from the exact themarr origin and from its own iframe's window, and
// posts with that exact origin as targetOrigin (never "*").

import { MODES, type Mode } from "@themarr/tokens";
import { isThemeId } from "../local.ts";
import type { Source, WireTheme } from "../types.ts";
import { parseWire } from "../wire.ts";

/** The protocol version every message carries as `themarr`. */
export const DRAWER_PROTOCOL = 1;

/** What the app shows now, as the SDK resolved it. */
export interface DrawerCurrent {
  /** The layer the theme came from; "none" when the app keeps its own look. */
  source: Source | "none";
  /** An admin enforces the theme: the person may preview, not keep. */
  locked: boolean;
  /** The theme's version, when there is a theme. */
  version?: number;
  /** The theme ID this browser keeps for the app (the local override), when there is one. */
  local?: string;
}

// The SDK → the drawer page.

/** Sent after each "ready", and again after the SDK refreshes (keepLocal, clearLocal, saved). */
export interface DrawerHello {
  themarr: 1;
  type: "hello";
  /** The app's ID in themarr. */
  app: string;
  /** The mode the app shows now. */
  mode: Mode;
  current: DrawerCurrent;
}

export type ToDrawer = DrawerHello;

// The drawer page → the SDK.

/** The page is loaded and listens; the SDK answers with "hello". */
export interface DrawerReady {
  themarr: 1;
  type: "ready";
}

/**
 * Show this theme on the app, in this tab only, until "clearPreview",
 * another preview, or the drawer closes. `body` is the public theme body
 * (GET /v1/themes/{id}/tokens: version, modes, tokens); the SDK checks it
 * with the token rules. `mode` forces that palette whatever the app's mode.
 */
export interface DrawerPreview {
  themarr: 1;
  type: "preview";
  body: WireTheme;
  mode?: Mode;
}

/** Stop previewing: the app shows its resolved theme again. */
export interface DrawerClearPreview {
  themarr: 1;
  type: "clearPreview";
}

/** Keep this theme in this browser (the local override), then refresh. Ignored while locked. */
export interface DrawerKeepLocal {
  themarr: 1;
  type: "keepLocal";
  themeId: string;
}

/** Forget the local override, then refresh. */
export interface DrawerClearLocal {
  themarr: 1;
  type: "clearLocal";
}

/**
 * The page saved a choice on themarr: "me" (the person's saved choice; the
 * SDK also clears the local override, which would hide it) or "app" (an
 * admin assigned the app's theme). The SDK refreshes.
 */
export interface DrawerSaved {
  themarr: 1;
  type: "saved";
  scope: "me" | "app";
}

/** Close the drawer (the page's own close button, or Escape inside the page). */
export interface DrawerClose {
  themarr: 1;
  type: "close";
}

export type FromDrawer = DrawerReady | DrawerPreview | DrawerClearPreview | DrawerKeepLocal | DrawerClearLocal | DrawerSaved | DrawerClose;

const SOURCES: readonly string[] = ["enforced", "local", "saved", "default", "app", "global", "public", "none"];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** v has exactly the required keys, plus any of the optional ones. */
function hasKeys(v: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  for (const k of required) if (!Object.hasOwn(v, k)) return false;
  for (const k of Object.keys(v)) if (!required.includes(k) && !optional.includes(k)) return false;
  return true;
}

function isMode(v: unknown): v is Mode {
  return (MODES as readonly unknown[]).includes(v);
}

/**
 * Check a message from the drawer page (event.data). Returns the message,
 * or null for anything that is not exactly one of FromDrawer. A preview's
 * body is checked with the token rules and comes back normalised.
 */
export function parseDrawerMessage(data: unknown): FromDrawer | null {
  if (!isObject(data) || data["themarr"] !== DRAWER_PROTOCOL) return null;
  switch (data["type"]) {
    case "ready":
    case "clearPreview":
    case "clearLocal":
    case "close":
      return hasKeys(data, ["themarr", "type"]) ? ({ themarr: 1, type: data["type"] } as FromDrawer) : null;
    case "preview": {
      if (!hasKeys(data, ["themarr", "type", "body"], ["mode"])) return null;
      const body = data["body"];
      if (!isObject(body) || !hasKeys(body, ["version", "modes", "tokens"])) return null;
      const parsed = parseWire(body);
      if (!parsed.ok) return null;
      const msg: DrawerPreview = { themarr: 1, type: "preview", body: parsed.theme };
      if (Object.hasOwn(data, "mode")) {
        if (!isMode(data["mode"])) return null;
        msg.mode = data["mode"];
      }
      return msg;
    }
    case "keepLocal":
      if (!hasKeys(data, ["themarr", "type", "themeId"]) || !isThemeId(data["themeId"])) return null;
      return { themarr: 1, type: "keepLocal", themeId: data["themeId"] };
    case "saved":
      if (!hasKeys(data, ["themarr", "type", "scope"]) || (data["scope"] !== "me" && data["scope"] !== "app")) return null;
      return { themarr: 1, type: "saved", scope: data["scope"] };
    default:
      return null;
  }
}

/**
 * Check a message from the SDK (for the drawer page). Returns the message,
 * or null for anything that is not exactly one of ToDrawer.
 */
export function parseAppMessage(data: unknown): ToDrawer | null {
  if (!isObject(data) || data["themarr"] !== DRAWER_PROTOCOL || data["type"] !== "hello") return null;
  if (!hasKeys(data, ["themarr", "type", "app", "mode", "current"])) return null;
  const app = data["app"];
  const mode = data["mode"];
  const cur = data["current"];
  if (!isThemeId(app) || !isMode(mode) || !isObject(cur)) return null;
  if (!hasKeys(cur, ["source", "locked"], ["version", "local"])) return null;
  if (typeof cur["source"] !== "string" || !SOURCES.includes(cur["source"]) || typeof cur["locked"] !== "boolean") return null;
  const current: DrawerCurrent = { source: cur["source"] as DrawerCurrent["source"], locked: cur["locked"] };
  if (Object.hasOwn(cur, "version")) {
    const v = cur["version"];
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) return null;
    current.version = v;
  }
  if (Object.hasOwn(cur, "local")) {
    if (!isThemeId(cur["local"])) return null;
    current.local = cur["local"];
  }
  return { themarr: 1, type: "hello", app, mode, current };
}
