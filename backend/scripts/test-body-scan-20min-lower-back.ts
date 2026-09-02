/**
 * 20-minute lower-back-focused body scan generation test.
 *
 * Usage:
 *   AWS_PROFILE=mm VOICE_ADMIN_TABLE_NAME=... ANTHROPIC_API_KEY=... \
 *     npx tsx scripts/test-body-scan-20min-lower-back.ts
 */
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { findDuplicateBeatTypeWarnings, tagNameToBeatType } from "../lib/script-lab-beats";
import { generateScriptLabScript } from "../lib/script-lab-generate";
import { listAllScriptSegmentLibrary } from "../lib/script-segment-library";
import {
  buildSegmentTagsForGenerationPrompt,
  buildSegmentTagMetricsIndex,
  budgetMetricsForTagAtTarget,
} from "../lib/script-segment-tag-metrics";
import { buildMeditationScriptGenerationPrompt } from "../lib/meditation-script-generate-prompt";
import { customTextHasPersonalizationSignal } from "../lib/script-lab-beat-verification";
import { countWords, speechSecondsFromWordCount } from "../lib/script-text-metrics";
import { SCRIPT_PAUSE_BAND_SECONDS } from "../lib/script-pause-bands";
import { CLAUDE_SONNET_45_MODEL_ID } from "../lib/anthropic-pricing";
import type { ScriptLabBeat } from "../lib/script-lab-beats";
import type { ScriptPauseBand } from "../lib/script-pause-bands";
import { inferDefaultSegmentRepeatability, type ScriptSegmentRepeatability } from "../lib/script-segment-tags";

const TRANSCRIPT = [
  "User: My lower back has been really tight — I'm sitting under my oak tree and want a long body scan from my toes to head and back, with real time in my lower back.",
  "Guide: Let's build a 20-minute body scan with extra attention through your lower back and the rest of the body.",
].join("\n");

const TARGET_MINUTES = 20;
const SPEECH_SPEED = 0.95;

function beatSummary(b: ScriptLabBeat, i: number): string {
  if (b.beatType === "pause") return `${i}: pause:${b.pauseBand ?? "?"}`;
  if (!b.custom && b.tag) return `${i}: tag:${b.tag} (${b.beatType})`;
  const text = (b.text ?? "").replace(/\s+/g, " ").trim().slice(0, 72);
  return `${i}: custom(${b.beatType}): ${text}${(b.text?.length ?? 0) > 72 ? "…" : ""}`;
}

async function resolveApiKey(): Promise<string> {
  const direct = process.env.ANTHROPIC_API_KEY?.trim();
  if (direct) return direct;
  const arn = process.env.CLAUDE_SECRET_ARN?.trim();
  if (!arn) throw new Error("Set ANTHROPIC_API_KEY or CLAUDE_SECRET_ARN");
  const out = await new SecretsManagerClient({}).send(
    new GetSecretValueCommand({ SecretId: arn }),
  );
  const s = out.SecretString?.trim();
  if (!s) throw new Error("Claude secret empty");
  return s;
}

function estimateBeatsSeconds(
  beats: ScriptLabBeat[],
  index: ReturnType<typeof buildSegmentTagMetricsIndex>,
): number {
  let words = 0;
  let pauses = 0;
  for (const b of beats) {
    if (b.beatType === "pause" && b.pauseBand) {
      pauses += SCRIPT_PAUSE_BAND_SECONDS[b.pauseBand as keyof typeof SCRIPT_PAUSE_BAND_SECONDS] ?? 0;
      continue;
    }
    if (b.custom && b.text) {
      words += countWords(b.text.replace(/\[\[PAUSE[^\]]+\]\]/gi, " "));
    } else if (!b.custom && b.tag) {
      const m = budgetMetricsForTagAtTarget(b.tag, TARGET_MINUTES, index);
      if (m) words += m.wordCount;
    }
  }
  return pauses + speechSecondsFromWordCount(words, SPEECH_SPEED, 140);
}

