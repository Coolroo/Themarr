// The wire body check: the token contract from @themarr/tokens, plus locked/source.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseWire } from "../src/wire.ts";
import { wire } from "./helpers.ts";

describe("parseWire", () => {
  it("accepts every golden fixture as a wire body", () => {
    for (const name of ["seeded-indigo", "seeded-with-tag", "handmade-synth-dark"] as const) {
      const p = parseWire(wire(name));
      assert.ok(p.ok, name);
      assert.equal(p.locked, false);
      assert.equal(p.source, undefined);
    }
  });

  it("reads locked and a known source, and ignores other fields", () => {
    const p = parseWire(wire("seeded-indigo", { locked: true, source: "enforced", etc: 1 }));
    assert.ok(p.ok);
    assert.equal(p.locked, true);
    assert.equal(p.source, "enforced");
    assert.deepEqual(Object.keys(p.theme), ["version", "modes", "tokens"]);
    const q = parseWire(wire("seeded-indigo", { locked: "yes", source: "elsewhere" }));
    assert.ok(q.ok && !q.locked && q.source === undefined);
  });

  it("drops token names it doesn't know (a newer server)", () => {
    const body = wire("handmade-synth-dark");
    body["tokens"].dark["glow"] = { $type: "color", $value: "anything" };
    const p = parseWire(body);
    assert.ok(p.ok);
    assert.ok(!("glow" in (p.theme.tokens.dark ?? {})));
  });

  it("refuses what breaks the contract", () => {
    const cases: [unknown, string][] = [
      [null, "invalid theme: the body is not a JSON object"],
      [[], "invalid theme: the body is not a JSON object"],
      [{ modes: ["dark"], tokens: {} }, 'invalid theme: missing_field at "/version"'],
      [{ ...wire("handmade-synth-dark"), modes: ["light"] }, "invalid theme: tokens_for_unlisted_mode"],
    ];
    for (const [body, want] of cases) {
      const p = parseWire(body);
      assert.ok(!p.ok);
      assert.ok(p.reason.startsWith(want), p.reason);
    }
    const bad = wire("handmade-synth-dark");
    bad["tokens"].dark.primary.$value.hex = "#000000";
    const p = parseWire(bad);
    assert.ok(!p.ok && p.reason.startsWith("invalid theme: hex_mismatch"));
  });
});
