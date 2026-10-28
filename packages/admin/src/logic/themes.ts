// What the pages show about a theme: its accent, style, swatch, preview
// colours, and which apps it reaches. Pure functions; the tests run them.

import { MODES, TOKENS, type Mode, type ModeTokens, type Theme, type TokenName } from "@themarr/tokens";
import type { App, Assignments } from "../api.ts";

export const STYLE_LABEL = {
  tonal: "Tonal spot",
  vibrant: "Vibrant",
  expressive: "Expressive",
  neutral: "Neutral",
} as const;

export const STYLE_HINT = {
  tonal: "Calm, lightly tinted",
  vibrant: "Stronger tint",
  expressive: "Shifted second hue",
  neutral: "Grey surfaces",
} as const;

export const CONTRAST_LABEL = ["Standard", "Medium", "High"] as const;

function hexOf(tokens: ModeTokens | undefined, name: Exclude<TokenName, "radius">): string | undefined {
  return tokens?.[name]?.$value.hex.toUpperCase();
}

/** The mode a theme shows first: light if it has it. */
export function firstMode(theme: Pick<Theme, "modes">): Mode {
  return theme.modes.includes("light") ? "light" : (theme.modes[0] ?? "light");
}

/** The accent: the seed of a seeded theme, else the primary of its first mode. */
export function themeAccent(theme: Theme): string {
  if (theme.source.kind === "seeded") return theme.source.seeds.primary.toUpperCase();
  return hexOf(theme.tokens[firstMode(theme)], "primary") ?? "";
}

export function modesLabel(modes: readonly Mode[]): string {
  if (modes.length === 1) return modes[0] === "dark" ? "dark only" : "light only";
  return "";
}

export function styleLabel(theme: Theme): string {
  if (theme.source.kind === "seeded") return STYLE_LABEL[theme.source.schemeStyle];
  const m = modesLabel(theme.modes);
  return m === "" ? "Hand-made" : `Hand-made · ${m}`;
}

/** "#5146D9 · Tonal spot". */
export function themeSub(theme: Theme): string {
  return `${themeAccent(theme)} · ${styleLabel(theme)}`;
}

export interface Swatch {
  /** A CSS background: one colour, or three bands for a hand-made theme. */
  fill: string;
  /** The strip at the bottom: the dark background (or the light one). */
  band: string;
}

/** A theme's swatch for pickers and tiles. */
export function swatchOf(theme: Theme): Swatch {
  const dark = theme.tokens.dark;
  const lightOrDark = theme.tokens[firstMode(theme)];
  const band = hexOf(dark, "background") ?? hexOf(lightOrDark, "background") ?? "transparent";
  if (theme.source.kind === "handmade") {
    const t = dark ?? lightOrDark;
    const a = hexOf(t, "primary") ?? "transparent";
    const b = hexOf(t, "tag") ?? hexOf(t, "accent") ?? a;
    const c = hexOf(t, "warning") ?? a;
    return { fill: `linear-gradient(90deg, ${a} 0 34%, ${b} 34% 67%, ${c} 67%)`, band };
  }
  return { fill: themeAccent(theme), band };
}

/**
 * The preview variables for one mode, `--t-<token>`: the page's preview CSS
 * reads them. A theme without `tag` shows `accent` there, as apps do.
 * Null when the theme has no palette for the mode.
 */
export function previewVars(tokens: ModeTokens | undefined): Record<string, string> | null {
  if (tokens === undefined) return null;
  const out: Record<string, string> = {};
  for (const spec of TOKENS) {
    const t = tokens[spec.name as TokenName];
    if (t === undefined) continue;
    out[`--t-${spec.name}`] = t.$type === "color" ? t.$value.hex : `${t.$value.value}${t.$value.unit}`;
  }
  if (out["--t-tag"] === undefined && out["--t-accent"] !== undefined) {
    out["--t-tag"] = out["--t-accent"];
    out["--t-tag-foreground"] = out["--t-accent-foreground"] ?? "";
  }
  return out;
}

/** Preview variables from plain colours (the editor's draft). */
export function previewVarsFromColors(colors: Partial<Record<string, string>> | undefined): Record<string, string> | null {
  if (colors === undefined) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(colors)) if (v !== undefined) out[`--t-${k}`] = v;
  if (out["--t-tag"] === undefined && out["--t-accent"] !== undefined) {
    out["--t-tag"] = out["--t-accent"];
    out["--t-tag-foreground"] = out["--t-accent-foreground"] ?? "";
  }
  return out;
}

export function themeById(themes: readonly Theme[], id: string | null | undefined): Theme | undefined {
  return id == null ? undefined : themes.find((t) => t.id === id);
}

/** The theme id an app's assignment comes to (inherit → global), or null for none. */
export function resolvedThemeId(appId: string, a: Assignments): { id: string | null; inherited: boolean } {
  const own = a.perApp[appId];
  if (own === undefined || own === "inherit") return { id: a.global, inherited: true };
  if (own === "none") return { id: null, inherited: false };
  return { id: own, inherited: false };
}

/** The apps that boot with this theme (by assignment, before people's own choices). */
export function usedBy(themeId: string, apps: readonly App[], a: Assignments): string[] {
  return apps.filter((app) => resolvedThemeId(app.id, a).id === themeId).map((app) => app.id);
}

/** "Harbor", "Coolroo Indigo (inherited)", "App defaults". */
export function bootsWith(appId: string, a: Assignments, themes: readonly Theme[]): string {
  const r = resolvedThemeId(appId, a);
  if (r.id === null) return "App defaults";
  const name = themeById(themes, r.id)?.name ?? r.id;
  return r.inherited ? `${name} (inherited)` : name;
}

/** The assignments with one app's set to `value` (a theme id, "inherit" or "none"). */
export function withAppAssignment(a: Assignments, appId: string, value: string): Assignments {
  const perApp = { ...a.perApp };
  if (value === "inherit") delete perApp[appId];
  else perApp[appId] = value;
  return { global: a.global, perApp };
}

/** The first host of an app's origins, for the list. */
export function appHost(app: App): string {
  const o = app.origins[0];
  if (o === undefined) return "no origin";
  return o.replace(/^https:\/\//, "");
}

export const ALL_MODES: readonly Mode[] = MODES;
