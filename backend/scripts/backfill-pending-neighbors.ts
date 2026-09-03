/**
 * Backfill promotionNeighbors on pending auto-promoted variants.
 *
 *   AWS_PROFILE=mm VOICE_ADMIN_TABLE_NAME=... SCRIPT_EMBED_FUNCTION_NAME=... \
 *     npx tsx scripts/backfill-pending-neighbors.ts
 */
import { backfillPendingPromotionNeighbors } from "../lib/script-lab-backfill-pending-neighbors";

async function main(): Promise<void> {
  const result = await backfillPendingPromotionNeighbors();
  console.log(result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
