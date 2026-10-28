// The in-app drawer: launcher, hide tab, signed-in iframe and its messages,
// the guest panel, focus and Escape, and Node.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boot } from "../../src/boot.ts";
import { launcherKey } from "../../src/drawer/drawer.ts";
import { localKey } from "../../src/local.ts";
import type { BootOptions, BootResult } from "../../src/types.ts";
import type { Route } from "../helpers.ts";
import { APP, BASE, fakeFetch, NODE_ENV, opts, PERSONAL, PUBLIC, tokensPath, wire } from "../helpers.ts";
import { dom, FContentWindow, type Dom, type FEl, settle } from "./dom.ts";

const SIGNED_IN: Route = { status: 204 };
const GUEST: Route = { error: "Failed to fetch" }; // Authelia's redirect, refused
const CATALOG = "/v1/catalog";

function swatch(primary: string): Record<string, string> {
  return { primary, background: "#101010", foreground: "#F0F0F0" };
}

const catalogBody = {
  themes: [
    { id: "indigo", name: "Coolroo Indigo", version: 1, modes: ["light", "dark"], swatch: { light: swatch("#5146D9"), dark: swatch("#8C84FF") } },
    { id: "synth", name: "Synth", version: 2, modes: ["dark"], swatch: { dark: swatch("#00E5D4") } },
    { id: "tagged", name: "Tagged <b>", version: 1, modes: ["light", "dark"], swatch: { light: swatch("#AA3300"), dark: swatch("#FF7744") } },
    { id: "Bad", name: "skipped: bad id", swatch: { light: swatch("#000000") } },
    { id: "evil", name: "skipped: bad colour", swatch: { light: { primary: "red;x", background: "#000000", foreground: "#FFFFFF" } } },
  ],
  favourites: ["synth", "ghost"],
};

function routes(personal: Route, more: Record<string, Route> = {}): Record<string, Route> {
  return {
    [PUBLIC]: { status: 200, body: wire("seeded-indigo"), etag: '"1"' },
    [PERSONAL]: personal,
    [CATALOG]: { status: 200, body: catalogBody },
    [tokensPath("synth")]: { status: 200, body: wire("handmade-synth-dark") },
    [tokensPath("tagged")]: { status: 200, body: wire("seeded-with-tag") },
    ...more,
  };
}

async function start(d: Dom, personal: Route, more: Partial<BootOptions> = {}, extra: Record<string, Route> = {}) {
  const f = fakeFetch(routes(personal, extra));
  const res = await boot(opts(f.fetch, d.env, { drawer: true, dark: { class: "dark" }, _drawerReadyMs: 50, refreshOnFocus: false, ...more }));
  return { res, calls: f.calls };
}

const visible = (e: FEl): boolean => !e.hidden;
const iframeOf = (d: Dom): FEl => {
  const f = d.drawer()?.shadowRoot?.byTag("iframe");
  if (f === undefined) throw new Error("no iframe");
  return f;
};
const posted = (d: Dom): { msg: any; targetOrigin: string }[] => (iframeOf(d).contentWindow as FContentWindow).posted;
/** A message from the drawer page, as the browser would deliver it. */
function fromPage(d: Dom, data: unknown, origin = BASE, source: unknown = iframeOf(d).contentWindow): void {
  d.win.message(data, origin, source);
}

