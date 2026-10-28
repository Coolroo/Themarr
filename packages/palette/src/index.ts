// @themarr/palette: a seeded theme's tokens from Material Color Utilities
// (decision 0003). The admin UI calls it while the owner edits, and sends the
// finished tokens when the theme is saved; the server never makes a palette.
//
// The role mapping (Material role → themarr token) is the one the golden
// fixtures in packages/tokens were made with, so seeded-indigo.json is this
// package's output for its seeds. Material's spec 2021 is pinned, so a later
// library default can't change a theme made again from its seeds.

import {
  argbFromHex,
  type DynamicScheme,
  hexFromArgb,
  Hct,
  SchemeExpressive,
  SchemeNeutral,
  SchemeTonalSpot,
  SchemeVibrant,
  TonalPalette,
} from "@material/material-color-utilities";
import {
  HEX_PATTERN,
  MODES,
  TOKENS,
  type ColorToken,
  type ContrastLevel,
  type DimensionToken,
  type Hex,
  type Mode,
  type ModeTokens,
  type SchemeStyle,
  type SeededSource,
  type Theme,
  type TokenName,
} from "@themarr/tokens";

/** What a seeded theme is made from (a seeded source without its kind). */
export interface PaletteInput {
  /** The accent: buttons, links, anything you can press. "#rrggbb". */
  primary: Hex;
  /** The second accent, for people and tags. Without it, `tag` is Material's tertiary role. */
  tag?: Hex | undefined;
  schemeStyle: SchemeStyle;
  contrast: ContrastLevel;
}

/** Every colour token, so a mode's colours can be listed and overridden. */
export type ColorTokenName = Exclude<TokenName, "radius">;

/** One mode's colours as "#RRGGBB". */
export type ModeColors = Record<ColorTokenName, Hex>;

/** Per mode, per token: a colour that replaces the generated one. */
export type Overrides = Partial<Record<Mode, Partial<Record<ColorTokenName, Hex>>>>;

/** Material's contrast level for themarr's 0, 1, 2 (standard, medium, high). */
export const MATERIAL_CONTRAST: Readonly<Record<ContrastLevel, number>> = { 0: 0, 1: 0.5, 2: 1 };

/** Status colours have no Material role: fixed hues, through tonal palettes. */
export const STATUS_SEEDS = { success: "#2E7D32", warning: "#E8A317", info: "#0277BD" } as const;

/**
 * Tones for a colour from a fixed palette (status colours, the tag seed):
 * [colour, its foreground] per mode. They are Material's primary tones at
 * standard contrast (decision 0003), at every contrast level: 40 on 100 and
 * 80 on 20 reach 4.5:1 for any hue (the tests), and the golden fixtures use
 * them.
 */
export const FIXED_TONES: Readonly<Record<Mode, readonly [number, number]>> = {
  light: [40, 100],
  dark: [80, 20],
};

/** The radius a new theme gets. */
export const DEFAULT_RADIUS: DimensionToken = { $type: "dimension", $value: { value: 0.5, unit: "rem" } };

export const COLOR_TOKENS: readonly ColorTokenName[] = TOKENS.filter((t) => t.kind === "color").map(
  (t) => t.name as ColorTokenName,
);

type SchemeClass = new (source: Hct, isDark: boolean, contrastLevel: number, specVersion?: "2021" | "2025") => DynamicScheme;

const SCHEMES: Record<SchemeStyle, SchemeClass> = {
  tonal: SchemeTonalSpot,
  vibrant: SchemeVibrant,
  expressive: SchemeExpressive,
  neutral: SchemeNeutral,
};

/** "#RRGGBB" for a "#rrggbb" string, or null. */
export function normalizeHex(value: string): Hex | null {
  const v = value.trim();
  return HEX_PATTERN.test(v) ? v.toUpperCase() : null;
}

