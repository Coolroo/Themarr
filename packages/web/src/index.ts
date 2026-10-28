// @themarr/web: the boot hook. Apps call boot before they draw.
// The build bundles this file and what it imports into dist/themarr.js.
// Each export is listed by name: scripts/build.ts makes the .d.ts from them.

export { boot, renderCss } from "./boot.ts";
export { clearLocalOverride, getLocalOverride, setLocalOverride } from "./local.ts";
export { formatColor } from "./color.ts";
export { DRAWER_PROTOCOL, parseAppMessage, parseDrawerMessage } from "./drawer/protocol.ts";
export type {
  BootOptions,
  BootResult,
  DarkStrategy,
  DrawerOptions,
  DrawerPosition,
  Format,
  MapEntry,
  Mode,
  RenderOptions,
  Source,
  Status,
  TokenMap,
  TokenName,
  WireTheme,
} from "./types.ts";
export type {
  DrawerClearLocal,
  DrawerClearPreview,
  DrawerClose,
  DrawerCurrent,
  DrawerHello,
  DrawerKeepLocal,
  DrawerPreview,
  DrawerReady,
  DrawerSaved,
  FromDrawer,
  ToDrawer,
} from "./drawer/protocol.ts";

/** The SDK version; the vendored file's header says the same. */
export const VERSION = "0.1.0";
