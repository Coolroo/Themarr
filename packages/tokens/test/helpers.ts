import { readdirSync, readFileSync } from "node:fs";

export const pkgDir = new URL("../", import.meta.url);

export function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(new URL(rel, pkgDir), "utf8"));
}

export function readText(rel: string): string {
  return readFileSync(new URL(rel, pkgDir), "utf8");
}

/** The .json files of a fixtures folder, without EXPECTED.json. */
export function fixtureFiles(kind: "valid" | "invalid"): string[] {
  return readdirSync(new URL(`fixtures/${kind}/`, pkgDir))
    .filter((f) => f.endsWith(".json") && f !== "EXPECTED.json")
    .sort();
}

export interface Expected {
  code: string;
  path: string;
}

export function expectedInvalid(): Record<string, Expected> {
  return readJson("fixtures/invalid/EXPECTED.json") as Record<string, Expected>;
}
