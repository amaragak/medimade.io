/**
 * Unit test: random fill filters on imported variant.direction when tour direction known.
 *
 * Usage: npx tsx scripts/test-variant-direction-select.ts
 */
import {
  createSegmentVariantPickerForBeats,
  filterVariantsByDirection,
  inferBodyTourDirectionFromBeats,
  selectSegmentVariant,
  type SegmentVariantCandidate,
} from "../lib/script-segment-variant-select";

const TAG_META = {
  lengthTiered: false,
  scope: "general" as const,
  types: [] as string[],
};

const DIRECTIONAL: SegmentVariantCandidate[] = [
  {
    variantId: "9f918dd3-f0bc-4b14-9a5c-49b590143f97",
    text: "Move your awareness down through your legs, all the way to your feet.",
    direction: "down",
  },
  {
    variantId: "up-1",
    text: "Let your awareness rise up from your feet.",
    direction: "up",
  },
  {
    variantId: "neutral-1",
    text: "Notice your legs, resting or supporting you.",
    direction: "neutral",
  },
];

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function testFilter() {
  const downPool = filterVariantsByDirection(DIRECTIONAL, "down");
  assert(
    downPool.every((v) => v.direction !== "up"),
    "down tour should exclude up",
  );
  assert(
    downPool.some((v) => v.direction === "down"),
    "down tour should keep down",
  );
  assert(
    downPool.some((v) => v.direction === "neutral"),
    "down tour should keep neutral",
  );

  const noMeta = filterVariantsByDirection(
    [{ variantId: "x", text: "plain", direction: null }],
    "down",
  );
  assert(noMeta.length === 1, "no direction metadata → no filter");
  console.log("PASS: filterVariantsByDirection");
}

function testSelect() {
  const pick = selectSegmentVariant({
    variants: DIRECTIONAL,
    tagMeta: TAG_META,
    tagName: "BODY_SCAN_LOWER_BODY",
    targetMinutes: 10,
    tourDirection: "down",
    random: false,
  });
  assert(pick?.direction !== "up", `got opposite direction ${pick?.direction}`);
  assert(
    pick?.direction === "down" || pick?.direction === "neutral",
    `expected down/neutral, got ${pick?.direction}`,
  );
  console.log("PASS: selectSegmentVariant filters on direction");
}

function testPicker() {
  const beats = [
    { beatType: "body_scan_crown", custom: false, tag: "BODY_SCAN_CROWN" },
    {
      beatType: "body_scan_neck_shoulders",
      custom: false,
      tag: "BODY_SCAN_NECK_SHOULDERS",
    },
    {
      beatType: "body_scan_lower_body",
      custom: false,
      tag: "BODY_SCAN_LOWER_BODY",
    },
  ];
  assert(inferBodyTourDirectionFromBeats(beats) === "down", "tour should be down");

  const picker = createSegmentVariantPickerForBeats({
    beats,
    variantsByTag: {
      BODY_SCAN_CROWN: [{ variantId: "c", text: "crown" }],
      BODY_SCAN_NECK_SHOULDERS: DIRECTIONAL,
      BODY_SCAN_LOWER_BODY: DIRECTIONAL,
    },
    tagMetaByName: {
      BODY_SCAN_CROWN: TAG_META,
      BODY_SCAN_NECK_SHOULDERS: TAG_META,
      BODY_SCAN_LOWER_BODY: TAG_META,
    },
    targetMinutes: 10,
    random: false,
  });
  assert(picker.tourDirection === "down", "picker tourDirection");
  const text = picker.pickVariantText("BODY_SCAN_LOWER_BODY", 2);
  assert(
    text === DIRECTIONAL[0]!.text || text === DIRECTIONAL[2]!.text,
    `unexpected fill text: ${text}`,
  );
  console.log("PASS: picker fill filters by tour direction");
}

testFilter();
testSelect();
testPicker();
console.log("All direction selection tests passed.");
