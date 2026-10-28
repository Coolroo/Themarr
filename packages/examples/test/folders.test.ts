// The example folders: the contract, the lint on each, and the registry.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lintCss, lintExample, lintHtml } from "../scripts/lint.ts";
import { checkMeta, EXAMPLE_FILES, exampleDirs, ID_PATTERN, PKG_DIR, readExample, readExamples, REGISTRY_FILE, registryText } from "../scripts/registry.ts";
import { EXAMPLES } from "../src/index.ts";
import type { ExampleMeta } from "../src/types.ts";

const dirs = exampleDirs();

describe("example folders", () => {
  it("are the three first examples, at least", () => {
    for (const id of ["gamarr-library", "seerr-games-discover", "vibe-kanban-board"]) assert.ok(dirs.includes(id), id);
  });

  for (const dir of dirs) {
    describe(dir, () => {
      it("has a slug name and exactly example.json, page.html and page.css", () => {
        assert.match(dir, ID_PATTERN);
        assert.doesNotThrow(() => readExample(dir));
        for (const f of EXAMPLE_FILES) assert.ok(readFileSync(new URL(`${dir}/${f}`, PKG_DIR), "utf8").trim() !== "", f);
      });

      it("has a valid example.json whose id is the folder name", () => {
        const meta: unknown = JSON.parse(readFileSync(new URL(`${dir}/example.json`, PKG_DIR), "utf8"));
        assert.deepEqual(checkMeta(dir, meta), []);
      });

      it("keeps the CSS, HTML and tag rules", () => {
        const e = readExample(dir);
        assert.deepEqual(lintCss(e.css), []);
        assert.deepEqual(lintHtml(e.html), []);
        assert.deepEqual(lintExample(e, e.html, e.css), []);
      });
    });
  }
});

describe("the registry", () => {
  it("src/registry.generated.ts is up to date (run npm run generate -w @themarr/examples)", () => {
    assert.equal(readFileSync(REGISTRY_FILE, "utf8"), registryText(readExamples()));
  });

  it("holds every folder, sorted by id", () => {
    assert.deepEqual(EXAMPLES.map((e) => e.id), dirs);
    assert.deepEqual(EXAMPLES, readExamples());
  });
});

const meta: ExampleMeta = {
  id: "demo",
  name: "Demo",
  sourceApp: "demo-app",
  description: "A demo.",
  modes: ["light"],
  size: { width: 100, height: 50 },
};

