// Refresh on focus: ETag, 304, 204, a new theme, outages, debounce.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boot } from "../src/boot.ts";
import type { BootResult } from "../src/types.ts";
import type { Reply } from "./helpers.ts";
import { browser, fakeFetch, NODE_ENV, opts, PERSONAL, PUBLIC, sleep, warnings, wire } from "./helpers.ts";

/** A public route whose answer the test changes; it answers 304 when If-None-Match matches. */
function server(first: Reply) {
  let reply = first;
  const route = (init: { headers: Record<string, string> }): Reply => {
    const inm = init.headers["If-None-Match"];
    if (reply.status === 200 && reply.etag !== undefined && inm === reply.etag) return { status: 304 };
    return reply;
  };
  return {
    set(r: Reply) {
      reply = r;
    },
    route,
  };
}

describe("refresh", () => {
  it("browser: sends no request headers (no CORS preflight); the same theme keeps the same sheet", async () => {
    const b = browser();
    const s = server({ status: 200, body: wire("seeded-indigo"), etag: '"7"' });
    const { fetch, calls } = fakeFetch({ [PUBLIC]: s.route, [PERSONAL]: { error: "Failed to fetch" } });
    const changes: BootResult[] = [];
    const res = await boot(opts(fetch, b.env, { onChange: (r) => void changes.push(r) }));
    const sheet = b.doc.adoptedStyleSheets?.[0];
    const css = b.css();
    await res.refresh();
    assert.ok(calls.length >= 4);
    for (const c of calls) assert.deepEqual(c.init.headers, {}, c.path);
    assert.equal(b.doc.adoptedStyleSheets?.[0], sheet);
    assert.equal(b.css(), css);
    assert.equal(res.status, "applied");
    assert.equal(changes.length, 0);
  });

  it("Node: sends If-None-Match; 304 keeps the result", async () => {
    const s = server({ status: 200, body: wire("seeded-indigo"), etag: '"7"' });
    const { fetch, calls } = fakeFetch({ [PUBLIC]: s.route });
    const changes: BootResult[] = [];
    const res = await boot(opts(fetch, NODE_ENV, { onChange: (r) => void changes.push(r) }));
    assert.deepEqual(calls[0]?.init.headers, {});
    const theme = res.theme;
    await res.refresh();
    assert.equal(calls[1]?.init.headers["If-None-Match"], '"7"');
    assert.equal(res.status, "applied");
    assert.equal(res.theme, theme);
    assert.equal(changes.length, 0);
    s.set({ status: 204 });
    await res.refresh();
    assert.equal(res.status, "unset");
    assert.equal(changes.length, 1);
  });

  it("204 removes the sheet: the app's own look returns", async () => {
    const b = browser();
    const s = server({ status: 200, body: wire("seeded-indigo"), etag: '"1"' });
    const { fetch } = fakeFetch({ [PUBLIC]: s.route, [PERSONAL]: { status: 204 } });
    const changes: string[] = [];
    const res = await boot(opts(fetch, b.env, { onChange: (r) => void changes.push(r.status) }));
    s.set({ status: 204 });
    await res.refresh();
    assert.equal(b.doc.adoptedStyleSheets?.length, 0);
    assert.equal(res.status, "unset");
    assert.equal(res.theme, undefined);
    assert.equal(res.tokens, undefined);
    assert.deepEqual(changes, ["unset"]);
  });

  it("a new theme replaces the sheet's text", async () => {
    const b = browser();
    const s = server({ status: 200, body: wire("seeded-indigo"), etag: '"1"' });
    const { fetch } = fakeFetch({ [PUBLIC]: s.route, [PERSONAL]: { status: 204 } });
    const res = await boot(opts(fetch, b.env, { dark: { class: "dark" } }));
    assert.ok(b.css().includes(":not(.dark)"));
    s.set({ status: 200, body: wire("handmade-synth-dark", { version: 4 }), etag: '"4"' });
    await res.refresh();
    assert.equal(b.doc.adoptedStyleSheets?.length, 1);
    assert.ok(!b.css().includes(":not(.dark)"));
    assert.equal(res.version, 4);
  });

  it("a theme set later is applied", async () => {
    const b = browser();
    const s = server({ status: 204 });
    const { fetch } = fakeFetch({ [PUBLIC]: s.route, [PERSONAL]: { status: 204 } });
    const res = await boot(opts(fetch, b.env));
    assert.equal(res.status, "unset");
    s.set({ status: 200, body: wire("seeded-indigo"), etag: '"1"' });
    await res.refresh();
    assert.equal(res.status, "applied");
    assert.ok(b.css().includes("--themarr-primary"));
  });

  it("an outage keeps the page as it is and warns once", async () => {
    const b = browser();
    const s = server({ status: 200, body: wire("seeded-indigo"), etag: '"1"' });
    const { fetch } = fakeFetch({ [PUBLIC]: s.route, [PERSONAL]: { error: "Failed to fetch" } });
    const res = await boot(opts(fetch, b.env));
    const css = b.css();
    const { lines } = await warnings(async () => {
      s.set({ status: 503 });
      await res.refresh();
      await res.refresh();
      assert.equal(b.css(), css);
      assert.equal(res.status, "applied");
      // Back, then down again: a new outage, a new warning.
      s.set({ status: 200, body: wire("seeded-indigo"), etag: '"1"' });
      await res.refresh();
      s.set({ error: "Failed to fetch" });
      await res.refresh();
    });
    assert.equal(lines.length, 2);
    assert.match(lines[0] ?? "", /: HTTP 503; using app defaults$/);
  });

  it("does not warn again for the outage boot already reported", async () => {
    const b = browser();
    const { fetch } = fakeFetch({ [PUBLIC]: { status: 500 }, [PERSONAL]: { status: 204 } });
    const { lines } = await warnings(async () => {
      const res = await boot(opts(fetch, b.env));
      await res.refresh();
    });
    assert.equal(lines.length, 1);
  });

  it("focus and visibilitychange together run one refresh (debounce)", async () => {
    const b = browser();
    const { fetch, calls } = fakeFetch({ [PUBLIC]: { status: 204 }, [PERSONAL]: { status: 204 } });
    await boot(opts(fetch, b.env, { _debounceMs: 10 }));
    const before = calls.length;
    b.win.fire("focus");
    b.doc.fire("visibilitychange");
    await sleep(40);
    assert.equal(calls.length - before, 2, "one public and one personal request");
  });

  it("a hidden tab does not refresh", async () => {
    const b = browser();
    const { fetch, calls } = fakeFetch({ [PUBLIC]: { status: 204 }, [PERSONAL]: { status: 204 } });
    await boot(opts(fetch, b.env, { _debounceMs: 5 }));
    const before = calls.length;
    b.doc.visibilityState = "hidden";
    b.doc.fire("visibilitychange");
    await sleep(20);
    assert.equal(calls.length, before);
  });

  it("refreshOnFocus: false adds no listeners", async () => {
    const b = browser();
    const { fetch } = fakeFetch({ [PUBLIC]: { status: 204 }, [PERSONAL]: { status: 204 } });
    await boot(opts(fetch, b.env, { refreshOnFocus: false }));
    assert.equal(b.win.count() + b.doc.count(), 0);
  });

  it("after dispose, focus does nothing", async () => {
    const b = browser();
    const { fetch, calls } = fakeFetch({ [PUBLIC]: { status: 204 }, [PERSONAL]: { status: 204 } });
    const res = await boot(opts(fetch, b.env, { _debounceMs: 5 }));
    res.dispose();
    const before = calls.length;
    b.win.fire("focus");
    await sleep(20);
    assert.equal(calls.length, before);
  });
});
