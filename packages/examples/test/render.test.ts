// Every example with every valid golden fixture, in both modes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cssVar, MODES, TOKEN_NAMES } from "@themarr/tokens";
import { EXAMPLES, mountExample } from "../src/index.ts";
import { FakeHost, FakeSheet, fixtures, varValue } from "./helpers.ts";

const all = fixtures();

describe("every example with every valid fixture", () => {
  it("has fixtures to render", () => {
    assert.ok(all.length >= 3);
  });

  for (const example of EXAMPLES) {
    for (const { name, theme } of all) {
      for (const mode of MODES) {
        const has = theme.modes.includes(mode);
        it(`${example.id} × ${name} × ${mode}: ${has ? "applied" : "missing-mode"}`, () => {
          for (const constructable of [true, false]) {
            const host = new FakeHost(constructable);
            const r = mountExample(host, example, theme, mode, { _Sheet: constructable ? FakeSheet : null });
            assert.equal(r.status, has ? "applied" : "missing-mode");
            assert.ok(r.root.innerHTML.endsWith(example.html));
            const css = r.root.css();
            assert.ok(css.includes(example.css));
            for (const token of TOKEN_NAMES) {
              const v = varValue(css, cssVar(token));
              const set = has && theme.tokens[mode]?.[token] !== undefined;
              if (set) assert.match(v ?? "", /^(?:oklch\([\d. /]+\)|[\d.]+(?:px|rem))$/, `${token}: ${v}`);
              else assert.equal(v, "initial", token);
            }
          }
        });
      }
    }
  }
});
