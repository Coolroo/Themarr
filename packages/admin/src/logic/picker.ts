// The swatch theme picker's state: what the button shows, the Inherit and
// None choices, favourites first, and the order of the grid. No dropdowns
// (the owner's decision): a swatch button opens a popover of swatches.

import type { Theme } from "@themarr/tokens";
import { swatchOf, themeById, themeSub, type Swatch } from "./themes.ts";

export const INHERIT = "inherit";
export const NONE = "none";

export interface Trigger {
  kind: "theme" | "inherit" | "none" | "missing";
  title: string;
  sub: string;
  swatch: Swatch | null;
}

/** What the picker's button shows for a value (a theme id, "inherit", "none" or null for none). */
export function triggerFor(value: string | null, themes: readonly Theme[], globalId: string | null): Trigger {
  if (value === null || value === NONE) return { kind: "none", title: "None", sub: "App keeps its own look", swatch: null };
  if (value === INHERIT) {
    const g = themeById(themes, globalId);
    return {
      kind: "inherit",
      title: "Inherit",
      sub: g === undefined ? "Global default: none" : `Global default: ${g.name}`,
      swatch: g === undefined ? null : swatchOf(g),
    };
  }
  const t = themeById(themes, value);
  if (t === undefined) return { kind: "missing", title: value, sub: "This theme no longer exists", swatch: null };
  return { kind: "theme", title: t.name, sub: themeSub(t), swatch: swatchOf(t) };
}

export interface Special {
  value: typeof INHERIT | typeof NONE;
  title: string;
  sub: string;
  swatch: Swatch | null;
  on: boolean;
}

/** The Inherit and None buttons above the swatches. */
export function specialsFor(
  opts: { allowInherit: boolean; allowNone: boolean },
  value: string | null,
  themes: readonly Theme[],
  globalId: string | null,
): Special[] {
  const out: Special[] = [];
  if (opts.allowInherit) {
    const g = themeById(themes, globalId);
    out.push({ value: INHERIT, title: "Inherit", sub: g?.name ?? "Global default: none", swatch: g === undefined ? null : swatchOf(g), on: value === INHERIT });
  }
  if (opts.allowNone) out.push({ value: NONE, title: "None", sub: "App defaults", swatch: null, on: value === NONE || value === null });
  return out;
}

/** The favourite themes that still exist, in the saved order. */
export function favouriteThemes(favourites: readonly string[], themes: readonly Theme[]): Theme[] {
  return favourites.map((id) => themeById(themes, id)).filter((t): t is Theme => t !== undefined);
}

/** Every theme, by name. */
export function sortedThemes(themes: readonly Theme[]): Theme[] {
  return [...themes].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** The favourites with `id` added at the end, or taken out. */
export function toggleFavourite(favourites: readonly string[], id: string): string[] {
  return favourites.includes(id) ? favourites.filter((f) => f !== id) : [...favourites, id];
}

/**
 * The next swatch for an arrow key in a grid of `count` swatches, `columns`
 * wide. Returns the same index at an edge.
 */
export function moveInGrid(index: number, key: string, count: number, columns: number): number {
  const next =
    key === "ArrowRight" ? index + 1 :
    key === "ArrowLeft" ? index - 1 :
    key === "ArrowDown" ? index + columns :
    key === "ArrowUp" ? index - columns :
    key === "Home" ? 0 :
    key === "End" ? count - 1 : index;
  return next >= 0 && next < count ? next : index;
}
