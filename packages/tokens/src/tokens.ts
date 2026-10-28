// The token vocabulary: every name a theme may carry, its group, its kind and
// whether each listed mode must have it. This list is the source of truth;
// tokens.manifest.json and schema/theme.schema.json are tested against it.

export const TOKEN_GROUPS = [
  "surface",
  "text",
  "brand",
  "second-accent",
  "status",
  "chart",
  "shape",
] as const;
export type TokenGroup = (typeof TOKEN_GROUPS)[number];

/** A token's kind is its DTCG `$type`. */
export const TOKEN_KINDS = ["color", "dimension"] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

export interface TokenSpec {
  readonly name: string;
  readonly group: TokenGroup;
  readonly kind: TokenKind;
  /** Every mode a theme lists must have this token. */
  readonly required: boolean;
  /** For a foreground: the token it is drawn on (checked for contrast). */
  readonly on?: string;
}

interface ColorSpec<N extends string> extends TokenSpec {
  readonly name: N;
  readonly kind: "color";
  readonly required: true;
}

function color<const N extends string>(name: N, group: TokenGroup, on?: string): ColorSpec<N> {
  return on === undefined
    ? { name, group, kind: "color", required: true }
    : { name, group, kind: "color", required: true, on };
}

export const TOKENS = [
  // Surfaces
  color("background", "surface"),
  color("card", "surface"),
  color("popover", "surface"),
  color("muted", "surface"),
  color("surface-1", "surface"),
  color("surface-2", "surface"),
  color("surface-3", "surface"),
  color("border", "surface"),
  color("input", "surface"),
  // Text
  color("foreground", "text", "background"),
  color("card-foreground", "text", "card"),
  color("popover-foreground", "text", "popover"),
  color("muted-foreground", "text", "muted"),
  // Brand
  color("primary", "brand"),
  color("primary-foreground", "brand", "primary"),
  color("secondary", "brand"),
  color("secondary-foreground", "brand", "secondary"),
  color("accent", "brand"),
  color("accent-foreground", "brand", "accent"),
  color("ring", "brand"),
  // Second accent: people and tags (asked for by Drives). Optional.
  { name: "tag", group: "second-accent", kind: "color", required: false },
  { name: "tag-foreground", group: "second-accent", kind: "color", required: false, on: "tag" },
  // Status
  color("destructive", "status"),
  color("destructive-foreground", "status", "destructive"),
  color("success", "status"),
  color("success-foreground", "status", "success"),
  color("warning", "status"),
  color("warning-foreground", "status", "warning"),
  color("info", "status"),
  color("info-foreground", "status", "info"),
  // Charts
  color("chart-1", "chart"),
  color("chart-2", "chart"),
  color("chart-3", "chart"),
  color("chart-4", "chart"),
  color("chart-5", "chart"),
  // Shape
  { name: "radius", group: "shape", kind: "dimension", required: true },
] as const satisfies readonly TokenSpec[];

export type TokenName = (typeof TOKENS)[number]["name"];

export const TOKEN_NAMES: readonly TokenName[] = TOKENS.map((t) => t.name);
export const REQUIRED_TOKENS: readonly TokenName[] = TOKENS.filter((t) => t.required).map((t) => t.name);
export const OPTIONAL_TOKENS: readonly TokenName[] = TOKENS.filter((t) => !t.required).map((t) => t.name);

const byName: ReadonlyMap<string, TokenSpec> = new Map(TOKENS.map((t) => [t.name, t]));

/** The spec of a token name, or undefined for a name not in the vocabulary. */
export function tokenSpec(name: string): TokenSpec | undefined {
  return byName.get(name);
}

export function isTokenName(name: string): name is TokenName {
  return byName.has(name);
}

/** [foreground, base] for every token that is drawn on another one. */
export const CONTRAST_PAIRS: readonly (readonly [TokenName, TokenName])[] = TOKENS.flatMap(
  (t: TokenSpec) => (t.on === undefined ? [] : [[t.name as TokenName, t.on as TokenName] as const]),
);

// Theme-level vocabularies.
export const MODES = ["light", "dark"] as const;
export type Mode = (typeof MODES)[number];

export const SOURCE_KINDS = ["seeded", "handmade"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Material Color Utilities scheme styles the admin UI offers. */
export const SCHEME_STYLES = ["tonal", "vibrant", "expressive", "neutral"] as const;
export type SchemeStyle = (typeof SCHEME_STYLES)[number];

/** 0 standard, 1 medium, 2 high (Material's contrast levels 0, 0.5, 1). */
export const CONTRAST_LEVELS = [0, 1, 2] as const;
export type ContrastLevel = (typeof CONTRAST_LEVELS)[number];

export const DIMENSION_UNITS = ["px", "rem"] as const;
export type DimensionUnit = (typeof DIMENSION_UNITS)[number];

/** The CSS custom property the SDK sets for a token when an app has no map. */
export function cssVar(name: TokenName): `--themarr-${TokenName}` {
  return `--themarr-${name}`;
}
