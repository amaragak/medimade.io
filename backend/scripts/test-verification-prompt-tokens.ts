/**
 * Compare verification prompt input-token size before vs after tag-card optimization.
 * Builds both prompt shapes offline against the live library (or a fixture).
 *
 * Usage:
 *   VOICE_ADMIN_TABLE_NAME=... AWS_PROFILE=mm npx tsx scripts/test-verification-prompt-tokens.ts
 *   ANTHROPIC_API_KEY=... VOICE_ADMIN_TABLE_NAME=... AWS_PROFILE=mm npx tsx scripts/test-verification-prompt-tokens.ts --count
 */
import {
  anthropicCountMessageInputTokens,
  CLAUDE_SONNET_45_MODEL_ID,
} from "../lib/anthropic-pricing";
import {
  buildVerificationPrompt,
  buildVerificationSentenceList,
  condenseTranscriptForVerification,
  prepareGeneralTagsForVerification,
  type GeneralTagVariantCatalog,
  type VerificationTagCard,
  type VerificationSentence,
} from "../lib/script-lab-beat-verification";
import { tagNameToBeatType, type ScriptLabBeat } from "../lib/script-lab-beats";
import { listAllScriptSegmentLibrary } from "../lib/script-segment-library";

const TRANSCRIPT = [
  "User: linger on lower back",
  "Guide: Where in your body are you holding the most tension?",
  "User: lower back tension",
  "Guide: What would you like to feel by the end?",
  "User: relief",
  "Guide: Anything else?",
  "User: seated or lying",
].join("\n\n");

const FIXTURE_BEATS: ScriptLabBeat[] = [
  {
    beatType: "content",
    custom: true,
    text:
      "And as you exhale, let yourself arrive fully here. [[PAUSE short]] There is nowhere to rush, nowhere to be except right now.",
  },
  {
    beatType: "content",
    custom: true,
    text:
      "Now bring your full awareness to your lower back. This is where you've been feeling that tension and discomfort. Don't try to change it yet—just notice it.",
  },
];

/** Legacy full-variant prompt shape (pre-optimization) for token comparison only. */
function buildLegacyVerificationPrompt(params: {
  transcript: string;
  sentences: VerificationSentence[];
  generalTags: GeneralTagVariantCatalog[];
}): { system: string; userContent: string } {
  const tagCatalog = params.generalTags
    .map((t) => {
      const lines = [`### ${t.name} (beatType: ${tagNameToBeatType(t.name)})`];
      for (const v of t.variants) {
        lines.push(`- [${v.variantId}] "${v.text}"`);
      }
      return lines.join("\n");
    })
    .join("\n\n");

  const sentencesJson = JSON.stringify(
    params.sentences.map((s) => ({
      sentenceIndex: s.globalIndex,
      sourceBeatIndex: s.beatIndex,
      sentenceIndexInBeat: s.sentenceIndexInBeat,
      beatType: s.beatType,
      text: s.prose,
    })),
    null,
    2,
  );

  return {
    system: "legacy verification system prompt (approx)",
    userContent: [
      "### Creator conversation (personalization check)",
      params.transcript.trim(),
      "",
      "### Numbered custom-beat sentences",
      sentencesJson,
      "",
      "### Tag library (all scopes) — ALL variant texts with ids",
      tagCatalog,
    ].join("\n"),
  };
}

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function main() {
  const meditationType = "Body scan";
  const contextTags = ["seated_or_lying"];

  let raw: GeneralTagVariantCatalog[] = [];
  if (process.env.VOICE_ADMIN_TABLE_NAME) {
    const lib = await listAllScriptSegmentLibrary();
    raw = lib.tags
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
  } else {
    console.warn("VOICE_ADMIN_TABLE_NAME unset — using tiny fixture catalog");
    raw = [
      {
        name: "PACE_REASSURANCE",
        scope: "general",
        types: [],
        variants: Array.from({ length: 20 }, (_, i) => ({
          variantId: `pr-${i}`,
          text: `Pace reassurance variant number ${i}: there's no rush, nowhere else you need to be right now.`,
        })),
      },
      {
        name: "MOVEMENT_WITNESS",
        scope: "types",
        types: ["Movement meditation"],
        variants: [
          { variantId: "mw-1", text: "Notice the quality of each movement." },
        ],
      },
      {
        name: "BODY_SCAN_LOWER_BODY",
        scope: "types",
        types: ["Body scan"],
        variants: [
          { variantId: "blb-1", text: "Bring attention into the legs and feet." },
          { variantId: "blb-2", text: "Sense the weight of the lower body." },
        ],
      },
    ];
  }

  const sentences = buildVerificationSentenceList(FIXTURE_BEATS);
  const cards = prepareGeneralTagsForVerification(raw, {
    meditationType,
    contextTags,
  });

  const legacy = buildLegacyVerificationPrompt({
    transcript: TRANSCRIPT,
    sentences,
    generalTags: raw,
  });
  const optimized = buildVerificationPrompt({
    transcript: TRANSCRIPT,
    sentences,
    generalTags: cards,
  });

  const legacyChars = legacy.system.length + legacy.userContent.length;
  const optChars = optimized.system.length + optimized.userContent.length;

  console.log("=== Verification prompt size ===");
  console.log(`Raw library tags: ${raw.length}`);
  console.log(`Filtered tag cards: ${cards.length}`);
  console.log(
    `Body scan cards exclude MOVEMENT_WITNESS: ${!cards.some((c) => c.name === "MOVEMENT_WITNESS")}`,
  );
  console.log(
    `Condensed transcript chars: ${condenseTranscriptForVerification(TRANSCRIPT).length} (full ${TRANSCRIPT.length})`,
  );
  console.log(`Legacy prompt chars: ${legacyChars} (~${approxTokens(legacy.system + legacy.userContent)} tok)`);
  console.log(`Optimized prompt chars: ${optChars} (~${approxTokens(optimized.system + optimized.userContent)} tok)`);
  console.log(
    `Reduction: ${(((legacyChars - optChars) / legacyChars) * 100).toFixed(1)}% chars`,
  );

  if (process.argv.includes("--count")) {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      console.error("--count requires ANTHROPIC_API_KEY");
      process.exit(1);
    }
    const [legacyTok, optTok] = await Promise.all([
      anthropicCountMessageInputTokens({
        apiKey,
        model: CLAUDE_SONNET_45_MODEL_ID,
        system: legacy.system,
        messages: [{ role: "user", content: legacy.userContent }],
      }),
      anthropicCountMessageInputTokens({
        apiKey,
        model: CLAUDE_SONNET_45_MODEL_ID,
        system: optimized.system,
        messages: [{ role: "user", content: optimized.userContent }],
      }),
    ]);
    console.log("\n=== Anthropic count_tokens ===");
    console.log(`Legacy input tokens: ${legacyTok}`);
    console.log(`Optimized input tokens: ${optTok}`);
    if (legacyTok && optTok) {
      console.log(
        `Reduction: ${(((legacyTok - optTok) / legacyTok) * 100).toFixed(1)}%`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
