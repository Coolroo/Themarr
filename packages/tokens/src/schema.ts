// The theme JSON Schema (draft 2020-12), built from the token list so the
// two never drift. A test checks the committed schema/theme.schema.json
// equals buildSchema(); `npm run generate` rewrites it.

import {
  CONTRAST_LEVELS,
  DIMENSION_UNITS,
  MODES,
  REQUIRED_TOKENS,
  SCHEME_STYLES,
  TOKENS,
  type TokenSpec,
} from "./tokens.ts";
import { HEX_PATTERN, ID_MAX_LENGTH, ID_PATTERN, NAME_MAX_LENGTH, NAME_PATTERN_SOURCE } from "./validate.ts";

export const SCHEMA_ID = "https://themarr.coolroo.dev/schema/v1/theme.schema.json";

export function buildSchema(): Record<string, unknown> {
  const tokenProps: Record<string, unknown> = {};
  for (const t of TOKENS as readonly TokenSpec[]) {
    tokenProps[t.name] = { $ref: t.kind === "color" ? "#/$defs/colorToken" : "#/$defs/dimensionToken" };
  }
  const modeRule = (mode: string) => ({
    if: { required: ["modes"], properties: { modes: { contains: { const: mode } } } },
    then: { properties: { tokens: { required: [mode] } } },
    else: { properties: { tokens: { not: { required: [mode] } } } },
  });
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: SCHEMA_ID,
    title: "Themarr theme",
    description:
      "A themarr theme: DTCG 2025.10 tokens with sRGB colours, one token set per listed mode. " +
      "validateTheme in @themarr/tokens also checks that each hex agrees with its components.",
    type: "object",
    additionalProperties: false,
    required: ["id", "name", "version", "source", "modes", "tokens"],
    properties: {
      id: { type: "string", maxLength: ID_MAX_LENGTH, pattern: ID_PATTERN.source },
      name: { type: "string", minLength: 1, maxLength: NAME_MAX_LENGTH, pattern: NAME_PATTERN_SOURCE },
      version: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      source: { $ref: "#/$defs/source" },
      modes: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { enum: [...MODES] },
      },
      tokens: {
        type: "object",
        propertyNames: { enum: [...MODES] },
        properties: Object.fromEntries(MODES.map((m) => [m, { $ref: "#/$defs/modeTokens" }])),
      },
    },
    allOf: MODES.map(modeRule),
    $defs: {
      hex: { type: "string", pattern: HEX_PATTERN.source },
      source: {
        type: "object",
        required: ["kind"],
        properties: { kind: { enum: ["seeded", "handmade"] } },
        oneOf: [{ $ref: "#/$defs/seededSource" }, { $ref: "#/$defs/handmadeSource" }],
      },
      seededSource: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "seeds", "schemeStyle", "contrast"],
        properties: {
          kind: { const: "seeded" },
          seeds: {
            type: "object",
            additionalProperties: false,
            required: ["primary"],
            properties: { primary: { $ref: "#/$defs/hex" }, tag: { $ref: "#/$defs/hex" } },
          },
          schemeStyle: { enum: [...SCHEME_STYLES] },
          contrast: { enum: [...CONTRAST_LEVELS] },
        },
      },
      handmadeSource: {
        type: "object",
        additionalProperties: false,
        required: ["kind"],
        properties: { kind: { const: "handmade" } },
      },
      modeTokens: {
        type: "object",
        additionalProperties: false,
        required: [...REQUIRED_TOKENS],
        properties: tokenProps,
      },
      colorToken: {
        type: "object",
        additionalProperties: false,
        required: ["$type", "$value"],
        properties: {
          $type: { const: "color" },
          $value: {
            type: "object",
            additionalProperties: false,
            required: ["colorSpace", "components", "hex"],
            properties: {
              colorSpace: { const: "srgb" },
              components: {
                type: "array",
                minItems: 3,
                maxItems: 3,
                items: { type: "number", minimum: 0, maximum: 1 },
              },
              hex: { $ref: "#/$defs/hex" },
              alpha: { type: "number", minimum: 0, maximum: 1 },
            },
          },
        },
      },
      dimensionToken: {
        type: "object",
        additionalProperties: false,
        required: ["$type", "$value"],
        properties: {
          $type: { const: "dimension" },
          $value: {
            type: "object",
            additionalProperties: false,
            required: ["value", "unit"],
            properties: {
              value: { type: "number", minimum: 0 },
              unit: { enum: [...DIMENSION_UNITS] },
            },
          },
        },
      },
    },
  };
}

export function schemaText(): string {
  return `${JSON.stringify(buildSchema(), null, 2)}\n`;
}
