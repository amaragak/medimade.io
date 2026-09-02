/**
 * Movement meditation constraint context + SETTLE_OPENER variant filter tests.
 *
 * Usage:
 *   npx tsx scripts/test-movement-constraint-context.ts
 *   AWS_PROFILE=mm VOICE_ADMIN_TABLE_NAME=... CLAUDE_SECRET_ARN=... \
 *     npx tsx scripts/test-movement-constraint-context.ts --live
 */
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { CLAUDE_SONNET_45_MODEL_ID } from "../lib/anthropic-pricing";
import {
  buildScriptLabContextTags,
  DEFAULT_SEATED_CONSTRAINT,
  STANDING_CONSTRAINT,
  variantEligibleForContext,
} from "../lib/script-constraint-tags";
import { generateScriptLabScriptV2 } from "../lib/script-lab-generate-v2";
import { listAllScriptSegmentLibrary } from "../lib/script-segment-library";
import { buildSegmentTagsForGenerationPrompt } from "../lib/script-segment-tag-metrics";
import type { ScriptLengthTier } from "../lib/script-segment-tags";
import { FIXED_SPEECH_PREVIEW_SPEED } from "../lib/speaker-sample-speed";

const WALKING_TRANSCRIPT = [
  "User: I want a movement meditation while walking and running around the office.",
  "Guide: We'll build a gentle walking and running practice you can do at work.",
  "User: About 5 minutes.",
].join("\n");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function testContextInference() {
  const walkingCtx = buildScriptLabContextTags({
    meditationType: "Movement meditation",
    userText: WALKING_TRANSCRIPT,
  });
  assert(
    walkingCtx.includes(STANDING_CONSTRAINT),
    `expected standing in context, got ${walkingCtx.join(",")}`,
  );
  assert(
    !walkingCtx.includes(DEFAULT_SEATED_CONSTRAINT),
    `Movement+walking should not include seated_or_lying, got ${walkingCtx.join(",")}`,
  );

  const floorCtx = buildScriptLabContextTags({
    meditationType: "Movement meditation",
    userText: "yoga on the floor, seated stretching",
  });
  assert(
    floorCtx.includes(DEFAULT_SEATED_CONSTRAINT),
    `expected seated for floor yoga, got ${floorCtx.join(",")}`,
  );
  assert(
    !floorCtx.includes(STANDING_CONSTRAINT),
    `floor yoga should not default to standing, got ${floorCtx.join(",")}`,
  );

  const bodyScanCtx = buildScriptLabContextTags({
    meditationType: "Body scan",
    userText: "walking meditation",
  });
  assert(bodyScanCtx.includes(DEFAULT_SEATED_CONSTRAINT), "body scan default seated");
  assert(bodyScanCtx.includes(STANDING_CONSTRAINT), "walking signal adds standing");

  console.log("PASS: context inference");
}

function testSettleOpenerVariantFilter(
  variants: Array<{
    variantId: string;
    text: string;
    requiredConstraints: string[];
    excludedConstraints: string[];
  }>,
) {
  const standingCtx = buildScriptLabContextTags({
    meditationType: "Movement meditation",
    userText: WALKING_TRANSCRIPT,
  });
  const eligible = variants.filter((v) =>
    variantEligibleForContext({
      requiredConstraints: v.requiredConstraints,
      excludedConstraints: v.excludedConstraints,
      contextTags: standingCtx,
    }),
  );
  const lyingVariant = variants.find((v) =>
    /sitting upright or lying down/i.test(v.text),
  );
  if (lyingVariant) {
    const stillEligible = eligible.some((v) => v.variantId === lyingVariant.variantId);
    assert(
      !stillEligible,
      "seated/lying SETTLE_OPENER variant must be excluded when context is standing",
    );
  }
  assert(eligible.length > 0, "expected at least one standing-eligible SETTLE_OPENER");
  const hasStandingAppropriate = eligible.some(
    (v) => !/lying down|sitting upright/i.test(v.text),
  );
  assert(hasStandingAppropriate, "eligible pool should include non-seated opener text");
  console.log(
    `PASS: SETTLE_OPENER filter (${eligible.length}/${variants.length} eligible for standing)`,
  );
}

async function resolveApiKey(): Promise<string> {
  const direct = process.env.ANTHROPIC_API_KEY?.trim();
  if (direct) return direct;
  const arn = process.env.CLAUDE_SECRET_ARN?.trim();
  if (!arn) throw new Error("Set ANTHROPIC_API_KEY or CLAUDE_SECRET_ARN for --live");
  const out = await new SecretsManagerClient({}).send(
    new GetSecretValueCommand({ SecretId: arn }),
  );
  const s = out.SecretString!.trim();
  try {
    const j = JSON.parse(s) as { apiKey?: string; ANTHROPIC_API_KEY?: string };
    return (j.apiKey ?? j.ANTHROPIC_API_KEY ?? s).trim();
  } catch {
    return s;
  }
}

async function testLiveGeneration() {
  if (!process.env.VOICE_ADMIN_TABLE_NAME?.trim()) {
    console.log("SKIP live (set VOICE_ADMIN_TABLE_NAME)");
    return;
  }
  const apiKey = await resolveApiKey();
  const library = await listAllScriptSegmentLibrary();
  const settleVariants = (library.variantsByTag.SETTLE_OPENER ?? []).map((v) => ({
    variantId: v.variantId,
    text: v.text,
    requiredConstraints: v.requiredConstraints,
    excludedConstraints: v.excludedConstraints,
  }));
  testSettleOpenerVariantFilter(settleVariants);

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
  const variantsByTag: Record<
    string,
    Array<{
      variantId: string;
      text: string;
      lengthTier?: ScriptLengthTier | null;
      direction?: string | null;
      requiredConstraints?: string[];
      excludedConstraints?: string[];
    }>
  > = {};
  const tagMetaByName: Record<
    string,
    {
      lengthTiered: boolean;
      scope: "general" | "types";
      types: string[];
      repeatability?: import("../lib/script-segment-tags").ScriptSegmentRepeatability;
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
  const contextTags = buildScriptLabContextTags({
    meditationType: "Movement meditation",
    userText: WALKING_TRANSCRIPT,
  });
  console.log("Live context tags:", contextTags.join(", "));

  const result = await generateScriptLabScriptV2({
    apiKey,
    model: CLAUDE_SONNET_45_MODEL_ID,
    transcript: WALKING_TRANSCRIPT,
    meditationStyle: "Movement meditation",
    journalMode: false,
    targetMinutes: 5,
    speechSpeed: FIXED_SPEECH_PREVIEW_SPEED,
    segmentTags,
    variantsByTag,
    tagMetaByName,
    generalTagVariants: verificationTagVariants,
    contextTags,
  });

  const settle = result.beats.find((b) => !b.custom && b.tag === "SETTLE_OPENER");
  const text = settle?.text ?? "";
  console.log("SETTLE_OPENER text:", text.slice(0, 120));
  if (/lying down|sitting upright/i.test(text)) {
    throw new Error(`FAIL: seated/lying SETTLE_OPENER selected: ${text.slice(0, 80)}`);
  }
  console.log("PASS: live Movement walking/running SETTLE_OPENER");
}

async function main() {
  testContextInference();
  const live = process.argv.includes("--live");
  if (live) {
    await testLiveGeneration();
  } else {
    console.log("Offline only (pass --live with AWS env for generation test)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