function firstBodyTourIntroIndex(beats: ScriptLabBeat[]): number {
  return beats.findIndex(
    (b) =>
      b.custom &&
      b.text &&
      /\b(body scan|move through your body|attention through|tour of your body|scan through)\b/i.test(
        b.text,
      ),
  );
}

function countPauseBands(beats: ScriptLabBeat[]): Record<ScriptPauseBand, number> {
  const counts: Record<ScriptPauseBand, number> = {
    "extra-short": 0,
    short: 0,
    medium: 0,
    long: 0,
    "extra-long": 0,
  };
  for (const b of beats) {
    if (b.beatType === "pause" && b.pauseBand && b.pauseBand in counts) {
      counts[b.pauseBand as ScriptPauseBand] += 1;
    }
  }
  return counts;
}

function pauseSecondsFromBands(counts: Record<ScriptPauseBand, number>): number {
  let total = 0;
  for (const [band, n] of Object.entries(counts) as Array<[ScriptPauseBand, number]>) {
    total += n * SCRIPT_PAUSE_BAND_SECONDS[band];
  }
  return total;
}

function adjacentNonPauseIndices(beats: ScriptLabBeat[], index: number, window = 2): number[] {
  const out: number[] = [];
  let seen = 0;
  for (let i = index - 1; i >= 0 && seen < window; i--) {
    if (beats[i]!.beatType === "pause") continue;
    out.push(i);
    seen += 1;
  }
  seen = 0;
  for (let i = index + 1; i < beats.length && seen < window; i++) {
    if (beats[i]!.beatType === "pause") continue;
    out.push(i);
    seen += 1;
  }
  return out;
}

function highlightAdjacencyPairs(beats: ScriptLabBeat[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i]!;
    if (b.beatType === "pause") continue;

    const neighbors = adjacentNonPauseIndices(beats, i);
    for (const j of neighbors) {
      const n = beats[j]!;
      if (n.beatType === "pause") continue;
      const tagCustom =
        (!b.custom && b.tag && n.custom) || (b.custom && !n.custom && n.tag);
      if (!tagCustom) continue;
      if (i > j) continue;

      const tagBeat = !b.custom && b.tag ? b : n;
      const customBeat = b.custom ? b : n;
      const tagIdx = !b.custom && b.tag ? i : j;
      const customIdx = b.custom ? i : j;
      const personalized = customTextHasPersonalizationSignal(
        customBeat.text ?? "",
        TRANSCRIPT,
      );
      lines.push(
        `  #${tagIdx + 1} tag:${tagBeat.tag} ↔ #${customIdx + 1} custom(${customBeat.beatType})${
          personalized ? " [personalized — OK]" : " [generic — review]"
        }`,
      );
    }
  }
  return lines;
}

function isSingularTag(
  tag: string,
  repeatability: Record<string, ScriptSegmentRepeatability | null>,
): boolean {
  const rep = repeatability[tag] ?? inferDefaultSegmentRepeatability(tag);
  return rep !== "connective";
}

const GENERIC_ADJACENT_TEXT_PATTERNS: Record<string, RegExp[]> = {
  CLOSE_DEEPEN_BREATH: [
    /\b(breath(?:ing)? become (?:a little )?(?:fuller|deeper)|deeper breath|deepen (?:your|the) breath)\b/i,
  ],
  CLOSE_SENSORY_RETURN: [
    /\b(notice the (?:room|sounds|world) around|feel the room|return to (?:the )?(?:room|sounds|space) around)\b/i,
  ],
  BODY_SCAN_NECK_SHOULDERS: [
    /\b(shoulders drop|release (?:your )?shoulders|soften (?:your )?(?:neck|shoulders))\b/i,
  ],
  BODY_SCAN_FACE_JAW: [/\b(unclench (?:your )?jaw|soften (?:your )?jaw|relax (?:your )?jaw)\b/i],
};

