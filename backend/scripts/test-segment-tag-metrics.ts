/**
 * Segment tag tier-average metrics tests.
 *
 * Usage:
 *   npx tsx scripts/test-segment-tag-metrics.ts
 *   AWS_PROFILE=mm VOICE_ADMIN_TABLE_NAME=... npx tsx scripts/test-segment-tag-metrics.ts --live
 */
import { buildMeditationScriptGenerationPrompt } from "../lib/meditation-script-generate-prompt";
import { listAllScriptSegmentLibrary } from "../lib/script-segment-library";
import {
  buildSegmentTagsForGenerationPrompt,
  budgetMetricsForTagAtTarget,
  buildSegmentTagMetricsIndex,
} from "../lib/script-segment-tag-metrics";
import { scriptSegmentLibraryPromptBlock } from "../lib/script-segment-tags";
import { estimateSyllableCount, countWords, speechSecondsFromWordCount } from "../lib/script-text-metrics";
import { SCRIPT_PAUSE_BAND_SECONDS } from "../lib/script-pause-bands";
import type { ScriptLabBeat } from "../lib/script-lab-beats";

const MOCK_VARIANTS = {
  BODY_SCAN_LOWER_BODY: [
    { text: "Short legs cue.", lengthTier: "short" as const },
    { text: "Medium length legs and feet scan with several phrases.", lengthTier: "medium" as const },
    {
      text:
        "Long lower body tour: thighs, knees, ankles, feet, and toes — inviting release in each region with unhurried attention.",
      lengthTier: "long" as const,
    },
  ],
  PACE_REASSURANCE: [
    { text: "There's no rush.", lengthTier: "short" as const },
    { text: "Continue at your own pace.", lengthTier: "medium" as const },
  ],
};

function testSyllableHeuristic() {
  const text = "beautiful meditation";
  const words = countWords(text);
  const syllables = estimateSyllableCount(text);
  console.log(`Syllables for "${text}": ${syllables} (${words} words)`);
  if (words !== 2 || syllables < 5) {
    throw new Error("FAIL: syllable heuristic sanity check");
  }
  console.log("PASS: syllable heuristic\n");
}

function testTierAverages() {
  const index = buildSegmentTagMetricsIndex({
    tags: [
      { name: "BODY_SCAN_LOWER_BODY", scope: "types", types: ["body_scan"], lengthTiered: true },
      { name: "PACE_REASSURANCE", scope: "general", types: [], lengthTiered: true },
    ],
    variantsByTag: MOCK_VARIANTS,
  });

  const long = index.BODY_SCAN_LOWER_BODY?.byTier.long;
  const short = index.BODY_SCAN_LOWER_BODY?.byTier.short;
  if (!long || !short) throw new Error("FAIL: missing tier averages");
  if (long.wordCount <= short.wordCount) {
    throw new Error("FAIL: long tier should average more words than short");
  }

  const budget20 = budgetMetricsForTagAtTarget("BODY_SCAN_LOWER_BODY", 20, index);
  if (!budget20 || budget20.wordCount <= short.wordCount) {
    throw new Error("FAIL: 20min budget should lean above short-tier average");
  }

  console.log(`BODY_SCAN_LOWER_BODY @20min budget: ~${budget20.wordCount} words, ~${budget20.syllableCount} syllables`);
  console.log("PASS: tier averages\n");
}

function testPromptIncludesMetrics() {
  const tags = buildSegmentTagsForGenerationPrompt({
    tags: [
      {
        name: "BODY_SCAN_LOWER_BODY",
        scope: "types",
        types: ["body_scan"],
        lengthTiered: true,
        repeatability: "singular",
        description: "Lower back and legs — use once; prefer over SPINE_BACK when lower-back focus is personalized.",
      },
    ],
    variantsByTag: { BODY_SCAN_LOWER_BODY: MOCK_VARIANTS.BODY_SCAN_LOWER_BODY },
  });

  const { userContent } = buildMeditationScriptGenerationPrompt({
    transcript: "User: lower back tension.\nGuide: body scan please.",
    meditationStyle: "Body scan",
    journalMode: false,
    targetMinutes: 20,
    speechSpeed: 0.95,
    includeSegmentPlaceholders: true,
    segmentTags: tags,
  });

  if (!userContent.includes("### BODY_SCAN_LOWER_BODY")) {
    throw new Error("FAIL: prompt missing ### tag catalog heading");
  }
  if (!userContent.includes("Repeatability: singular")) {
    throw new Error("FAIL: prompt missing Repeatability line");
  }
  if (!userContent.includes("Description: Lower back")) {
    throw new Error("FAIL: prompt missing Description line");
  }
  if (!userContent.includes("Example:")) {
    throw new Error("FAIL: prompt missing Example variant line");
  }
  if (!userContent.includes("Segment library — selection rules")) {
    throw new Error("FAIL: prompt missing selection rules block");
  }
  if (!userContent.includes("Phase / ordering")) {
    throw new Error("FAIL: prompt missing phase ordering rules");
  }
  if (!userContent.includes("Avg length:")) {
    throw new Error("FAIL: prompt missing tier average lines");
  }
  if (!userContent.includes("spoken_words_total")) {
    throw new Error("FAIL: prompt missing structured beat duration formula");
  }
  console.log("PASS: generation prompt includes metadata catalog and selection rules\n");
}

