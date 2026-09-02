/**
 * Live Sleep script generation check (V1).
 *
 * Usage:
 *   AWS_PROFILE=mm VOICE_ADMIN_TABLE_NAME=... CLAUDE_SECRET_ARN=... \
 *     npx tsx scripts/test-sleep-generation.ts
 */
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { CLAUDE_SONNET_45_MODEL_ID } from "../lib/anthropic-pricing";
import { generateScriptLabScript } from "../lib/script-lab-generate";
import { WAKING_CLOSE_TAGS } from "../lib/script-lab-shared-prompt-rules";
import type { ScriptLabBeat } from "../lib/script-lab-beats";
import { FIXED_SPEECH_PREVIEW_SPEED } from "../lib/speaker-sample-speed";
import { listAllScriptSegmentLibrary } from "../lib/script-segment-library";
import { buildSegmentTagsForGenerationPrompt } from "../lib/script-segment-tag-metrics";
import { buildTagRepeatabilityMap } from "../lib/script-lab-beats";

const TRANSCRIPT = [
  "User: I've been having trouble falling asleep — my mind keeps replaying the day.",
  "Guide: We'll create a gentle sleep meditation to help you unwind and drift off.",
  "User: About 10 minutes. Soft, no energizing imagery.",
].join("\n");

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
  try {
    const j = JSON.parse(s) as { apiKey?: string; ANTHROPIC_API_KEY?: string };
    return (j.apiKey ?? j.ANTHROPIC_API_KEY ?? s).trim();
  } catch {
    return s;
  }
}

function analyzeBeats(label: string, beats: ScriptLabBeat[]) {
  const closeTags = beats
    .map((b, i) => ({ i, b }))
    .filter(({ b }) => !b.custom && b.tag && WAKING_CLOSE_TAGS.includes(b.tag as (typeof WAKING_CLOSE_TAGS)[number]));
  const threshold = beats
    .map((b, i) => ({ i, b }))
    .filter(({ b }) => !b.custom && b.tag === "SLEEP_THRESHOLD");
  const sleepClose = beats
    .map((b, i) => ({ i, b }))
    .filter(({ b }) => !b.custom && b.tag === "SLEEP_CLOSE");
  const last = beats[beats.length - 1];
  const afterClose =
    sleepClose.length > 0
      ? beats.slice(sleepClose[sleepClose.length - 1]!.i + 1)
      : beats;

  console.log(`\n=== ${label} ===`);
  console.log(`beats=${beats.length}`);
  console.log(`CLOSE_* tags: ${closeTags.map(({ i, b }) => `@${i}:${b.tag}`).join(", ") || "(none)"}`);
  console.log(`SLEEP_THRESHOLD: ${threshold.length} @ ${threshold.map(({ i }) => i).join(", ") || "—"}`);
  console.log(`SLEEP_CLOSE: ${sleepClose.length} @ ${sleepClose.map(({ i }) => i).join(", ") || "—"}`);
  console.log(`final beat: ${last?.custom ? `custom/${last.beatType}` : last?.tag ?? last?.beatType}`);
  console.log(`beats after SLEEP_CLOSE: ${afterClose.length}`);

  if (closeTags.length > 0) {
    throw new Error(`FAIL: found waking CLOSE_* tags: ${closeTags.map(({ b }) => b.tag).join(", ")}`);
  }
  if (threshold.length !== 1) {
    throw new Error(`FAIL: expected exactly 1 SLEEP_THRESHOLD, got ${threshold.length}`);
  }
  if (sleepClose.length !== 1) {
    throw new Error(`FAIL: expected exactly 1 SLEEP_CLOSE, got ${sleepClose.length}`);
  }
  if (last?.tag !== "SLEEP_CLOSE") {
    throw new Error(`FAIL: final beat must be SLEEP_CLOSE, got ${last?.tag ?? last?.beatType}`);
  }
  if (afterClose.length > 0) {
    throw new Error(`FAIL: ${afterClose.length} beat(s) after SLEEP_CLOSE`);
  }

  beats.slice(-6).forEach((b, offset) => {
    const i = beats.length - 6 + offset;
    if (b.beatType === "pause") console.log(`  ${i}: pause:${b.pauseBand}`);
    else if (!b.custom) console.log(`  ${i}: ${b.tag}`);
    else console.log(`  ${i}: custom/${b.beatType}: ${(b.text ?? "").slice(0, 50)}`);
  });
}

async function main() {
  if (!process.env.VOICE_ADMIN_TABLE_NAME?.trim()) {
    throw new Error("VOICE_ADMIN_TABLE_NAME is required");
  }
  const apiKey = await resolveApiKey();
  const library = await listAllScriptSegmentLibrary();
  const segmentTags = buildSegmentTagsForGenerationPrompt({
    tags: library.tags,
    variantsByTag: library.variantsByTag,
  });
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
  const tagRepeatabilityByName = buildTagRepeatabilityMap(
    library.tags.map((t) => ({ name: t.name, repeatability: t.repeatability })),
  );

  const sleepTags = ["SLEEP_THRESHOLD", "SLEEP_CLOSE", "SLEEP_HEAVINESS", "SLEEP_PERMISSION_DRIFT"];
  const missing = sleepTags.filter(
    (t) => !library.tags.some((row) => row.name === t),
  );
  if (missing.length) {
    console.warn("WARN: sleep tags missing from library:", missing.join(", "));
  }

  const result = await generateScriptLabScript({
    apiKey,
    model: CLAUDE_SONNET_45_MODEL_ID,
    transcript: TRANSCRIPT,
    meditationStyle: "Sleep",
    journalMode: false,
    targetMinutes: 10,
    speechSpeed: FIXED_SPEECH_PREVIEW_SPEED,
    segmentTags,
    generalTagVariants: verificationTagVariants,
    tagRepeatabilityByName,
  });

  analyzeBeats("before verification", result.beatsBeforeVerification);
  analyzeBeats("after verification", result.beats);
  console.log("\nPASS: Sleep generation meets closing structure requirements");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
