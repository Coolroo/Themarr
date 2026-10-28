// validateTheme: everything schema/theme.schema.json says, plus the rules a
// JSON Schema can't hold cleanly (hex agrees with components). No dependencies.
//
// Every issue has a stable code (ERROR_CODES) and a JSON Pointer (RFC 6901)
// to the offending value. The Go server (T-086) returns the same codes.

import {
  CONTRAST_LEVELS,
  DIMENSION_UNITS,
  MODES,
  SCHEME_STYLES,
  SOURCE_KINDS,
  TOKENS,
  tokenSpec,
} from "./tokens.ts";
import type { Theme } from "./theme.ts";

export const ERROR_CODES = [
  "not_object", // the value must be a JSON object
  "missing_field", // a required field is absent
  "unknown_field", // a field the schema does not allow
  "bad_type", // the value has the wrong JSON type
  "bad_id", // id is not a slug of 1-64 characters
  "bad_name", // name is empty, too long, or has control characters
  "bad_version", // version is not an integer >= 1
  "bad_source_kind", // source.kind is not "seeded" or "handmade"
  "missing_seed", // a seeded source has no primary seed
  "bad_scheme_style", // schemeStyle is not one of SCHEME_STYLES
  "bad_contrast", // contrast is not 0, 1 or 2
  "empty_modes", // modes is an empty list
  "bad_mode", // a modes entry is not "light" or "dark"
  "duplicate_mode", // a mode is listed twice
  "mode_without_tokens", // a listed mode has no tokens object
  "tokens_for_unlisted_mode", // tokens has a key that modes does not list
  "missing_token", // a listed mode lacks a required token
  "unknown_token", // a token name not in the vocabulary
  "bad_token_type", // $type does not match the token's kind
  "bad_color_space", // colorSpace is not "srgb"
  "bad_components", // components is not three numbers in 0..1
  "bad_hex", // a hex colour is not "#rrggbb"
  "hex_mismatch", // hex and components name different colours
  "bad_alpha", // alpha is not a number in 0..1
  "bad_dimension", // a dimension value is not a finite number >= 0
  "bad_unit", // a dimension unit is not "px" or "rem"
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ValidationIssue {
  code: ErrorCode;
  /** JSON Pointer to the value; "" is the whole theme. */
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; theme: Theme }
  | { ok: false; errors: string[]; issues: ValidationIssue[] };

export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ID_MAX_LENGTH = 64;
export const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;
/** Code points, not UTF-16 units or bytes. */
export const NAME_MAX_LENGTH = 100;
/** Printable, with at least one non-space character (ECMAScript, u flag). */
export const NAME_PATTERN_SOURCE = "^[^\\x00-\\x1F\\x7F]*[^\\s\\x00-\\x1F\\x7F][^\\x00-\\x1F\\x7F]*$";
const NAME_PATTERN = new RegExp(NAME_PATTERN_SOURCE, "u");
/** A component may differ from its hex byte by half a step (rounding). */
export const HEX_TOLERANCE = 0.5;

type Json = Record<string, unknown>;

class Collector {
  readonly issues: ValidationIssue[] = [];
  add(code: ErrorCode, path: string, message: string): void {
    this.issues.push({ code, path, message });
  }
}

/** Escape one reference token for a JSON Pointer. */
function ptr(base: string, key: string | number): string {
  return `${base}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** Report fields of obj not in allowed, and required fields that are absent. Returns false if any required is absent. */
function fields(c: Collector, obj: Json, path: string, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) c.add("unknown_field", ptr(path, key), `field "${key}" is not allowed here`);
  }
  let all = true;
  for (const key of required) {
    if (!Object.hasOwn(obj, key)) {
      c.add("missing_field", ptr(path, key), `field "${key}" is required`);
      all = false;
    }
  }
  return all;
}

function checkHex(c: Collector, v: unknown, path: string): v is string {
  if (typeof v !== "string") {
    c.add("bad_type", path, `expected a string, got ${typeName(v)}`);
    return false;
  }
  if (!HEX_PATTERN.test(v)) {
    c.add("bad_hex", path, `"${v}" is not a #rrggbb colour`);
    return false;
  }
  return true;
}

