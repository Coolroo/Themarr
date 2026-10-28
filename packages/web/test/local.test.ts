// The local-override helpers the drawer uses.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clearLocalOverride, getLocalOverride, localKey, setLocalOverride } from "../src/local.ts";
import { FakeStorage } from "./helpers.ts";

describe("local override", () => {
  it("keeps one theme ID per app under themarr:<app>:local", () => {
    const s = new FakeStorage();
    assert.equal(getLocalOverride("demo", s), null);
    assert.equal(setLocalOverride("demo", "synth", s), true);
    assert.equal(s.map.get("themarr:demo:local"), "synth");
    assert.equal(localKey("other"), "themarr:other:local");
    assert.equal(getLocalOverride("demo", s), "synth");
    assert.equal(getLocalOverride("other", s), null);
    clearLocalOverride("demo", s);
    assert.equal(getLocalOverride("demo", s), null);
  });

  it("refuses an ID that is not a theme slug", () => {
    const s = new FakeStorage();
    assert.equal(setLocalOverride("demo", "../x", s), false);
    assert.equal(setLocalOverride("demo", "A", s), false);
    assert.equal(s.map.size, 0);
  });

  it("is safe when storage is blocked or absent", () => {
    const s = new FakeStorage();
    s.blocked = true;
    assert.equal(getLocalOverride("demo", s), null);
    assert.equal(setLocalOverride("demo", "synth", s), false);
    assert.doesNotThrow(() => clearLocalOverride("demo", s));
    assert.equal(getLocalOverride("demo", undefined), null);
    assert.equal(setLocalOverride("demo", "synth", undefined), false);
  });
});
