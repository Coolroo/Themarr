// The shape of a stored theme (DTCG 2025.10 tokens, sRGB colours).

import type { ContrastLevel, DimensionUnit, Mode, SchemeStyle, TokenName } from "./tokens.ts";

/** "#rrggbb", either case. */
export type Hex = string;

export interface ColorValue {
  colorSpace: "srgb";
  /** r, g, b in 0..1. */
  components: [number, number, number];
  /** The same colour as "#rrggbb"; must agree with components. */
  hex: Hex;
  /** 0..1; absent means opaque. */
  alpha?: number;
}

export interface ColorToken {
  $type: "color";
  $value: ColorValue;
}

export interface DimensionValue {
  value: number;
  unit: DimensionUnit;
}

export interface DimensionToken {
  $type: "dimension";
  $value: DimensionValue;
}

export type Token = ColorToken | DimensionToken;

/** One mode's tokens. Every required name is present after validation. */
export type ModeTokens = { [K in Exclude<TokenName, "radius">]?: ColorToken } & { radius?: DimensionToken };

export interface SeededSource {
  kind: "seeded";
  seeds: { primary: Hex; tag?: Hex };
  schemeStyle: SchemeStyle;
  contrast: ContrastLevel;
}

export interface HandmadeSource {
  kind: "handmade";
}

export type ThemeSource = SeededSource | HandmadeSource;

export interface Theme {
  /** Slug: lower-case letters, digits and single hyphens. */
  id: string;
  name: string;
  /** Integer ≥ 1; the server bumps it on every write. */
  version: number;
  source: ThemeSource;
  /** Non-empty, unique, a subset of ["light", "dark"]. */
  modes: Mode[];
  /** Exactly one entry per listed mode. */
  tokens: Partial<Record<Mode, ModeTokens>>;
}
