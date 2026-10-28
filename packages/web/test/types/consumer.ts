// Type-checked by scripts/build.ts against dist/themarr.d.ts (not by the
// package's typecheck, which runs before dist exists). It uses each export
// the way an app would, so a hole in the joined .d.ts fails the build.

import * as themarr from "../../dist/themarr.js";
import type { BootOptions, BootResult, Format, Mode, Status, TokenMap, TokenName } from "../../dist/themarr.js";

const format: Format = "hsl-triple";
const map: TokenMap = { primary: [{ var: "--brand", format }], radius: [{ var: "--radius", format: "hex" }] };
const opts: BootOptions = {
  app: "vibe-kanban",
  url: "https://themarr.coolroo.dev",
  timeoutMs: 1000,
  selector: "html:not([data-theme-variant])",
  dark: { class: "dark" },
  map,
  onChange: (r: BootResult) => void r.status,
};

export async function main(): Promise<void> {
  const result = await themarr.boot(opts);
  const status: Status = result.status;
  const mode: Mode = "dark";
  const name: TokenName = "primary";
  const value: string | undefined = result.tokens?.[mode]?.[name];
  const css: string = themarr.renderCss(result) + themarr.renderCss(result, { mode: "light" });
  const id: string | null = themarr.getLocalOverride("vibe-kanban");
  const ok: boolean = themarr.setLocalOverride("vibe-kanban", "synth");
  themarr.clearLocalOverride("vibe-kanban");
  const hex: string = themarr.formatColor({ colorSpace: "srgb", components: [1, 0, 0], hex: "#FF0000" }, "hex");
  const v: string = themarr.VERSION;
  await result.refresh();
  result.dispose();
  void [status, value, css, id, ok, hex, v];
}
