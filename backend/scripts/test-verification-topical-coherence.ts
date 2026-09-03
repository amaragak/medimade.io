/**
 * Topical coherence gate tests for sentence-level verification assembly.
 *
 * Usage:
 *   tsx scripts/test-verification-topical-coherence.ts
 *   ANTHROPIC_API_KEY=... tsx scripts/test-verification-topical-coherence.ts --live
 */
import {
  assembleBeatsFromSentenceVerdicts,
  buildVerificationSentenceList,
  prepareGeneralTagsForVerification,
  verifyScriptLabBeats,
  type GeneralTagVariantCatalog,
  type SentenceVerdict,
  type VerificationSentence,
  type VerificationTagCard,
} from "../lib/script-lab-beat-verification";
import type { ScriptLabBeat } from "../lib/script-lab-beats";

const TRANSCRIPT = [
  "User: I've been dealing with a lot of tension in my lower back lately.",
  "Guide: Let's create a body-scan meditation focused on that area.",
].join("\n");

/** Jaw sentence stranded in a lower-back passage (observed failure). */
const JAW_MISPLACEMENT_FIXTURE: ScriptLabBeat[] = [
  { beatType: "settle_opener", custom: false, tag: "SETTLE_OPENER" },
  { beatType: "pause", custom: false, pauseBand: "medium" },
  {
    beatType: "content",
    custom: true,
    text:
      "Bring your attention to your face and jaw. Soften your forehead and let your cheeks be easy.",
  },
  { beatType: "body_scan_face_jaw", custom: false, tag: "BODY_SCAN_FACE_JAW" },
  { beatType: "pause", custom: false, pauseBand: "long" },
  { beatType: "body_scan_neck_shoulders", custom: false, tag: "BODY_SCAN_NECK_SHOULDERS" },
  { beatType: "pause", custom: false, pauseBand: "long" },
  { beatType: "body_scan_spine_back", custom: false, tag: "BODY_SCAN_SPINE_BACK" },
  { beatType: "pause", custom: false, pauseBand: "long" },
  { beatType: "body_scan_hips_belly_chest", custom: false, tag: "BODY_SCAN_HIPS_BELLY_CHEST" },
  { beatType: "pause", custom: false, pauseBand: "long" },
  { beatType: "body_scan_lower_body", custom: false, tag: "BODY_SCAN_LOWER_BODY" },
  { beatType: "pause", custom: false, pauseBand: "long" },
  {
    beatType: "content",
    custom: true,
    text:
      "Now bring your full awareness to your lower back. This is where you've been feeling that tension and discomfort. Allow your jaw to unclench. Notice the warmth spreading through your lower back.",
  },
  { beatType: "pause", custom: false, pauseBand: "extra-long" },
  {
    beatType: "content",
    custom: true,
    text: "Feel the gentle release along your spine as you breathe.",
  },
];

const RAW_CATALOG: GeneralTagVariantCatalog[] = [
  {
    name: "BODY_SCAN_FACE_JAW",
    variants: [
      {
        variantId: "bfj-1",
        text: "Let your attention drift to your face and jaw. Invite your jaw to release.",
      },
    ],
  },
  {
    name: "BODY_SCAN_SPINE_BACK",
    variants: [
      {
        variantId: "bssb-1",
        text: "Notice the length of your spine, from the base to the back of your neck.",
      },
    ],
  },
  {
    name: "PACE_REASSURANCE",
    variants: [{ variantId: "pr-1", text: "There's no rush here." }],
  },
];

const CATALOG: VerificationTagCard[] = prepareGeneralTagsForVerification(RAW_CATALOG);

function beatSummary(b: ScriptLabBeat): string {
  if (b.beatType === "pause") return `pause:${b.pauseBand ?? "?"}`;
  if (!b.custom && b.tag) return `tag:${b.tag}`;
  return `custom(${b.beatType}): ${(b.text ?? "").slice(0, 80)}`;
}

function jawSentenceStaysInCustomLowerBackBeat(beats: ScriptLabBeat[]): boolean {
  const lowerBackBeat = beats.find(
    (b) =>
      b.custom &&
      b.text?.toLowerCase().includes("lower back") &&
      b.text?.toLowerCase().includes("jaw to unclench"),
  );
  if (!lowerBackBeat) return false;
  const idx = beats.indexOf(lowerBackBeat);
  const neighbors = beats.slice(Math.max(0, idx - 3), idx + 4);
  return !neighbors.some((b) => !b.custom && b.tag === "BODY_SCAN_FACE_JAW");
}

