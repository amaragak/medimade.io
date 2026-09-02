/**
 * Length-tier selection bias tests (offline + optional live library).
 *
 * Usage:
 *   npx tsx scripts/test-length-tier-selection.ts
 *   AWS_PROFILE=mm VOICE_ADMIN_TABLE_NAME=... npx tsx scripts/test-length-tier-selection.ts --live
 */
import { listAllScriptSegmentLibrary } from "../lib/script-segment-library";
import type { ScriptLabBeat } from "../lib/script-lab-beats";
import {
  createSegmentVariantPickerForBeats,
  selectSegmentVariant,
  type SegmentTagMeta,
  type SegmentVariantCandidate,
} from "../lib/script-segment-variant-select";
import type { ScriptLengthTier } from "../lib/script-segment-tags";

const BODY_SCAN_BEATS: ScriptLabBeat[] = [
  { beatType: "body_scan_lower_body", custom: false, tag: "BODY_SCAN_LOWER_BODY" },
  { beatType: "body_scan_hips_belly_chest", custom: false, tag: "BODY_SCAN_HIPS_BELLY_CHEST" },
  { beatType: "body_scan_spine_back", custom: false, tag: "BODY_SCAN_SPINE_BACK" },
  { beatType: "body_scan_neck_shoulders", custom: false, tag: "BODY_SCAN_NECK_SHOULDERS" },
  { beatType: "body_scan_face_jaw", custom: false, tag: "BODY_SCAN_FACE_JAW" },
  { beatType: "body_scan_crown", custom: false, tag: "BODY_SCAN_CROWN" },
];

const MOCK_BODY_SCAN_VARIANTS: SegmentVariantCandidate[] = [
  { variantId: "bs-short", text: "short body scan", lengthTier: "short" },
  { variantId: "bs-medium", text: "medium body scan", lengthTier: "medium" },
  { variantId: "bs-long", text: "long body scan", lengthTier: "long" },
];

const MOCK_PACE_VARIANTS: SegmentVariantCandidate[] = [
  { variantId: "pace-short", text: "short pace", lengthTier: "short" },
  { variantId: "pace-medium", text: "medium pace", lengthTier: "medium" },
  { variantId: "pace-long", text: "long pace", lengthTier: "long" },
];

const LENGTH_TIERED_META: SegmentTagMeta = {
  lengthTiered: true,
  scope: "types",
  types: ["body_scan"],
};

function tierCounts(runs: number, tierOf: () => ScriptLengthTier | null | undefined): Record<string, number> {
  const counts: Record<string, number> = { short: 0, medium: 0, long: 0, other: 0 };
  for (let i = 0; i < runs; i++) {
    const tier = tierOf() ?? "other";
    counts[tier] = (counts[tier] ?? 0) + 1;
  }
  return counts;
}

function testBodyScanBiasedAt20Min() {
  const runs = 4000;
  const counts = tierCounts(runs, () =>
    selectSegmentVariant({
      variants: MOCK_BODY_SCAN_VARIANTS,
      tagMeta: LENGTH_TIERED_META,
      tagName: "BODY_SCAN_SPINE_BACK",
      beatType: "body_scan_spine_back",
      targetMinutes: 20,
    })?.lengthTier ?? null,
  );

  const shortRate = counts.short / runs;
  const mediumLongRate = (counts.medium + counts.long) / runs;
  console.log(`20min BODY_SCAN tier distribution (${runs} picks):`, counts);
  console.log(`  short rate: ${(shortRate * 100).toFixed(1)}% (expect <25%)`);
  console.log(`  medium+long: ${(mediumLongRate * 100).toFixed(1)}% (expect >75%)`);

  if (shortRate >= 0.25) {
    throw new Error(`FAIL: BODY_SCAN short rate too high at 20min (${(shortRate * 100).toFixed(1)}%)`);
  }
  if (mediumLongRate <= 0.75) {
    throw new Error(`FAIL: BODY_SCAN medium+long rate too low at 20min`);
  }
  console.log("PASS: BODY_SCAN biased toward medium/long at 20min\n");
}

function testPaceUnbiasedAt20Min() {
  const runs = 4000;
  const counts = tierCounts(runs, () =>
    selectSegmentVariant({
      variants: MOCK_PACE_VARIANTS,
      tagMeta: LENGTH_TIERED_META,
      tagName: "PACE_REASSURANCE",
      beatType: "pace_reassurance",
      targetMinutes: 20,
    })?.lengthTier ?? null,
  );

  const shortRate = counts.short / runs;
  console.log(`20min PACE_REASSURANCE tier distribution (${runs} picks):`, counts);
  console.log(`  short rate: ${(shortRate * 100).toFixed(1)}% (expect ~33% uniform)`);

  if (shortRate < 0.22 || shortRate > 0.44) {
    throw new Error(
      `FAIL: PACE_REASSURANCE should stay roughly uniform at 20min (${(shortRate * 100).toFixed(1)}%)`,
    );
  }
  console.log("PASS: transitional tag stays uniform at 20min\n");
}

