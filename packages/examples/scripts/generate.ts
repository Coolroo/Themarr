// Rewrite src/registry.generated.ts from the example folders: `npm run generate`.
// Refuses (exit 1) when a folder breaks a rule (scripts/lint.ts, checkMeta).
import { writeFileSync } from "node:fs";
import { readExamples, REGISTRY_FILE, registryText } from "./registry.ts";

try {
  const examples = readExamples();
  writeFileSync(REGISTRY_FILE, registryText(examples));
  console.log(`registry: ${examples.length} examples (${examples.map((e) => e.id).join(", ")})`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