function genericRestatesAdjacentSingularTag(
  customText: string,
  tagName: string,
): boolean {
  const patterns = GENERIC_ADJACENT_TEXT_PATTERNS[tagName];
  if (!patterns) return false;
  const prose = customText.replace(/\[\[PAUSE[^\]]+\]\]/gi, " ");
  return patterns.some((p) => p.test(prose));
}

function findRedundantAdjacentGenericPairs(
  beats: ScriptLabBeat[],
  tagRepeatability: Record<string, ScriptSegmentRepeatability | null>,
): string[] {
  const bad: string[] = [];
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i]!;
    if (!b.custom || !b.text?.trim()) continue;
    if (customTextHasPersonalizationSignal(b.text, TRANSCRIPT)) continue;

    for (const j of adjacentNonPauseIndices(beats, i)) {
      const n = beats[j]!;
      if (n.custom || !n.tag) continue;
      if (!isSingularTag(n.tag, tagRepeatability)) continue;

      const tagBeatType = tagNameToBeatType(n.tag);
      const sameFunction =
        b.beatType === tagBeatType ||
        b.beatType === n.beatType ||
        (b.tag != null && b.tag === n.tag) ||
        genericRestatesAdjacentSingularTag(b.text, n.tag);

      if (sameFunction) {
        bad.push(
          `#${j + 1} singular tag:${n.tag} ↔ #${i + 1} generic custom (${b.beatType}): ${(b.text ?? "").slice(0, 56)}…`,
        );
      }
    }
  }
  return bad;
}

function beatsRemovedByVerification(
  before: ScriptLabBeat[],
  after: ScriptLabBeat[],
): ScriptLabBeat[] {
  const afterTexts = new Set(
    after.filter((b) => b.custom && b.text).map((b) => b.text!.trim()),
  );
  return before.filter(
    (b) => b.custom && b.text?.trim() && !afterTexts.has(b.text.trim()),
  );
}