describe("the launcher", () => {
  it("is off unless asked for", async () => {
    const d = dom();
    const f = fakeFetch(routes(SIGNED_IN));
    const res = await boot(opts(f.fetch, d.env));
    assert.equal(d.drawer(), undefined);
    res.dispose();
  });

  it("shows a button in one shadow root; the panel and tab are hidden", async () => {
    const d = dom();
    const { res } = await start(d, SIGNED_IN);
    const host = d.drawer();
    assert.ok(host !== undefined);
    assert.equal(host.parent, d.doc.body);
    assert.ok(host.shadowRoot !== null);
    assert.equal(host.children.length, 0, "nothing in the light DOM");
    assert.equal(host.shadowRoot.adoptedStyleSheets.length, 1, "own styles as a constructable sheet");
    const launcher = d.part("launcher");
    assert.equal(launcher.tagName, "BUTTON");
    assert.equal(launcher.getAttribute("aria-label"), "Open themarr");
    assert.ok(visible(launcher));
    assert.ok(!visible(d.part("tab")));
    assert.ok(!visible(d.part("panel")));
    assert.ok(d.part("right") !== undefined);
    res.dispose();
    assert.equal(d.drawer(), undefined, "dispose removes it");
  });

  it("takes position bottom-left, and refuses a bad option", async () => {
    const d = dom();
    const { res } = await start(d, SIGNED_IN, { drawer: { position: "bottom-left" } });
    assert.ok(d.part("left"));
    res.dispose();
    const d2 = dom();
    const f = fakeFetch(routes(SIGNED_IN));
    const orig = console.warn;
    console.warn = () => {};
    try {
      const bad = await boot(opts(f.fetch, d2.env, { drawer: { position: "top" as never } }));
      assert.equal(bad.status, "unreachable");
      assert.equal(bad.reason, "bad option drawer");
    } finally {
      console.warn = orig;
    }
  });

  it("uses a <style> with the nonce without constructable sheets", async () => {
    const d = dom(false);
    const { res } = await start(d, SIGNED_IN, { nonce: "n0nce" });
    const style = d.drawer()?.shadowRoot?.byTag("style");
    assert.equal(style?.getAttribute("nonce"), "n0nce");
    assert.ok(style?.textContent.includes(":host"));
    res.dispose();
  });

  it("waits for <body> when boot runs before it exists", async () => {
    const d = dom(true, undefined, false);
    const { res } = await start(d, SIGNED_IN);
    assert.equal(d.drawer(), undefined);
    d.doc.addBody();
    assert.equal(d.drawer()?.parent, d.doc.body);
    res.dispose();
  });

  it("Hide button leaves a tab, remembered per app; the tab brings the button back", async () => {
    const d = dom();
    const { res } = await start(d, SIGNED_IN);
    d.part("launcher").click();
    assert.ok(visible(d.part("panel")));
    d.part("hide").click();
    assert.ok(!visible(d.part("panel")));
    assert.ok(!visible(d.part("launcher")));
    assert.ok(visible(d.part("tab")));
    assert.equal(d.doc.focused, d.part("tab"));
    assert.equal(d.storage.map.get(launcherKey(APP)), "hidden");
    res.dispose();

    // A new page load keeps it hidden.
    const d2 = dom(true, d.storage);
    const { res: res2 } = await start(d2, SIGNED_IN);
    assert.ok(visible(d2.part("tab")));
    assert.ok(!visible(d2.part("launcher")));
    d2.part("tab").click();
    assert.ok(visible(d2.part("launcher")));
    assert.ok(!visible(d2.part("tab")));
    assert.equal(d2.doc.focused, d2.part("launcher"));
    assert.equal(d2.storage.map.has(launcherKey(APP)), false);
    res2.dispose();
  });

  it("does nothing in Node", async () => {
    const f = fakeFetch(routes(SIGNED_IN));
    const res = await boot(opts(f.fetch, NODE_ENV, { drawer: true }));
    assert.equal(res.status, "applied");
    res.dispose();
    const res2 = await boot({ app: APP, url: BASE, _fetch: f.fetch, drawer: { position: "bottom-left" } });
    assert.equal(res2.status, "applied");
    res2.dispose();
  });
});

describe("open, close, focus", () => {
  it("the panel is a labelled dialog; focus goes in, Escape closes, focus comes back", async () => {
    const d = dom();
    const { res } = await start(d, SIGNED_IN);
    const launcher = d.part("launcher");
    launcher.focus();
    launcher.click();
    const panel = d.part("panel");
    assert.equal(panel.getAttribute("role"), "dialog");
    assert.equal(panel.getAttribute("aria-label"), `Themarr for ${APP}`);
    assert.equal(d.doc.focused, panel, "focus moves into the drawer");
    assert.ok(!visible(launcher));
    const ev = d.part("title").key("Escape");
    assert.ok(ev.defaultPrevented);
    assert.ok(!visible(panel));
    assert.ok(visible(launcher));
    assert.equal(d.doc.focused, launcher, "focus returns to the button");
    res.dispose();
  });

  it("returns focus to the app's element that had it", async () => {
    const d = dom();
    const { res } = await start(d, SIGNED_IN);
    const appButton = d.doc.body!.appendChild(d.doc.createElement("button"));
    appButton.focus();
    d.part("launcher").click(); // a click from a pointer: focus stayed on the app
    d.part("close").click();
    assert.equal(d.doc.focused, appButton);
    res.dispose();
  });

  it("other keys do nothing", async () => {
    const d = dom();
    const { res } = await start(d, SIGNED_IN);
    d.part("launcher").click();
    d.part("title").key("Enter");
    assert.ok(visible(d.part("panel")));
    res.dispose();
  });
});