function mockMisplacedJawVerdicts(sentences: VerificationSentence[]): SentenceVerdict[] {
  return sentences.map((s) => {
    const prose = s.prose.toLowerCase();
    if (prose.includes("jaw to unclench")) {
      return {
        sentenceIndex: s.globalIndex,
        verdict: "convert_tag" as const,
        matchedTag: "BODY_SCAN_FACE_JAW",
        matchedVariantId: "bfj-1",
        confidence: "high" as const,
      };
    }
    if (prose.includes("release along your spine")) {
      return {
        sentenceIndex: s.globalIndex,
        verdict: "convert_tag" as const,
        matchedTag: "BODY_SCAN_SPINE_BACK",
        matchedVariantId: "bssb-1",
        confidence: "high" as const,
      };
    }
    if (prose.includes("you've been feeling")) {
      return {
        sentenceIndex: s.globalIndex,
        verdict: "keep_custom" as const,
        confidence: "high" as const,
      };
    }
    return {
      sentenceIndex: s.globalIndex,
      verdict: "keep_custom" as const,
      confidence: "low" as const,
    };
  });
}

function mockFaceSectionJawVerdicts(sentences: VerificationSentence[]): SentenceVerdict[] {
  return sentences.map((s) => {
    if (s.prose.toLowerCase().includes("face and jaw")) {
      return {
        sentenceIndex: s.globalIndex,
        verdict: "convert_tag" as const,
        matchedTag: "BODY_SCAN_FACE_JAW",
        matchedVariantId: "bfj-1",
        confidence: "high" as const,
      };
    }
    return {
      sentenceIndex: s.globalIndex,
      verdict: "keep_custom" as const,
      confidence: "low" as const,
    };
  });
}

function runMockMisplacementTest(): boolean {
  const sentences = buildVerificationSentenceList(JAW_MISPLACEMENT_FIXTURE);
  const beats = assembleBeatsFromSentenceVerdicts({
    beatsBefore: JAW_MISPLACEMENT_FIXTURE,
    sentences,
    verdicts: mockMisplacedJawVerdicts(sentences),
    generalTags: CATALOG,
  });

  console.log("=== Mock: jaw sentence in lower-back passage ===");
  beats.forEach((b, i) => console.log(`  ${i}: ${beatSummary(b)}`));

  const jawFolded = jawSentenceStaysInCustomLowerBackBeat(beats);

  console.log(`\nJaw line stays in lower-back custom beat: ${jawFolded}`);

  if (!jawFolded) {
    console.error("FAIL: BODY_SCAN_FACE_JAW split out of lower-back passage");
    return false;
  }
  console.log("PASS: mock topical coherence");
  return true;
}

function runMockLegitimateFaceTest(): boolean {
  const faceOnlyFixture: ScriptLabBeat[] = [
    {
      beatType: "content",
      custom: true,
      text:
        "Bring your attention to your face and jaw. Soften your forehead and let your cheeks be easy.",
    },
  ];
  const sentences = buildVerificationSentenceList(faceOnlyFixture);
  const beats = assembleBeatsFromSentenceVerdicts({
    beatsBefore: faceOnlyFixture,
    sentences,
    verdicts: mockFaceSectionJawVerdicts(sentences),
    generalTags: CATALOG,
  });

  console.log("\n=== Mock: jaw conversion in face/jaw section ===");
  beats.forEach((b, i) => console.log(`  ${i}: ${beatSummary(b)}`));

  const converted = beats.some((b) => !b.custom && b.tag === "BODY_SCAN_FACE_JAW");
  console.log(`BODY_SCAN_FACE_JAW converted: ${converted}`);
  if (!converted) {
    console.error("FAIL: legitimate face/jaw conversion blocked");
    return false;
  }
  console.log("PASS: mock legitimate conversion");
  return true;
}

async function runLiveTest(): Promise<boolean> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.error("Set ANTHROPIC_API_KEY for --live");
    process.exit(1);
  }

  console.log("\n=== Live Sonnet verification (jaw misplacement fixture) ===");
  const result = await verifyScriptLabBeats({
    apiKey,
    transcript: TRANSCRIPT,
    beatsBefore: JAW_MISPLACEMENT_FIXTURE,
    generalTags: RAW_CATALOG,
    meditationType: "Body scan",
  });

  result.beats.forEach((b, i) => {
    const mark = result.newBeatIndices.includes(i) ? " *" : "";
    console.log(`  ${i}${mark}: ${beatSummary(b)}`);
  });

  const jawFolded = jawSentenceStaysInCustomLowerBackBeat(result.beats);
  const earlyFaceTag = result.beats.some(
    (b, i) => i < 8 && !b.custom && b.tag === "BODY_SCAN_FACE_JAW",
  );

  console.log(`\nJaw line stays in lower-back custom beat: ${jawFolded}`);
  console.log(`Early face/jaw tag beat preserved: ${earlyFaceTag}`);

  if (!jawFolded) {
    console.error("FAIL: live run split jaw tag into lower-back passage");
    return false;
  }
  console.log("PASS: live topical coherence");
  return true;
}

async function main() {
  const mockOk = runMockMisplacementTest() && runMockLegitimateFaceTest();
  if (process.argv.includes("--live")) {
    const liveOk = await runLiveTest();
    if (!mockOk || !liveOk) process.exit(1);
    return;
  }
  if (!mockOk) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