function hexOfArgb(argb: number): Hex {
  return hexFromArgb(argb).toUpperCase();
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

/** A DTCG colour token for "#rrggbb" (components to 4 decimals, as the fixtures). */
export function colorToken(hex: Hex): ColorToken {
  const h = normalizeHex(hex);
  if (h === null) throw new TypeError(`[themarr] "${hex}" is not a #rrggbb colour`);
  const n = Number.parseInt(h.slice(1), 16);
  const components: [number, number, number] = [
    round4(((n >> 16) & 255) / 255),
    round4(((n >> 8) & 255) / 255),
    round4((n & 255) / 255),
  ];
  return { $type: "color", $value: { colorSpace: "srgb", components, hex: h } };
}

function scheme(input: PaletteInput, mode: Mode): DynamicScheme {
  const source = Hct.fromInt(argbFromHex(input.primary));
  return new SCHEMES[input.schemeStyle](source, mode === "dark", MATERIAL_CONTRAST[input.contrast], "2021");
}

/** One mode's colours from the seeds. */
export function modeColors(input: PaletteInput, mode: Mode): ModeColors {
  const s = scheme(input, mode);
  const [tone, onTone] = FIXED_TONES[mode];
  const fixed = (hex: string): [Hex, Hex] => {
    const p = TonalPalette.fromInt(argbFromHex(hex));
    return [hexOfArgb(p.tone(tone)), hexOfArgb(p.tone(onTone))];
  };
  const [tag, tagFg] = input.tag === undefined ? [hexOfArgb(s.tertiary), hexOfArgb(s.onTertiary)] : fixed(input.tag);
  const [success, successFg] = fixed(STATUS_SEEDS.success);
  const [warning, warningFg] = fixed(STATUS_SEEDS.warning);
  const [info, infoFg] = fixed(STATUS_SEEDS.info);
  const h = hexOfArgb;
  return {
    background: h(s.surface),
    card: h(s.surfaceContainerLow),
    popover: h(s.surfaceContainer),
    muted: h(s.surfaceContainerHighest),
    "surface-1": h(s.surfaceContainerLow),
    "surface-2": h(s.surfaceContainer),
    "surface-3": h(s.surfaceContainerHigh),
    border: h(s.outlineVariant),
    input: h(s.outline),
    foreground: h(s.onSurface),
    "card-foreground": h(s.onSurface),
    "popover-foreground": h(s.onSurface),
    "muted-foreground": h(s.onSurfaceVariant),
    primary: h(s.primary),
    "primary-foreground": h(s.onPrimary),
    secondary: h(s.secondaryContainer),
    "secondary-foreground": h(s.onSecondaryContainer),
    accent: h(s.primaryContainer),
    "accent-foreground": h(s.onPrimaryContainer),
    ring: h(s.primary),
    tag,
    "tag-foreground": tagFg,
    destructive: h(s.error),
    "destructive-foreground": h(s.onError),
    success,
    "success-foreground": successFg,
    warning,
    "warning-foreground": warningFg,
    info,
    "info-foreground": infoFg,
    "chart-1": h(s.primary),
    "chart-2": tag,
    "chart-3": info,
    "chart-4": success,
    "chart-5": warning,
  };
}

/** Both modes' colours from the seeds. */
export function makeColors(input: PaletteInput): Record<Mode, ModeColors> {
  return { light: modeColors(input, "light"), dark: modeColors(input, "dark") };
}

/** Colours (any subset of tokens) as DTCG tokens, in the vocabulary's order, plus the radius. */
export function toModeTokens(colors: Partial<Record<ColorTokenName, Hex>>, radius: DimensionToken = DEFAULT_RADIUS): ModeTokens {
  const out: Record<string, ColorToken | DimensionToken> = {};
  for (const name of COLOR_TOKENS) {
    const v = colors[name];
    if (v !== undefined) out[name] = colorToken(v);
  }
  out["radius"] = { $type: "dimension", $value: { ...radius.$value } };
  return out as ModeTokens;
}

/** The colours of a stored mode, as "#RRGGBB" (radius left out). */
export function colorsOf(tokens: ModeTokens | undefined): Partial<Record<ColorTokenName, Hex>> {
  const out: Partial<Record<ColorTokenName, Hex>> = {};
  if (tokens === undefined) return out;
  for (const name of COLOR_TOKENS) {
    const t = tokens[name];
    if (t !== undefined) out[name] = t.$value.hex.toUpperCase();
  }
  return out;
}

/** Generated colours with the overrides on top. */
export function applyOverrides(colors: Record<Mode, ModeColors>, overrides: Overrides = {}): Record<Mode, ModeColors> {
  const out = { light: { ...colors.light }, dark: { ...colors.dark } };
  for (const mode of MODES) {
    for (const [name, hex] of Object.entries(overrides[mode] ?? {})) {
      const h = hex === undefined ? null : normalizeHex(hex);
      if (h !== null && (COLOR_TOKENS as readonly string[]).includes(name)) out[mode][name as ColorTokenName] = h;
    }
  }
  return out;
}

/** The tokens that differ from what the seeds make: the overrides of a stored seeded theme. */
export function findOverrides(theme: Pick<Theme, "modes" | "tokens">, input: PaletteInput): Overrides {
  const made = makeColors(input);
  const out: Overrides = {};
  for (const mode of theme.modes) {
    const stored = colorsOf(theme.tokens[mode]);
    for (const name of COLOR_TOKENS) {
      const v = stored[name];
      if (v !== undefined && v !== made[mode][name]) (out[mode] ??= {})[name] = v;
    }
  }
  return out;
}

export interface SeededThemeInput {
  id: string;
  name: string;
  /** The server sets the real version on save; 1 for a new theme. */
  version?: number;
  seeds: { primary: Hex; tag?: Hex | undefined };
  schemeStyle: SchemeStyle;
  contrast: ContrastLevel;
  overrides?: Overrides;
  radius?: DimensionToken;
}

/** A complete seeded theme, both modes, ready for validateTheme and PUT /v1/themes/{id}. */
export function makeSeededTheme(t: SeededThemeInput): Theme {
  const primary = normalizeHex(t.seeds.primary);
  if (primary === null) throw new TypeError(`[themarr] "${t.seeds.primary}" is not a #rrggbb colour`);
  const tagSeed = t.seeds.tag === undefined ? undefined : normalizeHex(t.seeds.tag);
  if (tagSeed === null) throw new TypeError(`[themarr] "${String(t.seeds.tag)}" is not a #rrggbb colour`);
  const input: PaletteInput = { primary, tag: tagSeed, schemeStyle: t.schemeStyle, contrast: t.contrast };
  const colors = applyOverrides(makeColors(input), t.overrides);
  const source: SeededSource = {
    kind: "seeded",
    seeds: tagSeed === undefined ? { primary } : { primary, tag: tagSeed },
    schemeStyle: t.schemeStyle,
    contrast: t.contrast,
  };
  const radius = t.radius ?? DEFAULT_RADIUS;
  return {
    id: t.id,
    name: t.name,
    version: t.version ?? 1,
    source,
    modes: ["light", "dark"],
    tokens: { light: toModeTokens(colors.light, radius), dark: toModeTokens(colors.dark, radius) },
  };
}
