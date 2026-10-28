import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONTRAST_PAIRS,
  contrastRatio,
  MIN_TEXT_CONTRAST,
  relativeLuminance,
  themeContrasts,
  validateTheme,
} from "../src/index.ts";
import { fixtureFiles, readJson } from "./helpers.ts";

describe("contrast helper", () => {
  it("matches WCAG's reference points", () => {
    assert.equal(relativeLuminance([0, 0, 0]), 0);
    assert.equal(relativeLuminance([1, 1, 1]), 1);
    assert.equal(contrastRatio([0, 0, 0], [1, 1, 1]), 21);
    assert.equal(contrastRatio([1, 1, 1], [0, 0, 0]), 21);
    assert.equal(contrastRatio([0.5, 0.5, 0.5], [0.5, 0.5, 0.5]), 1);
    // #777777 on white is 4.48:1, the classic "just fails AA" grey.
    const g = 0x77 / 255;
    assert.equal(Math.round(contrastRatio([g, g, g], [1, 1, 1]) * 100) / 100, 4.48);
  });

  it("pairs every foreground with its base", () => {
    const fgs = CONTRAST_PAIRS.map(([fg]) => fg).sort();
    assert.deepEqual(fgs, [
      "accent-foreground", "card-foreground", "destructive-foreground", "foreground",
      "info-foreground", "muted-foreground", "popover-foreground", "primary-foreground",
      "secondary-foreground", "success-foreground", "tag-foreground", "warning-foreground",
    ]);
    for (const [fg, base] of CONTRAST_PAIRS) {
      if (fg !== "foreground") assert.equal(fg, `${base}-foreground`);
      else assert.equal(base, "background");
    }
  });
});

describe(`valid fixtures reach ${MIN_TEXT_CONTRAST}:1 for every foreground on its base`, () => {
  for (const file of fixtureFiles("valid")) {
    it(file, () => {
      const res = validateTheme(readJson(`fixtures/valid/${file}`));
      assert.ok(res.ok);
      const results = themeContrasts(res.theme);
      const pairsPerMode = res.theme.modes.map((m) =>
        CONTRAST_PAIRS.filter(([fg, base]) => res.theme.tokens[m]?.[fg] !== undefined && res.theme.tokens[m]?.[base] !== undefined).length,
      );
      assert.equal(results.length, pairsPerMode.reduce((a, b) => a + b, 0));
      const low = results.filter((r) => r.ratio < MIN_TEXT_CONTRAST);
      assert.deepEqual(
        low.map((r) => `${r.mode} ${r.foreground} on ${r.base}: ${r.ratio.toFixed(2)}`),
        [],
      );
    });
  }
});
