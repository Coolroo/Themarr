// mountExample: the shadow root, the theme's variables for the mode, the
// statuses, re-mounts and the <style> fallback.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cssVar, TOKEN_NAMES } from "@themarr/tokens";
import { formatColor, type WireTheme } from "@themarr/web";
import { EXAMPLES, exampleById, mountExample } from "../src/index.ts";
import type { ExampleHost } from "../src/mount.ts";
import type { Example } from "../src/types.ts";
import { BrokenSheet, FakeHost, FakeRoot, FakeSheet, fixture, varValue } from "./helpers.ts";

// Type check (npm run typecheck): a real HTMLElement is a host, and the result's root is its ShadowRoot.
type HostCheck = HTMLElement extends ExampleHost<ShadowRoot> ? true : never;
const hostCheck: HostCheck = true;
void hostCheck;
export function rootOf(el: HTMLElement, e: Example): ShadowRoot {
  return mountExample(el, e, undefined, "light").root;
}

function example(id: string): Example {
  const e = exampleById(id);
  if (e === undefined) throw new Error(`no example ${id}`);
  return e;
}

const kanban = example("vibe-kanban-board");
const gamarr = example("gamarr-library");
const indigo = fixture("seeded-indigo");
const synth = fixture("handmade-synth-dark");
const opts = { _Sheet: FakeSheet };

function oklch(theme: WireTheme, mode: "light" | "dark", token: "background" | "primary" | "tag"): string {
  const t = theme.tokens[mode]?.[token];
  if (t === undefined) throw new Error(`fixture lacks ${mode}.${token}`);
  return formatColor(t.$value, "oklch");
}

