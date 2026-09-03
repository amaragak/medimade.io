/**
 * Verify Script Lab per-stage model routing and cost comparison (all-Sonnet vs routed).
 *
 * Usage:
 *   npx tsx scripts/test-script-lab-stage-models.ts
 *   ANTHROPIC_API_KEY=... VOICE_ADMIN_TABLE_NAME=... AWS_PROFILE=mm npx tsx scripts/test-script-lab-stage-models.ts --live
 */
import { claudeUsdFromTokens } from "../lib/anthropic-pricing";
import { generateScriptLabScript } from "../lib/script-lab-generate";
import {
  SCRIPT_LAB_HAIKU_MODEL,
  SCRIPT_LAB_SONNET_MODEL,
  scriptLabModelForStage,
} from "../lib/script-lab-models";
import { buildScriptLabContextTags } from "../lib/script-constraint-tags";
import {
  listAllScriptSegmentLibrary,
  variantEligibleForV1V2Selection,
} from "../lib/script-segment-library";
import { buildSegmentTagsForGenerationPrompt } from "../lib/script-segment-tag-metrics";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function costUsd(
  usage: { input_tokens: number; output_tokens: number },
  model: string,
): number {
  return claudeUsdFromTokens(model, usage.input_tokens, usage.output_tokens);
}

function printCostComparison(label: string, breakdown: Array<{ stage: string; model: string; usage: { input_tokens: number; output_tokens: number } }>) {
  const totalUsage = breakdown.reduce(
    (acc, e) => ({
      input_tokens: acc.input_tokens + e.usage.input_tokens,
      output_tokens: acc.output_tokens + e.usage.output_tokens,
    }),
    { input_tokens: 0, output_tokens: 0 },
  );
  const allSonnet = costUsd(totalUsage, SCRIPT_LAB_SONNET_MODEL);
  const routed = breakdown.reduce((sum, e) => sum + costUsd(e.usage, e.model), 0);
  console.log(`\n=== ${label} ===`);
  for (const e of breakdown) {
    console.log(
      `  ${e.stage}: ${e.model} — ${e.usage.input_tokens} in / ${e.usage.output_tokens} out — $${costUsd(e.usage, e.model).toFixed(5)}`,
    );
  }
  console.log(`  Total tokens: ${totalUsage.input_tokens} in / ${totalUsage.output_tokens} out`);
  console.log(`  All-Sonnet cost: $${allSonnet.toFixed(5)}`);
  console.log(`  Routed cost:     $${routed.toFixed(5)} (${(((allSonnet - routed) / allSonnet) * 100).toFixed(1)}% saving)`);
}

async function main() {
  console.log("=== Static model routing ===");
  assert(scriptLabModelForStage("v1_generation") === SCRIPT_LAB_SONNET_MODEL, "gen=sonnet");
  assert(scriptLabModelForStage("v1_verification") === SCRIPT_LAB_HAIKU_MODEL, "verify=haiku");
  assert(scriptLabModelForStage("fill") === SCRIPT_LAB_HAIKU_MODEL, "fill=haiku");
  assert(scriptLabModelForStage("v3_pass5_promotion_review") === SCRIPT_LAB_SONNET_MODEL, "promo=sonnet");
  assert(scriptLabModelForStage("v3_pass5_substitution_review") === SCRIPT_LAB_HAIKU_MODEL, "sub=haiku");
  console.log("PASS: stage → model constants");

  // Illustrative V1 body-scan token profile (typical post-optimization sizes)
  printCostComparison("Illustrative V1 body scan (typical tokens)", [
    { stage: "v1_generation", model: SCRIPT_LAB_SONNET_MODEL, usage: { input_tokens: 8200, output_tokens: 2400 } },
    { stage: "v1_verification", model: SCRIPT_LAB_HAIKU_MODEL, usage: { input_tokens: 3700, output_tokens: 900 } },
    { stage: "fill", model: SCRIPT_LAB_HAIKU_MODEL, usage: { input_tokens: 2800, output_tokens: 400 } },
  ]);

  printCostComparison("Illustrative V1 visualization (typical tokens)", [
    { stage: "v1_generation", model: SCRIPT_LAB_SONNET_MODEL, usage: { input_tokens: 7800, output_tokens: 2600 } },
    { stage: "v1_verification", model: SCRIPT_LAB_HAIKU_MODEL, usage: { input_tokens: 3200, output_tokens: 850 } },
    { stage: "fill", model: SCRIPT_LAB_HAIKU_MODEL, usage: { input_tokens: 3100, output_tokens: 420 } },
  ]);

  if (!process.argv.includes("--live")) {
    console.log("\n(dry-run — pass --live with ANTHROPIC_API_KEY for live V1 runs)");
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("--live requires ANTHROPIC_API_KEY");
  if (!process.env.VOICE_ADMIN_TABLE_NAME) {
    throw new Error("--live requires VOICE_ADMIN_TABLE_NAME");
  }

  const library = await listAllScriptSegmentLibrary();
  const variantsByTagApproved: Record<string, typeof library.variantsByTag[string]> = {};
  for (const [tag, variants] of Object.entries(library.variantsByTag)) {
    variantsByTagApproved[tag] = variants.filter((v) => variantEligibleForV1V2Selection(v));
  }
  const segmentTags = buildSegmentTagsForGenerationPrompt({
    tags: library.tags,
    variantsByTag: variantsByTagApproved,
  });
  const verificationTagVariants = library.tags
    .map((t) => ({
      name: t.name,
      repeatability: t.repeatability,
      description: t.description,
      scope: t.scope,
      types: t.types,
      variants: (variantsByTagApproved[t.name] ?? []).map((v) => ({
        variantId: v.variantId,
        text: v.text,
        direction: v.direction ?? null,
        requiredConstraints: v.requiredConstraints,
        excludedConstraints: v.excludedConstraints,
      })),
    }))
    .filter((t) => t.variants.length > 0);

  for (const meditationStyle of ["Body scan", "Visualization"]) {
    const transcript = [
      "User: I've been holding tension and want to release it.",
      "Guide: What would help most right now?",
      `User: A ${meditationStyle.toLowerCase()} focused on relaxation.`,
    ].join("\n\n");
    const contextTags = buildScriptLabContextTags({
      meditationType: meditationStyle,
      userText: transcript,
    });

    const result = await generateScriptLabScript({
      apiKey,
      transcript,
      meditationStyle,
      journalMode: false,
      targetMinutes: 10,
      speechSpeed: 1,
      segmentTags,
      generalTagVariants: verificationTagVariants,
      contextTags,
    });

    console.log(`\n=== Live V1: ${meditationStyle} ===`);
    console.log(`  Beats: ${result.beats.length}, verification applied: ${result.verificationCorrectionsApplied}`);
    for (const e of result.usageBreakdown) {
      assert(
        e.model === scriptLabModelForStage(e.stage as Parameters<typeof scriptLabModelForStage>[0]),
        `${e.stage} used wrong model: ${e.model}`,
      );
      console.log(`  ${e.stage}: ${e.model}`);
    }
    printCostComparison(`Live ${meditationStyle}`, result.usageBreakdown);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