function testMultiRegionEvenness() {
  const runs = 500;
  const shortByTag = new Map<string, number>();
  const picksByTag = new Map<string, number>();

  for (const beat of BODY_SCAN_BEATS) {
    if (beat.tag) {
      shortByTag.set(beat.tag, 0);
      picksByTag.set(beat.tag, 0);
    }
  }

  let lopsidedRuns = 0;

  for (let run = 0; run < runs; run++) {
    const variantsByTag: Record<string, SegmentVariantCandidate[]> = {};
    const tagMetaByName: Record<string, SegmentTagMeta> = {};
    for (const beat of BODY_SCAN_BEATS) {
      if (!beat.tag) continue;
      variantsByTag[beat.tag] = MOCK_BODY_SCAN_VARIANTS;
      tagMetaByName[beat.tag] = LENGTH_TIERED_META;
    }

    const picker = createSegmentVariantPickerForBeats({
      beats: BODY_SCAN_BEATS,
      variantsByTag,
      tagMetaByName,
      targetMinutes: 20,
      meditationType: "Body scan",
      contextTags: [],
    });

    const tiersThisRun: ScriptLengthTier[] = [];
    for (let i = 0; i < BODY_SCAN_BEATS.length; i++) {
      const beat = BODY_SCAN_BEATS[i]!;
      if (!beat.tag) continue;
      picker.pickVariantText(beat.tag, i);
      const variantId = picker.picksByTag[beat.tag];
      const variant = MOCK_BODY_SCAN_VARIANTS.find((v) => v.variantId === variantId);
      const tier = variant?.lengthTier ?? "medium";
      tiersThisRun.push(tier);
      picksByTag.set(beat.tag, (picksByTag.get(beat.tag) ?? 0) + 1);
      if (tier === "short") {
        shortByTag.set(beat.tag, (shortByTag.get(beat.tag) ?? 0) + 1);
      }
    }

    const shortCount = tiersThisRun.filter((t) => t === "short").length;
    const nonShortCount = tiersThisRun.length - shortCount;
    if (shortCount === 1 && nonShortCount >= 3) {
      lopsidedRuns += 1;
    }
  }

  console.log(`Multi-region 20min body scan (${runs} simulated scripts):`);
  const shortRates: number[] = [];
  for (const [tag, shortCount] of shortByTag) {
    const total = picksByTag.get(tag) ?? 1;
    const rate = shortCount / total;
    shortRates.push(rate);
    console.log(`  ${tag}: short ${(rate * 100).toFixed(1)}%`);
  }

  const maxShort = Math.max(...shortRates);
  const minShort = Math.min(...shortRates);
  const spread = maxShort - minShort;
  console.log(`  short-rate spread across regions: ${(spread * 100).toFixed(1)}pp`);
  console.log(`  lopsided runs (1 short + 3+ longer): ${lopsidedRuns}/${runs}`);

  if (maxShort > 0.35) {
    throw new Error(`FAIL: a body region still picks short too often (max ${(maxShort * 100).toFixed(1)}%)`);
  }
  if (spread > 0.2) {
    throw new Error(`FAIL: uneven short rates across regions (spread ${(spread * 100).toFixed(1)}pp)`);
  }
  console.log("PASS: multi-region tier distribution is even\n");
}

async function testLiveLibraryIfRequested() {
  if (!process.argv.includes("--live")) return;

  const library = await listAllScriptSegmentLibrary();
  const bodyScanTags = library.tags.filter(
    (t) => t.name.startsWith("BODY_SCAN_") && t.lengthTiered,
  );
  if (bodyScanTags.length === 0) {
    console.log("SKIP live: no length-tiered BODY_SCAN tags in library");
    return;
  }

  const runs = 3;
  console.log(`Live: ${runs}× 20min body-scan render simulations from library (${bodyScanTags.length} tags)…`);

  for (let run = 1; run <= runs; run++) {
    const beats: ScriptLabBeat[] = bodyScanTags.map((t) => ({
      beatType: t.name.toLowerCase(),
      custom: false,
      tag: t.name,
    }));

    const variantsByTag: Record<string, SegmentVariantCandidate[]> = {};
    const tagMetaByName: Record<string, SegmentTagMeta> = {};
    for (const t of bodyScanTags) {
      variantsByTag[t.name] = (library.variantsByTag[t.name] ?? []).map((v) => ({
        variantId: v.variantId,
        text: v.text,
        lengthTier: v.lengthTier,
        requiredConstraints: v.requiredConstraints,
        excludedConstraints: v.excludedConstraints,
      }));
      tagMetaByName[t.name] = {
        lengthTiered: t.lengthTiered,
        scope: t.scope,
        types: t.types,
      };
    }

    const picker = createSegmentVariantPickerForBeats({
      beats,
      variantsByTag,
      tagMetaByName,
      targetMinutes: 20,
      meditationType: "Body scan",
      contextTags: [],
    });

    const tiers: string[] = [];
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i]!;
      if (!beat.tag) continue;
      picker.pickVariantText(beat.tag, i);
      const vid = picker.picksByTag[beat.tag];
      const variant = variantsByTag[beat.tag]?.find((v) => v.variantId === vid);
      tiers.push(`${beat.tag}:${variant?.lengthTier ?? "?"}`);
    }

    const shortCount = tiers.filter((t) => t.endsWith(":short")).length;
    console.log(`  run ${run}: ${shortCount}/${tiers.length} regions short`);
    tiers.forEach((line) => console.log(`    ${line}`));

    if (shortCount > Math.ceil(tiers.length * 0.4)) {
      throw new Error(`FAIL live run ${run}: too many short body-region picks`);
    }
  }
  console.log("PASS: live library simulations\n");
}

async function main() {
  testBodyScanBiasedAt20Min();
  testPaceUnbiasedAt20Min();
  testMultiRegionEvenness();
  await testLiveLibraryIfRequested();
  console.log("All length-tier selection tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
