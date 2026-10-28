// boot in Node (no document): resolves without applying; renderCss for the page head.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boot, renderCss } from "../src/boot.ts";
import { BASE, APP, fakeFetch, NODE_ENV, opts, PUBLIC, warnings, wire } from "./helpers.ts";

describe("Node", () => {
  it("asks the public route only (no cookie, no local override) and renders CSS", async () => {
    const { fetch, calls } = fakeFetch({ [PUBLIC]: { status: 200, body: wire("seeded-indigo"), etag: '"1"' } });
    const res = await boot(opts(fetch, NODE_ENV, { dark: { class: "dark" } }));
    assert.deepEqual(calls.map((c) => c.path), [PUBLIC]);
    assert.equal(res.status, "applied");
    const css = renderCss(res);
    assert.ok(css.includes(":root:not(.dark) {"), "uses boot's options");
    assert.ok(css.includes(":root.dark {"));
    const media = renderCss(res, { selector: "html" });
    assert.ok(media.includes("@media (prefers-color-scheme: dark) {\n  html {"));
    res.dispose();
  });

  it("works with the real globals when there is no DOM", async () => {
    assert.equal(typeof (globalThis as { document?: unknown }).document, "undefined");
    const { fetch } = fakeFetch({ [PUBLIC]: { status: 200, body: wire("handmade-synth-dark") } });
    const res = await boot({ app: APP, url: BASE, _fetch: fetch });
    assert.equal(res.status, "applied");
    assert.ok(renderCss(res).includes("--themarr-primary"));
  });

  it("warns in the server log when unreachable", async () => {
    const { fetch } = fakeFetch({ [PUBLIC]: { error: "connect ECONNREFUSED" } });
    const { value: res, lines } = await warnings(() => boot(opts(fetch, NODE_ENV)));
    assert.equal(res.status, "unreachable");
    assert.deepEqual(lines, [`[themarr] unreachable (${BASE}, ${APP}): network error: connect ECONNREFUSED; using app defaults`]);
    assert.equal(renderCss(res), "");
  });

  it("renderCss of nothing is empty; bad options throw", () => {
    assert.equal(renderCss(undefined), "");
    assert.equal(renderCss({}), "");
    assert.throws(() => renderCss({}, { selector: "a{}" }), TypeError);
  });

  it("personal: true in Node asks /v1/me too", async () => {
    const { fetch, calls } = fakeFetch({ [PUBLIC]: { status: 204 }, "/v1/me/apps/demo/theme": { status: 204 } });
    await boot(opts(fetch, NODE_ENV, { personal: true }));
    assert.equal(calls.length, 2);
  });
});
