import { searchVariantCatalog } from "./script-embed-client";
import {
  listAllScriptSegmentLibrary,
  listPendingReviewVariants,
  putScriptSegmentVariant,
} from "./script-segment-library";

/**
 * Recompute promotionNeighbors / nearest text for pending auto-promotes that
 * are missing them (e.g. written before those fields existed).
 */
export async function backfillPendingPromotionNeighbors(): Promise<{
  pending: number;
  updated: number;
  skipped: number;
}> {
  const pending = await listPendingReviewVariants();
  const need = pending.filter(
    (v) =>
      !(v.promotionNeighbors && v.promotionNeighbors.length > 0) &&
      !v.promotionNearestText,
  );
  if (need.length === 0) {
    return { pending: pending.length, updated: 0, skipped: pending.length };
  }

  const library = await listAllScriptSegmentLibrary();
  const catalog: Array<{
    id: string;
    tag: string;
    text: string;
    embedding: number[];
  }> = [];
  for (const [tag, variants] of Object.entries(library.variantsByTag)) {
    for (const v of variants) {
      if (!Array.isArray(v.embedding) || v.embedding.length === 0) continue;
      if (v.source === "auto" && v.approved === false) continue;
      catalog.push({
        id: v.variantId,
        tag,
        text: v.text,
        embedding: v.embedding,
      });
    }
  }
  if (catalog.length === 0) {
    throw new Error("No embedded catalog variants to search against");
  }

  let updated = 0;
  const batchSize = 20;
  for (let i = 0; i < need.length; i += batchSize) {
    const batch = need.slice(i, i + batchSize);
    const results = await searchVariantCatalog({
      queries: batch.map((v) => v.text),
      catalog,
      topK: 5,
    });
    for (let j = 0; j < batch.length; j++) {
      const v = batch[j]!;
      const matches = (results[j]?.matches ?? [])
        .filter((m) => m.id && m.id !== v.variantId && m.text?.trim())
        .slice(0, 5)
        .map((m) => ({
          tag: m.tag,
          text: m.text.slice(0, 500),
          score: m.score,
        }));
      if (matches.length === 0) continue;
      const top = matches[0]!;
      await putScriptSegmentVariant({
        tagName: v.tagName,
        variantId: v.variantId,
        text: v.text,
        lengthTier: v.lengthTier,
        requiredConstraints: v.requiredConstraints,
        excludedConstraints: v.excludedConstraints,
        source: "auto",
        approved: false,
        skipEmbed: true,
        promotionSimilarity: top.score,
        promotionNearestTag: top.tag,
        promotionNearestText: top.text,
        promotionNeighbors: matches,
        promotionContext: v.promotionContext ?? null,
      });
      updated += 1;
    }
  }

  return {
    pending: pending.length,
    updated,
    skipped: pending.length - need.length,
  };
}