/** The catalog ships only type-relevant tags — general tags always, off-type never. */
function testCatalogFiltersByMeditationType() {
  const tags = buildSegmentTagsForGenerationPrompt({
    tags: [
      {
        name: "BODY_SCAN_LOWER_BODY",
        scope: "types",
        types: ["body_scan"],
        lengthTiered: true,
        repeatability: "singular",
        description: "Lower back and legs.",
      },
      {
        name: "SLEEP_THRESHOLD",
        scope: "types",
        types: ["sleep"],
        lengthTiered: false,
        repeatability: "singular",
        description: "Marks the threshold of sleep.",
      },
      {
        name: "PACE_REASSURANCE",
        scope: "general",
        types: [],
        lengthTiered: false,
        repeatability: "connective",
        description: "No-rush reassurance.",
      },
    ],
    variantsByTag: {
      BODY_SCAN_LOWER_BODY: MOCK_VARIANTS.BODY_SCAN_LOWER_BODY,
      SLEEP_THRESHOLD: MOCK_VARIANTS.BODY_SCAN_LOWER_BODY,
      PACE_REASSURANCE: MOCK_VARIANTS.BODY_SCAN_LOWER_BODY,
    },
  });

  const catalogFor = (meditationType: string) =>
    scriptSegmentLibraryPromptBlock({
      tags,
      meditationType,
      structuredBeats: true,
    });

  const bodyScan = catalogFor("Body scan");
  if (bodyScan.includes("### SLEEP_THRESHOLD")) {
    throw new Error("FAIL: off-type SLEEP_THRESHOLD leaked into Body scan catalog");
  }
  if (!bodyScan.includes("### BODY_SCAN_LOWER_BODY")) {
    throw new Error("FAIL: on-type BODY_SCAN_LOWER_BODY missing from Body scan catalog");
  }
  if (!bodyScan.includes("### PACE_REASSURANCE")) {
    throw new Error("FAIL: general-scope PACE_REASSURANCE dropped from Body scan catalog");
  }

  const sleep = catalogFor("Sleep");
  if (!sleep.includes("### SLEEP_THRESHOLD")) {
    throw new Error("FAIL: on-type SLEEP_THRESHOLD missing from Sleep catalog");
  }
  if (sleep.includes("### BODY_SCAN_LOWER_BODY")) {
    throw new Error("FAIL: off-type BODY_SCAN_LOWER_BODY leaked into Sleep catalog");
  }

  // General-scope tags carry no Scope: line now that the catalog is pre-filtered.
  const paceEntry = bodyScan.slice(bodyScan.indexOf("### PACE_REASSURANCE"));
  if (paceEntry.slice(0, paceEntry.indexOf("Description:")).includes("Scope:")) {
    throw new Error("FAIL: general-scope tag should not emit a Scope line");
  }

  console.log("PASS: catalog filters to type-relevant tags\n");
}

function simulateBeatsDuration(params: {
  beats: ScriptLabBeat[];
  targetMinutes: number;
  speechSpeed: number;
  index: ReturnType<typeof buildSegmentTagMetricsIndex>;
}): {
  totalSeconds: number;
  spokenWords: number;
  pauseSeconds: number;
  speechSeconds: number;
} {
  const wpm = 140;
  let spokenWords = 0;
  for (const beat of params.beats) {
    if (beat.beatType === "pause") continue;
    if (beat.custom && beat.text) {
      spokenWords += countWords(beat.text.replace(/\[\[PAUSE[^\]]+\]\]/gi, " "));
      continue;
    }
    if (!beat.custom && beat.tag) {
      const m = budgetMetricsForTagAtTarget(beat.tag, params.targetMinutes, params.index);
      if (m) spokenWords += m.wordCount;
    }
  }
  const pauseSeconds = params.beats.reduce((sum, beat) => {
    if (beat.beatType !== "pause" || !beat.pauseBand) return sum;
    return sum + (SCRIPT_PAUSE_BAND_SECONDS[beat.pauseBand as keyof typeof SCRIPT_PAUSE_BAND_SECONDS] ?? 0);
  }, 0);
  const speechSeconds = speechSecondsFromWordCount(spokenWords, params.speechSpeed, wpm);
  return {
    totalSeconds: pauseSeconds + speechSeconds,
    spokenWords,
    pauseSeconds,
    speechSeconds,
  };
}

