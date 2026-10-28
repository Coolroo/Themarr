// The shape of an example: its example.json, plus its page.html and page.css.

import type { Mode } from "@themarr/tokens";

/** One example's example.json. */
export interface ExampleMeta {
  /** The folder's name: lower-case letters, digits and single hyphens. */
  id: string;
  /** What the admin UI shows, such as "vibe-kanban: board". */
  name: string;
  /** The app the screen was copied from, as an app ID in themarr (a slug). */
  sourceApp: string;
  /** One or two sentences: which screen, and what it shows. */
  description: string;
  /** The modes the real app has; the first is the mode it opens in. */
  modes: Mode[];
  /** The design size in CSS pixels; page.css draws `.page` at this size. */
  size: { width: number; height: number };
}

/** An example as the registry holds it. */
export interface Example extends ExampleMeta {
  /** page.html: static markup, sample data only, no scripts. */
  html: string;
  /** page.css: colours only from var(--themarr-<token>). */
  css: string;
}
