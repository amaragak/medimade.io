/**
 * Unit + optional live tests for intelligent placeholder fill.
 *
 * Usage:
 *   npx tsx scripts/test-intelligent-variant-select.ts
 *   LIVE=1 npx tsx scripts/test-intelligent-variant-select.ts   # needs Claude key + AWS library
 */
import {
  buildEligibleOptionsByTagBeat,
  coerceScriptLabBeats,
  selectSegmentVariantsIntelligently,
} from "../lib/script-segment-variant-select-intelligent";
import type { SegmentVariantCandidate } from "../lib/script-segment-variant-select";
import { createSegmentVariantPickerForBeats } from "../lib/script-segment-variant-select";
import type { ScriptLabBeat } from "../lib/script-lab-beats";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const SETTLE_VARIANTS: SegmentVariantCandidate[] = [
  {
    variantId: "echo-settle",
    text: "Settle into a position that feels supported and comfortable.",
  },
  {
    variantId: "breath-settle",
    text: "Let the next breath arrive without forcing anything.",
  },
  {
    variantId: "weight-settle",
    text: "Feel the weight of your body resting where it is.",
  },
];

const TAG_META = {
  lengthTiered: false,
  scope: "general" as const,
  types: [] as string[],
};

function cactusBeats(): ScriptLabBeat[] {
  return [
    {
      beatType: "content",
      custom: true,
      text: "Find a comfortable position, sitting on your cactus stump.",
    },
    { beatType: "pause", custom: false, pauseBand: "medium" },
    { beatType: "settle_opener", custom: false, tag: "SETTLE_OPENER" },
    { beatType: "pause", custom: false, pauseBand: "long" },
    { beatType: "breath_opener", custom: false, tag: "BREATH_OPENER" },
  ];
}

function testEligibleOptions() {
  const beats = cactusBeats();
  const slots = buildEligibleOptionsByTagBeat({
    beats,
    variantsByTag: {
      SETTLE_OPENER: SETTLE_VARIANTS,
      BREATH_OPENER: [
        { variantId: "b1", text: "Notice the breath moving in and out." },
        { variantId: "b2", text: "Follow one easy inhale." },
      ],
    },
    tagMetaByName: {
      SETTLE_OPENER: TAG_META,
      BREATH_OPENER: TAG_META,
    },
    targetMinutes: 5,
  });
  assert(slots.length === 2, `expected 2 tag slots, got ${slots.length}`);
  const settle = slots.find((s) => s.tag === "SETTLE_OPENER");
  assert(settle?.options.length === 3, "SETTLE_OPENER should list all variants");
  console.log("PASS: buildEligibleOptionsByTagBeat");
}

function testAssembleWithPreferredAvoidsEcho() {
  const beats = cactusBeats();
  const variantsByTag = {
    SETTLE_OPENER: SETTLE_VARIANTS,
    BREATH_OPENER: [
      { variantId: "b1", text: "Notice the breath moving in and out." },
      { variantId: "b2", text: "Follow one easy inhale." },
    ],
  };
  const picker = createSegmentVariantPickerForBeats({
    beats,
    variantsByTag,
    tagMetaByName: {
      SETTLE_OPENER: TAG_META,
      BREATH_OPENER: TAG_META,
    },
    targetMinutes: 5,
    preferredVariantIdByBeatIndex: {
      2: "breath-settle",
      4: "b2",
    },
    random: false,
  });
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i]!;
    if (!b.custom && b.tag) picker.pickVariantText(b.tag, i);
  }
  const settleText = SETTLE_VARIANTS.find(
    (v) => v.variantId === picker.picksByBeatIndex[2],
  )?.text;
  assert(settleText?.includes("breath"), `expected non-echo settle, got ${settleText}`);
  assert(
    !/comfortable position/i.test(settleText ?? ""),
    "should not echo comfortable position",
  );
  console.log("PASS: preferred assemble avoids echo wording");
}

function testCoerceBeats() {
  const beats = coerceScriptLabBeats([
    { beatType: "content", custom: true, text: "Hello" },
    { beatType: "pause", pauseBand: "long" },
    { custom: false, tag: "settle_opener", beatType: "settle_opener" },
  ]);
  assert(beats.length === 3, "coerce length");
  assert(beats[2]?.tag === "SETTLE_OPENER", `normalized tag got ${beats[2]?.tag}`);
  console.log("PASS: coerceScriptLabBeats");
}

async function testLiveCactusFill() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("LIVE=1 requires ANTHROPIC_API_KEY or CLAUDE_API_KEY");
  }
  const model =
    process.env.CLAUDE_MODEL?.trim() || "claude-sonnet-4-5-20250929";

  const beats = cactusBeats();
  const variantsByTag = {
    SETTLE_OPENER: SETTLE_VARIANTS,
    BREATH_OPENER: [
      { variantId: "b1", text: "Notice the breath moving in and out." },
      { variantId: "b2", text: "Follow one easy inhale." },
      { variantId: "b3", text: "Allow the breath to find its own pace." },
    ],
  };

  const seenSettle = new Set<string>();
  for (let run = 1; run <= 3; run++) {
    const result = await selectSegmentVariantsIntelligently({
      apiKey,
      model,
      beats,
      transcript:
        "User wants a breath-led meditation while sitting on a cactus stump in the desert.",
      variantsByTag,
      tagMetaByName: {
        SETTLE_OPENER: TAG_META,
        BREATH_OPENER: TAG_META,
      },
      targetMinutes: 5,
    });
    const settleId = result.picksByBeatIndex[2];
    const settleText = SETTLE_VARIANTS.find((v) => v.variantId === settleId)?.text ?? "";
    console.log(`LIVE run ${run}: SETTLE_OPENER=${settleId} — ${settleText}`);
    assert(settleId, "missing settle pick");
    assert(
      !/comfortable position|position that feels supported/i.test(settleText),
      `run ${run}: echo overlap with adjacent custom: ${settleText}`,
    );
    seenSettle.add(settleId!);
  }
  assert(seenSettle.size >= 2, `expected settle picks to vary across 3 runs, got ${[...seenSettle]}`);
  console.log("PASS: live cactus fill avoids echo and varies");
}

async function main() {
  testEligibleOptions();
  testAssembleWithPreferredAvoidsEcho();
  testCoerceBeats();
  if (process.env.LIVE === "1") {
    await testLiveCactusFill();
  } else {
    console.log("SKIP live Sonnet fill (set LIVE=1 to run)");
  }
  console.log("All tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
