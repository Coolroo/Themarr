import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CONTRAST_LEVELS,
  MIN_TEXT_CONTRAST,
  SCHEME_STYLES,
  themeContrasts,
  validateTheme,
  type SeededSource,
  type Theme,
} from "@themarr/tokens";
import {
  applyOverrides,
  COLOR_TOKENS,
  colorsOf,
  colorToken,
  findOverrides,
  makeColors,
  makeSeededTheme,
  modeColors,
  normalizeHex,
  STATUS_SEEDS,
} from "../src/index.ts";

function fixture(name: string): Theme {
  return JSON.parse(readFileSync(new URL(`../../tokens/fixtures/valid/${name}.json`, import.meta.url), "utf8")) as Theme;
}

function remake(t: Theme): Theme {
  const src = t.source as SeededSource;
  return makeSeededTheme({
    id: t.id,
    name: t.name,
    version: t.version,
    seeds: src.seeds,
    schemeStyle: src.schemeStyle,
    contrast: src.contrast,
    ...(t.tokens.light?.radius === undefined ? {} : { radius: t.tokens.light.radius }),
  });
}

const SEEDS = ["#5146D9", "#E0662F", "#3F8F5A", "#1F7AA8", "#B04FC4", "#5F6672", "#D9A21B", "#FFFF00", "#00FF00", "#FF0000", "#000000", "#FFFFFF"];
const TAGS = [undefined, "#FF6F59", "#FFFF00", "#4FE3D0", "#000000"];

describe("golden output", () => {
  for (const name of ["seeded-indigo", "seeded-with-tag"]) {
    it(`${name}.json is what the palette makes from its seeds`, () => {
      const want = fixture(name);
      assert.deepEqual(remake(want), want);
    });
  }

  it("is the same every time", () => {
    const a = makeColors({ primary: "#5146D9", schemeStyle: "tonal", contrast: 0 });
    const b = makeColors({ primary: "#5146d9", schemeStyle: "tonal", contrast: 0 });
    assert.deepEqual(a, b);
    assert.equal(a.light.primary, "#5B5891");
  });
});

describe("every style and contrast level", () => {
  for (const style of SCHEME_STYLES) {
    for (const contrast of CONTRAST_LEVELS) {
      it(`${style}, contrast ${contrast}: validates, and every foreground reaches ${MIN_TEXT_CONTRAST}:1`, () => {
        for (const primary of SEEDS) {
          for (const tag of TAGS) {
            const theme = makeSeededTheme({ id: "t", name: "T", seeds: { primary, tag }, schemeStyle: style, contrast });
            const res = validateTheme(theme);
            assert.ok(res.ok, `${primary} ${tag}: ${res.ok ? "" : res.errors.join("; ")}`);
            const low = themeContrasts(theme).filter((r) => r.ratio < MIN_TEXT_CONTRAST);
            assert.deepEqual(
              low.map((r) => `${primary} ${String(tag)} ${r.mode} ${r.foreground}: ${r.ratio.toFixed(2)}`),
              [],
            );
          }
        }
      });
    }
  }

  it("has every token in both modes", () => {
    const t = makeSeededTheme({ id: "t", name: "T", seeds: { primary: "#1F7AA8" }, schemeStyle: "vibrant", contrast: 1 });
    assert.deepEqual(t.modes, ["light", "dark"]);
    for (const mode of t.modes) {
      assert.deepEqual(Object.keys(t.tokens[mode] ?? {}).sort(), [...COLOR_TOKENS, "radius"].sort());
    }
  });

  it("higher contrast moves text further from its background", () => {
    const ratio = (c: 0 | 1 | 2) => {
      const t = makeSeededTheme({ id: "t", name: "T", seeds: { primary: "#5146D9" }, schemeStyle: "tonal", contrast: c });
      return themeContrasts(t).find((r) => r.mode === "light" && r.foreground === "muted-foreground")?.ratio ?? 0;
    };
    assert.ok(ratio(0) < ratio(1) && ratio(1) < ratio(2), `${ratio(0)} ${ratio(1)} ${ratio(2)}`);
  });
});

