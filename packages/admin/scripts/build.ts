// Build the admin UI and the drawer page into internal/webui/dist, which the
// Go server embeds (decision 0010).
//
//   npm run build -w @themarr/admin
//
// 1. Regenerate the example registry (packages/examples) and build the SDK
//    (packages/web/dist), so the UI ships the examples and the SDK file of
//    this checkout.
// 2. esbuild bundles src/main.tsx (the admin UI) and src/drawer/main.tsx
//    (the drawer page): one JS and one CSS file each, content-hashed, in
//    dist/assets/; their licence comments in a .LEGAL.txt beside them.
// 3. index.html and drawer.html load them with <script type="module" src>
//    and <link rel="stylesheet">: no inline script or style (the CSP is
//    default-src 'self').
// 4. The SDK files are copied to dist/sdk/ for the "Download themarr.js"
//    button.
// 5. Checks: no inline script or style in the pages, no file name that
//    go:embed would skip (a leading "." or "_"), and no URL in the bundles
//    except the SVG and XML namespaces (the UI calls only its own origin).
//
// Only what this script writes is replaced: other files in dist stay.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(pkg, "../..");
const out = resolve(process.env["THEMARR_UI_OUT"] ?? join(root, "internal/webui/dist"));
const assets = join(out, "assets");
const sdk = join(out, "sdk");

function fail(msg: string): never {
  console.error(`admin build: ${msg}`);
  process.exit(1);
}

function run(script: string): void {
  execFileSync(process.execPath, [script], { cwd: dirname(dirname(script)), stdio: "inherit" });
}

// 1. The examples registry and the SDK.
run(join(root, "packages/examples/scripts/generate.ts"));
run(join(root, "packages/web/scripts/build.ts"));

// 2. The bundles.
rmSync(assets, { recursive: true, force: true });
rmSync(sdk, { recursive: true, force: true });
mkdirSync(assets, { recursive: true });
mkdirSync(sdk, { recursive: true });

const result = await build({
  entryPoints: { app: join(pkg, "src/main.tsx"), drawer: join(pkg, "src/drawer/main.tsx") },
  outdir: assets,
  entryNames: "[name]-[hash]",
  bundle: true,
  splitting: false,
  format: "esm",
  platform: "browser",
  target: ["es2022", "chrome111", "firefox113", "safari16.4"],
  minify: true,
  sourcemap: false,
  legalComments: "linked",
  jsx: "automatic",
  jsxImportSource: "preact",
  metafile: true,
  logLevel: "warning",
  define: { "process.env.NODE_ENV": '"production"' },
});

/** The JS and CSS output of one entry point. */
function outputsOf(entry: string): { js: string; css: string } {
  let js = "";
  let css = "";
  for (const [file, meta] of Object.entries(result.metafile.outputs)) {
    if (meta.entryPoint === undefined || !meta.entryPoint.endsWith(entry)) continue;
    js = basename(file);
    css = meta.cssBundle === undefined ? "" : basename(meta.cssBundle);
  }
  if (js === "" || css === "") fail(`no JS or CSS output for ${entry}`);
  return { js, css };
}

// 3. The pages.
function page(title: string, rootId: string, files: { js: string; css: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
<link rel="stylesheet" href="/assets/${files.css}">
<script type="module" src="/assets/${files.js}"></script>
</head>
<body>
<div id="${rootId}"><noscript>Themarr needs JavaScript.</noscript></div>
</body>
</html>
`;
}

const pages = {
  "index.html": page("Themarr", "app", outputsOf("src/main.tsx")),
  "drawer.html": page("Themarr drawer", "drawer", outputsOf("src/drawer/main.tsx")),
};
for (const [name, html] of Object.entries(pages)) writeFileSync(join(out, name), html);

// 4. The SDK files.
for (const f of ["themarr.js", "themarr.d.ts"]) {
  const src = join(root, "packages/web/dist", f);
  if (!existsSync(src)) fail(`packages/web/dist/${f} is missing`);
  copyFileSync(src, join(sdk, f));
}

// 5. Checks.
for (const [name, html] of Object.entries(pages)) {
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html) || /<style\b/i.test(html) || /\sstyle=/i.test(html)) fail(`${name} has an inline script or style`);
}
const ALLOWED_URL = /^https?:\/\/www\.w3\.org\/(2000\/svg|1999\/xlink|XML\/1998\/namespace|1998\/Math\/MathML|1999\/xhtml)$/;
for (const dir of [assets, sdk]) {
  for (const f of readdirSync(dir)) {
    if (f.startsWith(".") || f.startsWith("_")) fail(`${relative(root, join(dir, f))}: go:embed skips names that start with "." or "_"`);
    if (dir !== assets || f.endsWith(".LEGAL.txt")) continue;
    const text = readFileSync(join(dir, f), "utf8");
    for (const m of text.matchAll(/https?:\/\/[^\s"'`)\\]+/g)) {
      if (!ALLOWED_URL.test(m[0])) fail(`assets/${f} names a URL: ${m[0]}`);
    }
  }
}

const sizes = Object.entries(result.metafile.outputs)
  .map(([file, meta]) => `${relative(out, resolve(file))} ${(meta.bytes / 1024).toFixed(1)} KiB`)
  .join(", ");
console.log(`admin build: ${relative(root, out)}: index.html, drawer.html, sdk/; ${sizes}`);
