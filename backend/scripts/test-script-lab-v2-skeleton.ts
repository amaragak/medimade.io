/**
 * Unit tests for V2 skeleton validation (no live LLM).
 * Usage: npx tsx scripts/test-script-lab-v2-skeleton.ts
 */
import {
  defaultFocusAnchorDepth,
  extractAdditionalContextFromTranscript,
  fillMissingTagVariantTexts,
  restoreRenderedVariantText,
  validateSkeleton,
  type SkeletonBeat,
} from "../lib/script-lab-generate-v2";
import type { ScriptLabBeat } from "../lib/script-lab-beats";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const OPENING: SkeletonBeat[] = [
  { kind: "tag", tag: "SETTLE_OPENER", tier: "short" },
  { kind: "pause", band: "short" },
  { kind: "tag", tag: "BREATH_OPENER", tier: "short" },
  { kind: "pause", band: "medium" },
];

const CLOSING: SkeletonBeat[] = [
  { kind: "tag", tag: "CLOSE_DEEPEN_BREATH", tier: "medium" },
  { kind: "pause", band: "medium" },
  { kind: "tag", tag: "CLOSE_SENSORY_RETURN", tier: "medium" },
  { kind: "pause", band: "medium" },
  { kind: "tag", tag: "CLOSE_EYES_OPEN", tier: "short" },
  { kind: "pause", band: "short" },
  { kind: "tag", tag: "CLOSE_SENDOFF", tier: "short" },
];

function testValid() {
  const skeleton: SkeletonBeat[] = [
    ...OPENING,
    { kind: "tag", tag: "BODY_SCAN_LOWER_BODY", tier: "long", direction: "up" },
    { kind: "focus_anchor", region: "lower back", depth: "deep" },
    { kind: "pause", band: "long" },
    ...CLOSING,
  ];
  const res = validateSkeleton({
    skeleton,
    tagRepeatabilityByName: {
      SETTLE_OPENER: "singular",
      BREATH_OPENER: "singular",
      BODY_SCAN_LOWER_BODY: "singular",
      CLOSE_DEEPEN_BREATH: "singular",
      CLOSE_SENSORY_RETURN: "singular",
      CLOSE_EYES_OPEN: "singular",
      CLOSE_SENDOFF: "singular",
    },
    requireFocusAnchor: true,
  });
  assert(res.ok, `expected ok, got ${JSON.stringify(res)}`);
  console.log("PASS: valid skeleton");
}

function testDuplicateSingular() {
  const skeleton: SkeletonBeat[] = [
    ...OPENING,
    { kind: "tag", tag: "BODY_SCAN_LOWER_BODY", tier: "long" },
    { kind: "tag", tag: "BODY_SCAN_LOWER_BODY", tier: "medium" },
    ...CLOSING,
  ];
  const res = validateSkeleton({
    skeleton,
    tagRepeatabilityByName: { BODY_SCAN_LOWER_BODY: "singular" },
    requireFocusAnchor: false,
  });
  assert(!res.ok, "expected fail");
  assert(
    !res.ok && res.errors.some((e) => e.includes("BODY_SCAN_LOWER_BODY")),
    "expected duplicate error",
  );
  console.log("PASS: duplicate singular rejected");
}

function testFocusRequired() {
  const skeleton: SkeletonBeat[] = [...OPENING, ...CLOSING];
  const res = validateSkeleton({
    skeleton,
    tagRepeatabilityByName: {},
    requireFocusAnchor: true,
  });
  assert(!res.ok, "expected focus required fail");
  console.log("PASS: focus_anchor required when implied");
}

function testDepthDefaults() {
  assert(defaultFocusAnchorDepth(2) === "light", "2m");
  assert(defaultFocusAnchorDepth(5) === "medium", "5m");
  assert(defaultFocusAnchorDepth(10) === "deep", "10m");
  assert(defaultFocusAnchorDepth(20) === "deep", "20m");
  console.log("PASS: focus depth defaults");
}

function testRestoreRenderedVariantText() {
  const rendered: ScriptLabBeat[] = [
    { beatType: "settle_opener", custom: false, tag: "SETTLE_OPENER", text: "Locked settle A." },
    { beatType: "pause", custom: false, pauseBand: "medium" },
    { beatType: "breath_opener", custom: false, tag: "BREATH_OPENER", text: "Locked breath B." },
  ];
  const afterPass2: ScriptLabBeat[] = [
    { beatType: "settle_opener", custom: false, tag: "SETTLE_OPENER" },
    { beatType: "content", custom: true, text: "Personalized cactus stump." },
    { beatType: "breath_opener", custom: false, tag: "BREATH_OPENER" },
  ];
  const restored = restoreRenderedVariantText(afterPass2, rendered);
  assert(restored[0]?.text === "Locked settle A.", "settle text restored");
  assert(restored[1]?.text === "Personalized cactus stump.", "custom preserved");
  assert(restored[2]?.text === "Locked breath B.", "breath text restored");
  console.log("PASS: restoreRenderedVariantText keeps Pass-1 picks");
}

