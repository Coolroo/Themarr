// Check a theme answer from the server. The wire body is a theme without
// id, name and source, so the SDK wraps it and runs @themarr/tokens'
// validateTheme: the same rules as the server, in one place.

import { isTokenName, validateTheme } from "@themarr/tokens";
import type { Source, WireTheme } from "./types.ts";

export type Parsed =
  | { ok: true; theme: WireTheme; locked: boolean; source?: Source }
  | { ok: false; reason: string };

const SOURCES: readonly string[] = ["enforced", "local", "saved", "default", "app", "global", "public"];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * A token name this SDK doesn't know is dropped, so a newer server can add
 * tokens without breaking apps that carry an older copy of the SDK. Anything
 * else that breaks the token contract refuses the whole theme.
 */
function dropUnknownTokens(tokens: unknown): unknown {
  if (!isObject(tokens)) return tokens;
  const out: Record<string, unknown> = {};
  for (const [mode, set] of Object.entries(tokens)) {
    if (!isObject(set)) {
      out[mode] = set;
      continue;
    }
    out[mode] = Object.fromEntries(Object.entries(set).filter(([name]) => isTokenName(name)));
  }
  return out;
}

/** Parse a 200 body. Other top-level fields are ignored. */
export function parseWire(body: unknown): Parsed {
  if (!isObject(body)) return { ok: false, reason: "invalid theme: the body is not a JSON object" };
  const candidate: Record<string, unknown> = { id: "wire", name: "wire", source: { kind: "handmade" } };
  // Copy only the fields the body has, so a missing one is reported as missing.
  if (Object.hasOwn(body, "version")) candidate["version"] = body["version"];
  if (Object.hasOwn(body, "modes")) candidate["modes"] = body["modes"];
  if (Object.hasOwn(body, "tokens")) candidate["tokens"] = dropUnknownTokens(body["tokens"]);
  const res = validateTheme(candidate);
  if (!res.ok) return { ok: false, reason: `invalid theme: ${res.errors[0] ?? "unknown error"}` };
  const theme: WireTheme = { version: res.theme.version, modes: res.theme.modes, tokens: res.theme.tokens };
  const locked = body["locked"] === true;
  const src = body["source"];
  if (typeof src === "string" && SOURCES.includes(src)) return { ok: true, theme, locked, source: src as Source };
  return { ok: true, theme, locked };
}
