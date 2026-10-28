// The editor's contrast checks: every foreground on its base (the pairs of
// the token manifest), per mode, against WCAG AA (4.5:1). The admin is
// warned, never stopped (decision 0005).

import { CONTRAST_PAIRS, contrastRatio, MIN_TEXT_CONTRAST, type Mode, type TokenName } from "@themarr/tokens";

export const PAIR_LABEL: Readonly<Partial<Record<TokenName, string>>> = {
  foreground: "Text on background",
  "card-foreground": "Text on cards",
  "popover-foreground": "Text on pop-ups",
  "muted-foreground": "Muted text",
  "primary-foreground": "Primary button text",
  "secondary-foreground": "Secondary button text",
  "accent-foreground": "Accent text",
  "tag-foreground": "Tag text",
  "destructive-foreground": "Delete button text",
  "success-foreground": "Success badge text",
  "warning-foreground": "Warning badge text",
  "info-foreground": "Info badge text",
};

export interface Ratio {
  ratio: number;
  ok: boolean;
  /** "7.2:1" */
  text: string;
}

export interface ContrastRow {
  foreground: TokenName;
  base: TokenName;
  label: string;
  /** Null: the theme has no such mode, or the pair is not in it (an optional tag). */
  light: Ratio | null;
  dark: Ratio | null;
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function one(colors: Partial<Record<string, string>> | undefined, fg: TokenName, base: TokenName): Ratio | null {
  const f = colors?.[fg];
  const b = colors?.[base];
  if (f === undefined || b === undefined) return null;
  const ratio = contrastRatio(rgb(f), rgb(b));
  // Shown to one decimal, so round down: 4.47 must not read "4.5:1" and pass.
  return { ratio, ok: ratio >= MIN_TEXT_CONTRAST, text: `${(Math.floor(ratio * 10) / 10).toFixed(1)}:1` };
}

/** One row per foreground/base pair, with the ratio in each mode. */
export function contrastRows(colors: Partial<Record<Mode, Partial<Record<string, string>>>>): ContrastRow[] {
  return CONTRAST_PAIRS.map(([fg, base]) => ({
    foreground: fg,
    base,
    label: PAIR_LABEL[fg] ?? `${fg} on ${base}`,
    light: one(colors.light, fg, base),
    dark: one(colors.dark, fg, base),
  }));
}

/** How many checks fall short, and how many there are. */
export function contrastSummary(rows: readonly ContrastRow[]): { failing: number; total: number; text: string } {
  let failing = 0;
  let total = 0;
  for (const r of rows) {
    for (const v of [r.light, r.dark]) {
      if (v === null) continue;
      total++;
      if (!v.ok) failing++;
    }
  }
  const text =
    failing === 0
      ? `All ${total} contrast checks pass.`
      : `${failing} of ${total} contrast ${failing === 1 ? "check is" : "checks are"} below 4.5:1. Try higher contrast, or change the colours.`;
  return { failing, total, text };
}
