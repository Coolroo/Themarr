// The drawer's postMessage protocol: only exact shapes pass.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DRAWER_PROTOCOL, parseAppMessage, parseDrawerMessage } from "../../src/drawer/protocol.ts";
import { wire } from "../helpers.ts";

describe("parseDrawerMessage", () => {
  it("accepts each message of version 1", () => {
    assert.equal(DRAWER_PROTOCOL, 1);
    for (const type of ["ready", "clearPreview", "clearLocal", "close"]) {
      assert.deepEqual(parseDrawerMessage({ themarr: 1, type }), { themarr: 1, type });
    }
    assert.deepEqual(parseDrawerMessage({ themarr: 1, type: "keepLocal", themeId: "synth" }), { themarr: 1, type: "keepLocal", themeId: "synth" });
    assert.deepEqual(parseDrawerMessage({ themarr: 1, type: "saved", scope: "me" }), { themarr: 1, type: "saved", scope: "me" });
    assert.deepEqual(parseDrawerMessage({ themarr: 1, type: "saved", scope: "app" }), { themarr: 1, type: "saved", scope: "app" });
    const p = parseDrawerMessage({ themarr: 1, type: "preview", body: wire("seeded-indigo"), mode: "dark" });
    assert.equal(p?.type, "preview");
    assert.equal(p?.type === "preview" ? p.mode : undefined, "dark");
    assert.equal(p?.type === "preview" ? p.body.version : undefined, 1);
  });

  it("refuses everything else", () => {
    const bad: unknown[] = [
      null,
      "ready",
      [],
      { type: "ready" },
      { themarr: 2, type: "ready" },
      { themarr: "1", type: "ready" },
      { themarr: 1, type: "hello" },
      { themarr: 1, type: "nope" },
      { themarr: 1, type: "ready", extra: true },
      { themarr: 1, type: "close", x: 1 },
      { themarr: 1, type: "keepLocal" },
      { themarr: 1, type: "keepLocal", themeId: "../etc" },
      { themarr: 1, type: "keepLocal", themeId: "Synth" },
      { themarr: 1, type: "saved", scope: "everyone" },
      { themarr: 1, type: "saved" },
      { themarr: 1, type: "preview" },
      { themarr: 1, type: "preview", body: { version: 1, modes: ["dark"], tokens: { dark: {} } } },
      { themarr: 1, type: "preview", body: wire("seeded-indigo"), mode: "sepia" },
      { themarr: 1, type: "preview", body: { ...wire("seeded-indigo"), locked: true } },
      { themarr: 1, type: "preview", body: wire("seeded-indigo"), script: "x" },
    ];
    for (const b of bad) assert.equal(parseDrawerMessage(b), null, JSON.stringify(b)?.slice(0, 80));
  });
});

describe("parseAppMessage", () => {
  const hello = { themarr: 1, type: "hello", app: "board", mode: "light", current: { source: "saved", locked: false, version: 3, local: "synth" } };

  it("accepts a hello", () => {
    assert.deepEqual(parseAppMessage(hello), hello);
    const none = { themarr: 1, type: "hello", app: "board", mode: "dark", current: { source: "none", locked: false } };
    assert.deepEqual(parseAppMessage(none), none);
  });

  it("refuses anything else", () => {
    const bad: unknown[] = [
      { ...hello, themarr: 2 },
      { ...hello, type: "ready" },
      { ...hello, app: "Board" },
      { ...hello, mode: "sepia" },
      { ...hello, extra: 1 },
      { ...hello, current: { source: "wat", locked: false } },
      { ...hello, current: { source: "saved" } },
      { ...hello, current: { source: "saved", locked: "no" } },
      { ...hello, current: { source: "saved", locked: false, version: 0 } },
      { ...hello, current: { source: "saved", locked: false, local: "../x" } },
      { ...hello, current: { source: "saved", locked: false, who: "alice" } },
    ];
    for (const b of bad) assert.equal(parseAppMessage(b), null, JSON.stringify(b));
  });
});
