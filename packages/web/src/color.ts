// Token values to CSS text. Colours arrive as sRGB (decision 0002); the SDK
// writes them in the format each app variable asks for.

import type { ColorValue, DimensionValue } from "@themarr/tokens";
import type { Format } from "./types.ts";

/** Round to dp decimals and drop trailing zeros; never "-0". */
export function num(x: number, dp: number): string {
  const f = 10 ** dp;
  const r = Math.round(x * f) / f;
  return String(Object.is(r, -0) ? 0 : r);
}

function alphaSuffix(alpha: number | undefined): string {
  return alpha === undefined || alpha >= 1 ? "" : ` / ${num(alpha, 4)}`;
}

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** sRGB components (0..1) → OKLCH [L 0..1, C, H degrees] (Björn Ottosson's OKLab). */
export function srgbToOklch(rgb: readonly [number, number, number]): [number, number, number] {
  const r = toLinear(rgb[0]);
  const g = toLinear(rgb[1]);
  const b = toLinear(rgb[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  // Greys: the hue is noise.
  if (C < 1e-4) return [L, 0, 0];
  return [L, C, H];
}

/** sRGB components (0..1) → HSL [H degrees, S 0..100, L 0..100]. */
export function srgbToHsl(rgb: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s * 100, l * 100];
}

function hexBytes(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** One colour in one format. */
export function formatColor(v: ColorValue, format: Format): string {
  switch (format) {
    case "oklch": {
      const [L, C, H] = srgbToOklch(v.components);
      // H is 0 for a grey; a hue of 360 is written as 0.
      const h = num(H, 2) === "360" ? "0" : num(H, 2);
      return `oklch(${num(L, 4)} ${num(C, 4)} ${h}${alphaSuffix(v.alpha)})`;
    }
    case "hsl-triple": {
      const [H, S, L] = srgbToHsl(v.components);
      const h = num(H, 1) === "360" ? "0" : num(H, 1);
      return `${h} ${num(S, 1)}% ${num(L, 1)}%${alphaSuffix(v.alpha)}`;
    }
    case "hex": {
      const hex = v.hex.toLowerCase();
      if (v.alpha === undefined || v.alpha >= 1) return hex;
      return hex + Math.round(v.alpha * 255).toString(16).padStart(2, "0");
    }
    case "rgb-triplet":
      // No alpha: theme.park-style apps write rgb(var(--x)) or rgba(var(--x), a).
      return hexBytes(v.hex).join(", ");
  }
}

export function formatDimension(v: DimensionValue): string {
  return `${num(v.value, 4)}${v.unit}`;
}
