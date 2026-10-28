// The CSS text for a theme: one rule per mode the theme has, on the app's
// selector, scoped to the app's way of marking dark mode.

import { cssVar, isTokenName, MODES, TOKENS, type Mode, type ModeTokens, type TokenName } from "@themarr/tokens";
import { formatColor, formatDimension } from "./color.ts";
import type { BootResult, DarkStrategy, Format, RenderOptions, WireTheme } from "./types.ts";

const FORMATS: readonly string[] = ["oklch", "hsl-triple", "hex", "rgb-triplet"];
const VAR_PATTERN = /^--[A-Za-z0-9_-]+$/;
const CLASS_PATTERN = /^-?[_A-Za-z][_A-Za-z0-9-]*$/;
const ATTR_PATTERN = /^[_A-Za-z][_A-Za-z0-9.-]*$/;
// No block, statement or at-rule characters, no "<" (it could end a <style>
// when an app renders the CSS into one on its server), and no comment
// ("/*" or "*/", which could hide the rest of the rule).
const SELECTOR_FORBIDDEN = /[{};<@\\\u0000-\u001f\u007f]|\/\*|\*\//;
// dark.value goes inside [attr="value"]: no quote, backslash, "<" or ">",
// and no comment either.
const VALUE_FORBIDDEN = /["\\<>\u0000-\u001f\u007f]|\/\*|\*\//;

/** The render options after checks, with defaults. */
export interface Render {
  selector: string;
  dark: DarkStrategy;
  mode?: Mode;
  map: RenderOptions["map"];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Check render options. Returns the options with defaults, or the first problem as text. */
export function checkRender(o: RenderOptions): Render | string {
  const selector = o.selector ?? ":root";
  if (typeof selector !== "string" || selector.trim() === "" || selector.length > 1000 || SELECTOR_FORBIDDEN.test(selector)) {
    return "bad option selector";
  }
  const dark: unknown = o.dark ?? "media";
  if (dark !== "media") {
    if (!isObject(dark)) return "bad option dark";
    if ("class" in dark) {
      if (Object.keys(dark).length !== 1 || typeof dark["class"] !== "string" || !CLASS_PATTERN.test(dark["class"])) {
        return "bad option dark.class";
      }
    } else if ("attr" in dark) {
      if (Object.keys(dark).length !== 2 || typeof dark["attr"] !== "string" || !ATTR_PATTERN.test(dark["attr"])) {
        return "bad option dark.attr";
      }
      if (typeof dark["value"] !== "string" || VALUE_FORBIDDEN.test(dark["value"])) return "bad option dark.value";
    } else {
      return "bad option dark";
    }
  }
  if (o.mode !== undefined && !(MODES as readonly unknown[]).includes(o.mode)) return "bad option mode";
  if (o.map !== undefined) {
    if (!isObject(o.map)) return "bad option map";
    for (const [token, entries] of Object.entries(o.map)) {
      if (!isTokenName(token)) return `bad option map: "${token}" is not a themarr token`;
      if (!Array.isArray(entries)) return `bad option map.${token}`;
      for (const [i, e] of (entries as unknown[]).entries()) {
        if (!isObject(e) || typeof e["var"] !== "string" || !VAR_PATTERN.test(e["var"])) return `bad option map.${token}[${i}].var`;
        if (typeof e["format"] !== "string" || !FORMATS.includes(e["format"])) return `bad option map.${token}[${i}].format`;
      }
    }
  }
  const r: Render = { selector, dark: dark as DarkStrategy, map: o.map };
  if (o.mode !== undefined) r.mode = o.mode;
  return r;
}

/** Split a selector list at its top-level commas (not inside (), [] or quotes). */
export function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (quote !== "") {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts.filter((p) => p !== "");
}

/** The CSS value of one token (oklch for colours), as the --themarr-* variables use. */
export function tokenValue(tokens: ModeTokens, name: TokenName, format: Format = "oklch"): string | undefined {
  if (name === "radius") {
    const t = tokens.radius;
    return t === undefined ? undefined : formatDimension(t.$value);
  }
  const t = tokens[name];
  return t === undefined ? undefined : formatColor(t.$value, format);
}

/** Per mode the theme has: token → CSS value in oklch (BootResult.tokens). */
export function themeValues(theme: WireTheme): NonNullable<BootResult["tokens"]> {
  const out: NonNullable<BootResult["tokens"]> = {};
  for (const mode of theme.modes) {
    const set = theme.tokens[mode];
    if (set === undefined) continue;
    const values: { [K in TokenName]?: string } = {};
    for (const spec of TOKENS) {
      const v = tokenValue(set, spec.name);
      if (v !== undefined) values[spec.name] = v;
    }
    out[mode] = values;
  }
  return out;
}

function declarations(tokens: ModeTokens, map: Render["map"]): string[] {
  const lines: string[] = [];
  for (const spec of TOKENS) {
    const v = tokenValue(tokens, spec.name);
    if (v === undefined) continue; // An optional token the theme lacks: the app's value stays.
    lines.push(`${cssVar(spec.name)}: ${v};`);
  }
  if (map !== undefined) {
    for (const spec of TOKENS) {
      for (const e of map[spec.name] ?? []) {
        const v = tokenValue(tokens, spec.name, e.format);
        if (v !== undefined) lines.push(`${e.var}: ${v};`);
      }
    }
  }
  return lines;
}

function rule(selectors: string[], lines: string[], indent = ""): string {
  const body = lines.map((l) => `${indent}  ${l}`).join("\n");
  return `${indent}${selectors.join(`,\n${indent}`)} {\n${body}\n${indent}}`;
}

function modeRule(r: Render, mode: Mode, lines: string[]): string {
  const parts = splitSelectors(r.selector);
  const d = r.dark;
  if (d === "media") {
    return `@media (prefers-color-scheme: ${mode}) {\n${rule(parts, lines, "  ")}\n}`;
  }
  const mark = "class" in d ? `.${d.class}` : `[${d.attr}="${d.value}"]`;
  return rule(
    parts.map((p) => (mode === "dark" ? `${p}${mark}` : `${p}:not(${mark})`)),
    lines,
  );
}

/**
 * The CSS text for a theme, or "" when there is nothing to draw (no theme,
 * or no palette for the forced mode). Only the modes the theme has get a
 * rule: in a mode the theme lacks, the app keeps its own look.
 */
export function cssFor(theme: WireTheme | undefined, r: Render): string {
  if (theme === undefined) return "";
  if (r.mode !== undefined) {
    const set = theme.modes.includes(r.mode) ? theme.tokens[r.mode] : undefined;
    return set === undefined ? "" : rule(splitSelectors(r.selector), declarations(set, r.map)) + "\n";
  }
  const rules: string[] = [];
  for (const mode of MODES) {
    const set = theme.modes.includes(mode) ? theme.tokens[mode] : undefined;
    if (set !== undefined) rules.push(modeRule(r, mode, declarations(set, r.map)));
  }
  return rules.length === 0 ? "" : rules.join("\n") + "\n";
}
