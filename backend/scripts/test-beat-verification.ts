/**
 * Verification pass tests: sentence split, determinism (3 runs), fixture coverage.
 * Usage:
 *   ANTHROPIC_API_KEY=... tsx scripts/test-beat-verification.ts
 *   tsx scripts/test-beat-verification.ts --dry-run
 *   VOICE_ADMIN_TABLE_NAME=... AWS_PROFILE=mm tsx scripts/test-beat-verification.ts --live-library
 */
import { listAllScriptSegmentLibrary } from "../lib/script-segment-library";
import {
  buildVerificationPrompt,
  buildVerificationSentenceList,
  prepareGeneralTagsForVerification,
  splitCustomBeatTextIntoSentences,
  verifyScriptLabBeats,
  type GeneralTagVariantCatalog,
  type SentenceVerdict,
} from "../lib/script-lab-beat-verification";
import type { ScriptLabBeat } from "../lib/script-lab-beats";

const TRANSCRIPT = [
  "User: I've been dealing with a lot of tension in my lower back lately.",
  "Guide: Let's create a body-scan meditation focused on that area.",
].join("\n");

/** Lower-back diagnostic fixture from live testing. */
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
      "Now bring your full awareness to your lower back. This is where you've been feeling that tension and discomfort. Don't try to change it yet—just notice it. Notice the quality of the sensations there. Is it tight, achy, warm, cool? Simply observe with curiosity.",
  },
  {
    beatType: "content",
    custom: true,
    text: "There is nowhere to rush. Just stay with what you notice.",
  },
  {
    beatType: "settle_opener",
    custom: true,
    text: "Find a comfortable position, sitting beneath your tree",
  },
];

function verdictKey(verdicts: SentenceVerdict[]): string {
  return JSON.stringify(
    [...verdicts]
      .sort((a, b) => a.sentenceIndex - b.sentenceIndex)
      .map((v) => ({
        i: v.sentenceIndex,
        v: v.verdict,
        t: v.matchedTag ?? null,
        c: v.confidence,
      })),
  );
}

function beatSummary(b: ScriptLabBeat): string {
  if (b.beatType === "pause") return `pause:${b.pauseBand ?? "?"}`;
  if (!b.custom && b.tag) return `tag:${b.tag}`;
  return `custom(${b.beatType}): ${(b.text ?? "").slice(0, 90)}`;
}