describe("checkMeta", () => {
  it("accepts a good example.json", () => {
    assert.deepEqual(checkMeta("demo", meta), []);
  });

  const bad: [string, unknown, RegExp][] = [
    ["not an object", [], /JSON object/],
    ["unknown field", { ...meta, colour: "x" }, /unknown field "colour"/],
    ["missing field", { ...meta, description: undefined }, /description/],
    ["id not the folder", { ...meta, id: "other" }, /folder's name/],
    ["id not a slug", { ...meta, id: "Demo_1" }, /^id:/],
    ["sourceApp not a slug", { ...meta, sourceApp: "My App" }, /sourceApp/],
    ["empty name", { ...meta, name: " " }, /^name/],
    ["no modes", { ...meta, modes: [] }, /^modes/],
    ["unknown mode", { ...meta, modes: ["dim"] }, /^modes/],
    ["mode twice", { ...meta, modes: ["dark", "dark"] }, /^modes/],
    ["size not whole", { ...meta, size: { width: 10.5, height: 5 } }, /^size/],
    ["size extra field", { ...meta, size: { width: 10, height: 5, depth: 1 } }, /^size/],
  ];
  for (const [what, value, want] of bad) {
    it(`refuses: ${what}`, () => {
      const p = checkMeta("demo", value);
      assert.ok(p.some((x) => want.test(x)), p.join("; "));
    });
  }
});

describe("lintCss", () => {
  it("accepts tokens, tag with its fallback, color-mix of tokens and keywords", () => {
    const css = `.page { width: 100px; height: 50px; background: var(--themarr-background); color: currentColor; }
.a { border: 1px solid transparent; color: inherit; background: color-mix(in oklab, var(--themarr-primary) 16%, transparent); }
.tag { background: var(--themarr-tag, var(--themarr-accent)); color: var(--themarr-tag-foreground, var(--themarr-accent-foreground)); }
.r { border-radius: calc(var(--themarr-radius) - 2px); }`;
    assert.deepEqual(lintCss(css), []);
  });

  const bad: [string, string, RegExp][] = [
    ["a hex colour", ".a { color: #fff; }", /hex/],
    ["a long hex colour", ".a { background: #11223344; }", /hex/],
    ["rgb()", ".a { color: rgb(0 0 0); }", /colour function/],
    ["rgba()", ".a { color: rgba(0,0,0,.5); }", /colour function/],
    ["hsl()", ".a { color: hsl(0 0% 0%); }", /colour function/],
    ["oklch()", ".a { color: oklch(0.5 0.1 200); }", /colour function/],
    ["color()", ".a { color: color(srgb 1 0 0); }", /colour function/],
    ["light-dark()", ".a { color: light-dark(var(--themarr-primary), var(--themarr-accent)); }", /colour function/],
    ["a named colour", ".a { color: white; }", /colour name "white"/],
    ["a named colour in a shorthand", ".a { border: 1px solid Red; }", /colour name "red"/],
    ["a system colour", ".a { background: Canvas; }", /colour name "canvas"/],
    ["a colour literal inside color-mix", ".a { color: color-mix(in oklab, var(--themarr-primary), black); }", /colour name "black"/],
    ["another variable", ".a { color: var(--brand); }", /only --themarr-/],
    ["an unknown token", ".a { color: var(--themarr-brand); }", /only --themarr-/],
    ["a fallback on a required token", ".a { color: var(--themarr-primary, var(--themarr-accent)); }", /no fallback/],
    ["tag without its fallback", ".a { color: var(--themarr-tag); }", /tag is optional/],
    ["tag with the wrong fallback", ".a { color: var(--themarr-tag, var(--themarr-primary)); }", /tag is optional/],
    ["tag-foreground without its fallback", ".a { color: var(--themarr-tag-foreground); }", /tag-foreground is optional/],
    ["setting a --themarr-* variable", ".a { --themarr-primary: var(--themarr-accent); }", /must not set/],
    ["url()", ".a { background: url(x.png); }", /url\(\)/],
    ["@import", "@import 'x.css';", /@import/],
    ["@font-face", "@font-face { font-family: X; }", /@font-face/],
    [":host", ":host { display: block; }", /:host and :root/],
    [":root", ":root { color: var(--themarr-primary); }", /:host and :root/],
    ["a <", ".a::after { content: '</style>'; }", /"<"/],
  ];
  for (const [what, css, want] of bad) {
    it(`refuses ${what}`, () => {
      const p = lintCss(css);
      assert.ok(p.some((x) => want.test(x)), `${css} → ${p.join("; ") || "no problems"}`);
    });
  }

  it("ignores colours in comments and font names in quotes", () => {
    assert.deepEqual(lintCss("/* #fff white */ .a { font-family: \"Gold Sans\", sans-serif; }"), []);
  });
});

describe("lintHtml", () => {
  const ok = '<div class="page"><h2>Title</h2><button type="button" aria-pressed="true">Go</button><input type="search" aria-label="Search" readonly><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M0 0h1"></path></svg></div>';

  it("accepts static markup", () => {
    assert.deepEqual(lintHtml(ok), []);
  });

  const page = (body: string): string => `<div class="page"><h2>T</h2>${body}</div>`;
  const bad: [string, string, RegExp][] = [
    ["<script>", page("<script>alert(1)</script>"), /<script> is not allowed/],
    ["<style>", page("<style>.a{}</style>"), /<style> is not allowed/],
    ["<link>", page('<link rel="stylesheet" href="x.css">'), /<link> is not allowed/],
    ["<img>", page('<img src="x.png" alt="">'), /<img> is not allowed/],
    ["<a href>", page('<a href="/x">x</a>'), /<a> is not allowed/],
    ["<iframe>", page("<iframe></iframe>"), /<iframe> is not allowed/],
    ["<h1>", page("<h1>x</h1>"), /<h1> is not allowed/],
    ["an event handler", page('<div onclick="x()">x</div>'), /onclick/],
    ["a style attribute", page('<div style="color: red">x</div>'), /style/],
    ["an https URL", page("<p>see https://example.com</p>"), /URLs/],
    ["a protocol-relative URL", page("<p>//cdn.example.com/x.js</p>"), /URLs/],
    ["a javascript: URL", page("<p>javascript:void(0)</p>"), /javascript:/],
    ["a button without type", page("<button>x</button>"), /type="button"/],
    ["a submit button", page('<button type="submit">x</button>'), /type="button"/],
    ["an input that can be typed in", page('<input type="search" aria-label="S">'), /readonly/],
    ["an input without a label", page('<input type="text" readonly>'), /aria-label/],
    ["a password input", page('<input type="password" aria-label="P" readonly>'), /type="search"/],
    ["an SVG colour", page('<svg><path fill="#f00" d="M0 0"></path></svg>'), /none or currentColor/],
    ["no heading", '<div class="page"><p>x</p></div>', /heading/],
    ["no page element", "<main><h2>T</h2></main>", /<div class="page">/],
    ["a doctype", `<!doctype html>${page("")}`, /cannot read|<div class="page">/],
    ["a stray <", page("<p>a < b</p>"), /cannot read/],
  ];
  for (const [what, html, want] of bad) {
    it(`refuses ${what}`, () => {
      const p = lintHtml(html);
      assert.ok(p.some((x) => want.test(x)), `${html} → ${p.join("; ") || "no problems"}`);
    });
  }
});

describe("lintExample", () => {
  const css = ".page { width: 100px; height: 50px; }\n";
  const html = '<div class="page"><h2>T</h2><span class="pill tag">sdk</span><span class="avatar">AB</span></div>';
  const people = `.tag, .avatar { background: var(--themarr-tag, var(--themarr-accent)); color: var(--themarr-tag-foreground, var(--themarr-accent-foreground)); }\n`;

  it("accepts tags and people drawn with the tag token", () => {
    assert.deepEqual(lintExample(meta, html, css + people), []);
  });

  it("refuses tags or people drawn with another token", () => {
    const p = lintExample(meta, html, `${css}.tag, .avatar { background: var(--themarr-accent); color: var(--themarr-accent-foreground); }`);
    assert.equal(p.filter((x) => x.includes("tag token")).length, 2, p.join("; "));
  });

  it("refuses a .page that is not the example.json size", () => {
    const p = lintExample(meta, '<div class="page"><h2>T</h2></div>', ".page { width: 90px; height: 50px; }");
    assert.ok(p.some((x) => x.includes(".page needs width: 100px")), p.join("; "));
  });
});
