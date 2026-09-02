/**
 * Import segment library JSON (segments + variants mode).
 *
 * Usage:
 *   AWS_PROFILE=mm VOICE_ADMIN_TABLE_NAME=... npx tsx scripts/import-segment-json.ts path/to/file.json
 *   ... npx tsx scripts/import-segment-json.ts --fresh path/to/file.json
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runScriptSegmentImport } from "../lib/script-segment-import";

async function main() {
  const args = process.argv.slice(2);
  const fresh = args.includes("--fresh");
  const fileArg = args.find((a) => a !== "--fresh");
  if (!fileArg) {
    console.error("Usage: npx tsx scripts/import-segment-json.ts [--fresh] <path-to-json>");
    process.exit(1);
  }
  if (fresh) {
    console.error(
      "WARNING: Fresh import clears ALL existing variants (including audio) before loading JSON. Tag metadata is preserved.",
    );
  }
  const path = resolve(fileArg);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const result = await runScriptSegmentImport(raw, { fresh });
  if (!result.ok) {
    console.error("Import validation failed:");
    for (const e of result.errors) {
      console.error(`  ${e.path}: ${e.message}`);
    }
    process.exit(1);
  }
  console.log(JSON.stringify(result.result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
