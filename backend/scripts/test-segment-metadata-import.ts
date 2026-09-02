import {
  runSegmentMetadataImport,
  validateSegmentMetadataImportJson,
} from "../lib/script-segment-metadata-import";

const FIXTURE = [
  {
    tag: {
      name: "BODY_RELAX",
      scope: "general",
      types: [] as string[],
      lengthTiered: false,
      repeatability: "connective" as const,
      description: "Generic body-softening cue.",
    },
  },
  {
    tag: {
      name: "BODY_SCAN_CROWN",
      scope: "restricted",
      types: ["body_scan"],
      lengthTiered: true,
      repeatability: "singular" as const,
      description: "Crown awareness — once only.",
    },
  },
];

const validated = validateSegmentMetadataImportJson(FIXTURE);
if (!validated.ok) {
  console.error("FAIL: validation", validated.errors);
  process.exit(1);
}
console.log(`PASS: parsed ${validated.entries.length} metadata entries`);

void (async () => {
  if (!process.env.VOICE_ADMIN_TABLE_NAME) {
    console.log("SKIP live import (set VOICE_ADMIN_TABLE_NAME to run against DynamoDB)");
    return;
  }
  const result = await runSegmentMetadataImport(FIXTURE);
  if (!result.ok) {
    console.error("FAIL: import", result.errors);
    process.exit(1);
  }
  console.log("PASS: live metadata import", result.result);
})();
