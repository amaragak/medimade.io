/**
 * Proximity gate tests for the coverage-verification pass.
 *
 * Usage:
 *   tsx scripts/test-verification-proximity.ts
 *   ANTHROPIC_API_KEY=... tsx scripts/test-verification-proximity.ts --live
 *   VOICE_ADMIN_TABLE_NAME=... AWS_PROFILE=mm tsx scripts/test-verification-proximity.ts --live
 */
import { listAllScriptSegmentLibrary } from "../lib/script-segment-library";
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
import { tagNameToBeatType, type ScriptLabBeat } from "../lib/script-lab-beats";

const TRANSCRIPT = [
  "User: I've been dealing with a lot of tension in my lower back lately.",
  "Guide: Let's create a body-scan meditation focused on that area.",
].join("\n");

/** Observed failure shape: stacked integration + repeated spine near personalized lower-back beat. */
const BODY_SCAN_PROXIMITY_FIXTURE: ScriptLabBeat[] = [
  { beatType: "settle_opener", custom: false, tag: "SETTLE_OPENER" },
  { beatType: "pause", custom: false, pauseBand: "medium" },
  {
    beatType: "content",
    custom: true,
    text:
      "Now bring your full awareness to your lower back. This is where you've been feeling that tension and discomfort. Notice the length of your spine from your tailbone upward. Don't try to change it yet—just notice what's there.",
  },
  { beatType: "pause", custom: false, pauseBand: "long" },
  {
    beatType: "content",
    custom: true,
    text:
      "Feel the gentle curve of your spine supporting you here. Let your breath travel along your spine.",
  },
  { beatType: "pause", custom: false, pauseBand: "long" },
  {
    beatType: "content",
    custom: true,
    text:
      "Take a moment to sense your whole body, all at once. Feel every part connected as one integrated whole. Rest in awareness of your complete body from head to toe.",
  },
  { beatType: "pause", custom: false, pauseBand: "extra-long" },
  {
    beatType: "content",
    custom: true,
    text: "There's no rush here. Just stay with what you notice.",
  },
  { beatType: "pause", custom: false, pauseBand: "long" },
  {
    beatType: "content",
    custom: true,
    text: "Move through the hips and belly at your own pace.",
  },
  { beatType: "pause", custom: false, pauseBand: "medium" },
  { beatType: "body_scan_face_jaw", custom: false, tag: "BODY_SCAN_FACE_JAW" },
  { beatType: "pause", custom: false, pauseBand: "long" },
  { beatType: "body_scan_crown", custom: false, tag: "BODY_SCAN_CROWN" },
  { beatType: "pause", custom: false, pauseBand: "long" },
  {
    beatType: "content",
    custom: true,
    text: "Continue naturally at your own pace.",
  },
];

function beatSummary(b: ScriptLabBeat): string {
  if (b.beatType === "pause") return `pause:${b.pauseBand ?? "?"}`;
  if (!b.custom && b.tag) return `tag:${b.tag}`;
  return `custom(${b.beatType}): ${(b.text ?? "").slice(0, 72)}`;
}

function maxConsecutiveTagRun(beats: ScriptLabBeat[], tag: string): number {
  const role = tagNameToBeatType(tag);
  let max = 0;
  let cur = 0;
  for (const b of beats) {
    if (b.beatType === "pause") continue;
    if (!b.custom && (b.tag === tag || b.beatType === role)) {
      cur += 1;
      max = Math.max(max, cur);
    } else {
      cur = 0;
    }
  }
  return max;
}

function countTagBeats(beats: ScriptLabBeat[], tag: string): number {
  const role = tagNameToBeatType(tag);
  return beats.filter(
    (b) => !b.custom && b.tag && (b.tag === tag || b.beatType === role),
  ).length;
}

