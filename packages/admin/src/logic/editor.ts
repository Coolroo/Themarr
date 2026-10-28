// The theme editor's model: a stored theme → the form's state, the state →
// the draft colours (shown live), and the state → the theme that is saved.
// Seeded themes are made by @themarr/palette; hand-made ones hold every
// colour as typed. Pure functions; the tests run them.

import {
  applyOverrides,
  COLOR_TOKENS,
  colorsOf,
  DEFAULT_RADIUS,
  findOverrides,
  makeColors,
  normalizeHex,
  toModeTokens,
  type ColorTokenName,
  type ModeColors,
  type Overrides,
  type PaletteInput,
} from "@themarr/palette";
import {
  ID_MAX_LENGTH,
  ID_PATTERN,
  MODES,
  TOKEN_GROUPS,
  TOKENS,
  validateTheme,
  type ContrastLevel,
  type DimensionToken,
  type Mode,
  type SchemeStyle,
  type Theme,
  type TokenGroup,
  type TokenName,
} from "@themarr/tokens";

export const PRESETS = ["#5146D9", "#E0662F", "#3F8F5A", "#1F7AA8", "#B04FC4", "#5F6672"] as const;

export const RESERVED_IDS = ["inherit", "none"] as const;

export type SourceKind = "seeded" | "handmade";

export interface EditorState {
  isNew: boolean;
  id: string;
  /** The admin typed the id; stop deriving it from the name. */
  idTouched: boolean;
  name: string;
  /** The stored version (the server sets the next one). */
  version: number;
  source: SourceKind;
  /** The accent seed, "#RRGGBB" (kept while hand-made, for a switch back). */
  primary: string;
  /** The second accent's seed; null is auto (Material's tertiary). */
  tag: string | null;
  schemeStyle: SchemeStyle;
  contrast: ContrastLevel;
  /** Seeded: per token, the text of its override field ("" is auto). */
  overrides: Partial<Record<ColorTokenName, string>>;
  /** Hand-made: every colour per mode (both kept, even for a mode left out). */
  hand: Record<Mode, ModeColors>;
  handModes: Record<Mode, boolean>;
  /** Hand-made: the theme has the optional tag and tag-foreground. */
  handTag: boolean;
  /** "0.5rem" or "10px". */
  radius: string;
}

const DEFAULT_PRIMARY = "#5146D9";

function input(s: Pick<EditorState, "primary" | "tag" | "schemeStyle" | "contrast">): PaletteInput {
  return {
    primary: normalizeHex(s.primary) ?? DEFAULT_PRIMARY,
    tag: s.tag === null ? undefined : (normalizeHex(s.tag) ?? undefined),
    schemeStyle: s.schemeStyle,
    contrast: s.contrast,
  };
}

export function radiusText(r: DimensionToken | undefined): string {
  const v = (r ?? DEFAULT_RADIUS).$value;
  return `${v.value}${v.unit}`;
}

/** "0.5rem", "10px" → a dimension token; anything else → null. */
export function parseRadius(text: string): DimensionToken | null {
  const m = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*(px|rem)\s*$/.exec(text);
  if (m === null) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value < 0 || value > 1000) return null;
  return { $type: "dimension", $value: { value, unit: m[2] as "px" | "rem" } };
}

/** A new theme: Coolroo indigo, tonal spot, standard contrast. */
export function newEditorState(): EditorState {
  const base = { primary: DEFAULT_PRIMARY, tag: null, schemeStyle: "tonal" as const, contrast: 0 as const };
  return {
    isNew: true,
    id: "",
    idTouched: false,
    name: "",
    version: 1,
    source: "seeded",
    ...base,
    overrides: {},
    hand: makeColors(input(base)),
    handModes: { light: true, dark: true },
    handTag: true,
    radius: radiusText(undefined),
  };
}

/** One override field's text: "#ABCDEF" (both modes), "#111111 #EEEEEE" (light, dark), or "auto" for a side. */
export function formatOverride(light: string | undefined, dark: string | undefined): string {
  if (light === undefined && dark === undefined) return "";
  if (light !== undefined && light === dark) return light;
  return `${light ?? "auto"} ${dark ?? "auto"}`;
}

export type ParsedOverride = { ok: true; light?: string; dark?: string } | { ok: false };