async function main() {
  const library = await listAllScriptSegmentLibrary();
  const segmentTags = buildSegmentTagsForGenerationPrompt({
    tags: library.tags,
    variantsByTag: library.variantsByTag,
  });

  const withDesc = segmentTags.filter((t) => t.description?.trim()).length;
  console.log(`Tags with description in prompt: ${withDesc}/${segmentTags.length}`);
  if (withDesc < 10) {
    console.warn("WARN: fewer than 10 tags have descriptions — import metadata first");
  }

  const { userContent } = buildMeditationScriptGenerationPrompt({
    transcript: TRANSCRIPT,
    meditationStyle: "Body scan",
    journalMode: false,
    targetMinutes: TARGET_MINUTES,
    speechSpeed: SPEECH_SPEED,
    includeSegmentPlaceholders: true,
    segmentTags,
  });
  if (!userContent.includes("### BODY_SCAN_NECK_SHOULDERS")) {
    throw new Error("FAIL: catalog missing BODY_SCAN_NECK_SHOULDERS heading");
  }
  if (!userContent.includes("Segment library — selection rules")) {
    throw new Error("FAIL: missing selection rules");
  }
  if (!userContent.includes("Pause budget (scales with target duration)")) {
    throw new Error("FAIL: missing scaled pause budget guidance");
  }
  if (!userContent.includes("Singular tags + adjacent custom beats")) {
    throw new Error("FAIL: missing singular-tag adjacent-custom generation rule");
  }

  const tagRepeatability = Object.fromEntries(
    library.tags.map((t) => [t.name, t.repeatability]),
  );
  const verificationTagVariants = library.tags
    .map((t) => ({
      name: t.name,
      repeatability: t.repeatability,
      variants: (library.variantsByTag[t.name] ?? []).map((v) => ({
        variantId: v.variantId,
        text: v.text,
        direction: v.direction ?? null,
      })),
    }))
    .filter((t) => t.variants.length > 0);

  const apiKey = await resolveApiKey();
  console.log("\nGenerating 20min lower-back body scan…");
  const result = await generateScriptLabScript({
    apiKey,
    model: CLAUDE_SONNET_45_MODEL_ID,
    transcript: TRANSCRIPT,
    meditationStyle: "Body scan",
    journalMode: false,
    targetMinutes: TARGET_MINUTES,
    speechSpeed: SPEECH_SPEED,
    segmentTags,
    generalTagVariants: verificationTagVariants,
    tagRepeatabilityByName: tagRepeatability,
  });

  const beats = result.beats;
  const beatsBefore = result.beatsBeforeVerification;
  const warnings = findDuplicateBeatTypeWarnings(beats, tagRepeatability);

  const redundantBefore = findRedundantAdjacentGenericPairs(beatsBefore, tagRepeatability);
  const redundantAfter = findRedundantAdjacentGenericPairs(beats, tagRepeatability);
  const removedCustom = beatsRemovedByVerification(beatsBefore, beats);

  console.log("\n--- Pre-verification beat list ---");
  beatsBefore.forEach((b, i) => console.log(beatSummary(b, i)));

  console.log("\n--- Post-verification beat list ---");
  beats.forEach((b, i) => console.log(beatSummary(b, i)));

  console.log("\n--- Pre-verification: redundant generic ↔ singular tag (should be empty) ---");
  if (redundantBefore.length === 0) {
    console.log("(none)");
  } else {
    redundantBefore.forEach((line) => console.error(`  ${line}`));
  }

  console.log("\n--- Verification trim proxy (custom beats removed) ---");
  if (removedCustom.length === 0) {
    console.log("(none — generation produced no trims for verification to apply)");
  } else {
    removedCustom.forEach((b) =>
      console.log(`  removed: custom(${b.beatType}): ${(b.text ?? "").slice(0, 72)}…`),
    );
  }

  console.log("\n--- Post-verification: redundant generic ↔ singular tag ---");
  if (redundantAfter.length === 0) {
    console.log("(none)");
  } else {
    redundantAfter.forEach((line) => console.log(`  ${line}`));
  }

  console.log("\n--- Tag ↔ custom adjacency pairs (post-verification) ---");
  const adjPairs = highlightAdjacencyPairs(beats);
  if (adjPairs.length === 0) {
    console.log("(none within 2-beat window)");
  } else {
    adjPairs.forEach((line) => console.log(line));
  }

  let failed = false;
  if (redundantBefore.length > 0) {
    console.error("FAIL: pre-verification beat list has redundant generic custom adjacent to singular tags");
    failed = true;
  }

  console.log("\n--- Duplicate warnings ---");
  if (warnings.length === 0) {
    console.log("(none)");
  } else {
    warnings.forEach((w) =>
      console.log(`  ${w.tag ?? w.beatType}: ${w.instances.map((x) => `#${x.index + 1}`).join(", ")}`),
    );
  }

  const tagCounts = new Map<string, number>();
  for (const b of beats) {
    if (!b.custom && b.tag) {
      tagCounts.set(b.tag, (tagCounts.get(b.tag) ?? 0) + 1);
    }
  }
  const neckCount = tagCounts.get("BODY_SCAN_NECK_SHOULDERS") ?? 0;
  const spineCount = tagCounts.get("BODY_SCAN_SPINE_BACK") ?? 0;
  const paceCount = tagCounts.get("PACE_REASSURANCE") ?? 0;
  const breathCount = tagCounts.get("BREATH_TRANSITION") ?? 0;

  const tourIntroIdx = firstBodyTourIntroIndex(beats);
  const bodyScanBeforeIntro = beats.some(
    (b, i) =>
      tourIntroIdx >= 0 &&
      i < tourIntroIdx &&
      !b.custom &&
      b.tag?.startsWith("BODY_SCAN_"),
  );

  const index = buildSegmentTagMetricsIndex({
    tags: library.tags.map((t) => ({
      name: t.name,
      scope: t.scope,
      types: t.types,
      lengthTiered: t.lengthTiered,
    })),
    variantsByTag: library.variantsByTag,
  });
  const estSeconds = estimateBeatsSeconds(beats, index);
  const estMin = (estSeconds / 60).toFixed(1);
  const pauseBands = countPauseBands(beats);
  const pauseSeconds = pauseSecondsFromBands(pauseBands);
  const pauseShare = ((pauseSeconds / estSeconds) * 100).toFixed(0);

  console.log("\n--- Pause band distribution ---");
  for (const band of ["extra-short", "short", "medium", "long", "extra-long"] as const) {
    const n = pauseBands[band];
    if (n > 0) {
      console.log(`  ${band}: ${n} (${(n * SCRIPT_PAUSE_BAND_SECONDS[band]).toFixed(0)}s)`);
    }
  }
  console.log(`  Total pause time: ${pauseSeconds.toFixed(0)}s (~${pauseShare}% of est. stem)`);

  console.log("\n--- Checks ---");
  console.log(`Est. duration: ${estMin} min (target ${TARGET_MINUTES})`);
  console.log(`BODY_SCAN_NECK_SHOULDERS uses: ${neckCount} (want ≤1)`);
  console.log(`BODY_SCAN_SPINE_BACK uses: ${spineCount} (want 0 when lower-back focused)`);
  console.log(`PACE_REASSURANCE uses: ${paceCount} (connective — may repeat)`);
  console.log(`BREATH_TRANSITION uses: ${breathCount} (connective — may repeat)`);
  console.log(`BODY_SCAN before tour intro: ${bodyScanBeforeIntro ? "YES (bad)" : "no"}`);
  console.log(`Verification corrections: ${result.verificationCorrectionsApplied}`);
  console.log(`Custom beats removed by verification: ${removedCustom.length}`);

  const closeDeepenIdx = beats.findIndex((b) => !b.custom && b.tag === "CLOSE_DEEPEN_BREATH");
  const closeDeepenGenericNeighbor = closeDeepenIdx >= 0 && adjacentNonPauseIndices(beats, closeDeepenIdx).some((j) => {
    const n = beats[j]!;
    return (
      n.custom &&
      n.beatType === "close_deepen_breath" &&
      !customTextHasPersonalizationSignal(n.text ?? "", TRANSCRIPT)
    );
  });

  const sensoryIdx = beats.findIndex((b) => !b.custom && b.tag === "CLOSE_SENSORY_RETURN");
  const sensoryCustomNeighbor = sensoryIdx >= 0
    ? adjacentNonPauseIndices(beats, sensoryIdx)
        .map((j) => beats[j]!)
        .filter((n) => n.custom && n.beatType === "close_sensory_return")
    : [];

  if (closeDeepenGenericNeighbor) {
    console.error("FAIL: generic custom text adjacent to CLOSE_DEEPEN_BREATH (post-verification)");
    failed = true;
  }
  for (const n of sensoryCustomNeighbor) {
    if (!customTextHasPersonalizationSignal(n.text ?? "", TRANSCRIPT)) {
      console.error("FAIL: CLOSE_SENSORY_RETURN neighbor lacks personalization only");
      failed = true;
    }
  }
  if (redundantAfter.length > 0) {
    console.warn("WARN: post-verification still has redundant adjacency (trim may have missed)");
  }
  if (neckCount > 1) {
    console.error("FAIL: NECK_SHOULDERS repeated");
    failed = true;
  }
  if (warnings.some((w) => w.tag === "BODY_SCAN_NECK_SHOULDERS")) {
    console.error("FAIL: duplicate warning for NECK_SHOULDERS");
    failed = true;
  }
  if (spineCount > 0) {
    console.warn("WARN: SPINE_BACK present — review if lower-back overlap acceptable");
  }
  if (bodyScanBeforeIntro) {
    console.error("FAIL: BODY_SCAN tag before tour intro");
    failed = true;
  }
  if (parseFloat(estMin) < TARGET_MINUTES * 0.35) {
    console.warn(`WARN: estimate ${estMin}m still well below target — may need more custom content`);
  }

  if (failed) process.exit(1);
  console.log("\nPASS: 20min lower-back generation review complete");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
