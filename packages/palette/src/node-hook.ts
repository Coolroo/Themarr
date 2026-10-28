// A resolve hook for plain Node (tests): Material Color Utilities 0.4.0 has
// ten relative imports without the ".js" extension (such as
// '../dynamiccolor/dynamic_scheme'), which a bundler accepts and Node's ESM
// loader refuses. This adds ".js" to those imports, and only inside that
// package. Browsers never see it: the admin build bundles the library.
//
//   node --import @themarr/palette/node-hook --test "test/**/*.test.ts"

import { registerHooks } from "node:module";

const PACKAGE = "/node_modules/@material/material-color-utilities/";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.includes(PACKAGE) === true &&
      /^\.\.?\//.test(specifier) &&
      !/\.[cm]?js$/.test(specifier)
    ) {
      return nextResolve(`${specifier}.js`, context);
    }
    return nextResolve(specifier, context);
  },
});
