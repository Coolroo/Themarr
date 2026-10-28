// The local override: a theme ID kept in this browser only, per app
// (localStorage key `themarr:<app>:local`). The drawer (T-085) writes it;
// boot reads it. Every access is guarded: storage may be blocked.

import { ID_MAX_LENGTH, ID_PATTERN } from "@themarr/tokens";
import type { EnvStorage } from "./types.ts";

export function localKey(app: string): string {
  return `themarr:${app}:local`;
}

function defaultStorage(): EnvStorage | undefined {
  try {
    return (globalThis as { localStorage?: EnvStorage }).localStorage;
  } catch {
    return undefined;
  }
}

export function isThemeId(id: unknown): id is string {
  return typeof id === "string" && id.length <= ID_MAX_LENGTH && ID_PATTERN.test(id);
}

/** The theme ID this browser keeps for app, or null. A value that is not a theme ID is cleared. */
export function getLocalOverride(app: string, storage: EnvStorage | undefined = defaultStorage()): string | null {
  try {
    const id = storage?.getItem(localKey(app)) ?? null;
    if (id === null) return null;
    if (isThemeId(id)) return id;
    storage?.removeItem(localKey(app));
    return null;
  } catch {
    return null;
  }
}

/** Keep themeId for app in this browser. Returns false when the ID is not valid or storage is blocked. */
export function setLocalOverride(app: string, themeId: string, storage: EnvStorage | undefined = defaultStorage()): boolean {
  if (!isThemeId(themeId) || storage === undefined) return false;
  try {
    storage.setItem(localKey(app), themeId);
    return true;
  } catch {
    return false;
  }
}

export function clearLocalOverride(app: string, storage: EnvStorage | undefined = defaultStorage()): void {
  try {
    storage?.removeItem(localKey(app));
  } catch {
    // Blocked storage holds nothing to clear.
  }
}
