// Every golden fixture through validateTheme and through the JSON Schema.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ERROR_CODES, validateTheme } from "../src/index.ts";
import { expectedInvalid, fixtureFiles, readJson } from "./helpers.ts";
import { keywordsUsed, makeValidator, SUPPORTED_KEYWORDS } from "./jsonschema.ts";

const schema = readJson("schema/theme.schema.json") as Record<string, unknown>;
const schemaValid = makeValidator(schema);

describe("valid fixtures", () => {
  const files = fixtureFiles("valid");
  it("include the three named themes", () => {
    for (const f of ["seeded-indigo.json", "handmade-synth-dark.json", "seeded-with-tag.json"]) {
      assert.ok(files.includes(f), `missing fixtures/valid/${f}`);
    }
  });
  for (const file of files) {
    it(`${file} passes validateTheme`, () => {
      const res = validateTheme(readJson(`fixtures/valid/${file}`));
      assert.ok(res.ok, res.ok ? "" : res.errors.join("\n"));
    });
    it(`${file} passes the JSON Schema`, () => {
      assert.ok(schemaValid(readJson(`fixtures/valid/${file}`)));
    });
  }

  it("Synth is handmade and dark only, with tag tokens", () => {
    const res = validateTheme(readJson("fixtures/valid/handmade-synth-dark.json"));
    assert.ok(res.ok);
    assert.deepEqual(res.theme.source, { kind: "handmade" });
    assert.deepEqual(res.theme.modes, ["dark"]);
    assert.deepEqual(Object.keys(res.theme.tokens), ["dark"]);
    assert.equal(res.theme.tokens.dark?.tag?.$value.hex, "#FF6FD8");
    assert.deepEqual(res.theme.tokens.dark?.radius?.$value, { value: 10, unit: "px" });
  });

  it("seeded-with-tag has a tag seed and tag tokens in both modes", () => {
    const res = validateTheme(readJson("fixtures/valid/seeded-with-tag.json"));
    assert.ok(res.ok);
    assert.equal(res.theme.source.kind, "seeded");
    assert.ok(res.theme.source.kind === "seeded" && res.theme.source.seeds.tag !== undefined);
    for (const mode of res.theme.modes) {
      assert.ok(res.theme.tokens[mode]?.tag !== undefined);
      assert.ok(res.theme.tokens[mode]?.["tag-foreground"] !== undefined);
    }
  });

  it("seeded-indigo is seeded from #5146D9, tonal, standard contrast, light and dark", () => {
    const res = validateTheme(readJson("fixtures/valid/seeded-indigo.json"));
    assert.ok(res.ok);
    assert.deepEqual(res.theme.source, { kind: "seeded", seeds: { primary: "#5146D9" }, schemeStyle: "tonal", contrast: 0 });
    assert.deepEqual(res.theme.modes, ["light", "dark"]);
  });
});

describe("invalid fixtures", () => {
  const files = fixtureFiles("invalid");
  const expected = expectedInvalid();

  it("EXPECTED.json lists exactly the invalid fixtures", () => {
    assert.deepEqual(Object.keys(expected).sort(), files);
  });
  it("EXPECTED.json uses only known error codes", () => {
    for (const [file, e] of Object.entries(expected)) {
      assert.ok((ERROR_CODES as readonly string[]).includes(e.code), `${file}: unknown code ${e.code}`);
    }
  });
  it("cover every defect the task names", () => {
    const codes = new Set(Object.values(expected).map((e) => e.code));
    for (const c of [
      "missing_token", "unknown_token", "bad_hex", "hex_mismatch", "mode_without_tokens",
      "tokens_for_unlisted_mode", "empty_modes", "bad_source_kind", "missing_seed", "bad_id",
    ]) {
      assert.ok(codes.has(c), `no invalid fixture for ${c}`);
    }
  });

  for (const file of files) {
    it(`${file} fails validateTheme with exactly its one defect`, () => {
      const res = validateTheme(readJson(`fixtures/invalid/${file}`));
      assert.equal(res.ok, false);
      if (res.ok) return;
      const want = expected[file];
      assert.ok(want !== undefined);
      assert.deepEqual(
        res.issues.map((i) => ({ code: i.code, path: i.path })),
        [{ code: want.code, path: want.path }],
        res.errors.join("\n"),
      );
      assert.equal(res.errors.length, 1);
      assert.ok(res.errors[0]?.startsWith(`${want.code} at "${want.path}": `));
    });

    const want = expected[file];
    if (want?.code === "hex_mismatch") {
      it(`${file} passes the JSON Schema (hex agreement is a validator-only rule)`, () => {
        assert.ok(schemaValid(readJson(`fixtures/invalid/${file}`)));
      });
    } else {
      it(`${file} fails the JSON Schema`, () => {
        assert.equal(schemaValid(readJson(`fixtures/invalid/${file}`)), false);
      });
    }
  }
});

describe("the schema", () => {
  it("uses only keywords the test evaluator knows", () => {
    const unknown = [...keywordsUsed(schema)].filter((k) => !SUPPORTED_KEYWORDS.has(k));
    assert.deepEqual(unknown, []);
  });
  it("is draft 2020-12", () => {
    assert.equal(schema["$schema"], "https://json-schema.org/draft/2020-12/schema");
  });
});