describe("mountExample", () => {
  it("puts the example in an open shadow root with the theme's light variables", () => {
    const host = new FakeHost();
    const r = mountExample(host, kanban, indigo, "light", opts);
    assert.equal(r.status, "applied");
    assert.equal(r.example, "vibe-kanban-board");
    assert.equal(r.mode, "light");
    assert.equal(r.root, host.shadowRoot);
    assert.equal(r.root.innerHTML, kanban.html);
    assert.equal(r.root.adoptedStyleSheets?.length, 1);
    const css = r.root.css();
    assert.ok(css.includes(kanban.css));
    assert.ok(css.includes("color-scheme: light;"));
    assert.equal(varValue(css, cssVar("background")), oklch(indigo, "light", "background"));
    assert.equal(varValue(css, cssVar("primary")), oklch(indigo, "light", "primary"));
    assert.match(varValue(css, cssVar("radius")) ?? "", /^\d+(?:\.\d+)?(?:px|rem)$/);
  });

  it("uses the dark palette for dark", () => {
    const r = mountExample(new FakeHost(), kanban, indigo, "dark", opts);
    assert.equal(r.status, "applied");
    const css = r.root.css();
    assert.ok(css.includes("color-scheme: dark;"));
    assert.equal(varValue(css, cssVar("background")), oklch(indigo, "dark", "background"));
    assert.notEqual(oklch(indigo, "dark", "background"), oklch(indigo, "light", "background"));
  });

  it("sets every token the theme has, on :host only", () => {
    const css = mountExample(new FakeHost(), kanban, indigo, "light", opts).root.css();
    for (const name of TOKEN_NAMES) {
      if (indigo.tokens.light?.[name] === undefined) continue;
      assert.notEqual(varValue(css, cssVar(name)), "initial", name);
    }
    const selectors = [...css.matchAll(/^([^\s{}][^{}]*)\{/gm)].map((m) => (m[1] ?? "").trim());
    assert.ok(selectors.slice(0, 3).every((s) => s === ":host"), selectors.slice(0, 3).join(" | "));
  });

  it("resets every --themarr-* variable first, so the page around the host never shows through", () => {
    const css = mountExample(new FakeHost(), kanban, indigo, "light", opts).root.css();
    for (const name of TOKEN_NAMES) assert.ok(css.includes(`${cssVar(name)}: initial;`), name);
    assert.ok(css.indexOf(`${cssVar("background")}: initial;`) < css.indexOf(`${cssVar("background")}: oklch(`));
  });

  it("leaves tag reset when the theme has none, so page.css falls back to accent", () => {
    const noTag = structuredClone(indigo);
    const light = noTag.tokens.light;
    assert.ok(light !== undefined && light.tag !== undefined);
    delete light.tag;
    delete light["tag-foreground"];
    const css = mountExample(new FakeHost(), kanban, noTag, "light", opts).root.css();
    assert.equal(varValue(css, cssVar("tag")), "initial");
    assert.equal(varValue(css, cssVar("tag-foreground")), "initial");
    assert.ok(kanban.css.includes("var(--themarr-tag, var(--themarr-accent))"));
  });

  it("sets tag when the theme has it", () => {
    const tagged = fixture("seeded-with-tag");
    const css = mountExample(new FakeHost(), kanban, tagged, "light", opts).root.css();
    assert.equal(varValue(css, cssVar("tag")), oklch(tagged, "light", "tag"));
  });

  it("reports missing-mode, with no theme variables, for a mode the theme lacks", () => {
    const r = mountExample(new FakeHost(), kanban, synth, "light", opts);
    assert.equal(r.status, "missing-mode");
    assert.equal(r.root.innerHTML, kanban.html);
    const css = r.root.css();
    assert.ok(!css.includes("oklch("));
    assert.equal(varValue(css, cssVar("background")), "initial");
    assert.ok(css.includes(kanban.css));
  });

  it("reports no-theme, with no theme variables, when there is no theme", () => {
    const r = mountExample(new FakeHost(), kanban, undefined, "dark", opts);
    assert.equal(r.status, "no-theme");
    assert.ok(!r.root.css().includes("oklch("));
  });

  it("a re-mount reuses the shadow root and the sheet, and replaces the content", () => {
    const host = new FakeHost();
    const first = mountExample(host, kanban, indigo, "light", opts);
    const sheet = first.root.adoptedStyleSheets?.[0];
    const second = mountExample(host, gamarr, synth, "dark", opts);
    assert.equal(host.attached, 1);
    assert.equal(second.root, first.root);
    assert.equal(second.root.innerHTML, gamarr.html);
    assert.deepEqual(second.root.adoptedStyleSheets, [sheet]);
    const css = second.root.css();
    assert.ok(css.includes(gamarr.css) && !css.includes(kanban.css));
    assert.equal(varValue(css, cssVar("background")), oklch(synth, "dark", "background"));
    const third = mountExample(host, gamarr, synth, "light", opts);
    assert.equal(third.status, "missing-mode");
    assert.ok(!third.root.css().includes("oklch("));
  });

  it("uses a shadow root the host already has", () => {
    const host = new FakeHost();
    host.shadowRoot = new FakeRoot(true);
    const r = mountExample(host, kanban, indigo, "light", opts);
    assert.equal(host.attached, 0);
    assert.equal(r.root, host.shadowRoot);
  });

  it("falls back to a <style> element without constructable sheets, with the nonce", () => {
    const r = mountExample(new FakeHost(false), kanban, indigo, "light", { nonce: "abc123+/=" });
    assert.ok(r.root.innerHTML.startsWith('<style nonce="abc123+/=">\n:host {'));
    assert.ok(r.root.innerHTML.endsWith(kanban.html));
    assert.equal(varValue(r.root.css(), cssVar("background")), oklch(indigo, "light", "background"));
  });

  it("falls back to a <style> element when the sheet refuses, or when told to", () => {
    const a = mountExample(new FakeHost(), kanban, indigo, "light", { _Sheet: BrokenSheet });
    assert.ok(a.root.innerHTML.startsWith("<style>"));
    assert.deepEqual(a.root.adoptedStyleSheets, []);
    const b = mountExample(new FakeHost(), kanban, indigo, "light", { _Sheet: null });
    assert.ok(b.root.innerHTML.startsWith("<style>"));
  });

  it("drops its own sheet when a re-mount falls back to <style>", () => {
    const host = new FakeHost();
    mountExample(host, kanban, indigo, "light", opts);
    const r = mountExample(host, kanban, indigo, "light", { _Sheet: null });
    assert.deepEqual(r.root.adoptedStyleSheets, []);
    assert.ok(r.root.innerHTML.startsWith("<style>"));
  });

  it("refuses a bad mode and a bad nonce", () => {
    assert.throws(() => mountExample(new FakeHost(), kanban, indigo, "dim" as "dark", opts), TypeError);
    assert.throws(() => mountExample(new FakeHost(), kanban, indigo, "light", { nonce: 'x"><b' }), TypeError);
  });
});

describe("exampleById", () => {
  it("finds each example, and nothing else", () => {
    for (const e of EXAMPLES) assert.equal(exampleById(e.id), e);
    assert.equal(exampleById("nope"), undefined);
  });
});
