/**
 * Cross-session Script Lab variant repeat-avoidance tests.
 *
 * Usage:
 *   npx tsx scripts/test-script-lab-recent-variants.ts
 *   AWS_PROFILE=mm VOICE_ADMIN_TABLE_NAME=... npx tsx scripts/test-script-lab-recent-variants.ts --live
 */
import {
  applyCrossSessionRecencyPreference,
  listEligibleSegmentVariants,
  selectSegmentVariant,
  type SegmentVariantCandidate,
} from "../lib/script-segment-variant-select";
import {
  appendScriptLabRecentVariantIds,
  loadScriptLabRecentVariantIds,
  mergeRecentVariantIds,
  SCRIPT_LAB_RECENT_VARIANTS_CAP,
} from "../lib/script-lab-recent-variants";
import { listAllScriptSegmentLibrary } from "../lib/script-segment-library";
import { buildScriptLabContextTags } from "../lib/script-constraint-tags";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function testMergeRecentVariantIds() {
  const merged = mergeRecentVariantIds(["b", "c"], ["a", "b"], 200);
  assert(merged[0] === "a" && merged[1] === "b" && merged[2] === "c", "prepend + dedupe");
  const capped = mergeRecentVariantIds(
    Array.from({ length: 200 }, (_, i) => `old-${i}`),
    ["new"],
    SCRIPT_LAB_RECENT_VARIANTS_CAP,
  );
  assert(capped.length === 200 && capped[0] === "new", "cap at 200");
  console.log("PASS: mergeRecentVariantIds");
}

function testRecencyPreference() {
  const pool: SegmentVariantCandidate[] = [
    { variantId: "a", text: "A" },
    { variantId: "b", text: "B" },
    { variantId: "c", text: "C" },
  ];
  const unheard = applyCrossSessionRecencyPreference(pool, ["a", "b"]);
  assert(
    unheard.every((v) => v.variantId === "c"),
    "prefers unheard variant",
  );
  const lru = applyCrossSessionRecencyPreference(pool, ["a", "b", "c"]);
  assert(lru.length === 1 && lru[0]!.variantId === "c", "LRU when all heard");
  console.log("PASS: applyCrossSessionRecencyPreference");
}

function testSelectNeverFailsWhenAllRecent() {
  const variants: SegmentVariantCandidate[] = [
    { variantId: "only", text: "Only option" },
  ];
  const picked = selectSegmentVariant({
    variants,
    targetMinutes: 5,
    recentVariantIds: ["only"],
    random: false,
  });
  assert(picked?.variantId === "only", "must still pick when only eligible is recent");
  console.log("PASS: never exclude when all recent");
}

async function testSettleOpenerRotationOffline() {
  if (!process.env.VOICE_ADMIN_TABLE_NAME?.trim()) {
    console.log("SKIP settle rotation offline (set VOICE_ADMIN_TABLE_NAME)");
    return;
  }
  const library = await listAllScriptSegmentLibrary();
  const tagMeta = library.tags.find((t) => t.name === "SETTLE_OPENER");
  assert(tagMeta, "SETTLE_OPENER tag exists");
  const variants = (library.variantsByTag.SETTLE_OPENER ?? []).map((v) => ({
    variantId: v.variantId,
    text: v.text,
    lengthTier: v.lengthTier,
    direction: v.direction ?? null,
    requiredConstraints: v.requiredConstraints,
    excludedConstraints: v.excludedConstraints,
  }));
  assert(variants.length >= 2, "need at least 2 SETTLE_OPENER variants");

  const contextTags = buildScriptLabContextTags({
    meditationType: "Reflection",
    userText: "office break reflection",
  });
  const eligible = listEligibleSegmentVariants(
    variants,
    {
      lengthTiered: tagMeta!.lengthTiered,
      scope: tagMeta!.scope,
      types: tagMeta!.types,
    },
    5,
    "Reflection",
    contextTags,
  );
  assert(eligible.length >= 2, "need 2+ eligible SETTLE_OPENER variants");

  const first = selectSegmentVariant({
    variants,
    tagMeta: {
      lengthTiered: tagMeta!.lengthTiered,
      scope: tagMeta!.scope,
      types: tagMeta!.types,
    },
    tagName: "SETTLE_OPENER",
    beatType: "settle_opener",
    targetMinutes: 5,
    meditationType: "Reflection",
    contextTags,
    random: false,
  });
  assert(first, "first pick");

  const second = selectSegmentVariant({
    variants,
    tagMeta: {
      lengthTiered: tagMeta!.lengthTiered,
      scope: tagMeta!.scope,
      types: tagMeta!.types,
    },
    tagName: "SETTLE_OPENER",
    beatType: "settle_opener",
    targetMinutes: 5,
    meditationType: "Reflection",
    contextTags,
    recentVariantIds: [first!.variantId],
    random: false,
  });
  assert(second, "second pick");
  if (eligible.length >= 2) {
    assert(
      second!.variantId !== first!.variantId,
      `second SETTLE_OPENER should differ when alternatives exist (got ${second!.variantId} again)`,
    );
  }
  console.log(
    `PASS: SETTLE_OPENER rotation (${first!.variantId} → ${second!.variantId})`,
  );
}

