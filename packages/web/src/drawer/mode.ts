// The mode the app shows now, read the way the theme's CSS rules match it.

import type { Mode } from "@themarr/tokens";
import { splitSelectors, type Render } from "../css.ts";

export function currentMode(r: Render, doc: Document | undefined, win: Window | undefined): Mode {
  if (r.mode !== undefined) return r.mode;
  try {
    const d = r.dark;
    if (d === "media") return win?.matchMedia?.("(prefers-color-scheme: dark)").matches === true ? "dark" : "light";
    // The same selector as the dark rule in css.ts (modeRule).
    const mark = "class" in d ? `.${d.class}` : `[${d.attr}="${d.value}"]`;
    const selector = splitSelectors(r.selector)
      .map((p) => `${p}${mark}`)
      .join(", ");
    return doc?.querySelector(selector) != null ? "dark" : "light";
  } catch {
    return "light";
  }
}