/** The text of an override field → a colour per mode. */
export function parseOverride(text: string): ParsedOverride {
  const parts = text.trim().split(/[\s,/]+/).filter((p) => p !== "");
  if (parts.length === 0) return { ok: true };
  if (parts.length > 2) return { ok: false };
  const one = (p: string): string | null | undefined => (p.toLowerCase() === "auto" ? undefined : normalizeHex(p));
  const a = one(parts[0] ?? "");
  const b = parts.length === 2 ? one(parts[1] ?? "") : a;
  if (a === null || b === null) return { ok: false };
  const out: { ok: true; light?: string; dark?: string } = { ok: true };
  if (a !== undefined) out.light = a;
  if (b !== undefined) out.dark = b;
  return out;
}

function overridesText(o: Overrides): Partial<Record<ColorTokenName, string>> {
  const out: Partial<Record<ColorTokenName, string>> = {};
  for (const name of COLOR_TOKENS) {
    const t = formatOverride(o.light?.[name], o.dark?.[name]);
    if (t !== "") out[name] = t;
  }
  return out;
}

/** The override fields as overrides, and the tokens whose text is not a colour. */
export function overridesOf(state: Pick<EditorState, "overrides">): { overrides: Overrides; invalid: ColorTokenName[] } {
  const overrides: Overrides = {};
  const invalid: ColorTokenName[] = [];
  for (const name of COLOR_TOKENS) {
    const p = parseOverride(state.overrides[name] ?? "");
    if (!p.ok) {
      invalid.push(name);
      continue;
    }
    if (p.light !== undefined) (overrides.light ??= {})[name] = p.light;
    if (p.dark !== undefined) (overrides.dark ??= {})[name] = p.dark;
  }
  return { overrides, invalid };
}

/** A stored theme in the form. */
export function editorFromTheme(theme: Theme): EditorState {
  const first = theme.modes.includes("light") ? "light" : "dark";
  const radius = radiusText(theme.tokens[first]?.radius);
  const common = { isNew: false, id: theme.id, idTouched: true, name: theme.name, version: theme.version, radius };
  if (theme.source.kind === "seeded") {
    const s = {
      primary: theme.source.seeds.primary.toUpperCase(),
      tag: theme.source.seeds.tag?.toUpperCase() ?? null,
      schemeStyle: theme.source.schemeStyle,
      contrast: theme.source.contrast,
    };
    const found = findOverrides(theme, input(s));
    return {
      ...common,
      source: "seeded",
      ...s,
      overrides: overridesText(found),
      hand: applyOverrides(makeColors(input(s)), found),
      handModes: { light: true, dark: true },
      handTag: true,
    };
  }
  const primary = colorsOf(theme.tokens[first]).primary ?? DEFAULT_PRIMARY;
  const base = makeColors({ primary, schemeStyle: "tonal", contrast: 0 });
  const hand = {
    light: { ...base.light, ...colorsOf(theme.tokens.light) },
    dark: { ...base.dark, ...colorsOf(theme.tokens.dark) },
  };
  return {
    ...common,
    source: "handmade",
    primary,
    tag: null,
    schemeStyle: "tonal",
    contrast: 0,
    overrides: {},
    hand,
    handModes: { light: theme.modes.includes("light"), dark: theme.modes.includes("dark") },
    handTag: theme.modes.some((m) => theme.tokens[m]?.tag !== undefined),
  };
}

/** The colours the theme has now, per mode it has. */
export function draftColors(state: EditorState): Partial<Record<Mode, Partial<ModeColors>>> {
  if (state.source === "seeded") {
    return applyOverrides(makeColors(input(state)), overridesOf(state).overrides);
  }
  const out: Partial<Record<Mode, Partial<ModeColors>>> = {};
  for (const mode of MODES) {
    if (!state.handModes[mode]) continue;
    const c: Partial<ModeColors> = { ...state.hand[mode] };
    if (!state.handTag) {
      delete c.tag;
      delete c["tag-foreground"];
    }
    out[mode] = c;
  }
  return out;
}

/** Switch the source. Hand-made starts from the colours shown now. */
export function withSource(state: EditorState, source: SourceKind): EditorState {
  if (source === state.source) return state;
  if (source === "handmade") {
    const d = applyOverrides(makeColors(input(state)), overridesOf(state).overrides);
    return { ...state, source, hand: d, handModes: { light: true, dark: true }, handTag: true };
  }
  return { ...state, source, overrides: {} };
}

/** A slug for a theme name: "Ocean Night!" → "ocean-night". */
export function slugify(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ID_MAX_LENGTH)
    .replace(/-+$/g, "");
  return (RESERVED_IDS as readonly string[]).includes(s) ? `${s}-theme` : s;
}