/** Worst case: model confidently converts every generic spine/integration line. */
function mockAggressiveVerdicts(sentences: VerificationSentence[]): SentenceVerdict[] {
  return sentences.map((s) => {
    const prose = s.prose.toLowerCase();
    if (
      prose.includes("lower back") ||
      prose.includes("tension and discomfort") ||
      prose.includes("you've been feeling")
    ) {
      return {
        sentenceIndex: s.globalIndex,
        verdict: "keep_custom" as const,
        confidence: "high" as const,
      };
    }
    if (
      prose.includes("whole body") ||
      prose.includes("integrated whole") ||
      prose.includes("complete body")
    ) {
      return {
        sentenceIndex: s.globalIndex,
        verdict: "convert_tag" as const,
        matchedTag: "BODY_SCAN_FULL_INTEGRATION",
        matchedVariantId: "bsfi-1",
        confidence: "high" as const,
      };
    }
    if (prose.includes("spine")) {
      return {
        sentenceIndex: s.globalIndex,
        verdict: "convert_tag" as const,
        matchedTag: "BODY_SCAN_SPINE_BACK",
        matchedVariantId: "bssb-1",
        confidence: "high" as const,
      };
    }
    if (prose.includes("no rush") || prose.includes("own pace")) {
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
}

async function loadCatalog(): Promise<{
  raw: GeneralTagVariantCatalog[];
  cards: VerificationTagCard[];
}> {
  if (process.env.VOICE_ADMIN_TABLE_NAME) {
    const lib = await listAllScriptSegmentLibrary();
    const raw = lib.tags
      .map((t) => ({
        name: t.name,
        scope: t.scope,
        types: t.types,
        description: t.description,
        repeatability: t.repeatability,
        variants: (lib.variantsByTag[t.name] ?? []).map((v) => ({
          variantId: v.variantId,
          text: v.text,
          direction: v.direction ?? null,
          requiredConstraints: v.requiredConstraints,
          excludedConstraints: v.excludedConstraints,
        })),
      }))
      .filter((t) => t.variants.length > 0);
    return { raw, cards: prepareGeneralTagsForVerification(raw) };
  }

  const raw: GeneralTagVariantCatalog[] = [
    {
      name: "PACE_REASSURANCE",
      variants: [
        { variantId: "pr-1", text: "There's no rush here." },
        { variantId: "pr-2", text: "Continue naturally at your own pace." },
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
      name: "BODY_SCAN_FULL_INTEGRATION",
      variants: [
        {
          variantId: "bsfi-1",
          text: "Take a moment to sense your whole body, all at once.",
        },
      ],
    },
  ];
  return { raw, cards: prepareGeneralTagsForVerification(raw) };
}

function runMockProximityTest(catalog: VerificationTagCard[]) {
  const sentences = buildVerificationSentenceList(BODY_SCAN_PROXIMITY_FIXTURE);
  const verdicts = mockAggressiveVerdicts(sentences);
  const beats = assembleBeatsFromSentenceVerdicts({
    beatsBefore: BODY_SCAN_PROXIMITY_FIXTURE,
    sentences,
    verdicts,
    generalTags: catalog,
  });

  const integrationRun = maxConsecutiveTagRun(beats, "BODY_SCAN_FULL_INTEGRATION");
  const spineRun = maxConsecutiveTagRun(beats, "BODY_SCAN_SPINE_BACK");
  const paceCount = countTagBeats(beats, "PACE_REASSURANCE");

  console.log("=== Mock proximity test (aggressive convert_tag verdicts) ===");
  beats.forEach((b, i) => console.log(`  ${i}: ${beatSummary(b)}`));
  console.log(`\nMax consecutive BODY_SCAN_FULL_INTEGRATION: ${integrationRun}`);
  console.log(`Max consecutive BODY_SCAN_SPINE_BACK: ${spineRun}`);
  console.log(`PACE_REASSURANCE tag beats: ${paceCount}`);

  let ok = true;
  if (integrationRun > 1) {
    console.error("FAIL: BODY_SCAN_FULL_INTEGRATION stacked back-to-back");
    ok = false;
  }
  if (spineRun > 1) {
    console.error("FAIL: BODY_SCAN_SPINE_BACK stacked near lower-back section");
    ok = false;
  }
  if (paceCount < 2) {
    console.error("FAIL: well-spaced PACE_REASSURANCE should convert twice");
    ok = false;
  }
  if (ok) console.log("\nPASS: mock proximity gate");
  return ok;
}

async function runLiveProximityTest(catalog: GeneralTagVariantCatalog[]) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.error("Set ANTHROPIC_API_KEY for --live");
    process.exit(1);
  }

  console.log("\n=== Live Sonnet verification (body-scan proximity fixture) ===");
  const result = await verifyScriptLabBeats({
    apiKey,
    transcript: TRANSCRIPT,
    beatsBefore: BODY_SCAN_PROXIMITY_FIXTURE,
    generalTags: catalog,
    meditationType: "Body scan",
  });

  result.beats.forEach((b, i) => {
    const mark = result.newBeatIndices.includes(i) ? " *" : "";
    console.log(`  ${i}${mark}: ${beatSummary(b)}`);
  });

  const integrationRun = maxConsecutiveTagRun(
    result.beats,
    "BODY_SCAN_FULL_INTEGRATION",
  );
  const spineRun = maxConsecutiveTagRun(result.beats, "BODY_SCAN_SPINE_BACK");
  const paceCount = countTagBeats(result.beats, "PACE_REASSURANCE");

  console.log(`\nMax consecutive BODY_SCAN_FULL_INTEGRATION: ${integrationRun}`);
  console.log(`Max consecutive BODY_SCAN_SPINE_BACK: ${spineRun}`);
  console.log(`PACE_REASSURANCE tag beats: ${paceCount}`);

  let ok = true;
  if (integrationRun > 1) {
    console.error("FAIL: BODY_SCAN_FULL_INTEGRATION stacked");
    ok = false;
  }
  if (spineRun > 1) {
    console.error("FAIL: BODY_SCAN_SPINE_BACK stacked");
    ok = false;
  }
  if (paceCount < 1) {
    console.error("FAIL: expected at least one PACE_REASSURANCE conversion");
    ok = false;
  }
  if (ok) console.log("\nPASS: live proximity gate");
  return ok;
}

async function main() {
  const { raw, cards } = await loadCatalog();
  const mockOk = runMockProximityTest(cards);

  if (process.argv.includes("--live")) {
    const liveOk = await runLiveProximityTest(raw);
    if (!mockOk || !liveOk) process.exit(1);
    return;
  }

  if (!mockOk) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
