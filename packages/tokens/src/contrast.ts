// WCAG 2.x contrast for sRGB components (0..1). Used by the tests over the
// golden fixtures, and by the admin UI's contrast warnings.

import { CONTRAST_PAIRS, type Mode, type TokenName } from "./tokens.ts";
import type { ColorToken, Theme } from "./theme.ts";

/** WCAG AA for body text. */
export const MIN_TEXT_CONTRAST = 4.5;

function linear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an opaque sRGB colour. */
export function relativeLuminance(rgb: readonly [number, number, number]): number {
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface ContrastResult {
  mode: Mode;
  foreground: TokenName;
  base: TokenName;
  ratio: number;
}

/** The ratio of every foreground/base pair present in each of the theme's modes. */
export function themeContrasts(theme: Theme): ContrastResult[] {
  const out: ContrastResult[] = [];
  for (const mode of theme.modes) {
    const tokens = theme.tokens[mode];
    if (tokens === undefined) continue;
    for (const [fg, base] of CONTRAST_PAIRS) {
      const f = tokens[fg as keyof typeof tokens] as ColorToken | undefined;
      const b = tokens[base as keyof typeof tokens] as ColorToken | undefined;
      if (f === undefined || b === undefined) continue;
      out.push({ mode, foreground: fg, base, ratio: contrastRatio(f.$value.components, b.$value.components) });
    }
  }
  return out;
}
