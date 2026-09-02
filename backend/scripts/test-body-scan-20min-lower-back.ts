/**
 * 20-minute lower-back-focused body scan generation test.
 *
 * Usage:
 *   AWS_PROFILE=mm VOICE_ADMIN_TABLE_NAME=... ANTHROPIC_API_KEY=... \
 *     npx tsx scripts/test-body-scan-20min-lower-back.ts
 */
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { findDuplicateBeatTypeWarnings } from "../lib/script-lab-beats";
import { generateScriptLabScript } from "../lib/script-lab-generate";
import { listAllScriptSegmentLibrary } from "../lib/script-segment-library";
import {
  buildSegmentTagsForGenerationPrompt,
  buildSegmentTagMetricsIndex,
  budgetMetricsForTagAtTarget,
} from "../lib/script-segment-tag-metrics";
import { buildMeditationScriptGenerationPrompt } from "../lib/meditation-script-generate-prompt";
import { countWords, speechSecondsFromWordCount } from "../lib/script-text-metrics";
import { SCRIPT_PAUSE_BAND_SECONDS } from "../lib/script-pause-bands";
import { CLAUDE_HAIKU_45_MODEL_ID } from "../lib/anthropic-pricing";
import type { ScriptLabBeat } from "../lib/script-lab-beats";

const TRANSCRIPT = [
  "User: My lower back has been really tight — I want a long body scan that spends real time there.",
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
      })),
    }))
    .filter((t) => t.variants.length > 0);

  const apiKey = await resolveApiKey();
  console.log("\nGenerating 20min lower-back body scan…");
  const result = await generateScriptLabScript({
    apiKey,
    model: CLAUDE_HAIKU_45_MODEL_ID,
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
  const warnings = findDuplicateBeatTypeWarnings(beats, tagRepeatability);

  console.log("\n--- Beat list ---");
  beats.forEach((b, i) => console.log(beatSummary(b, i)));

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

  console.log("\n--- Checks ---");
  console.log(`Est. duration: ${estMin} min (target ${TARGET_MINUTES})`);
  console.log(`BODY_SCAN_NECK_SHOULDERS uses: ${neckCount} (want ≤1)`);
  console.log(`BODY_SCAN_SPINE_BACK uses: ${spineCount} (want 0 when lower-back focused)`);
  console.log(`PACE_REASSURANCE uses: ${paceCount} (connective — may repeat)`);
  console.log(`BREATH_TRANSITION uses: ${breathCount} (connective — may repeat)`);
  console.log(`BODY_SCAN before tour intro: ${bodyScanBeforeIntro ? "YES (bad)" : "no"}`);
  console.log(`Verification corrections: ${result.verificationCorrectionsApplied}`);

  let failed = false;
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
