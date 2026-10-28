// The machine-readable manifest (tokens.manifest.json). The Go server embeds
// that file to validate themes without a JSON Schema library. A test checks
// the committed file equals buildManifest(); `npm run manifest` rewrites it.

import {
  CONTRAST_LEVELS,
  DIMENSION_UNITS,
  MODES,
  SCHEME_STYLES,
  SOURCE_KINDS,
  TOKENS,
  type TokenSpec,
} from "./tokens.ts";
import {
  ERROR_CODES,
  HEX_PATTERN,
  HEX_TOLERANCE,
  ID_MAX_LENGTH,
  ID_PATTERN,
  NAME_MAX_LENGTH,
} from "./validate.ts";

export const MANIFEST_VERSION = 1;

export interface ManifestToken {
  name: string;
  group: string;
  kind: "color" | "dimension";
  required: boolean;
  /** For a foreground: the token it is drawn on. */
  on?: string;
}

export interface Manifest {
  manifestVersion: number;
  tokens: ManifestToken[];
  modes: string[];
  sourceKinds: string[];
  schemeStyles: string[];
  contrastLevels: number[];
  dimensionUnits: string[];
  limits: { idMaxLength: number; idPattern: string; nameMaxLength: number; hexPattern: string; hexTolerance: number };
  errorCodes: string[];
}

export function buildManifest(): Manifest {
  return {
    manifestVersion: MANIFEST_VERSION,
    tokens: TOKENS.map((t: TokenSpec) => {
      const m: ManifestToken = { name: t.name, group: t.group, kind: t.kind, required: t.required };
      if (t.on !== undefined) m.on = t.on;
      return m;
    }),
    modes: [...MODES],
    sourceKinds: [...SOURCE_KINDS],
    schemeStyles: [...SCHEME_STYLES],
    contrastLevels: [...CONTRAST_LEVELS],
    dimensionUnits: [...DIMENSION_UNITS],
    limits: {
      idMaxLength: ID_MAX_LENGTH,
      // RE2 (Go) and ECMAScript read these the same way.
      idPattern: ID_PATTERN.source,
      nameMaxLength: NAME_MAX_LENGTH,
      hexPattern: HEX_PATTERN.source,
      hexTolerance: HEX_TOLERANCE,
    },
    errorCodes: [...ERROR_CODES],
  };
}

/** The manifest as committed: two-space JSON with a final newline. */
export function manifestText(): string {
  return `${JSON.stringify(buildManifest(), null, 2)}\n`;
}