describe("signed in: themarr's page in an iframe", () => {
  it("frames /drawer?app=<id> with a sandbox that can't navigate the app", async () => {
    const d = dom();
    const { res } = await start(d, SIGNED_IN);
    d.part("launcher").click();
    const f = iframeOf(d);
    assert.equal(f.getAttribute("src"), `${BASE}/drawer?app=${APP}`);
    assert.equal(f.getAttribute("title"), "Themarr");
    const sandbox = (f.getAttribute("sandbox") ?? "").split(" ");
    assert.ok(sandbox.includes("allow-scripts") && sandbox.includes("allow-same-origin"));
    assert.ok(!sandbox.some((s) => s.startsWith("allow-top-navigation")));
    assert.equal(d.win.listeners.count("message"), 1);
    d.part("close").click();
    assert.equal(d.drawer()?.shadowRoot?.byTag("iframe"), undefined, "closing drops the iframe");
    assert.equal(d.win.listeners.count("message"), 0);
    res.dispose();
  });

  it("a personal theme (200) also counts as signed in", async () => {
    const d = dom();
    const { res } = await start(d, { status: 200, body: { ...wire("seeded-with-tag"), source: "saved" } });
    d.part("launcher").click();
    assert.ok(iframeOf(d));
    res.dispose();
  });

  it("answers ready with hello, posted to the exact themarr origin", async () => {
    const d = dom();
    d.doc.matching.add(":root.dark");
    d.storage.map.set(localKey(APP), "synth");
    const { res } = await start(d, SIGNED_IN);
    d.part("launcher").click();
    fromPage(d, { themarr: 1, type: "ready" });
    await settle();
    const p = posted(d);
    assert.equal(p.length, 1);
    assert.equal(p[0]?.targetOrigin, BASE);
    assert.deepEqual(p[0]?.msg, {
      themarr: 1,
      type: "hello",
      app: APP,
      mode: "dark",
      current: { source: "local", locked: false, version: 1, local: "synth" },
    });
    res.dispose();
  });

  it("ignores messages from another origin, another window, or of another shape", async () => {
    const d = dom();
    const { res } = await start(d, SIGNED_IN);
    d.part("launcher").click();
    const css = d.css();
    const preview = { themarr: 1, type: "preview", body: wire("handmade-synth-dark") };
    fromPage(d, preview, "https://evil.test");
    fromPage(d, preview, "https://themarr.test.evil.test");
    fromPage(d, preview, "null");
    fromPage(d, preview, BASE, new FContentWindow()); // the right origin, another window
    fromPage(d, preview, BASE, null);
    fromPage(d, { ...preview, extra: 1 });
    fromPage(d, { ...preview, themarr: 2 });
    fromPage(d, { themarr: 1, type: "preview", body: { version: 1, modes: ["dark"], tokens: {} } });
    fromPage(d, JSON.stringify(preview));
    fromPage(d, { themarr: 1, type: "close" }, "https://evil.test");
    await settle();
    assert.equal(d.css(), css);
    assert.ok(visible(d.part("panel")));
    assert.equal(posted(d).length, 0);
    res.dispose();
  });

  it("preview changes this tab only; clearPreview and close restore the resolved theme", async () => {
    const d = dom();
    const { res, calls } = await start(d, SIGNED_IN);
    const resolved = d.css();
    d.part("launcher").click();
    const before = calls.length;
    fromPage(d, { themarr: 1, type: "preview", body: wire("handmade-synth-dark") });
    const previewed = d.css();
    assert.notEqual(previewed, resolved);
    assert.ok(previewed.includes(":root.dark {") && !previewed.includes(":root:not(.dark)"), "the synth theme is dark only");
    assert.equal(res.source, "public", "the result does not change");
    assert.equal(calls.length, before, "no request, nothing saved");
    assert.equal(d.storage.map.size, 0, "nothing kept");
    fromPage(d, { themarr: 1, type: "clearPreview" });
    assert.equal(d.css(), resolved);
    fromPage(d, { themarr: 1, type: "preview", body: wire("handmade-synth-dark"), mode: "dark" });
    assert.ok(d.css().startsWith(":root {"), "a forced mode puts the palette on the selector");
    fromPage(d, { themarr: 1, type: "close" });
    assert.ok(!visible(d.part("panel")));
    assert.equal(d.css(), resolved);
    res.dispose();
  });

  it("a preview survives a refresh until it is cleared", async () => {
    const d = dom();
    const { res } = await start(d, SIGNED_IN);
    d.part("launcher").click();
    fromPage(d, { themarr: 1, type: "preview", body: wire("handmade-synth-dark") });
    const previewed = d.css();
    await res.refresh();
    assert.equal(d.css(), previewed);
    d.part("close").click();
    assert.notEqual(d.css(), previewed);
    res.dispose();
  });

  it("keepLocal keeps the theme in this browser, refreshes, and says hello again", async () => {
    const d = dom();
    const { res, calls } = await start(d, SIGNED_IN);
    d.part("launcher").click();
    fromPage(d, { themarr: 1, type: "ready" });
    fromPage(d, { themarr: 1, type: "preview", body: wire("handmade-synth-dark") });
    fromPage(d, { themarr: 1, type: "keepLocal", themeId: "synth" });
    await settle();
    assert.equal(d.storage.map.get(localKey(APP)), "synth");
    assert.ok(calls.some((c) => c.path === tokensPath("synth")), "refreshed with the local layer");
    assert.equal(res.source, "local");
    const last = posted(d).at(-1)?.msg;
    assert.equal(last.type, "hello");
    assert.equal(last.current.source, "local");
    assert.equal(last.current.local, "synth");
    for (const p of posted(d)) assert.equal(p.targetOrigin, BASE);

    fromPage(d, { themarr: 1, type: "clearLocal" });
    await settle();
    assert.equal(d.storage.map.has(localKey(APP)), false);
    assert.equal(res.source, "public");
    res.dispose();
  });

  it("saved refreshes; saved for me also drops the local override", async () => {
    const d = dom();
    d.storage.map.set(localKey(APP), "synth");
    let saved = false;
    const personal: Route = () => (saved ? { status: 200, body: { ...wire("seeded-with-tag"), source: "saved" } } : { status: 204 });
    const { res } = await start(d, personal);
    assert.equal(res.source, "local");
    d.part("launcher").click();
    saved = true;
    fromPage(d, { themarr: 1, type: "saved", scope: "app" });
    await settle();
    assert.equal(res.source, "local", "scope app keeps this browser's choice");
    fromPage(d, { themarr: 1, type: "saved", scope: "me" });
    await settle();
    assert.equal(d.storage.map.has(localKey(APP)), false);
    assert.equal(res.source, "saved");
    res.dispose();
  });

  it("a locked person can preview but not keep", async () => {
    const d = dom();
    const { res } = await start(d, { status: 200, body: { ...wire("seeded-with-tag"), locked: true, source: "enforced" } });
    d.part("launcher").click();
    fromPage(d, { themarr: 1, type: "ready" });
    await settle();
    assert.equal(posted(d)[0]?.msg.current.locked, true);
    const css = d.css();
    fromPage(d, { themarr: 1, type: "preview", body: wire("handmade-synth-dark") });
    assert.notEqual(d.css(), css);
    fromPage(d, { themarr: 1, type: "keepLocal", themeId: "synth" });
    await settle();
    assert.equal(d.storage.map.has(localKey(APP)), false);
    res.dispose();
  });

  it("offers a new tab when the page never says ready (no session, or framing refused)", async () => {
    const d = dom();
    const { res } = await start(d, SIGNED_IN);
    d.part("launcher").click();
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(d.drawer()?.shadowRoot?.byTag("iframe"), undefined);
    const a = d.drawer()?.shadowRoot?.byTag("a");
    assert.equal(a?.getAttribute("href"), `${BASE}/drawer?app=${APP}`);
    assert.equal(a?.getAttribute("target"), "_blank");
    assert.ok((a?.getAttribute("rel") ?? "").includes("noopener"));
    res.dispose();
  });
});

