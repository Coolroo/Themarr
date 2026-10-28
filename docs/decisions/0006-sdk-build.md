# 0006: The SDK is bundled by esbuild into one file; its .d.ts is joined from tsc's

Date: 2026-10-28. Task: T-118. Asked by: the plan
([Themarr plan: SDK, boot and drawer](https://docs.coolroo.dev/doc/themarr-plan-sdk-boot-and-drawer-a7euDJdAHN)):
"One TypeScript file with no dependencies, copied into each app."

## Decision

- **`esbuild` 0.28.2** (released 2026-08-08, MIT) bundles `packages/web/src/index.ts`
  into `dist/themarr.js`: one ESM file, target ES2022, not minified (people read
  the vendored copy), with the code it uses from `@themarr/tokens` inlined and
  tree-shaken. It is a development dependency only; the shipped file imports
  nothing, and the build fails if it has an `import` or `require`.
- **The `.d.ts` comes from the TypeScript compiler** (5.9.3, already pinned by
  decision 0001). `scripts/build.ts` emits declarations in memory, joins the
  SDK's files and the two token type files (`tokens.ts`, `theme.ts`) into
  `dist/themarr.d.ts`, keeps only the names `src/index.ts` re-exports, and then
  type-checks `test/types/consumer.ts` against it, so a hole in the join fails
  the build.
- **The build also loads the bundle in Node** and renders a golden fixture with
  it, so a broken bundle never reaches an app.
- **esbuild's install script is not needed.** The npm in the pinned Node image
  does not run it (`allowScripts`); esbuild's JavaScript API finds the binary
  in its `@esbuild/<platform>` optional package without it.
- Both files start with a header: the version and "copied from Coolroo/themarr
  packages/web — do not edit; copy a new release instead". `VERSION` in
  `src/index.ts` must equal `package.json`'s version; the build checks it.

## Why esbuild

- It scopes each module's top-level names, so two files may both have a helper
  called `isObject`; a hand-written concatenation would have to rename or
  refuse them.
- It removes the parts of `@themarr/tokens` the SDK doesn't call (manifest,
  schema, contrast), so apps carry only what boot needs.
- One package (plus one native binary per platform), no plugins, no config
  file. The release is more than two weeks old.

## Rejected

- **A hand-written bundler** (strip types with Node, concatenate modules):
  zero downloads, but it needs its own scoping rules and tree shaking, which is
  a small compiler to maintain.
- **Rollup with plugins, or tsup:** several packages for what esbuild does alone.
- **A `.d.ts` bundler** (`rollup-plugin-dts`, `dts-bundle-generator`,
  API Extractor): another dependency for a join of six files that the build
  checks anyway.
- **Shipping the TypeScript sources:** apps differ in build tools; one plain
  ESM file works in each of them and in Node without a build step.