/** Why an id can't be used, or null. */
export function idProblem(id: string, isNew: boolean, existing: readonly string[]): string | null {
  if (id === "") return "Give the theme an ID.";
  if (id.length > ID_MAX_LENGTH || !ID_PATTERN.test(id)) return "An ID is lower-case letters, digits and single dashes, at most 64.";
  if ((RESERVED_IDS as readonly string[]).includes(id)) return `"${id}" is reserved.`;
  if (isNew && existing.includes(id)) return "A theme with this ID exists. Choose another.";
  return null;
}

export interface Built {
  theme: Theme | null;
  /** What stops the save, for people. */
  problems: string[];
}

/** The theme to save, or why it can't be saved yet. */
export function buildTheme(state: EditorState, existingIds: readonly string[]): Built {
  const problems: string[] = [];
  const idp = idProblem(state.id, state.isNew, existingIds);
  if (idp !== null) problems.push(idp);
  if (state.name.trim() === "") problems.push("Give the theme a name.");
  const radius = parseRadius(state.radius);
  if (radius === null) problems.push("Radius is a number with px or rem, such as 0.5rem.");
  const { invalid } = overridesOf(state);
  if (state.source === "seeded" && invalid.length > 0) {
    problems.push(`Not a colour: ${invalid.join(", ")}. Use #rrggbb, or two of them (light, dark), or leave it empty.`);
  }
  if (state.source === "seeded" && normalizeHex(state.primary) === null) problems.push("The accent colour is not #rrggbb.");
  if (state.source === "handmade" && !state.handModes.light && !state.handModes.dark) problems.push("A theme needs at least one mode.");
  if (problems.length > 0) return { theme: null, problems };

  const colors = draftColors(state);
  const modes = MODES.filter((m) => colors[m] !== undefined);
  const tokens: Theme["tokens"] = {};
  for (const m of modes) tokens[m] = toModeTokens(colors[m] ?? {}, radius ?? DEFAULT_RADIUS);
  const p = input(state);
  const theme: Theme = {
    id: state.id,
    name: state.name.trim(),
    version: state.version,
    source:
      state.source === "seeded"
        ? { kind: "seeded", seeds: p.tag === undefined ? { primary: p.primary } : { primary: p.primary, tag: p.tag }, schemeStyle: p.schemeStyle, contrast: p.contrast }
        : { kind: "handmade" },
    modes,
    tokens,
  };
  const res = validateTheme(theme);
  if (!res.ok) return { theme: null, problems: res.errors };
  return { theme: res.theme, problems: [] };
}

export const GROUP_LABEL: Readonly<Record<TokenGroup, string>> = {
  surface: "Surfaces",
  text: "Text",
  brand: "Brand",
  "second-accent": "Second accent",
  status: "Status",
  chart: "Charts",
  shape: "Shape",
};

export interface TokenRow {
  name: TokenName;
  light: string | null;
  dark: string | null;
  /** Seeded: the override field's text. */
  override: string;
  overridden: boolean;
  invalid: boolean;
}

export interface TokenGroupRows {
  group: TokenGroup;
  label: string;
  rows: TokenRow[];
}

/** The token list, grouped as the manifest groups it (radius is its own field). */
export function tokenGroups(state: EditorState): TokenGroupRows[] {
  const colors = draftColors(state);
  const { invalid } = overridesOf(state);
  return TOKEN_GROUPS.filter((g) => g !== "shape").map((group) => ({
    group,
    label: GROUP_LABEL[group],
    rows: TOKENS.filter((t) => t.group === group).map((t) => {
      const name = t.name as ColorTokenName;
      const text = state.overrides[name] ?? "";
      return {
        name,
        light: colors.light?.[name] ?? null,
        dark: colors.dark?.[name] ?? null,
        override: text,
        overridden: state.source === "seeded" && text.trim() !== "" && parseOverride(text).ok,
        invalid: invalid.includes(name),
      };
    }),
  }));
}

/** How many tokens are overridden, as the token list's heading says it. */
export function overrideCountText(state: EditorState): string {
  if (state.source === "handmade") return "Every colour set by hand";
  const n = COLOR_TOKENS.filter((name) => {
    const t = state.overrides[name] ?? "";
    return t.trim() !== "" && parseOverride(t).ok;
  }).length;
  return n === 0 ? "All automatic" : `${n} ${n === 1 ? "override" : "overrides"}`;
}

/** The form compared for "Unsaved changes" (the id flag aside). */
export function sameState(a: EditorState, b: EditorState): boolean {
  const strip = (s: EditorState) => ({ ...s, idTouched: false });
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}
