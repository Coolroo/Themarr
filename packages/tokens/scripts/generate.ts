// Rewrite tokens.manifest.json and schema/theme.schema.json from src/: `npm run generate`.
import { mkdirSync, writeFileSync } from "node:fs";
import { manifestText } from "../src/manifest.ts";
import { schemaText } from "../src/schema.ts";

writeFileSync(new URL("../tokens.manifest.json", import.meta.url), manifestText());
mkdirSync(new URL("../schema/", import.meta.url), { recursive: true });
writeFileSync(new URL("../schema/theme.schema.json", import.meta.url), schemaText());
