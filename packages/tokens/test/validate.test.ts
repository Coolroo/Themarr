// validateTheme rules beyond the golden fixtures.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ErrorCode, validateTheme } from "../src/index.ts";
import { readJson } from "./helpers.ts";
import { makeValidator } from "./jsonschema.ts";

const schemaValid = makeValidator(readJson("schema/theme.schema.json") as Record<string, unknown>);

type Mutable = Record<string, any>;
const synth = (): Mutable => readJson("fixtures/valid/handmade-synth-dark.json") as Mutable;
const indigo = (): Mutable => readJson("fixtures/valid/seeded-indigo.json") as Mutable;

function issues(x: unknown): { code: ErrorCode; path: string }[] {
  const res = validateTheme(x);
  return res.ok ? [] : res.issues.map(({ code, path }) => ({ code, path }));
}

/** The validator and the schema agree on accepting or refusing x. */
function agree(x: unknown): void {
  assert.equal(schemaValid(x), validateTheme(x).ok, JSON.stringify(issues(x)));
}

describe("validateTheme", () => {
  it("refuses a non-object", () => {
    for (const x of [null, [], "theme", 3, true]) {
      assert.deepEqual(issues(x), [{ code: "not_object", path: "" }]);
      agree(x);
    }
  });

  it("reports every missing top-level field", () => {
    assert.deepEqual(
      issues({}).map((i) => i.path),
      ["/id", "/name", "/version", "/source", "/modes", "/tokens"],
    );
  });

  it("returns the theme itself on success", () => {
    const t = synth();
    const res = validateTheme(t);
    assert.ok(res.ok);
    assert.equal(res.theme, t);
  });

  it("accepts a theme without the optional tag tokens", () => {
    const t = synth();
    delete t.tokens.dark.tag;
    delete t.tokens.dark["tag-foreground"];
    assert.deepEqual(issues(t), []);
    agree(t);
  });

  it("accepts light only", () => {
    const t = indigo();
    t.modes = ["light"];
    delete t.tokens.dark;
    assert.deepEqual(issues(t), []);
    agree(t);
  });

  it("accepts alpha in 0..1 and refuses it outside", () => {
    const t = synth();
    t.tokens.dark.border.$value.alpha = 0.5;
    assert.deepEqual(issues(t), []);
    agree(t);
    t.tokens.dark.border.$value.alpha = 1.2;
    assert.deepEqual(issues(t), [{ code: "bad_alpha", path: "/tokens/dark/border/$value/alpha" }]);
    agree(t);
  });

  it("accepts lower-case hex and tolerates rounding of half a step", () => {
    const t = synth();
    t.tokens.dark.primary.$value = { colorSpace: "srgb", components: [0x4f / 255 + 0.0019, 0xe3 / 255, 0xd0 / 255], hex: "#4fe3d0" };
    assert.deepEqual(issues(t), []);
    t.tokens.dark.primary.$value.components[0] = 0x4f / 255 + 0.0021; // more than half a step (0.00196)
    assert.deepEqual(issues(t), [{ code: "hex_mismatch", path: "/tokens/dark/primary/$value/hex" }]);
  });

  it("refuses colorSpace other than srgb", () => {
    const t = synth();
    t.tokens.dark.ring.$value.colorSpace = "display-p3";
    assert.deepEqual(issues(t), [{ code: "bad_color_space", path: "/tokens/dark/ring/$value/colorSpace" }]);
    agree(t);
  });

  it("refuses components that are not three numbers", () => {
    for (const comps of [[0.1, 0.2], [0.1, 0.2, 0.3, 0.4], [0.1, "0.2", 0.3], "none"]) {
      const t = synth();
      t.tokens.dark.ring.$value.components = comps;
      assert.deepEqual(issues(t), [{ code: "bad_components", path: "/tokens/dark/ring/$value/components" }]);
      agree(t);
    }
  });

  it("refuses extra fields in a token and in a value", () => {
    const t = synth();
    t.tokens.dark.ring.$description = "focus ring";
    t.tokens.dark.ring.$value.oklch = "x";
    assert.deepEqual(issues(t), [
      { code: "unknown_field", path: "/tokens/dark/ring/$description" },
      { code: "unknown_field", path: "/tokens/dark/ring/$value/oklch" },
    ]);
    agree(t);
  });

  it("checks radius as a dimension", () => {
    const t = synth();
    t.tokens.dark.radius.$value = { value: 0.75, unit: "rem" };
    assert.deepEqual(issues(t), []);
    t.tokens.dark.radius.$value = { value: -1, unit: "px" };
    assert.deepEqual(issues(t), [{ code: "bad_dimension", path: "/tokens/dark/radius/$value/value" }]);
    agree(t);
    t.tokens.dark.radius = { $type: "dimension", $value: "10px" };
    assert.deepEqual(issues(t), [{ code: "not_object", path: "/tokens/dark/radius/$value" }]);
    agree(t);
  });

  it("refuses a colour token typed as a dimension", () => {
    const t = synth();
    t.tokens.dark.primary.$type = "dimension";
    assert.deepEqual(issues(t), [{ code: "bad_token_type", path: "/tokens/dark/primary/$type" }]);
    agree(t);
  });

  it("refuses an unknown mode in modes", () => {
    const t = synth();
    t.modes = ["dark", "sepia"];
    assert.deepEqual(issues(t), [{ code: "bad_mode", path: "/modes/1" }]);
    agree(t);
  });

  it("refuses modes that is not an array, and still checks the tokens", () => {
    const t = synth();
    t.modes = "dark";
    delete t.tokens.dark.primary;
    assert.deepEqual(issues(t), [
      { code: "bad_type", path: "/modes" },
      { code: "missing_token", path: "/tokens/dark/primary" },
    ]);
  });

  it("checks the source fields", () => {
    const t = indigo();
    t.source.contrast = 0.5;
    t.source.seeds.tag = "red";
    t.source.seeds.secondary = "#112233";
    assert.deepEqual(issues(t), [
      { code: "unknown_field", path: "/source/seeds/secondary" },
      { code: "bad_hex", path: "/source/seeds/tag" },
      { code: "bad_contrast", path: "/source/contrast" },
    ]);
    agree(t);
  });

  it("needs seeds, schemeStyle and contrast on a seeded source", () => {
    const t = indigo();
    t.source = { kind: "seeded" };
    assert.deepEqual(issues(t), [
      { code: "missing_field", path: "/source/seeds" },
      { code: "missing_field", path: "/source/schemeStyle" },
      { code: "missing_field", path: "/source/contrast" },
    ]);
    agree(t);
  });

  it("checks name and version", () => {
    for (const name of ["", "   ", "a\nb", "x".repeat(101), 7]) {
      const t = synth();
      t.name = name;
      assert.deepEqual(issues(t), [{ code: "bad_name", path: "/name" }], JSON.stringify(name));
      agree(t);
    }
    const ok = synth();
    ok.name = "🎨".repeat(100); // 100 code points, 200 UTF-16 units
    assert.deepEqual(issues(ok), []);
    agree(ok);
    for (const version of [0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 2]) {
      const t = synth();
      t.version = version;
      assert.deepEqual(issues(t), [{ code: "bad_version", path: "/version" }], String(version));
      agree(t);
    }
  });

  it("checks the id slug", () => {
    for (const id of ["synth", "synth-2", "a", "x".repeat(64)]) {
      const t = synth();
      t.id = id;
      assert.deepEqual(issues(t), [], id);
      agree(t);
    }
    for (const id of ["", "-synth", "synth-", "syn--th", "Synth", "syn_th", "x".repeat(65), 5]) {
      const t = synth();
      t.id = id;
      assert.deepEqual(issues(t), [{ code: "bad_id", path: "/id" }], String(id));
      agree(t);
    }
  });

  it("escapes ~ and / in JSON Pointer paths", () => {
    const t = synth();
    t.tokens.dark["a/b~c"] = {};
    assert.deepEqual(issues(t), [{ code: "unknown_token", path: "/tokens/dark/a~1b~0c" }]);
  });

  it("formats errors as '<code> at \"<path>\": <message>'", () => {
    const res = validateTheme({ ...synth(), version: 0 });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.errors[0], `bad_version at "/version": version must be an integer >= 1`);
  });
});
