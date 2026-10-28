// The CSS text: selectors per dark strategy, missing modes, forced mode, map.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkRender, cssFor, splitSelectors, type Render } from "../src/css.ts";
import type { RenderOptions, WireTheme } from "../src/types.ts";
import { wire } from "./helpers.ts";

const indigo = wire("seeded-indigo") as WireTheme;
const synth = wire("handmade-synth-dark") as WireTheme;

function r(o: RenderOptions = {}): Render {
  const res = checkRender(o);
  if (typeof res === "string") throw new Error(res);
  return res;
}

describe("dark strategies", () => {
  it("class: light on :not(.dark), dark on .dark", () => {
    const css = cssFor(indigo, r({ dark: { class: "dark" } }));
    assert.match(css, /^:root:not\(\.dark\) \{\n  --themarr-background: oklch\(/);
    assert.match(css, /\n:root\.dark \{\n  --themarr-background: oklch\(/);
    assert.ok(!css.includes("@media"));
  });

  it("attr: an attribute selector", () => {
    const css = cssFor(indigo, r({ dark: { attr: "data-theme", value: "dark" } }));
    assert.ok(css.includes(':root:not([data-theme="dark"]) {'));
    assert.ok(css.includes(':root[data-theme="dark"] {'));
  });

  it("media (the default): prefers-color-scheme", () => {
    const css = cssFor(indigo, r());
    assert.ok(css.includes("@media (prefers-color-scheme: light) {\n  :root {\n    --themarr-background:"));
    assert.ok(css.includes("@media (prefers-color-scheme: dark) {\n  :root {\n"));
  });

  it("a selector list gets the mark on each part", () => {
    const css = cssFor(synth, r({ selector: "html, body > main", dark: { class: "night" } }));
    assert.ok(css.startsWith("html.night,\nbody > main.night {"));
  });

  it("vibe-kanban's selector", () => {
    const css = cssFor(indigo, r({ selector: "html:not([data-theme-variant])", dark: { class: "dark" } }));
    assert.ok(css.includes("html:not([data-theme-variant]):not(.dark) {"));
    assert.ok(css.includes("html:not([data-theme-variant]).dark {"));
  });
});

describe("modes", () => {
  it("emits nothing for a mode the theme lacks", () => {
    const css = cssFor(synth, r({ dark: { class: "dark" } }));
    assert.ok(!css.includes(":not(.dark)"));
    assert.ok(css.startsWith(":root.dark {"));
    assert.ok(!cssFor(synth, r()).includes("prefers-color-scheme: light"));
  });

  it("a forced mode goes on the selector only", () => {
    const css = cssFor(synth, r({ mode: "dark", dark: { class: "dark" } }));
    assert.ok(css.startsWith(":root {\n  --themarr-background:"));
    assert.ok(!css.includes(".dark") && !css.includes("@media"));
    const light = cssFor(indigo, r({ mode: "light" }));
    assert.equal((light.match(/\{/g) ?? []).length, 1);
    assert.ok(light.includes(`--themarr-background: oklch(`));
  });

  it("a forced mode the theme lacks gives no CSS", () => {
    assert.equal(cssFor(synth, r({ mode: "light" })), "");
  });

  it("no theme, no CSS", () => assert.equal(cssFor(undefined, r()), ""));
});

describe("tokens and the map", () => {
  it("sets every token as --themarr-<name>, radius as a dimension", () => {
    const css = cssFor(synth, r({ mode: "dark" }));
    assert.ok(css.includes("--themarr-radius: 10px;"));
    assert.ok(css.includes("--themarr-chart-5: oklch("));
    // Synth has the optional tag tokens.
    assert.ok(css.includes("--themarr-tag: oklch("));
  });

  it("maps tokens to the app's variables in their formats", () => {
    const css = cssFor(synth, r({
      mode: "dark",
      map: {
        primary: [{ var: "--brand", format: "hsl-triple" }, { var: "--brand-hex", format: "hex" }],
        background: [{ var: "--bg", format: "rgb-triplet" }],
        radius: [{ var: "--radius", format: "hex" }],
      },
    }));
    const primary = synth.tokens.dark!.primary!.$value;
    assert.ok(css.includes(`--brand-hex: ${primary.hex.toLowerCase()};`));
    assert.match(css, /--brand: [\d.]+ [\d.]+% [\d.]+%;/);
    assert.match(css, /--bg: \d+, \d+, \d+;/);
    assert.ok(css.includes("--radius: 10px;"), "a format on radius is ignored");
  });

  it("a mapped token the theme lacks leaves the app's value alone", () => {
    const plain = wire("seeded-indigo") as WireTheme;
    for (const m of plain.modes) delete plain.tokens[m]!.tag;
    const css = cssFor(plain, r({ map: { tag: [{ var: "--people", format: "hex" }] } }));
    assert.ok(css.includes("--themarr-primary"));
    assert.ok(!css.includes("--people"));
  });
});

describe("checkRender", () => {
  const bad: [RenderOptions, string][] = [
    [{ selector: "" }, "bad option selector"],
    [{ selector: ":root { color: red }" }, "bad option selector"],
    [{ selector: "</style><script>" }, "bad option selector"],
    [{ dark: { class: "two words" } }, "bad option dark.class"],
    [{ dark: { attr: "data theme", value: "dark" } }, "bad option dark.attr"],
    [{ dark: { attr: "data-theme", value: 'x"]' } }, "bad option dark.value"],
    [{ dark: "auto" as never }, "bad option dark"],
    [{ mode: "dim" as never }, "bad option mode"],
    [{ map: { primary: [{ var: "brand", format: "hex" }] } }, "bad option map.primary[0].var"],
    [{ map: { primary: [{ var: "--a:b", format: "hex" }] } }, "bad option map.primary[0].var"],
    [{ map: { primary: [{ var: "--brand", format: "rgb" as never }] } }, "bad option map.primary[0].format"],
    [{ map: { brand: [] } as never }, 'bad option map: "brand" is not a themarr token'],
  ];
  for (const [o, want] of bad) {
    it(`refuses ${JSON.stringify(o)}`, () => assert.equal(checkRender(o), want));
  }

  it("defaults: :root and media", () => {
    assert.deepEqual(checkRender({}), { selector: ":root", dark: "media", map: undefined });
  });
});

describe("splitSelectors", () => {
  it("splits at top-level commas only", () => {
    assert.deepEqual(splitSelectors(':is(a, b) c, [data-x="1,2"], d'), [":is(a, b) c", '[data-x="1,2"]', "d"]);
  });
});
