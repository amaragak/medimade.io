/**
 * Repeatability classification tests (offline).
 *
 * Usage:
 *   npx tsx scripts/test-repeatability.ts
 */
import {
  assembleBeatsFromSentenceVerdicts,
  buildVerificationSentenceList,
  proximityBlocksTagConversion,
  prepareGeneralTagsForVerification,
  type GeneralTagVariantCatalog,
} from "../lib/script-lab-beat-verification";
import {
  findDuplicateBeatTypeWarnings,
  type ScriptLabBeat,
} from "../lib/script-lab-beats";

const CATALOG: GeneralTagVariantCatalog[] = prepareGeneralTagsForVerification([
  {
    name: "BODY_SCAN_NECK_SHOULDERS",
    repeatability: "singular",
    variants: [{ variantId: "ns-1", text: "Soften the neck and shoulders." }],
  },
  {
    name: "PACE_REASSURANCE",
    repeatability: "connective",
    variants: [
      { variantId: "pr-1", text: "There's no rush here." },
      { variantId: "pr-2", text: "Continue at your own pace." },
    ],
  },
  {
    name: "SETTLE_OPENER",
    repeatability: "singular",
    variants: [{ variantId: "so-1", text: "Arrive here." }],
  },
]);

function testDuplicateWarnings() {
  const beats: ScriptLabBeat[] = [
    { beatType: "pace_reassurance", custom: false, tag: "PACE_REASSURANCE" },
    { beatType: "pause", custom: false, pauseBand: "short" },
    { beatType: "pace_reassurance", custom: false, tag: "PACE_REASSURANCE" },
    { beatType: "body_scan_neck_shoulders", custom: false, tag: "BODY_SCAN_NECK_SHOULDERS" },
    { beatType: "body_scan_neck_shoulders", custom: false, tag: "BODY_SCAN_NECK_SHOULDERS" },
  ];

  const warnings = findDuplicateBeatTypeWarnings(beats);
  const neckWarning = warnings.find((w) => w.tag === "BODY_SCAN_NECK_SHOULDERS");
  const paceWarning = warnings.find((w) => w.tag === "PACE_REASSURANCE");

  console.log("Duplicate warnings:", warnings.length);
  if (!neckWarning) throw new Error("FAIL: expected BODY_SCAN_NECK_SHOULDERS duplicate warning");
  if (paceWarning) throw new Error("FAIL: PACE_REASSURANCE repeats should not warn");
  console.log("PASS: duplicate warnings respect repeatability\n");
}

function testVerificationSingularGlobalBlock() {
  const assembled: ScriptLabBeat[] = [
    { beatType: "body_scan_neck_shoulders", custom: false, tag: "BODY_SCAN_NECK_SHOULDERS" },
  ];
  const blocked = proximityBlocksTagConversion(
    assembled,
    "BODY_SCAN_NECK_SHOULDERS",
    CATALOG,
  );
  if (!blocked) throw new Error("FAIL: singular tag should block second conversion globally");
  console.log("PASS: singular tag blocked on global duplicate\n");
}

function testVerificationConnectiveExempt() {
  const assembled: ScriptLabBeat[] = [
    { beatType: "pace_reassurance", custom: false, tag: "PACE_REASSURANCE" },
    { beatType: "pause", custom: false, pauseBand: "medium" },
    { beatType: "pace_reassurance", custom: false, tag: "PACE_REASSURANCE" },
  ];
  const blocked = proximityBlocksTagConversion(assembled, "PACE_REASSURANCE", CATALOG);
  if (blocked) throw new Error("FAIL: connective tag should not be blocked");
  console.log("PASS: connective tag exempt from duplicate block\n");
}

function testVerificationAssemblyNeckOnce() {
  const beatsBefore: ScriptLabBeat[] = [
    { beatType: "settle_opener", custom: false, tag: "SETTLE_OPENER" },
    {
      beatType: "content",
      custom: true,
      text:
        "Bring awareness to your neck and shoulders. Let them soften. There's no rush. Later, notice your neck and shoulders again as you settle.",
    },
  ];
  const sentences = buildVerificationSentenceList(beatsBefore);
  const verdicts = sentences.map((s) => {
    const prose = s.prose.toLowerCase();
    if (prose.includes("neck") && prose.includes("shoulder")) {
      return {
        sentenceIndex: s.globalIndex,
        verdict: "convert_tag" as const,
        matchedTag: "BODY_SCAN_NECK_SHOULDERS",
        matchedVariantId: "ns-1",
        confidence: "high" as const,
      };
    }
    if (prose.includes("no rush")) {
      return {
        sentenceIndex: s.globalIndex,
        verdict: "convert_tag" as const,
        matchedTag: "PACE_REASSURANCE",
        matchedVariantId: "pr-1",
        confidence: "high" as const,
      };
    }
    return {
      sentenceIndex: s.globalIndex,
      verdict: "keep_custom" as const,
      confidence: "low" as const,
    };
  });

  const beats = assembleBeatsFromSentenceVerdicts({
    beatsBefore,
    sentences,
    verdicts,
    generalTags: CATALOG,
  });

  const neckCount = beats.filter(
    (b) => !b.custom && b.tag === "BODY_SCAN_NECK_SHOULDERS",
  ).length;
  const paceCount = beats.filter((b) => !b.custom && b.tag === "PACE_REASSURANCE").length;

  console.log(`Assembly: BODY_SCAN_NECK_SHOULDERS=${neckCount}, PACE_REASSURANCE=${paceCount}`);
  beats.forEach((b, i) => console.log(`  ${i}: ${b.custom ? "custom" : b.tag}`));

  if (neckCount > 1) throw new Error("FAIL: neck/shoulders converted more than once");
  if (paceCount < 1) throw new Error("FAIL: expected at least one pace reassurance conversion");
  console.log("PASS: verification assembly respects singular vs connective\n");
}

function main() {
  testDuplicateWarnings();
  testVerificationSingularGlobalBlock();
  testVerificationConnectiveExempt();
  testVerificationAssemblyNeckOnce();
  console.log("All repeatability tests passed.");
}

main();
