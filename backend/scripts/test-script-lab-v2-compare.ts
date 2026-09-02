/**
 * Compare V1 vs V2 on the lower-back oak-tree body-scan request (5m and 20m).
 *
 * Usage:
 *   AWS_PROFILE=mm VOICE_ADMIN_TABLE_NAME=... ANTHROPIC_API_KEY=... \
 *     npx tsx scripts/test-script-lab-v2-compare.ts
 */
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { CLAUDE_SONNET_45_MODEL_ID } from "../lib/anthropic-pricing";
import type { ScriptLabBeat } from "../lib/script-lab-beats";
import { generateScriptLabScript } from "../lib/script-lab-generate";
import { generateScriptLabScriptV2 } from "../lib/script-lab-generate-v2";
import { buildScriptLabContextTags } from "../lib/script-constraint-tags";
import { listAllScriptSegmentLibrary } from "../lib/script-segment-library";
import { buildSegmentTagsForGenerationPrompt } from "../lib/script-segment-tag-metrics";

function customUtf8Ratio(beats: ScriptLabBeat[]): number | null {
  let custom = 0;
  let total = 0;
  for (const b of beats) {
    if (b.beatType === "pause") continue;
    if (b.custom && b.text?.trim()) {
      const n = Buffer.byteLength(b.text.trim(), "utf8");
      custom += n;
      total += n;
    } else if (!b.custom && b.tag) {
      total += Buffer.byteLength(b.tag, "utf8");
    }
  }
  return total > 0 ? custom / total : null;
}

const TRANSCRIPT = [
  "User: My lower back has been really tight — I'm sitting under my oak tree and want a body scan from my toes to head and back, with real time in my lower back.",
  "Guide: Let's build a body scan with extra attention through your lower back.",
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

function summarize(label: string, beats: ScriptLabBeat[]) {
  const tags = beats.filter((b) => !b.custom && b.tag).map((b) => b.tag!);
  const settle = tags.filter((t) => t === "SETTLE_OPENER").length;
  const body = tags.filter((t) => t.startsWith("BODY_SCAN_")).join(", ");
  const customCount = beats.filter((b) => b.custom && b.beatType !== "pause").length;
  console.log(`\n=== ${label} ===`);
  console.log(`beats=${beats.length} settle_opener=${settle} custom=${customCount}`);
  console.log(`body tags: ${body || "(none)"}`);
  console.log(`custom%≈ ${((customUtf8Ratio(beats) ?? 0) * 100).toFixed(1)}`);
  beats.slice(0, 12).forEach((b, i) => {
    if (b.beatType === "pause") console.log(`  ${i}: pause:${b.pauseBand}`);
    else if (!b.custom) console.log(`  ${i}: ${b.tag}`);
    else console.log(`  ${i}: custom ${b.beatType}: ${(b.text ?? "").slice(0, 60)}`);
  });
  if (beats.length > 12) console.log(`  … +${beats.length - 12} more`);
}

async function runMinutes(targetMinutes: number) {
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

  const variantsByTag: Record<string, Array<{
    variantId: string;
    text: string;
    lengthTier?: "short" | "medium" | "long" | null;
    direction?: string | null;
    requiredConstraints?: string[];
    excludedConstraints?: string[];
  }>> = {};
  const tagMetaByName: Record<
    string,
    {
      lengthTiered: boolean;
      scope: "general" | "types";
      types: string[];
      repeatability?: typeof library.tags[0]["repeatability"];
    }
  > = {};
  for (const t of library.tags) {
    tagMetaByName[t.name] = {
      lengthTiered: t.lengthTiered,
      scope: t.scope,
      types: t.types,
      repeatability: t.repeatability,
    };
    variantsByTag[t.name] = (library.variantsByTag[t.name] ?? []).map((v) => ({
      variantId: v.variantId,
      text: v.text,
      lengthTier: v.lengthTier,
      direction: v.direction ?? null,
      requiredConstraints: v.requiredConstraints,
      excludedConstraints: v.excludedConstraints,
    }));
  }

  console.log(`\n########## ${targetMinutes} min ##########`);

  const v1 = await generateScriptLabScript({
    apiKey,
    model: CLAUDE_SONNET_45_MODEL_ID,
    transcript: TRANSCRIPT,
    meditationStyle: "Body scan",
    journalMode: false,
    targetMinutes,
    speechSpeed: 0.95,
    segmentTags,
    generalTagVariants: verificationTagVariants,
  });
  summarize(`V1 final (${targetMinutes}m)`, v1.beats);

  const v2 = await generateScriptLabScriptV2({
    apiKey,
    model: CLAUDE_SONNET_45_MODEL_ID,
    transcript: TRANSCRIPT,
    meditationStyle: "Body scan",
    journalMode: false,
    targetMinutes,
    speechSpeed: 0.95,
    segmentTags,
    variantsByTag,
    tagMetaByName,
    generalTagVariants: verificationTagVariants,
    contextTags: buildScriptLabContextTags({
      meditationType: "Body scan",
      userText: TRANSCRIPT,
    }),
  });

  console.log("\n--- V2 pass 1 skeleton ---");
  console.log(JSON.stringify(v2.v2Meta.passOneSkeleton, null, 2));
  summarize(`V2 pass1 rendered (${targetMinutes}m)`, v2.v2Meta.passOneRendered);
  summarize(`V2 before verify (${targetMinutes}m)`, v2.beatsBeforeVerification);
  summarize(`V2 after verify (${targetMinutes}m)`, v2.beats);
  console.log(
    `removedTags=${v2.v2Meta.removedTags.join(", ") || "(none)"} focusAnchorBeats=${v2.v2Meta.focusAnchorBeats}`,
  );
}

async function main() {
  if (!process.env.VOICE_ADMIN_TABLE_NAME) {
    console.log("SKIP: set VOICE_ADMIN_TABLE_NAME");
    return;
  }
  await runMinutes(5);
  await runMinutes(20);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
