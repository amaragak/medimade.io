/**
 * Live check: manifestation visualization must not stack the same connective
 * tag with only pauses between instances.
 *
 *   AWS_PROFILE=mm VOICE_ADMIN_TABLE_NAME=... CLAUDE_SECRET_ARN=... \
 *     npx tsx scripts/test-connective-stacking-live.ts
 */
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { CLAUDE_SONNET_45_MODEL_ID } from "../lib/anthropic-pricing";
import type { ScriptLabBeat } from "../lib/script-lab-beats";
import { generateScriptLabScript } from "../lib/script-lab-generate";
import { FIXED_SPEECH_PREVIEW_SPEED } from "../lib/speaker-sample-speed";
import { listAllScriptSegmentLibrary } from "../lib/script-segment-library";
import { buildSegmentTagsForGenerationPrompt } from "../lib/script-segment-tag-metrics";
import {
  effectiveSegmentRepeatability,
  type ScriptSegmentRepeatability,
} from "../lib/script-segment-tags";

const TRANSCRIPT = [
  "User: I want a manifestation visualization meditation — I'm imagining my future home with rich sensory detail, colours, textures, sounds. Help me expand into that scene.",
  "Guide: We'll build a manifestation visualization with sensory expansion through the scene.",
  "User: Make it vivid — sights, sounds, feelings. About 10 minutes.",
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

/** True when the same connective tag appears twice with only pauses between. */
export function findConnectivePauseOnlyStacks(
  beats: ScriptLabBeat[],
  repeatabilityByName: Record<string, ScriptSegmentRepeatability>,
): Array<{ tag: string; indices: [number, number] }> {
  const stacks: Array<{ tag: string; indices: [number, number] }> = [];
  let prev: { index: number; tag: string } | null = null;
  beats.forEach((b, i) => {
    if (b.beatType === "pause") return;
    if (b.custom || !b.tag) {
      prev = null;
      return;
    }
    const rep =
      repeatabilityByName[b.tag] ??
      effectiveSegmentRepeatability({ tag: b.tag, repeatability: null });
    if (rep !== "connective") {
      prev = null;
      return;
    }
    if (prev && prev.tag === b.tag) {
      stacks.push({ tag: b.tag, indices: [prev.index, i] });
    }
    prev = { index: i, tag: b.tag };
  });
  return stacks;
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

  const repeatabilityByName: Record<string, ScriptSegmentRepeatability> = {};
  for (const t of library.tags) {
    repeatabilityByName[t.name] = effectiveSegmentRepeatability({
      tag: t.name,
      repeatability: t.repeatability,
    });
  }

  console.log(
    "SENSORY_EXPAND repeatability:",
    repeatabilityByName["SENSORY_EXPAND"] ?? "(missing)",
  );

  const result = await generateScriptLabScript({
    apiKey,
    model: CLAUDE_SONNET_45_MODEL_ID,
    transcript: TRANSCRIPT,
    meditationStyle: "Manifestation",
    journalMode: false,
    targetMinutes: 10,
    speechSpeed: FIXED_SPEECH_PREVIEW_SPEED,
    segmentTags,
    generalTagVariants: verificationTagVariants,
  });

  const beats = result.beats;
  beats.forEach((b, i) => {
    if (b.beatType === "pause") console.log(`${i}: pause:${b.pauseBand}`);
    else if (!b.custom) console.log(`${i}: ${b.tag}`);
    else console.log(`${i}: custom ${(b.text ?? "").slice(0, 70)}`);
  });

  const stacks = findConnectivePauseOnlyStacks(beats, repeatabilityByName);
  if (stacks.length) {
    console.error("FAIL connective pause-only stacks:", stacks);
    process.exit(1);
  }
  const sensory = beats.filter((b) => !b.custom && b.tag === "SENSORY_EXPAND").length;
  console.log(`PASS: no connective pause-only stacks (SENSORY_EXPAND uses=${sensory})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
