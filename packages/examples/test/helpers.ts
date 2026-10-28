// Test doubles: a host element with an open shadow root, and constructable
// sheets. No jsdom. And the golden fixtures from packages/tokens.

import { readdirSync, readFileSync } from "node:fs";
import type { WireTheme } from "@themarr/web";
import type { ExampleHost, ExampleRoot, ExampleSheet } from "../src/mount.ts";

export class FakeSheet implements ExampleSheet {
  cssText = "";
  replaceSync(text: string): void {
    this.cssText = text;
  }
}

/** A sheet whose replaceSync throws, as one from another document may. */
export class BrokenSheet implements ExampleSheet {
  replaceSync(): void {
    throw new Error("NotAllowedError");
  }
}

export class FakeRoot implements ExampleRoot {
  innerHTML = "";
  adoptedStyleSheets?: ExampleSheet[];
  constructor(constructable: boolean) {
    if (constructable) this.adoptedStyleSheets = [];
  }
  /** The CSS in the root: the adopted sheets' text, else the <style> element's. */
  css(): string {
    const sheets = (this.adoptedStyleSheets ?? []).map((s) => (s as FakeSheet).cssText).join("");
    if (sheets !== "") return sheets;
    const m = /^<style[^>]*>([\s\S]*?)<\/style>/.exec(this.innerHTML);
    return m?.[1] ?? "";
  }
}

export class FakeHost implements ExampleHost<FakeRoot> {
  shadowRoot: FakeRoot | null = null;
  attached = 0;
  readonly #constructable: boolean;
  constructor(constructable = true) {
    this.#constructable = constructable;
  }
  attachShadow(init: { mode: "open" }): FakeRoot {
    if (this.shadowRoot !== null) throw new Error("NotSupportedError: already has a shadow root");
    if (init.mode !== "open") throw new Error("expected an open shadow root");
    this.attached++;
    this.shadowRoot = new FakeRoot(this.#constructable);
    return this.shadowRoot;
  }
}

const FIXTURES = new URL("../../tokens/fixtures/valid/", import.meta.url);

/** Every valid golden fixture from packages/tokens, as the SDK gets it (version, modes, tokens). */
export function fixtures(): { name: string; theme: WireTheme }[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const t = JSON.parse(readFileSync(new URL(f, FIXTURES), "utf8")) as WireTheme;
      return { name: f.replace(/\.json$/, ""), theme: { version: t.version, modes: t.modes, tokens: t.tokens } };
    });
}

export function fixture(name: string): WireTheme {
  const f = fixtures().find((x) => x.name === name);
  if (f === undefined) throw new Error(`no fixture ${name}`);
  return f.theme;
}

/** The value a CSS text gives a custom property, or undefined (the last one wins). */
export function varValue(css: string, name: string): string | undefined {
  const all = [...css.matchAll(new RegExp(`${name}:\\s*([^;]+);`, "g"))];
  return all.at(-1)?.[1]?.trim();
}