describe("the tag seed", () => {
  it("is Material's tertiary role without a seed", () => {
    const auto = modeColors({ primary: "#5146D9", schemeStyle: "tonal", contrast: 0 }, "light");
    const seeded = modeColors({ primary: "#5146D9", tag: "#FF6F59", schemeStyle: "tonal", contrast: 0 }, "light");
    assert.notEqual(auto.tag, seeded.tag);
    assert.equal(auto["chart-2"], auto.tag);
    assert.equal(seeded["chart-2"], seeded.tag);
  });

  it("gives tag a tone of the seed's own hue, and is recorded in the source", () => {
    const t = makeSeededTheme({ id: "t", name: "T", seeds: { primary: "#5146D9", tag: "#ff6f59" }, schemeStyle: "tonal", contrast: 0 });
    assert.deepEqual(t.source, { kind: "seeded", seeds: { primary: "#5146D9", tag: "#FF6F59" }, schemeStyle: "tonal", contrast: 0 });
    // Tone 40 of a coral is a deep red-orange: red well above blue.
    const [r, , b] = t.tokens.light?.tag?.$value.components ?? [0, 0, 0];
    assert.ok(r > b, `light tag ${t.tokens.light?.tag?.$value.hex}`);
    const without = makeSeededTheme({ id: "t", name: "T", seeds: { primary: "#5146D9" }, schemeStyle: "tonal", contrast: 0 });
    assert.deepEqual(without.source, { kind: "seeded", seeds: { primary: "#5146D9" }, schemeStyle: "tonal", contrast: 0 });
  });

  it("status colours keep their hue whatever the seed", () => {
    const a = modeColors({ primary: "#5146D9", schemeStyle: "tonal", contrast: 0 }, "dark");
    const b = modeColors({ primary: "#E0662F", schemeStyle: "expressive", contrast: 0 }, "dark");
    assert.equal(a.success, b.success);
    assert.equal(a.warning, b.warning);
    assert.equal(a.info, b.info);
    assert.equal(Object.keys(STATUS_SEEDS).length, 3);
  });
});

describe("overrides", () => {
  const input = { primary: "#5146D9", schemeStyle: "tonal", contrast: 0 } as const;

  it("replace single tokens in one mode", () => {
    const made = makeColors(input);
    const out = applyOverrides(made, { dark: { card: "#123456", tag: "#abcdef" }, light: { primary: "not a colour" } });
    assert.equal(out.dark.card, "#123456");
    assert.equal(out.dark.tag, "#ABCDEF");
    assert.equal(out.light.card, made.light.card);
    assert.equal(out.light.primary, made.light.primary);
  });

  it("are found again in a stored theme", () => {
    const t = makeSeededTheme({ id: "t", name: "T", seeds: { primary: "#5146D9" }, schemeStyle: "tonal", contrast: 0, overrides: { light: { border: "#000000" } } });
    assert.deepEqual(findOverrides(t, input), { light: { border: "#000000" } });
    assert.deepEqual(findOverrides(fixture("seeded-indigo"), input), {});
  });
});

describe("colour tokens", () => {
  it("are DTCG sRGB with 4-decimal components and upper-case hex", () => {
    assert.deepEqual(colorToken("#ff8000"), {
      $type: "color",
      $value: { colorSpace: "srgb", components: [1, 0.502, 0], hex: "#FF8000" },
    });
    assert.throws(() => colorToken("#fff"), TypeError);
    assert.equal(normalizeHex(" #abcdef "), "#ABCDEF");
    assert.equal(normalizeHex("abcdef"), null);
  });

  it("read back as hex", () => {
    const t = fixture("handmade-synth-dark");
    assert.equal(colorsOf(t.tokens.dark).primary, "#4FE3D0");
    assert.deepEqual(colorsOf(undefined), {});
  });
});