async function loadGeneralTags(useLiveLibrary: boolean): Promise<GeneralTagVariantCatalog[]> {
  if (useLiveLibrary && process.env.VOICE_ADMIN_TABLE_NAME) {
    const lib = await listAllScriptSegmentLibrary();
    return lib.tags
      .map((t) => ({
        name: t.name,
        variants: (lib.variantsByTag[t.name] ?? []).map((v) => ({
          variantId: v.variantId,
          text: v.text,
        })),
      }))
      .filter((t) => t.variants.length > 0);
  }

  return prepareGeneralTagsForVerification([
    {
      name: "PACE_REASSURANCE",
      variants: [
        { variantId: "pr-1", text: "Continue naturally at your own pace." },
        { variantId: "pr-2", text: "There's no rush here." },
        { variantId: "pr-3", text: "Take whatever time you need with this." },
        { variantId: "pr-4", text: "Stay with this for as long as feels right." },
        { variantId: "pr-5", text: "Move through this gently, in your own time." },
        { variantId: "pr-6", text: "There's nowhere else you need to be right now." },
      ],
    },
    {
      name: "BREATH_TRANSITION",
      variants: [
        {
          variantId: "bt-1",
          text: "And as you exhale, let yourself arrive fully here.",
        },
      ],
    },
  ]);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const useLiveLibrary = process.argv.includes("--live-library");

  console.log("=== Sentence pre-split (beat 0) ===");
  const beat0Parts = splitCustomBeatTextIntoSentences(FIXTURE_BEATS[0]!.text!);
  beat0Parts.forEach((p, i) => {
    console.log(
      `  ${i}: "${p.prose}" pauses=[${p.trailingPauseBands.join(", ")}]`,
    );
  });

  const sentences = buildVerificationSentenceList(FIXTURE_BEATS);
  console.log(`\nTotal sentences across fixture: ${sentences.length}`);

  const generalTags = await loadGeneralTags(useLiveLibrary);
  const pace = generalTags.find((t) => t.name === "PACE_REASSURANCE");
  console.log(`PACE_REASSURANCE variants in prompt: ${pace?.variants.length ?? 0}`);

  const prompt = buildVerificationPrompt({
    transcript: TRANSCRIPT,
    sentences,
    generalTags,
  });
  console.log("\nPrompt uses numbered sentences:", prompt.userContent.includes("sentenceIndex"));
  console.log("Prompt includes full variant ids:", prompt.userContent.includes("variantId") || prompt.userContent.includes("[pr-") || prompt.userContent.includes("["));

  if (dryRun) {
    console.log("\n(dry-run — skipping live Sonnet calls)");
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.error("Set ANTHROPIC_API_KEY or pass --dry-run");
    process.exit(1);
  }

  const runResults: Array<{
    run: number;
    verdicts: SentenceVerdict[];
    beats: ScriptLabBeat[];
    newBeatIndices: number[];
  }> = [];

  for (let run = 1; run <= 3; run++) {
    const result = await verifyScriptLabBeats({
      apiKey,
      transcript: TRANSCRIPT,
      beatsBefore: FIXTURE_BEATS,
      generalTags,
    });
    runResults.push({
      run,
      verdicts: result.sentenceVerdicts,
      beats: result.beats,
      newBeatIndices: result.newBeatIndices,
    });
    console.log(`\n=== Run ${run} ===`);
    console.log("correctionsApplied:", result.correctionsApplied);
    console.log("newBeatIndices:", result.newBeatIndices);
    result.sentenceVerdicts.forEach((v) => {
      const s = sentences.find((x) => x.globalIndex === v.sentenceIndex);
      console.log(
        `  [${v.sentenceIndex}] ${v.verdict}${v.matchedTag ? ` → ${v.matchedTag}` : ""} (${v.confidence}) — "${s?.prose.slice(0, 60)}…"`,
      );
    });
    result.beats.forEach((b, i) => {
      const mark = result.newBeatIndices.includes(i) ? " *" : "";
      console.log(`  beat ${i + 1}${mark}: ${beatSummary(b)}`);
    });
  }

  const keys = runResults.map((r) => verdictKey(r.verdicts));
  const deterministic = keys[0] === keys[1] && keys[1] === keys[2];
  console.log("\n=== Determinism (3 runs) ===");
  console.log(deterministic ? "PASS — identical verdicts" : "FAIL — verdicts differ");
  if (!deterministic) {
    keys.forEach((k, i) => console.log(`  run ${i + 1} hash: ${k.slice(0, 120)}…`));
  }

  const last = runResults[2]!;
  const nowhereVerdicts = last.verdicts.filter((v) => {
    const s = sentences[v.sentenceIndex];
    return s?.prose.toLowerCase().includes("nowhere to rush");
  });
  console.log("\n=== 'nowhere to rush' sentences ===");
  nowhereVerdicts.forEach((v) => {
    console.log(`  index ${v.sentenceIndex}: ${v.verdict} ${v.matchedTag ?? ""} (${v.confidence})`);
  });

  const lowerBackVerdicts = last.verdicts.filter((v) => {
    const s = sentences[v.sentenceIndex];
    return s?.beatIndex === 1;
  });
  console.log("\n=== Lower-back mixed beat (beat index 1) ===");
  lowerBackVerdicts.forEach((v) => {
    const s = sentences[v.sentenceIndex]!;
    console.log(`  "${s.prose.slice(0, 55)}…" → ${v.verdict}${v.matchedTag ? ` ${v.matchedTag}` : ""}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
