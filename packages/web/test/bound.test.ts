// The runtime's own fetch, with no _fetch: a browser's fetch throws "Illegal
// invocation" unless it runs on the global object. These tests put a strict
// fetch on globalThis and boot without _fetch, so boot and the drawer must
// call it bound (they once called it as this.#fetch(...) and host.fetch(...)).
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { boot, globalFetch } from "../src/boot.ts";
import type { FetchLike } from "../src/types.ts";
import { dom, settle } from "./drawer/dom.ts";
import { APP, BASE, fakeFetch, PERSONAL, PUBLIC, tokensPath, wire } from "./helpers.ts";

const original = (globalThis as { fetch?: unknown }).fetch;

function install(f: FetchLike): void {
  (globalThis as { fetch?: unknown }).fetch = f;
}

describe("the runtime's fetch, called bound", () => {
  beforeEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
  });
  afterEach(() => {
    (globalThis as { fetch?: unknown }).fetch = original;
  });

  it("the strict fake refuses a call on another object", async () => {
    const { fetch } = fakeFetch({ [PUBLIC]: { status: 204 } });
    const holder = { fetch };
    await assert.rejects(holder.fetch(`${BASE}${PUBLIC}`, { method: "GET", credentials: "omit", redirect: "error", headers: {}, signal: new AbortController().signal }), /Illegal invocation/);
  });

  it("globalFetch is undefined without a fetch, and calls it on globalThis", async () => {
    assert.equal(globalFetch(), undefined);
    const { fetch, calls } = fakeFetch({ [PUBLIC]: { status: 204 } });
    install(fetch);
    const f = globalFetch();
    const holder = { f };
    const res = await holder.f!(`${BASE}${PUBLIC}`, { method: "GET", credentials: "omit", redirect: "error", headers: {}, signal: new AbortController().signal });
    assert.equal(res.status, 204);
    assert.equal(calls.length, 1);
  });

  it("boot in a browser applies the theme with the global fetch", async () => {
    const { fetch } = fakeFetch({ [PUBLIC]: { status: 200, body: wire("seeded-indigo"), etag: '"1"' }, [PERSONAL]: { status: 204 } });
    install(fetch);
    const d = dom();
    const res = await boot({ app: APP, url: BASE, _env: d.env, refreshOnFocus: false });
    assert.equal(res.status, "applied", res.reason);
    assert.ok(d.css().includes("--themarr-primary"));
    res.dispose();
  });

  it("the guest drawer lists and previews with the global fetch", async () => {
    const swatch = { primary: "#5146D9", background: "#101010", foreground: "#F0F0F0" };
    const { fetch, calls } = fakeFetch({
      [PUBLIC]: { status: 200, body: wire("seeded-indigo"), etag: '"1"' },
      [PERSONAL]: { error: "Failed to fetch" },
      "/v1/catalog": { status: 200, body: { themes: [{ id: "synth", name: "Synth", version: 1, modes: ["dark"], swatch: { dark: swatch } }], favourites: [] } },
      [tokensPath("synth")]: { status: 200, body: wire("handmade-synth-dark") },
    });
    install(fetch);
    const d = dom();
    const res = await boot({ app: APP, url: BASE, _env: d.env, drawer: true, _drawerReadyMs: 50, refreshOnFocus: false });
    assert.equal(res.status, "applied", res.reason);
    d.part("launcher").click();
    await settle();
    const tiles = d.drawer()?.shadowRoot?.all().filter((e) => e.getAttribute("class") === "tile") ?? [];
    assert.equal(tiles.length, 1);
    tiles[0]!.click();
    await settle();
    assert.ok(calls.some((c) => c.path === tokensPath("synth")), "the preview fetched the tokens");
    res.dispose();
  });
});