function checkSource(c: Collector, v: unknown, path: string): void {
  if (!isObject(v)) {
    c.add("not_object", path, `source must be an object, got ${typeName(v)}`);
    return;
  }
  if (!Object.hasOwn(v, "kind")) {
    c.add("missing_field", ptr(path, "kind"), `field "kind" is required`);
    return;
  }
  const kind = v["kind"];
  if (kind === "handmade") {
    fields(c, v, path, ["kind"]);
    return;
  }
  if (kind !== "seeded") {
    c.add("bad_source_kind", ptr(path, "kind"), `kind must be one of ${SOURCE_KINDS.join(", ")}`);
    return;
  }
  fields(c, v, path, ["kind", "seeds", "schemeStyle", "contrast"]);
  if (Object.hasOwn(v, "seeds")) {
    const seeds = v["seeds"];
    const sp = ptr(path, "seeds");
    if (!isObject(seeds)) {
      c.add("not_object", sp, `seeds must be an object, got ${typeName(seeds)}`);
    } else {
      for (const key of Object.keys(seeds)) {
        if (key !== "primary" && key !== "tag") c.add("unknown_field", ptr(sp, key), `seed "${key}" is not allowed`);
      }
      if (!Object.hasOwn(seeds, "primary")) c.add("missing_seed", ptr(sp, "primary"), "a seeded theme needs a primary seed");
      else checkHex(c, seeds["primary"], ptr(sp, "primary"));
      if (Object.hasOwn(seeds, "tag")) checkHex(c, seeds["tag"], ptr(sp, "tag"));
    }
  }
  if (Object.hasOwn(v, "schemeStyle") && !(SCHEME_STYLES as readonly unknown[]).includes(v["schemeStyle"])) {
    c.add("bad_scheme_style", ptr(path, "schemeStyle"), `schemeStyle must be one of ${SCHEME_STYLES.join(", ")}`);
  }
  if (Object.hasOwn(v, "contrast") && !(CONTRAST_LEVELS as readonly unknown[]).includes(v["contrast"])) {
    c.add("bad_contrast", ptr(path, "contrast"), `contrast must be one of ${CONTRAST_LEVELS.join(", ")}`);
  }
}

/** Returns the valid, unique listed modes, or undefined when modes is not an array. */
function checkModes(c: Collector, v: unknown, path: string): Set<string> | undefined {
  const listed = new Set<string>();
  if (!Array.isArray(v)) {
    c.add("bad_type", path, `modes must be an array, got ${typeName(v)}`);
    return undefined;
  }
  if (v.length === 0) c.add("empty_modes", path, "modes must list at least one mode");
  v.forEach((m: unknown, i: number) => {
    const p = ptr(path, i);
    if (typeof m !== "string" || !(MODES as readonly string[]).includes(m)) {
      c.add("bad_mode", p, `mode must be one of ${MODES.join(", ")}`);
    } else if (listed.has(m)) {
      c.add("duplicate_mode", p, `mode "${m}" is listed twice`);
    } else {
      listed.add(m);
    }
  });
  return listed;
}

function checkColorValue(c: Collector, v: unknown, path: string): void {
  if (!isObject(v)) {
    c.add("not_object", path, `$value must be an object, got ${typeName(v)}`);
    return;
  }
  fields(c, v, path, ["colorSpace", "components", "hex"], ["alpha"]);
  if (Object.hasOwn(v, "colorSpace") && v["colorSpace"] !== "srgb") {
    c.add("bad_color_space", ptr(path, "colorSpace"), `colorSpace must be "srgb"`);
  }
  let comps: number[] | undefined;
  if (Object.hasOwn(v, "components")) {
    const raw = v["components"];
    const ok =
      Array.isArray(raw) &&
      raw.length === 3 &&
      raw.every((n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1);
    if (ok) comps = raw as number[];
    else c.add("bad_components", ptr(path, "components"), "components must be three numbers in 0..1");
  }
  let hex: string | undefined;
  if (Object.hasOwn(v, "hex") && checkHex(c, v["hex"], ptr(path, "hex"))) hex = v["hex"] as string;
  if (comps !== undefined && hex !== undefined) {
    for (let i = 0; i < 3; i++) {
      const byte = Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
      if (Math.abs((comps[i] as number) * 255 - byte) > HEX_TOLERANCE + 1e-9) {
        c.add("hex_mismatch", ptr(path, "hex"), `hex ${hex} does not match components [${comps.join(", ")}]`);
        break;
      }
    }
  }
  if (Object.hasOwn(v, "alpha")) {
    const a = v["alpha"];
    if (typeof a !== "number" || !Number.isFinite(a) || a < 0 || a > 1) {
      c.add("bad_alpha", ptr(path, "alpha"), "alpha must be a number in 0..1");
    }
  }
}

function checkDimensionValue(c: Collector, v: unknown, path: string): void {
  if (!isObject(v)) {
    c.add("not_object", path, `$value must be an object, got ${typeName(v)}`);
    return;
  }
  fields(c, v, path, ["value", "unit"]);
  if (Object.hasOwn(v, "value")) {
    const n = v["value"];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
      c.add("bad_dimension", ptr(path, "value"), "value must be a finite number >= 0");
    }
  }
  if (Object.hasOwn(v, "unit") && !(DIMENSION_UNITS as readonly unknown[]).includes(v["unit"])) {
    c.add("bad_unit", ptr(path, "unit"), `unit must be one of ${DIMENSION_UNITS.join(", ")}`);
  }
}

