// Formats: oklch (known values), hsl-triple, hex, rgb-triplet, dimensions.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ColorValue } from "@themarr/tokens";
import { formatColor, formatDimension, num, srgbToOklch } from "../src/color.ts";

function c(hex: string, alpha?: number): ColorValue {
  const comps = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const v: ColorValue = { colorSpace: "srgb", components: comps, hex };
  if (alpha !== undefined) v.alpha = alpha;
  return v;
}

describe("oklch", () => {
  // Reference values: CSS Color 4 / color.js (red oklch(62.796% 0.25768 29.234), etc.).
  const known: [string, string][] = [
    ["#FF0000", "oklch(0.628 0.2577 29.23)"],
    ["#00FF00", "oklch(0.8664 0.2948 142.5)"],
    ["#0000FF", "oklch(0.452 0.3132 264.05)"],
    ["#FFFFFF", "oklch(1 0 0)"],
    ["#000000", "oklch(0 0 0)"],
    ["#808080", "oklch(0.5999 0 0)"],
  ];
  for (const [hex, want] of known) {
    it(`${hex} → ${want}`, () => assert.equal(formatColor(c(hex), "oklch"), want));
  }

  it("matches the reference to five decimals before rounding", () => {
    const [L, C, H] = srgbToOklch([1, 0, 0]);
    assert.ok(Math.abs(L - 0.62796) < 1e-5, String(L));
    assert.ok(Math.abs(C - 0.25768) < 1e-5, String(C));
    assert.ok(Math.abs(H - 29.2339) < 1e-3, String(H));
  });

  it("writes alpha after a slash", () => {
    assert.equal(formatColor(c("#FF0000", 0.5), "oklch"), "oklch(0.628 0.2577 29.23 / 0.5)");
  });

  it("writes no alpha for an opaque colour with alpha 1", () => {
    assert.equal(formatColor(c("#FF0000", 1), "oklch"), "oklch(0.628 0.2577 29.23)");
  });
});

describe("hsl-triple", () => {
  it("is bare H S% L%, as shadcn's hsl(var(--x)) takes", () => {
    assert.equal(formatColor(c("#3B82F6"), "hsl-triple"), "217.2 91.2% 59.8%");
    assert.equal(formatColor(c("#FF0000"), "hsl-triple"), "0 100% 50%");
    assert.equal(formatColor(c("#000000"), "hsl-triple"), "0 0% 0%");
    assert.equal(formatColor(c("#FFFFFF"), "hsl-triple"), "0 0% 100%");
  });

  it("writes alpha after a slash", () => {
    assert.equal(formatColor(c("#FF0000", 0.25), "hsl-triple"), "0 100% 50% / 0.25");
  });
});

describe("hex", () => {
  it("is lower-case #rrggbb", () => assert.equal(formatColor(c("#3B82F6"), "hex"), "#3b82f6"));
  it("adds an alpha byte", () => assert.equal(formatColor(c("#3B82F6", 0.5), "hex"), "#3b82f680"));
});

describe("rgb-triplet", () => {
  it("is R, G, B in 0..255, as theme.park uses", () => assert.equal(formatColor(c("#3B82F6"), "rgb-triplet"), "59, 130, 246"));
  it("has no alpha", () => assert.equal(formatColor(c("#3B82F6", 0.5), "rgb-triplet"), "59, 130, 246"));
});

describe("dimension and numbers", () => {
  it("writes value and unit", () => {
    assert.equal(formatDimension({ value: 10, unit: "px" }), "10px");
    assert.equal(formatDimension({ value: 0.5, unit: "rem" }), "0.5rem");
  });
  it("rounds and never writes -0", () => {
    assert.equal(num(-0.00001, 4), "0");
    assert.equal(num(1.23456, 2), "1.23");
    assert.equal(num(2, 4), "2");
  });
});
