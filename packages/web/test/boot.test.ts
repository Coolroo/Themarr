// boot in a browser (fake DOM): statuses, layers, deadline, warnings, the sheet.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boot } from "../src/boot.ts";
import { localKey } from "../src/local.ts";
import type { FakeSheet } from "./helpers.ts";
import { APP, BASE, browser, fakeFetch, opts, PERSONAL, PUBLIC, tokensPath, warnings, wire } from "./helpers.ts";

const NOT_SIGNED_IN = { error: "Failed to fetch" }; // Authelia's redirect, refused (redirect: "error")

describe("statuses", () => {
  it("applied: a public theme goes on the page as one sheet", async () => {
    const b = browser();
    const { fetch } = fakeFetch({ [PUBLIC]: { status: 200, body: wire("seeded-indigo"), etag: '"1"' }, [PERSONAL]: NOT_SIGNED_IN });
    const { value: res, lines } = await warnings(() => boot(opts(fetch, b.env, { dark: { class: "dark" } })));
    assert.equal(res.status, "applied");
    assert.equal(res.source, "public");
    assert.equal(res.version, 1);
    assert.match(res.tokens?.dark?.primary ?? "", /^oklch\(/);
    const radius = wire("seeded-indigo")["tokens"].light.radius.$value;
    assert.equal(res.tokens?.light?.radius, `${radius.value}${radius.unit}`);
    assert.equal(b.doc.adoptedStyleSheets?.length, 1);
    assert.ok(b.css().includes(":root.dark {"));
    assert.deepEqual(lines, []);
  });

  it("unset: 204 everywhere, nothing on the page, no warning", async () => {
    const b = browser();
    const { fetch } = fakeFetch({ [PUBLIC]: { status: 204 }, [PERSONAL]: { status: 204 } });
    const { value: res, lines } = await warnings(() => boot(opts(fetch, b.env)));
    assert.equal(res.status, "unset");
    assert.equal(res.theme, undefined);
    assert.equal(b.css(), "");
    assert.deepEqual(lines, []);
  });

  const failures: [string, object, string][] = [
    ["a server error", { status: 500 }, "HTTP 500"],
    ["a 404", { status: 404 }, "HTTP 404"],
    ["a network error", { error: "Failed to fetch" }, "network error: Failed to fetch"],
    ["a body that is not JSON", { status: 200, badJson: true }, "bad JSON"],
    ["an invalid theme", { status: 200, body: { version: 1, modes: ["dark"], tokens: { dark: {} } } }, 'invalid theme: missing_token at "/tokens/dark/background"'],
  ];
  for (const [what, reply, reason] of failures) {
    it(`unreachable on ${what}: warns exactly one line`, async () => {
      const b = browser();
      const { fetch } = fakeFetch({ [PUBLIC]: reply, [PERSONAL]: NOT_SIGNED_IN });
      const { value: res, lines } = await warnings(() => boot(opts(fetch, b.env)));
      assert.equal(res.status, "unreachable");
      assert.ok(res.reason?.startsWith(reason), res.reason);
      assert.equal(lines.length, 1);
      assert.equal(lines[0], `[themarr] unreachable (${BASE}, ${APP}): ${res.reason}; using app defaults`);
      assert.equal(b.css(), "");
    });
  }
});

describe("the deadline", () => {
  it("resolves within timeoutMs when themarr hangs, and warns once", async () => {
    const b = browser();
    const { fetch } = fakeFetch({ [PUBLIC]: { status: 200, hang: true }, [PERSONAL]: { status: 200, hang: true } });
    const t0 = performance.now();
    const { value: res, lines } = await warnings(() => boot(opts(fetch, b.env, { timeoutMs: 200 })));
    const took = performance.now() - t0;
    assert.ok(took >= 190 && took < 300, `took ${took} ms`);
    assert.equal(res.status, "unreachable");
    assert.equal(res.reason, "timeout after 200 ms");
    assert.equal(lines.length, 1);
  });

  it("defaults to 1000 ms", async () => {
    const { fetch } = fakeFetch({ [PUBLIC]: { status: 200, hang: true } });
    const t0 = performance.now();
    const { value: res } = await warnings(() => boot(opts(fetch, browser().env, { personal: false })));
    const took = performance.now() - t0;
    assert.ok(took >= 990 && took < 1100, `took ${took} ms`);
    assert.equal(res.reason, "timeout after 1000 ms");
  });

  it("waits for a slow personal answer inside the deadline", async () => {
    const b = browser();
    const { fetch } = fakeFetch({
      [PUBLIC]: { status: 200, body: wire("seeded-indigo") },
      [PERSONAL]: { status: 200, body: wire("handmade-synth-dark"), delayMs: 50 },
    });
    const res = await boot(opts(fetch, b.env));
    assert.equal(res.source, "saved");
    assert.deepEqual(res.theme?.modes, ["dark"]);
  });

  it("the app's signal stops boot", async () => {
    const ctrl = new AbortController();
    const { fetch } = fakeFetch({ [PUBLIC]: { status: 200, hang: true }, [PERSONAL]: { status: 200, hang: true } });
    const p = warnings(() => boot(opts(fetch, browser().env, { signal: ctrl.signal })));
    setTimeout(() => ctrl.abort(), 20);
    const { value: res, lines } = await p;
    assert.equal(res.status, "unreachable");
    assert.equal(res.reason, "aborted");
    assert.equal(lines.length, 1);
  });

  it("the theme is on the page when boot resolves", async () => {
    const b = browser();
    const { fetch } = fakeFetch({ [PUBLIC]: { status: 200, body: wire("seeded-indigo"), delayMs: 5 }, [PERSONAL]: NOT_SIGNED_IN });
    let seen = "";
    await boot(opts(fetch, b.env)).then(() => {
      seen = b.css();
    });
    assert.ok(seen.includes("--themarr-primary"));
  });
});

describe("layers", () => {
  it("asks public (no cookie) and personal (cookie) at the same time", async () => {
    const { fetch, calls } = fakeFetch({ [PUBLIC]: { status: 204, delayMs: 20 }, [PERSONAL]: { status: 204, delayMs: 20 } });
    const p = boot(opts(fetch, browser().env));
    assert.equal(calls.length, 2, "both asked before either answers");
    await p;
    const byPath = Object.fromEntries(calls.map((c) => [c.path, c.init]));
    assert.equal(byPath[PUBLIC]?.credentials, "omit");
    assert.equal(byPath[PERSONAL]?.credentials, "include");
    assert.equal(byPath[PERSONAL]?.redirect, "error");
  });

  it("a personal theme beats the public one", async () => {
    const b = browser();
    const { fetch } = fakeFetch({
      [PUBLIC]: { status: 200, body: wire("seeded-indigo") },
      [PERSONAL]: { status: 200, body: wire("handmade-synth-dark", { source: "default" }) },
    });
    const res = await boot(opts(fetch, b.env));
    assert.equal(res.status, "applied");
    assert.equal(res.source, "default");
    assert.deepEqual(res.theme?.modes, ["dark"]);
  });

  it("anonymous (personal refused) uses the public theme with no warning", async () => {
    const { fetch } = fakeFetch({ [PUBLIC]: { status: 200, body: wire("seeded-indigo") }, [PERSONAL]: NOT_SIGNED_IN });
    const { value: res, lines } = await warnings(() => boot(opts(fetch, browser().env)));
    assert.equal(res.status, "applied");
    assert.equal(res.source, "public");
    assert.deepEqual(lines, []);
  });

  it("a personal theme still applies when the public route fails, with no warning", async () => {
    const { fetch } = fakeFetch({ [PUBLIC]: { status: 502 }, [PERSONAL]: { status: 200, body: wire("seeded-indigo") } });
    const { value: res, lines } = await warnings(() => boot(opts(fetch, browser().env)));
    assert.equal(res.status, "applied");
    assert.equal(res.source, "saved");
    assert.deepEqual(lines, []);
  });

  it("personal: false asks the public route only", async () => {
    const { fetch, calls } = fakeFetch({ [PUBLIC]: { status: 204 } });
    await boot(opts(fetch, browser().env, { personal: false }));
    assert.deepEqual(calls.map((c) => c.path), [PUBLIC]);
  });

  it("a local override beats the saved choice", async () => {
    const b = browser();
    b.storage.setItem(localKey(APP), "synth");
    const { fetch } = fakeFetch({
      [PUBLIC]: { status: 204 },
      [PERSONAL]: { status: 200, body: wire("seeded-indigo", { source: "saved" }) },
      [tokensPath("synth")]: { status: 200, body: wire("handmade-synth-dark") },
    });
    const res = await boot(opts(fetch, b.env));
    assert.equal(res.source, "local");
    assert.deepEqual(res.theme?.modes, ["dark"]);
  });

  it("a locked (enforced) theme beats the local override", async () => {
    const b = browser();
    b.storage.setItem(localKey(APP), "indigo");
    const { fetch } = fakeFetch({
      [PUBLIC]: { status: 200, body: wire("seeded-indigo") },
      [PERSONAL]: { status: 200, body: wire("handmade-synth-dark", { locked: true, source: "enforced" }) },
      [tokensPath("indigo")]: { status: 200, body: wire("seeded-indigo") },
    });
    const res = await boot(opts(fetch, b.env));
    assert.equal(res.source, "enforced");
    assert.deepEqual(res.theme?.modes, ["dark"]);
    assert.equal(b.storage.getItem(localKey(APP)), "indigo", "the override stays for when the lock goes");
  });

  it("a local override that is gone (404) is cleared, with no warning", async () => {
    const b = browser();
    b.storage.setItem(localKey(APP), "deleted");
    const { fetch } = fakeFetch({
      [PUBLIC]: { status: 200, body: wire("seeded-indigo") },
      [PERSONAL]: NOT_SIGNED_IN,
      [tokensPath("deleted")]: { status: 404 },
    });
    const { value: res, lines } = await warnings(() => boot(opts(fetch, b.env)));
    assert.equal(res.source, "public");
    assert.equal(b.storage.getItem(localKey(APP)), null);
    assert.deepEqual(lines, []);
  });

  it("a stored value that is not a theme ID is cleared without a request", async () => {
    const b = browser();
    b.storage.setItem(localKey(APP), "../../admin");
    const { fetch, calls } = fakeFetch({ [PUBLIC]: { status: 204 }, [PERSONAL]: { status: 204 } });
    await boot(opts(fetch, b.env));
    assert.equal(b.storage.getItem(localKey(APP)), null);
    assert.equal(calls.length, 2);
  });

  it("blocked storage: no local layer, no error", async () => {
    const b = browser();
    b.storage.blocked = true;
    const { fetch } = fakeFetch({ [PUBLIC]: { status: 200, body: wire("seeded-indigo") }, [PERSONAL]: NOT_SIGNED_IN });
    const res = await boot(opts(fetch, b.env));
    assert.equal(res.status, "applied");
  });
});

describe("modes", () => {
  it("a forced mode the theme lacks: unset, nothing on the page", async () => {
    const b = browser();
    const { fetch } = fakeFetch({ [PUBLIC]: { status: 200, body: wire("handmade-synth-dark") }, [PERSONAL]: NOT_SIGNED_IN });
    const { value: res, lines } = await warnings(() => boot(opts(fetch, b.env, { mode: "light" })));
    assert.equal(res.status, "unset");
    assert.equal(b.css(), "");
    assert.deepEqual(lines, []);
  });

  it("a forced mode puts that palette on the selector", async () => {
    const b = browser();
    const { fetch } = fakeFetch({ [PUBLIC]: { status: 200, body: wire("handmade-synth-dark") }, [PERSONAL]: NOT_SIGNED_IN });
    const res = await boot(opts(fetch, b.env, { mode: "dark", dark: { class: "dark" } }));
    assert.equal(res.status, "applied");
    assert.ok(b.css().startsWith(":root {"));
  });
});

describe("bad options resolve unreachable without a request", () => {
  const cases: [string, object, string][] = [
    ["an http:// url", { url: "http://themarr.test" }, "bad option url: https:// only, not http://"],
    ["a relative url", { url: "/themarr" }, "bad option url: not an absolute URL"],
    ["a url with a query", { url: `${BASE}/?x=1` }, "bad option url: no user, query or fragment"],
    ["a bad app", { app: "Demo App" }, "bad option app"],
    ["a bad timeout", { timeoutMs: -1 }, "bad option timeoutMs"],
    ["a bad map", { map: { primary: [{ var: "brand", format: "hex" }] } }, "bad option map.primary[0].var"],
  ];
  for (const [what, more, reason] of cases) {
    it(what, async () => {
      const { fetch, calls } = fakeFetch({});
      const { value: res, lines } = await warnings(() => boot(opts(fetch, browser().env, more)));
      assert.equal(res.status, "unreachable");
      assert.equal(res.reason, reason);
      assert.equal(calls.length, 0);
      assert.equal(lines.length, 1);
      assert.ok(lines[0]?.startsWith("[themarr] unreachable ("));
    });
  }

  it("never throws, even with no options", async () => {
    const { value: res } = await warnings(() => boot(undefined as never));
    assert.equal(res.status, "unreachable");
  });
});

describe("the stylesheet", () => {
  it("is placed last among the adopted sheets", async () => {
    const b = browser();
    const appSheet = { replaceSync() {} };
    b.doc.adoptedStyleSheets = [appSheet];
    const { fetch } = fakeFetch({ [PUBLIC]: { status: 200, body: wire("seeded-indigo") }, [PERSONAL]: NOT_SIGNED_IN });
    await boot(opts(fetch, b.env));
    assert.equal(b.doc.adoptedStyleSheets.length, 2);
    assert.equal(b.doc.adoptedStyleSheets[0], appSheet);
    assert.ok((b.doc.adoptedStyleSheets[1] as FakeSheet).cssText.includes("--themarr-primary"));
  });

  it("falls back to <style id=themarr> with the nonce", async () => {
    const b = browser(false);
    const { fetch } = fakeFetch({ [PUBLIC]: { status: 200, body: wire("seeded-indigo") }, [PERSONAL]: NOT_SIGNED_IN });
    const res = await boot(opts(fetch, b.env, { nonce: "abc123" }));
    assert.equal(b.doc.head.children.length, 1);
    const el = b.doc.head.children[0]!;
    assert.equal(el.id, "themarr");
    assert.equal(el.attrs.get("nonce"), "abc123");
    assert.ok(el.textContent?.includes("--themarr-primary"));
    res.dispose();
    assert.equal(b.doc.head.children.length, 0);
  });

  it("takes over a server-rendered <style id=themarr>", async () => {
    const b = browser();
    b.doc.addServerStyle(":root { --themarr-primary: red; }");
    const { fetch } = fakeFetch({ [PUBLIC]: { status: 200, body: wire("seeded-indigo") }, [PERSONAL]: NOT_SIGNED_IN });
    await boot(opts(fetch, b.env));
    assert.equal(b.doc.head.children.length, 0);
    assert.equal(b.doc.adoptedStyleSheets?.length, 1);
  });

  it("dispose removes the sheet and the listeners", async () => {
    const b = browser();
    const { fetch } = fakeFetch({ [PUBLIC]: { status: 200, body: wire("seeded-indigo") }, [PERSONAL]: NOT_SIGNED_IN });
    const res = await boot(opts(fetch, b.env));
    assert.equal(b.win.count() + b.doc.count(), 2);
    res.dispose();
    assert.equal(b.doc.adoptedStyleSheets?.length, 0);
    assert.equal(b.win.count() + b.doc.count(), 0);
  });
});
