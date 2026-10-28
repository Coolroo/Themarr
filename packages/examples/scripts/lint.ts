// The rules an example's files must keep. `npm run generate` refuses an
// example that breaks one, and the tests run them on every folder.
//
// page.css: colours only from var(--themarr-<token>), with no fallback,
// except tag and tag-foreground, which fall back to accent and
// accent-foreground (tag is optional). No colour literals, no url(), no
// @import, no :host or :root (the mount helper owns them).
//
// page.html: a fragment of static markup from a short list of elements and
// attributes. No scripts, styles, links, images, URLs or event handlers.

import { isTokenName } from "@themarr/tokens";
import type { ExampleMeta } from "../src/types.ts";

/** CSS named colours and system colours. transparent and currentColor are allowed. */
const NAMED_COLORS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown " +
    "burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan " +
    "darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid " +
    "darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet " +
    "deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro " +
    "ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
    "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow " +
    "lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray " +
    "lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine " +
    "mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise " +
    "mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab " +
    "orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru " +
    "pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown " +
    "seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan " +
    "teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen " +
    // System colours: the browser's own palette, not the theme's.
    "accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field " +
    "fieldtext graytext highlight highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext"
  ).split(" "),
);

/** Colour functions. color-mix() is allowed: its colours must be tokens too. */
const COLOR_FUNCTION = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|light-dark|device-cmyk)\s*\(/i;
const HEX = /#[0-9a-f]{3,8}(?![\w-])/i;

/** The two optional tokens and the token each must fall back to. */
const FALLBACKS: Readonly<Record<string, string>> = { tag: "accent", "tag-foreground": "accent-foreground" };

/** A CSS rule with no nested block: its selector (or prelude) and its declarations. */
export interface CssRule {
  selector: string;
  declarations: { prop: string; value: string }[];
}

export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The innermost rules of a stylesheet (rules inside @media are found too). */
export function cssRules(css: string): CssRule[] {
  const out: CssRule[] = [];
  for (const m of stripCssComments(css).matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const declarations: CssRule["declarations"] = [];
    for (const d of (m[2] ?? "").split(";")) {
      const i = d.indexOf(":");
      if (i < 0) continue;
      declarations.push({ prop: d.slice(0, i).trim().toLowerCase(), value: d.slice(i + 1).trim() });
    }
    out.push({ selector: (m[1] ?? "").trim(), declarations });
  }
  return out;
}

/** The problems in a page.css; [] when it keeps every rule. */
export function lintCss(css: string): string[] {
  const problems: string[] = [];
  const text = stripCssComments(css);
  if (text.includes("<")) problems.push('"<" is not allowed (the CSS may go in a <style> element)');
  if (text.includes("\\")) problems.push("escapes are not allowed");
  if (/url\s*\(|image-set\s*\(|expression\s*\(/i.test(text)) problems.push("url(), image-set() and expression() are not allowed");
  if (/@(?:import|font-face|namespace)\b/i.test(text)) problems.push("@import, @font-face and @namespace are not allowed");
  for (const rule of cssRules(text)) {
    if (/:(?:host|root)\b/i.test(rule.selector)) {
      problems.push(`selector "${rule.selector}": :host and :root belong to the mount helper`);
    }
    for (const { prop, value } of rule.declarations) {
      const where = `${rule.selector} { ${prop} }`;
      if (prop.startsWith("--themarr-")) problems.push(`${where}: page.css must not set a --themarr-* variable`);
      const bare = value.replace(/"[^"]*"|'[^']*'/g, '""');
      if (HEX.test(bare)) problems.push(`${where}: a hex colour; use var(--themarr-<token>)`);
      if (COLOR_FUNCTION.test(bare)) problems.push(`${where}: a colour function; use var(--themarr-<token>)`);
      for (const word of bare.toLowerCase().match(/(?<![\w-])[a-z][a-z0-9-]*/g) ?? []) {
        if (NAMED_COLORS.has(word)) problems.push(`${where}: the colour name "${word}"; use var(--themarr-<token>)`);
      }
    }
  }
  for (const m of text.matchAll(/var\(\s*([^\s,)]*)\s*([,)]?)/g)) {
    const name = m[1] ?? "";
    const token = name.startsWith("--themarr-") ? name.slice("--themarr-".length) : "";
    if (!isTokenName(token)) {
      problems.push(`var(${name}): only --themarr-<token> variables are allowed`);
      continue;
    }
    const fallback = FALLBACKS[token];
    if (fallback !== undefined) {
      const want = new RegExp(`^var\\(\\s*--themarr-${token}\\s*,\\s*var\\(\\s*--themarr-${fallback}\\s*\\)\\s*\\)`);
      if (!want.test(text.slice(m.index))) {
        problems.push(`var(${name}): write var(--themarr-${token}, var(--themarr-${fallback})) (${token} is optional)`);
      }
    } else if (m[2] !== ")") {
      problems.push(`var(${name}): no fallback; every theme has ${token}`);
    }
  }
  return problems;
}

/** Elements a page.html may use. No h1: the admin page around the example has its own. */
const ELEMENTS = new Set([
  "div", "span", "aside", "nav", "main", "header", "footer", "section", "article",
  "ul", "ol", "li", "h2", "h3", "h4", "h5", "h6", "p", "strong", "em", "small", "time",
  "button", "input", "label",
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
]);

const ATTRIBUTES = new Set([
  "class", "role", "type", "placeholder", "readonly", "disabled", "tabindex", "value", "title", "hidden", "datetime",
  "viewbox", "width", "height", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "focusable",
  "d", "x", "y", "rx", "ry", "cx", "cy", "r", "points", "x1", "y1", "x2", "y2",
]);

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** The problems in a page.html; [] when it keeps every rule. */
export function lintHtml(html: string): string[] {
  const problems: string[] = [];
  const text = html.replace(/<!--[\s\S]*?-->/g, "");
  if (/(?:https?:)?\/\/[a-z0-9]/i.test(text)) problems.push("URLs are not allowed");
  if (/\b(?:javascript|vbscript|data):/i.test(text)) problems.push("javascript:, vbscript: and data: are not allowed");
  if (!/^<div class="page"[\s>]/.test(text.trimStart())) problems.push('the page starts with <div class="page">');
  let headings = 0;
  for (const m of text.matchAll(TAG)) {
    if (m[1] === "/") continue;
    const el = (m[2] ?? "").toLowerCase();
    if (!ELEMENTS.has(el)) {
      problems.push(`<${el}> is not allowed`);
      continue;
    }
    if (/^h[2-6]$/.test(el)) headings++;
    const attrs = new Map<string, string>();
    for (const a of (m[3] ?? "").matchAll(ATTR)) {
      const name = (a[1] ?? "").toLowerCase();
      const value = a[2] ?? a[3] ?? a[4] ?? "";
      attrs.set(name, value);
      if (!ATTRIBUTES.has(name) && !/^aria-[a-z]+$/.test(name)) {
        problems.push(`<${el} ${name}>: the attribute is not allowed`);
      } else if ((name === "fill" || name === "stroke") && value !== "none" && value !== "currentColor") {
        problems.push(`<${el} ${name}="${value}">: only none or currentColor (colour it from page.css)`);
      }
    }
    if (el === "button" && attrs.get("type") !== "button") problems.push('<button> needs type="button"');
    if (el === "input") {
      if (!["search", "text"].includes(attrs.get("type") ?? "")) problems.push('<input> needs type="search" or type="text"');
      if (!attrs.has("readonly")) problems.push("<input> needs readonly (sample data only)");
      if (!attrs.has("aria-label")) problems.push("<input> needs aria-label");
    }
  }
  if (headings === 0) problems.push("the page needs a heading (h2 to h6)");
  if (text.replace(TAG, "").includes("<")) problems.push('markup the lint cannot read (a stray "<", <!...> or <?...>)');
  return problems;
}

/** Rules across the files: the page's size, and the tag token on people and tags. */
export function lintExample(meta: ExampleMeta, html: string, css: string): string[] {
  const problems = [...lintCss(css).map((p) => `page.css: ${p}`), ...lintHtml(html).map((p) => `page.html: ${p}`)];
  const rules = cssRules(css);
  const page = rules.filter((r) => r.selector === ".page").flatMap((r) => r.declarations);
  const has = (prop: string, value: string): boolean => page.some((d) => d.prop === prop && d.value === value);
  if (!has("width", `${meta.size.width}px`) || !has("height", `${meta.size.height}px`)) {
    problems.push(`page.css: .page needs width: ${meta.size.width}px and height: ${meta.size.height}px (example.json size)`);
  }
  for (const cls of ["tag", "avatar"]) {
    if (!new RegExp(`class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"`).test(html)) continue;
    const own = rules.filter((r) => new RegExp(`\\.${cls}(?![\\w-])`).test(r.selector)).flatMap((r) => r.declarations);
    const bg = own.find((d) => d.prop === "background" || d.prop === "background-color");
    const fg = own.find((d) => d.prop === "color");
    if (bg?.value !== "var(--themarr-tag, var(--themarr-accent))" || fg?.value !== "var(--themarr-tag-foreground, var(--themarr-accent-foreground))") {
      problems.push(`page.css: .${cls} (people and tags) needs the tag token: background var(--themarr-tag, var(--themarr-accent)) and color var(--themarr-tag-foreground, var(--themarr-accent-foreground))`);
    }
  }
  return problems;
}