function testBodyScanBudgetSimulation() {
  const index = buildSegmentTagMetricsIndex({
    tags: [
      { name: "SETTLE_OPENER", scope: "general", types: [], lengthTiered: true, repeatability: "singular" },
      { name: "BODY_SCAN_LOWER_BODY", scope: "types", types: ["body_scan"], lengthTiered: true, repeatability: "singular" },
      { name: "BODY_SCAN_SPINE_BACK", scope: "types", types: ["body_scan"], lengthTiered: true, repeatability: "singular" },
      { name: "PACE_REASSURANCE", scope: "general", types: [], lengthTiered: true, repeatability: "connective" },
      { name: "CLOSE_SENDOFF", scope: "general", types: [], lengthTiered: true, repeatability: "singular" },
    ],
    variantsByTag: {
      ...MOCK_VARIANTS,
      SETTLE_OPENER: [{ text: "Arrive here.", lengthTier: "medium" }],
      BODY_SCAN_SPINE_BACK: [
        { text: "Short spine.", lengthTier: "short" },
        { text: "Medium spine back scan.", lengthTier: "medium" },
        { text: "Long spine and back attention through upper mid and lower back regions.", lengthTier: "long" },
      ],
      CLOSE_SENDOFF: [{ text: "Gently return.", lengthTier: "short" }],
    },
  });

  const beats: ScriptLabBeat[] = [
    { beatType: "settle_opener", custom: false, tag: "SETTLE_OPENER" },
    { beatType: "pause", custom: false, pauseBand: "medium" },
    {
      beatType: "content",
      custom: true,
      text: "Bring awareness to your lower back where you've been holding tension.",
    },
    { beatType: "body_scan_lower_body", custom: false, tag: "BODY_SCAN_LOWER_BODY" },
    { beatType: "pause", custom: false, pauseBand: "long" },
    { beatType: "body_scan_spine_back", custom: false, tag: "BODY_SCAN_SPINE_BACK" },
    { beatType: "pace_reassurance", custom: false, tag: "PACE_REASSURANCE" },
    { beatType: "pause", custom: false, pauseBand: "medium" },
    { beatType: "pace_reassurance", custom: false, tag: "PACE_REASSURANCE" },
    { beatType: "close_sendoff", custom: false, tag: "CLOSE_SENDOFF" },
  ];

  const oldEstimate = simulateBeatsDuration({
    beats: beats.filter((b) => b.custom || b.beatType === "pause"),
    targetMinutes: 20,
    speechSpeed: 0.95,
    index,
  });
  const newEstimate = simulateBeatsDuration({
    beats,
    targetMinutes: 20,
    speechSpeed: 0.95,
    index,
  });

  console.log("20min body-scan budget simulation (formula: pause_seconds + spoken_words × 60 / (140 × speed))");
  console.log(`  Custom-only estimate: ${Math.round(oldEstimate.totalSeconds)}s (${oldEstimate.spokenWords} spoken words + ${Math.round(oldEstimate.pauseSeconds)}s pause)`);
  console.log(`  With tag beats:       ${Math.round(newEstimate.totalSeconds)}s (${newEstimate.spokenWords} spoken words + ${Math.round(newEstimate.pauseSeconds)}s pause)`);

  if (newEstimate.totalSeconds < oldEstimate.totalSeconds + 10) {
    throw new Error("FAIL: tag beats should add meaningful duration to estimate");
  }
  console.log("PASS: tag beats increase duration estimate\n");
}

async function testLiveLibrary() {
  if (!process.argv.includes("--live")) return;
  const library = await listAllScriptSegmentLibrary();
  const tags = buildSegmentTagsForGenerationPrompt({
    tags: library.tags,
    variantsByTag: library.variantsByTag,
  });
  const withMetrics = tags.filter((t) => t.tierAverages.length > 0);
  console.log(`Live library: ${withMetrics.length}/${tags.length} tags have tier averages`);
  const bodyScan = tags.filter((t) => t.name.startsWith("BODY_SCAN_") && t.tierAverages.length > 0);
  console.log(`BODY_SCAN tags with metrics: ${bodyScan.length}`);
  if (bodyScan.length === 0) throw new Error("FAIL: no BODY_SCAN metrics in live library");
  const sample = bodyScan[0]!;
  console.log(`  Example ${sample.name}:`, sample.tierAverages);
  console.log("PASS: live library metrics\n");
}

async function main() {
  testSyllableHeuristic();
  testTierAverages();
  testPromptIncludesMetrics();
  testCatalogFiltersByMeditationType();
  testBodyScanBudgetSimulation();
  await testLiveLibrary();
  console.log("All segment tag metrics tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
