// One stylesheet for the theme, placed last so it wins over the app's own
// CSS at equal specificity. A constructable sheet when the browser has
// them; else a <style id="themarr"> (with the nonce) at the end of <head>.
// Clearing it gives the app its own look back: the app's CSS is never touched.

import type { EnvDocument, EnvElement, EnvSheet, EnvWindow } from "./types.ts";

export const STYLE_ID = "themarr";

export class ThemeSheet {
  readonly #doc: EnvDocument;
  readonly #win: EnvWindow | undefined;
  readonly #nonce: string | undefined;
  #sheet: EnvSheet | undefined;
  #style: EnvElement | undefined;
  #css = "";

  constructor(doc: EnvDocument, win: EnvWindow | undefined, nonce: string | undefined) {
    this.#doc = doc;
    this.#win = win;
    this.#nonce = nonce;
  }

  /** The CSS text now on the page ("" when none). */
  get css(): string {
    return this.#css;
  }

  /** Put css on the page, last. "" clears. */
  set(css: string): void {
    if (css === "") {
      this.clear();
      return;
    }
    this.#dropServerStyle();
    if (this.#trySheet(css)) {
      this.#css = css;
      return;
    }
    let el = this.#style;
    if (el === undefined) {
      el = this.#doc.createElement("style");
      el.id = STYLE_ID;
      if (this.#nonce !== undefined) el.setAttribute("nonce", this.#nonce);
      this.#style = el;
    }
    el.textContent = css;
    // Append again even when present: it moves to the end of <head>.
    this.#doc.head?.appendChild(el);
    this.#css = css;
  }

  clear(): void {
    this.#dropServerStyle();
    const list = this.#doc.adoptedStyleSheets;
    if (this.#sheet !== undefined && list !== undefined) {
      this.#doc.adoptedStyleSheets = list.filter((s) => s !== this.#sheet);
    }
    this.#sheet = undefined;
    this.#style?.remove();
    this.#style = undefined;
    this.#css = "";
  }

  #trySheet(css: string): boolean {
    const Ctor = this.#win?.CSSStyleSheet;
    const list = this.#doc.adoptedStyleSheets;
    if (Ctor === undefined || list === undefined) return false;
    try {
      const sheet = this.#sheet ?? new Ctor();
      sheet.replaceSync(css);
      this.#doc.adoptedStyleSheets = [...list.filter((s) => s !== sheet), sheet];
      this.#sheet = sheet;
      return true;
    } catch {
      return false;
    }
  }

  /** A <style id="themarr"> the server rendered (renderCss) is replaced by this sheet. */
  #dropServerStyle(): void {
    const el = this.#doc.getElementById(STYLE_ID);
    if (el !== null && el !== this.#style && el.tagName.toLowerCase() === "style") el.remove();
  }
}
