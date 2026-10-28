// Build the vendored SDK: dist/themarr.js (one ESM file, @themarr/tokens
// inlined, no imports) and dist/themarr.d.ts (one file). Decision 0006.
//
//   npm run build -w @themarr/web
//
// 1. esbuild bundles src/index.ts.
// 2. The TypeScript compiler emits declarations in memory; this script joins
//    the SDK's and the token types' into one module (see joinDeclarations).
// 3. Checks: the bundle has no import or require, it loads in Node and
//    renders a fixture, and a consumer file type-checks against the .d.ts.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import ts from "typescript";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(pkg, "dist");
const version = (JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")) as { version: string }).version;

const header = `/*! themarr web SDK ${version}
 * Copied from Coolroo/themarr packages/web — do not edit; copy a new release instead.
 * One file, no dependencies. Docs: packages/web/README.md in that repo.
 */`;

function fail(msg: string): never {
  console.error(`build: ${msg}`);
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// 1. The bundle.
await build({
  entryPoints: [join(pkg, "src/index.ts")],
  outfile: join(dist, "themarr.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  minify: false,
  legalComments: "none",
  banner: { js: header },
  logLevel: "warning",
});
const js = readFileSync(join(dist, "themarr.js"), "utf8");
if (/^\s*import\s|\bimport\(|\brequire\(/m.test(js)) fail("dist/themarr.js has an import or require; the SDK must have no runtime dependencies");

// 2. The declarations.
const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2023,
  lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  types: [],
  strict: true,
  exactOptionalPropertyTypes: true,
  declaration: true,
  emitDeclarationOnly: true,
  allowImportingTsExtensions: true,
  rewriteRelativeImportExtensions: false,
  skipLibCheck: true,
  // Resolved through node_modules, the token sources would count as a
  // library, and TypeScript emits no declarations for a library.
  baseUrl: pkg,
  paths: { "@themarr/tokens": ["../tokens/src/index.ts"] },
};
const program = ts.createProgram([join(pkg, "src/index.ts")], options);
const diags = ts.getPreEmitDiagnostics(program);
if (diags.length > 0) fail(ts.formatDiagnostics(diags, ts.createCompilerHost(options)));
const emitted = new Map<string, string>();
const emit = program.emit(undefined, (file, text) => emitted.set(resolve(file), text), undefined, true);
if (emit.emitSkipped) fail("declaration emit failed");

/** The .d.ts text of one source file. */
function dts(src: string): string {
  const key = resolve(src).replace(/\.ts$/, ".d.ts");
  const text = emitted.get(key);
  if (text === undefined) fail(`no declarations for ${relative(pkg, src)}`);
  return text;
}

/**
 * Join the declaration files into one module. Every file but the entry
 * loses its imports and its `export` keywords, so only the entry's named
 * re-exports are public; the entry's `export {…} from "…"` lines lose
 * their `from`. The consumer check below proves the result is complete.
 */
function joinDeclarations(entry: string, others: string[]): string {
  const strip = (text: string): string =>
    text
      .replace(/^import[^;]*;\n/gm, "")
      .replace(/^export \{\};\n/gm, "")
      // Local re-export lists (`export type { Mode };`): the names are declared in the joined file.
      .replace(/^export (?:type )?\{[^}]*\};\n/gm, "")
      .replace(/^export (declare |interface |type |function |const |class |abstract )/gm, "$1")
      .replace(/^declare (interface|type) /gm, "$1 ");
  const parts = others.map((f) => `// ${relative(join(pkg, ".."), f)}\n${strip(dts(f)).trim()}\n`);
  const entryText = dts(entry)
    .replace(/^export \{\};\n/gm, "")
    .replace(/^(export (?:type )?\{[^}]*\}) from "[^"]+";$/gm, "$1;");
  if (/^export \* /m.test(entryText) || /^import /m.test(entryText)) fail("src/index.ts must re-export by name only");
  if (/^export /m.test(parts.join("\n"))) fail("an export keyword survived outside the entry");
  return `${header}\n${parts.join("\n")}\n// packages/web/src/index.ts\n${entryText.trim()}\n`;
}

const tokensSrc = resolve(pkg, "../tokens/src");
const webSrc = join(pkg, "src");
const declFiles = [
  join(tokensSrc, "tokens.ts"),
  join(tokensSrc, "theme.ts"),
  join(webSrc, "types.ts"),
  join(webSrc, "color.ts"),
  join(webSrc, "local.ts"),
  join(webSrc, "boot.ts"),
];
writeFileSync(join(dist, "themarr.d.ts"), joinDeclarations(join(webSrc, "index.ts"), declFiles));

// 3a. The bundle loads and renders.
const mod = (await import(pathToFileURL(join(dist, "themarr.js")).href)) as typeof import("../src/index.ts");
const synth = JSON.parse(readFileSync(resolve(pkg, "../tokens/fixtures/valid/handmade-synth-dark.json"), "utf8")) as {
  version: number;
  modes: ["dark"];
  tokens: never;
};
const css = mod.renderCss({ theme: { version: synth.version, modes: synth.modes, tokens: synth.tokens } }, { dark: { class: "dark" } });
if (!css.includes(":root.dark {") || !css.includes("--themarr-primary: oklch(")) fail("the bundle rendered unexpected CSS");
if (mod.VERSION !== version) fail(`VERSION ${mod.VERSION} is not package.json's ${version}`);

// 3b. A consumer type-checks against the .d.ts.
const consumer = join(pkg, "test/types/consumer.ts");
const check = ts.createProgram([consumer], {
  ...options,
  declaration: false,
  emitDeclarationOnly: false,
  noEmit: true,
  skipLibCheck: false,
  noUnusedLocals: true,
});
const checkDiags = ts.getPreEmitDiagnostics(check);
if (checkDiags.length > 0) fail(`dist/themarr.d.ts:\n${ts.formatDiagnostics(checkDiags, ts.createCompilerHost(options))}`);

const kb = (n: number): string => `${(n / 1024).toFixed(1)} KiB`;
console.log(`build: dist/themarr.js ${kb(js.length)}, dist/themarr.d.ts ${kb(readFileSync(join(dist, "themarr.d.ts")).length)}`);
