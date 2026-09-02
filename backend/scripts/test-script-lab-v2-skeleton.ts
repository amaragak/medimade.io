/**
 * Unit tests for V2 skeleton validation (no live LLM).
 * Usage: npx tsx scripts/test-script-lab-v2-skeleton.ts
 */
import {
  defaultFocusAnchorDepth,
  validateSkeleton,
  type SkeletonBeat,
} from "../lib/script-lab-generate-v2";

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

testValid();
testDuplicateSingular();
testFocusRequired();
testDepthDefaults();
console.log("All V2 skeleton unit tests passed.");
