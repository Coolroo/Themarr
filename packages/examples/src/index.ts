// @themarr/examples: real app screens, drawn with any theme, for the admin UI.
// Each example is a folder (example.json, page.html, page.css); the registry
// is generated from the folders by `npm run generate`.

import { EXAMPLES } from "./registry.generated.ts";
import type { Example } from "./types.ts";

export { EXAMPLES };
export { exampleCss, mountExample } from "./mount.ts";
export type { ExampleHost, ExampleRoot, ExampleSheet, MountOptions, MountResult, MountStatus } from "./mount.ts";
export type { Example, ExampleMeta } from "./types.ts";

/** The example with this id, or undefined. */
export function exampleById(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}