function testFillMissingFromLiveLibrary() {
  const variantsByTag = {
    BODY_SOFTEN_CUE: [
      { variantId: "soft-1", text: "Let the shoulders soften a little." },
    ],
    BREATH_GATHER: [
      { variantId: "gather-1", text: "Each breath is one small point of gathering." },
    ],
  };
  const beats: ScriptLabBeat[] = [
    { beatType: "body_soften_cue", custom: false, tag: "BODY_SOFTEN_CUE" },
    {
      beatType: "breath_gather",
      custom: false,
      tag: "BREATH_GATHER",
      text: "[[SEG:BREATH_GATHER]]",
    },
  ];
  const filled = fillMissingTagVariantTexts({
    beats,
    variantsByTag,
    tagMetaByName: {},
    targetMinutes: 20,
    meditationType: "Breathing",
    contextTags: [],
  });
  assert(
    filled[0]?.text === "Let the shoulders soften a little.",
    `BODY_SOFTEN_CUE filled, got ${filled[0]?.text}`,
  );
  assert(
    filled[1]?.text === "Each breath is one small point of gathering.",
    `BREATH_GATHER filled, got ${filled[1]?.text}`,
  );
  assert(
    !filled.some((b) => (b.text ?? "").includes("[[SEG:")),
    "no SEG placeholders remain",
  );
  console.log("PASS: fillMissingTagVariantTexts uses live library for any tag");
}

function testExtractAdditionalContext() {
  const transcript = [
    "Guide: We'll shape a Breath-led meditation from your answers.",
    "",
    "Guide: Do you want counted breaths, or to follow the breath as it is?",
    "",
    "User: long-then-natural",
    "",
    "Guide: How do you feel right now—wired, tired, scattered, something else?",
    "",
    "User: scattered",
    "",
    "Guide: Do you want a slow, long breath, or to keep a natural pace?",
    "",
    "User: natural",
    "",
    "Guide: Anything else you would like to add?",
    "",
    "User: sitting on a cactus",
  ].join("\n");
  const extra = extractAdditionalContextFromTranscript(transcript);
  assert(extra === "sitting on a cactus", `got "${extra}"`);
  assert(extractAdditionalContextFromTranscript("no extra") === "", "empty when missing");
  console.log("PASS: extractAdditionalContextFromTranscript");
}

function testSleepValid() {
  const skeleton: SkeletonBeat[] = [
    ...OPENING,
    { kind: "tag", tag: "SLEEP_HEAVINESS", tier: "medium" },
    { kind: "tag", tag: "SLEEP_PERMISSION_DRIFT", tier: "medium" },
    { kind: "pause", band: "long" },
    { kind: "tag", tag: "SLEEP_THRESHOLD", tier: "medium" },
    { kind: "pause", band: "extra-long" },
    { kind: "tag", tag: "SLEEP_CLOSE", tier: "short" },
  ];
  const res = validateSkeleton({
    skeleton,
    tagRepeatabilityByName: {
      SETTLE_OPENER: "singular",
      BREATH_OPENER: "singular",
      SLEEP_HEAVINESS: "connective",
      SLEEP_PERMISSION_DRIFT: "connective",
      SLEEP_THRESHOLD: "singular",
      SLEEP_CLOSE: "singular",
    },
    requireFocusAnchor: false,
    meditationType: "Sleep",
  });
  assert(res.ok, `expected sleep ok, got ${JSON.stringify(res)}`);
  console.log("PASS: valid Sleep skeleton");
}

function testSleepRejectsWakingClose() {
  const skeleton: SkeletonBeat[] = [
    ...OPENING,
    { kind: "tag", tag: "SLEEP_HEAVINESS", tier: "medium" },
    ...CLOSING,
  ];
  const res = validateSkeleton({
    skeleton,
    tagRepeatabilityByName: {},
    requireFocusAnchor: false,
    meditationType: "Sleep",
  });
  assert(!res.ok, "expected sleep CLOSE_* rejection");
  assert(
    !res.ok && res.errors.some((e) => e.includes("CLOSE_DEEPEN_BREATH")),
    "expected waking close tag error",
  );
  console.log("PASS: Sleep skeleton rejects CLOSE_* tags");
}

function testSleepRejectsBadClosing() {
  const skeleton: SkeletonBeat[] = [
    ...OPENING,
    { kind: "tag", tag: "SLEEP_THRESHOLD", tier: "medium" },
    { kind: "pause", band: "long" },
    { kind: "tag", tag: "SLEEP_CLOSE", tier: "short" },
  ];
  const res = validateSkeleton({
    skeleton,
    tagRepeatabilityByName: {},
    requireFocusAnchor: false,
    meditationType: "Sleep",
  });
  assert(!res.ok, "expected bad sleep closing fail");
  assert(
    !res.ok && res.errors.some((e) => e.includes("extra-long")),
    "expected extra-long pause requirement",
  );
  console.log("PASS: Sleep closing requires extra-long pause");
}

testValid();
testSleepValid();
testSleepRejectsWakingClose();
testSleepRejectsBadClosing();
testDuplicateSingular();
testFocusRequired();
testDepthDefaults();
testRestoreRenderedVariantText();
testFillMissingFromLiveLibrary();
testExtractAdditionalContext();
console.log("All V2 skeleton unit tests passed.");
