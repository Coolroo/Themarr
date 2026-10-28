// The committed manifest and schema match the TypeScript token list.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildManifest,
  cssVar,
  manifestText,
  OPTIONAL_TOKENS,
  REQUIRED_TOKENS,
  schemaText,
  TOKEN_NAMES,
  TOKENS,
} from "../src/index.ts";
import { readJson, readText } from "./helpers.ts";

describe("token list", () => {
  it("has unique kebab-case names", () => {
    assert.equal(new Set(TOKEN_NAMES).size, TOKEN_NAMES.length);
    for (const n of TOKEN_NAMES) assert.match(n, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
  it("is the vocabulary of the plan, in order", () => {
    assert.deepEqual(TOKEN_NAMES, [
      "background", "card", "popover", "muted", "surface-1", "surface-2", "surface-3", "border", "input",
      "foreground", "card-foreground", "popover-foreground", "muted-foreground",
      "primary", "primary-foreground", "secondary", "secondary-foreground", "accent", "accent-foreground", "ring",
      "tag", "tag-foreground",
      "destructive", "destructive-foreground", "success", "success-foreground",
      "warning", "warning-foreground", "info", "info-foreground",
      "chart-1", "chart-2", "chart-3", "chart-4", "chart-5",
      "radius",
    ]);
  });
  it("makes only tag and tag-foreground optional", () => {
    assert.deepEqual([...OPTIONAL_TOKENS], ["tag", "tag-foreground"]);
    assert.equal(REQUIRED_TOKENS.length, TOKEN_NAMES.length - 2);
  });
  it("has radius as the only dimension", () => {
    assert.deepEqual(TOKENS.filter((t) => t.kind === "dimension").map((t) => t.name), ["radius"]);
  });
  it("names the CSS custom property --themarr-<token>", () => {
    assert.equal(cssVar("primary-foreground"), "--themarr-primary-foreground");
    assert.equal(cssVar("radius"), "--themarr-radius");
  });
});

describe("tokens.manifest.json", () => {
  it("is exactly what buildManifest() makes (run npm run generate)", () => {
    assert.equal(readText("tokens.manifest.json"), manifestText());
  });
  it("lists every token with name, group, kind and required", () => {
    const m = readJson("tokens.manifest.json") as ReturnType<typeof buildManifest>;
    assert.deepEqual(m.tokens.map((t) => t.name), [...TOKEN_NAMES]);
    for (const t of m.tokens) {
      assert.equal(typeof t.group, "string");
      assert.ok(t.kind === "color" || t.kind === "dimension");
      assert.equal(typeof t.required, "boolean");
    }
  });
  it("has patterns Go's RE2 can read (no lookaround, no backreferences)", () => {
    const m = buildManifest();
    for (const p of [m.limits.idPattern, m.limits.hexPattern]) assert.doesNotMatch(p, /\(\?[=!<]|\\[1-9]/);
  });
});

describe("schema/theme.schema.json", () => {
  it("is exactly what buildSchema() makes (run npm run generate)", () => {
    assert.equal(readText("schema/theme.schema.json"), schemaText());
  });
  it("requires the manifest's required tokens and allows only its tokens", () => {
    const s = readJson("schema/theme.schema.json") as {
      $defs: { modeTokens: { required: string[]; properties: Record<string, unknown>; additionalProperties: boolean } };
    };
    assert.deepEqual(s.$defs.modeTokens.required, [...REQUIRED_TOKENS]);
    assert.deepEqual(Object.keys(s.$defs.modeTokens.properties), [...TOKEN_NAMES]);
    assert.equal(s.$defs.modeTokens.additionalProperties, false);
  });
});
