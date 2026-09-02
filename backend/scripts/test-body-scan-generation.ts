/**
 * End-to-end Body Scan Script Lab generation test.
 * Usage:
 *   AWS_PROFILE=mm VOICE_ADMIN_TABLE_NAME=... ANTHROPIC_API_KEY=... tsx scripts/test-body-scan-generation.ts
 */
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { generateScriptLabScript } from "../lib/script-lab-generate";
import { listAllScriptSegmentLibrary } from "../lib/script-segment-library";
import {
  scriptSegmentLibraryPromptBlock,
  typesMatchMeditationType,
} from "../lib/script-segment-tags";
import { CLAUDE_HAIKU_45_MODEL_ID } from "../lib/anthropic-pricing";
import type { ScriptLabBeat } from "../lib/script-lab-beats";

const TRANSCRIPT = [
  "User: I've been feeling scattered and disconnected from my body lately.",
  "Guide: Let's create a body scan meditation — slow attention through the whole body, from feet to crown.",
].join("\n");

const MEDITATION_STYLE = "Body scan";

function beatTagSummary(b: ScriptLabBeat): string {
  if (b.beatType === "pause") return `pause:${b.pauseBand ?? "?"}`;
  if (!b.custom && b.tag) return `tag:${b.tag}`;
  return `custom(${b.beatType}): ${(b.text ?? "").slice(0, 80)}`;
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

async function main() {
  const library = await listAllScriptSegmentLibrary();
  const bodyScanTags = library.tags.filter((t) => t.name.startsWith("BODY_SCAN_"));
  console.log(`Library BODY_SCAN tags: ${bodyScanTags.length}`);

  const typeMatchOk = typesMatchMeditationType(["body_scan"], MEDITATION_STYLE);
  console.log(`typesMatchMeditationType(["body_scan"], "Body scan"): ${typeMatchOk}`);
  if (!typeMatchOk) {
    console.error("FAIL: type normalization");
    process.exit(1);
  }

  const segmentTags = library.tags.map((t) => ({
    name: t.name,
    scope: t.scope,
    types: t.types,
    sampleVariants: (library.variantsByTag[t.name] ?? []).slice(0, 2).map((v) => v.text),
  }));

  const promptBlock = scriptSegmentLibraryPromptBlock({
    tags: segmentTags,
    meditationType: MEDITATION_STYLE,
    structuredBeats: true,
  });
  const bodyScanInPrompt = bodyScanTags.every((t) => promptBlock.includes(`**${t.name}**`));
  const preferredLabel = bodyScanTags.some((t) =>
    promptBlock.includes(`**${t.name}** (Preferred for:`),
  );
  console.log(`(a) All BODY_SCAN tags in generation prompt: ${bodyScanInPrompt}`);
  console.log(`(a) At least one labeled Preferred for: ${preferredLabel}`);
  if (!bodyScanInPrompt) {
    console.error("FAIL: BODY_SCAN tags missing from prompt");
    process.exit(1);
  }

  const verificationTagVariants = library.tags
    .map((t) => ({
      name: t.name,
      variants: (library.variantsByTag[t.name] ?? []).map((v) => ({
        variantId: v.variantId,
        text: v.text,
      })),
    }))
    .filter((t) => t.variants.length > 0);
  const bodyScanInVerification = verificationTagVariants.some((t) =>
    t.name.startsWith("BODY_SCAN_"),
  );
  console.log(`Verification catalog includes BODY_SCAN tags: ${bodyScanInVerification}`);
  if (!bodyScanInVerification) {
    console.error("FAIL: verification catalog missing BODY_SCAN");
    process.exit(1);
  }

  const apiKey = await resolveApiKey();
  console.log("\nRunning live generation (Haiku)…");
  const result = await generateScriptLabScript({
    apiKey,
    model: CLAUDE_HAIKU_45_MODEL_ID,
    transcript: TRANSCRIPT,
    meditationStyle: MEDITATION_STYLE,
    journalMode: false,
    targetMinutes: 5,
    speechSpeed: 0.95,
    segmentTags,
    generalTagVariants: verificationTagVariants,
  });

  const usedBodyScanTags = result.beats.filter(
    (b) => !b.custom && b.tag?.startsWith("BODY_SCAN_"),
  );
  console.log(`\n(b) BODY_SCAN tags used in final beats: ${usedBodyScanTags.length}`);
  usedBodyScanTags.forEach((b) => console.log(`  - ${b.tag} (${b.beatType})`));

  const beforeTags = new Set(
    result.beatsBeforeVerification
      .filter((b) => !b.custom && b.tag)
      .map((b) => b.tag!),
  );
  const afterTags = new Set(
    result.beats.filter((b) => !b.custom && b.tag).map((b) => b.tag!),
  );
  const verificationAddedBodyScan = [...afterTags].some(
    (t) => t.startsWith("BODY_SCAN_") && !beforeTags.has(t),
  );
  const verificationConverted =
    result.verificationCorrectionsApplied &&
    (verificationAddedBodyScan || usedBodyScanTags.length > 0);

  console.log(`\n(c) Verification corrections applied: ${result.verificationCorrectionsApplied}`);
  console.log(`(c) Verification new beat indices: ${result.verificationNewBeatIndices.join(", ") || "(none)"}`);
  console.log(`(c) BODY_SCAN from verification pass: ${verificationAddedBodyScan || usedBodyScanTags.length > 0}`);

  console.log("\n--- Final beats ---");
  result.beats.forEach((b, i) => console.log(`  ${i}: ${beatTagSummary(b)}`));

  const passB = usedBodyScanTags.length >= 1;
  const passC = verificationConverted || usedBodyScanTags.length >= 1;

  if (!passB) {
    console.error("\nFAIL (b): no BODY_SCAN tag selected during generation");
    process.exit(1);
  }
  if (!passC) {
    console.error("\nFAIL (c): verification did not produce BODY_SCAN tag beats");
    process.exit(1);
  }

  console.log("\nPASS: Body Scan e2e checks (a)(b)(c)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