describe("guests: a local-only panel", () => {
  async function openGuest(d: Dom, extra: Record<string, Route> = {}): Promise<{ res: BootResult; calls: { path: string }[] }> {
    const r = await start(d, GUEST, {}, extra);
    d.part("launcher").click();
    await settle();
    return r;
  }
  const tiles = (d: Dom): FEl[] => d.drawer()?.shadowRoot?.all().filter((e) => e.getAttribute("class") === "tile") ?? [];

  it("lists the catalog: favourites first, then all themes, names as text", async () => {
    const d = dom();
    const { res, calls } = await openGuest(d);
    assert.equal(d.drawer()?.shadowRoot?.byTag("iframe"), undefined, "no iframe for guests");
    const catalogCall = calls.find((c) => c.path === CATALOG) as { path: string; init: { credentials: string; headers: object } } | undefined;
    assert.equal(catalogCall?.init.credentials, "omit");
    assert.deepEqual(catalogCall?.init.headers, {});
    const t = tiles(d);
    assert.deepEqual(
      t.map((e) => e.getAttribute("data-theme")),
      ["synth", "indigo", "synth", "tagged"],
    );
    assert.deepEqual(
      t.map((e) => e.textContent),
      ["Synth", "Coolroo Indigo", "Synth", "Tagged <b>"],
    );
    assert.equal(t[1]?.getAttribute("aria-label"), "Preview Coolroo Indigo");
    assert.equal(t[1]?.style.props.get("--t-bg"), "#5146D9");
    assert.equal(t[1]?.style.props.get("--t-band"), "#101010");
    assert.equal(d.part("keep").hasAttribute("disabled"), true);
    assert.ok(!visible(d.part("forget")));
    res.dispose();
  });

  it("previews a theme from its public tokens, then keeps it in this browser", async () => {
    const d = dom();
    const { res, calls } = await openGuest(d);
    const resolved = d.css();
    tiles(d)[3]!.click(); // Tagged
    await settle();
    assert.ok(calls.some((c) => c.path === tokensPath("tagged")));
    assert.notEqual(d.css(), resolved);
    assert.equal(tiles(d)[3]?.getAttribute("aria-pressed"), "true");
    assert.ok(visible(d.part("bar")));
    assert.ok(d.part("bar").textContent.includes("Previewing Tagged <b> in this tab only."));
    const keep = d.part("keep");
    assert.equal(keep.hasAttribute("disabled"), false);
    keep.click();
    await settle();
    assert.equal(d.storage.map.get(localKey(APP)), "tagged");
    assert.equal(res.source, "local");
    assert.ok(!visible(d.part("bar")));
    assert.ok(visible(d.part("forget")));
    assert.ok(d.part("now").textContent.includes("Tagged <b>"));

    d.part("forget").click();
    await settle();
    assert.equal(d.storage.map.has(localKey(APP)), false);
    assert.equal(res.source, "public");
    assert.equal(d.css(), resolved);
    res.dispose();
  });

  it("Reset and closing restore the resolved theme; nothing is kept", async () => {
    const d = dom();
    const { res } = await openGuest(d);
    const resolved = d.css();
    tiles(d)[0]!.click();
    await settle();
    assert.notEqual(d.css(), resolved);
    d.part("reset").click();
    assert.equal(d.css(), resolved);
    tiles(d)[0]!.click();
    await settle();
    d.part("title").key("Escape");
    assert.equal(d.css(), resolved);
    assert.equal(d.storage.map.size, 0);
    res.dispose();
  });

  it("says so when the catalog or a theme can't be read", async () => {
    const d = dom();
    const { res } = await openGuest(d, { [CATALOG]: { status: 500 } });
    assert.ok(d.drawer()?.shadowRoot?.textContent.includes("can't list its themes"));
    res.dispose();
    const d2 = dom();
    const { res: res2 } = await openGuest(d2, { [tokensPath("synth")]: { status: 200, body: { version: 1 } } });
    const css = d2.css();
    tiles(d2)[0]!.click();
    await settle();
    assert.equal(d2.css(), css);
    assert.ok(d2.part("status").textContent.includes("can't send this theme"));
    res2.dispose();
  });
});
