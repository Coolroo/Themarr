// A small JSON Schema 2020-12 evaluator for the keywords theme.schema.json
// uses, so the tests check the schema itself without a dependency. A test
// fails if the schema starts using a keyword this file does not know.

import { isDeepStrictEqual } from "node:util";

type Schema = boolean | Record<string, unknown>;

export const SUPPORTED_KEYWORDS = new Set([
  // annotations and structure (no assertion)
  "$schema", "$id", "$defs", "title", "description",
  // assertions and applicators
  "$ref", "type", "enum", "const",
  "properties", "required", "additionalProperties", "propertyNames",
  "pattern", "minLength", "maxLength", "minimum", "maximum",
  "items", "minItems", "maxItems", "uniqueItems", "contains",
  "allOf", "oneOf", "not", "if", "then", "else",
]);

/** Every keyword used anywhere in the schema (property names under "properties"/"$defs" excluded). */
export function keywordsUsed(schema: unknown, out = new Set<string>()): Set<string> {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return out;
  for (const [k, v] of Object.entries(schema)) {
    out.add(k);
    if (k === "properties" || k === "$defs") {
      for (const sub of Object.values(v as object)) keywordsUsed(sub, out);
    } else if (k === "allOf" || k === "oneOf") {
      for (const sub of v as unknown[]) keywordsUsed(sub, out);
    } else if (["items", "contains", "not", "if", "then", "else", "propertyNames", "additionalProperties"].includes(k)) {
      keywordsUsed(v, out);
    }
  }
  return out;
}

function typeOk(t: string, v: unknown): boolean {
  switch (t) {
    case "object": return typeof v === "object" && v !== null && !Array.isArray(v);
    case "array": return Array.isArray(v);
    case "string": return typeof v === "string";
    case "number": return typeof v === "number";
    case "integer": return typeof v === "number" && Number.isInteger(v);
    case "boolean": return typeof v === "boolean";
    case "null": return v === null;
    default: throw new Error(`unknown type ${t}`);
  }
}

export function makeValidator(root: Record<string, unknown>): (v: unknown) => boolean {
  const resolve = (ref: string): Schema => {
    if (!ref.startsWith("#/")) throw new Error(`only local refs: ${ref}`);
    let cur: unknown = root;
    for (const part of ref.slice(2).split("/")) cur = (cur as Record<string, unknown>)[part];
    if (cur === undefined) throw new Error(`unresolved ref ${ref}`);
    return cur as Schema;
  };

  const valid = (s: Schema, v: unknown): boolean => {
    if (s === true) return true;
    if (s === false) return false;
    const isObj = typeOk("object", v);
    const obj = v as Record<string, unknown>;
    if (typeof s["$ref"] === "string" && !valid(resolve(s["$ref"]), v)) return false;
    if (typeof s["type"] === "string" && !typeOk(s["type"], v)) return false;
    if (Array.isArray(s["enum"]) && !s["enum"].some((e) => isDeepStrictEqual(e, v))) return false;
    if ("const" in s && !isDeepStrictEqual(s["const"], v)) return false;

    if (isObj) {
      const props = (s["properties"] ?? {}) as Record<string, Schema>;
      for (const [k, sub] of Object.entries(props)) {
        if (Object.hasOwn(obj, k) && !valid(sub, obj[k])) return false;
      }
      if (Array.isArray(s["required"]) && !s["required"].every((k) => Object.hasOwn(obj, k as string))) return false;
      if ("additionalProperties" in s) {
        for (const k of Object.keys(obj)) {
          if (!Object.hasOwn(props, k) && !valid(s["additionalProperties"] as Schema, obj[k])) return false;
        }
      }
      if ("propertyNames" in s && !Object.keys(obj).every((k) => valid(s["propertyNames"] as Schema, k))) return false;
    }
    if (typeof v === "string") {
      const len = [...v].length;
      if (typeof s["minLength"] === "number" && len < s["minLength"]) return false;
      if (typeof s["maxLength"] === "number" && len > s["maxLength"]) return false;
      if (typeof s["pattern"] === "string" && !new RegExp(s["pattern"], "u").test(v)) return false;
    }
    if (typeof v === "number") {
      if (typeof s["minimum"] === "number" && v < s["minimum"]) return false;
      if (typeof s["maximum"] === "number" && v > s["maximum"]) return false;
    }
    if (Array.isArray(v)) {
      if ("items" in s && !v.every((e) => valid(s["items"] as Schema, e))) return false;
      if (typeof s["minItems"] === "number" && v.length < s["minItems"]) return false;
      if (typeof s["maxItems"] === "number" && v.length > s["maxItems"]) return false;
      if (s["uniqueItems"] === true && v.some((e, i) => v.slice(i + 1).some((f) => isDeepStrictEqual(e, f)))) return false;
      if ("contains" in s && !v.some((e) => valid(s["contains"] as Schema, e))) return false;
    }
    if (Array.isArray(s["allOf"]) && !s["allOf"].every((sub) => valid(sub as Schema, v))) return false;
    if (Array.isArray(s["oneOf"]) && s["oneOf"].filter((sub) => valid(sub as Schema, v)).length !== 1) return false;
    if ("not" in s && valid(s["not"] as Schema, v)) return false;
    if ("if" in s) {
      const branch = valid(s["if"] as Schema, v) ? s["then"] : s["else"];
      if (branch !== undefined && !valid(branch as Schema, v)) return false;
    }
    return true;
  };

  return (v) => valid(root, v);
}