function checkModeTokens(c: Collector, v: unknown, path: string): void {
  if (!isObject(v)) {
    c.add("not_object", path, `a mode's tokens must be an object, got ${typeName(v)}`);
    return;
  }
  for (const [name, token] of Object.entries(v)) {
    const p = ptr(path, name);
    const spec = tokenSpec(name);
    if (spec === undefined) {
      c.add("unknown_token", p, `"${name}" is not a themarr token`);
      continue;
    }
    if (!isObject(token)) {
      c.add("not_object", p, `token must be an object, got ${typeName(token)}`);
      continue;
    }
    if (!fields(c, token, p, ["$type", "$value"])) continue;
    if (token["$type"] !== spec.kind) {
      c.add("bad_token_type", ptr(p, "$type"), `"${name}" must have $type "${spec.kind}"`);
      continue;
    }
    if (spec.kind === "color") checkColorValue(c, token["$value"], ptr(p, "$value"));
    else checkDimensionValue(c, token["$value"], ptr(p, "$value"));
  }
  for (const spec of TOKENS) {
    if (spec.required && !Object.hasOwn(v, spec.name)) {
      c.add("missing_token", ptr(path, spec.name), `required token "${spec.name}" is missing`);
    }
  }
}

/** listed is undefined when modes is absent or unusable: then only the tokens present are checked. */
function checkTokens(c: Collector, v: unknown, path: string, listed: Set<string> | undefined): void {
  if (!isObject(v)) {
    c.add("not_object", path, `tokens must be an object, got ${typeName(v)}`);
    return;
  }
  for (const key of Object.keys(v)) {
    if (listed === undefined) {
      if (!(MODES as readonly string[]).includes(key)) c.add("tokens_for_unlisted_mode", ptr(path, key), `"${key}" is not a mode`);
    } else if (!listed.has(key)) {
      c.add("tokens_for_unlisted_mode", ptr(path, key), `tokens has "${key}", which modes does not list`);
    }
  }
  for (const mode of MODES) {
    if (listed === undefined) {
      if (Object.hasOwn(v, mode)) checkModeTokens(c, v[mode], ptr(path, mode));
      continue;
    }
    if (!listed.has(mode)) continue;
    if (!Object.hasOwn(v, mode)) {
      c.add("mode_without_tokens", ptr(path, mode), `mode "${mode}" is listed but has no tokens`);
      continue;
    }
    checkModeTokens(c, v[mode], ptr(path, mode));
  }
}

/** Validate an untrusted value (parsed JSON) as a themarr theme. */
export function validateTheme(x: unknown): ValidationResult {
  const c = new Collector();
  if (!isObject(x)) {
    c.add("not_object", "", `a theme must be an object, got ${typeName(x)}`);
    return fail(c);
  }
  fields(c, x, "", ["id", "name", "version", "source", "modes", "tokens"]);

  if (Object.hasOwn(x, "id")) {
    const id = x["id"];
    if (typeof id !== "string" || id.length > ID_MAX_LENGTH || !ID_PATTERN.test(id)) {
      c.add("bad_id", "/id", `id must be lower-case letters, digits and single hyphens, at most ${ID_MAX_LENGTH} characters`);
    }
  }
  if (Object.hasOwn(x, "name")) {
    const name = x["name"];
    if (typeof name !== "string" || [...name].length > NAME_MAX_LENGTH || !NAME_PATTERN.test(name)) {
      c.add("bad_name", "/name", `name must be 1-${NAME_MAX_LENGTH} characters, not blank, without control characters`);
    }
  }
  if (Object.hasOwn(x, "version")) {
    const ver = x["version"];
    if (typeof ver !== "number" || !Number.isSafeInteger(ver) || ver < 1) {
      c.add("bad_version", "/version", "version must be an integer >= 1");
    }
  }
  if (Object.hasOwn(x, "source")) checkSource(c, x["source"], "/source");

  const listed = Object.hasOwn(x, "modes") ? checkModes(c, x["modes"], "/modes") : undefined;
  if (Object.hasOwn(x, "tokens")) checkTokens(c, x["tokens"], "/tokens", listed);

  if (c.issues.length > 0) return fail(c);
  return { ok: true, theme: x as unknown as Theme };
}

function fail(c: Collector): ValidationResult {
  return {
    ok: false,
    issues: c.issues,
    errors: c.issues.map((i) => `${i.code} at "${i.path}": ${i.message}`),
  };
}
