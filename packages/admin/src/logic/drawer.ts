// The drawer page's model (decision 0009): the tiles from the public
// catalog, what the person sees now, and where they may keep a theme.

import type { Mode } from "@themarr/tokens";

export interface CatalogSwatch {
  primary: string;
  background: string;
  foreground: string;
  tag?: string;
}

export interface CatalogTheme {
  id: string;
  name: string;
  version: number;
  modes: Mode[];
  swatch: Partial<Record<Mode, CatalogSwatch>>;
}

export interface Catalog {
  themes: CatalogTheme[];
  favourites: string[];
}

export interface Tile {
  id: string;
  name: string;
  /** The tile's colour: the primary of the light palette (or the dark one). */
  fill: string;
  /** The strip with the name: the dark background, and its text colour. */
  band: string;
  bandFg: string;
  favourite: boolean;
  /** "dark only", "light only" or "". */
  modes: string;
}

function tile(t: CatalogTheme, favourite: boolean): Tile {
  const top = t.swatch.light ?? t.swatch.dark;
  const strip = t.swatch.dark ?? t.swatch.light;
  return {
    id: t.id,
    name: t.name,
    fill: top?.primary ?? "transparent",
    band: strip?.background ?? "transparent",
    bandFg: strip?.foreground ?? "inherit",
    favourite,
    modes: t.modes.length === 1 ? `${t.modes[0]} only` : "",
  };
}

/** Favourites first (in the admins' order), then every other theme in the catalog's order (by name). */
export function tiles(c: Catalog): { favourites: Tile[]; others: Tile[] } {
  const byId = new Map(c.themes.map((t) => [t.id, t]));
  const favourites = c.favourites.map((id) => byId.get(id)).filter((t): t is CatalogTheme => t !== undefined).map((t) => tile(t, true));
  const fav = new Set(favourites.map((t) => t.id));
  return { favourites, others: c.themes.filter((t) => !fav.has(t.id)).map((t) => tile(t, false)) };
}

export type CurrentSource = "enforced" | "local" | "saved" | "default" | "app" | "global" | "public" | "none";

export const SOURCE_LABEL: Readonly<Record<CurrentSource, string>> = {
  enforced: "set by an admin",
  local: "this browser",
  saved: "your choice",
  default: "an admin's default for you",
  app: "the app's theme",
  global: "the global default",
  public: "the app's theme",
  none: "the app's own look",
};

/** "You see now": the name when the page can know it, else the version. */
export function seeNow(
  current: { source: CurrentSource; version?: number; local?: string },
  names: { local?: string | undefined; saved?: string | undefined; app?: string | undefined },
): { name: string; from: string } {
  const from = SOURCE_LABEL[current.source];
  if (current.source === "none") return { name: "No theme", from };
  const known = current.source === "local" ? names.local : current.source === "saved" ? names.saved : current.source === "app" || current.source === "global" || current.source === "public" ? names.app : undefined;
  return { name: known ?? (current.version === undefined ? "A theme" : `A theme (version ${current.version})`), from };
}

export type Scope = "browser" | "me" | "app";

/** Where the person may keep a theme: nothing while locked; "me" needs a registered app; "app" needs an admin. */
export function scopes(o: { locked: boolean; canSaveMe: boolean; admin: boolean; app: string }): { id: Scope; label: string }[] {
  if (o.locked) return [];
  const out: { id: Scope; label: string }[] = [{ id: "browser", label: "This browser" }];
  if (o.canSaveMe) out.push({ id: "me", label: "Me, everywhere" });
  if (o.admin) out.push({ id: "app", label: `Everyone on ${o.app}` });
  return out;
}

export function scopeHint(scope: Scope): string {
  if (scope === "browser") return "Only this browser. Clearing site data removes it.";
  if (scope === "me") return "Follows you to every device where you sign in.";
  return "Everyone who has no choice of their own sees it.";
}

export function applyLabel(scope: Scope, app: string): string {
  if (scope === "browser") return "Keep in this browser";
  if (scope === "me") return "Save for me";
  return `Assign to ${app}`;
}