async function testLiveDynamoRoundTrip() {
  if (!process.argv.includes("--live") || !process.env.VOICE_ADMIN_TABLE_NAME?.trim()) {
    console.log("SKIP live Dynamo round-trip");
    return;
  }
  const before = await loadScriptLabRecentVariantIds();
  const stamp = `test-${Date.now()}`;
  const after = await appendScriptLabRecentVariantIds([stamp, stamp, "dup-skip"]);
  assert(after[0] === stamp, "appended id at front");
  assert(after.filter((id) => id === stamp).length === 1, "deduped on append");
  assert(after.length <= SCRIPT_LAB_RECENT_VARIANTS_CAP, "cap respected");
  // Restore prior list (best effort — prepend is additive for tests)
  if (before.length > 0) {
    await appendScriptLabRecentVariantIds(before.slice(0, 3));
  }
  console.log("PASS: live Dynamo round-trip");
}

async function testFivePickRotation() {
  if (!process.env.VOICE_ADMIN_TABLE_NAME?.trim()) return;
  const library = await listAllScriptSegmentLibrary();
  const tagMeta = library.tags.find((t) => t.name === "SETTLE_OPENER");
  if (!tagMeta) return;
  const variants = (library.variantsByTag.SETTLE_OPENER ?? []).map((v) => ({
    variantId: v.variantId,
    text: v.text,
    lengthTier: v.lengthTier,
    requiredConstraints: v.requiredConstraints,
    excludedConstraints: v.excludedConstraints,
  }));
  const contextTags = buildScriptLabContextTags({
    meditationType: "Reflection",
    userText: "",
  });
  let recent: string[] = [];
  const picks: string[] = [];
  for (let i = 0; i < 5; i++) {
    const picked = selectSegmentVariant({
      variants,
      tagMeta: {
        lengthTiered: tagMeta.lengthTiered,
        scope: tagMeta.scope,
        types: tagMeta.types,
      },
      tagName: "SETTLE_OPENER",
      targetMinutes: 5,
      meditationType: "Reflection",
      contextTags,
      recentVariantIds: recent,
      random: false,
    });
    assert(picked, `pick ${i + 1}`);
    picks.push(picked!.variantId);
    recent = mergeRecentVariantIds(recent, [picked!.variantId]);
  }
  const unique = new Set(picks);
  assert(
    unique.size >= 2,
    `expected rotation across 5 picks, got ${unique.size} unique: ${picks.join(", ")}`,
  );
  console.log(`PASS: 5-pick rotation (${unique.size} unique / 5)`);
}

async function main() {
  testMergeRecentVariantIds();
  testRecencyPreference();
  testSelectNeverFailsWhenAllRecent();
  await testSettleOpenerRotationOffline();
  await testFivePickRotation();
  await testLiveDynamoRoundTrip();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
