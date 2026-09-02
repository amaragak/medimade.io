/**
 * Unit test: id-matched variant upsert applies direction and other import fields.
 *
 * Usage: npx tsx scripts/test-variant-import-direction.ts
 */
import { randomUUID } from "node:crypto";
import {
  buildVariantImportFieldsFromJson,
  importScriptSegments,
} from "../lib/script-segment-library";

async function testDirectionUpsertById() {
  const tag = `TEST_DIR_${randomUUID().slice(0, 8).toUpperCase()}`;
  const variantId = `dir-test-${randomUUID().slice(0, 8)}`;

  await importScriptSegments([
    {
      tag,
      scope: "general",
      types: [],
      lengthTiered: false,
      variants: [
        {
          id: variantId,
          importFields: buildVariantImportFieldsFromJson({
            raw: { text: "Baseline line.", direction: null },
            lengthTiered: false,
            text: "Baseline line.",
            lengthTier: null,
            requiredConstraints: [],
            excludedConstraints: [],
          }),
        },
      ],
    },
  ]);

  const first = await importScriptSegments([
    {
      tag,
      scope: "general",
      types: [],
      lengthTiered: false,
      variants: [
        {
          id: variantId,
          importFields: buildVariantImportFieldsFromJson({
            raw: { text: "Baseline line.", direction: "ascending" },
            lengthTiered: false,
            text: "Baseline line.",
            lengthTier: null,
            requiredConstraints: [],
            excludedConstraints: [],
          }),
        },
      ],
    },
  ]);

  if (first.variantsUpdatedById !== 1) {
    throw new Error(
      `FAIL: expected 1 update by id for direction, got ${first.variantsUpdatedById}`,
    );
  }
  if (first.variantsUnchanged !== 0) {
    throw new Error(`FAIL: expected 0 unchanged, got ${first.variantsUnchanged}`);
  }

  const second = await importScriptSegments([
    {
      tag,
      scope: "general",
      types: [],
      lengthTiered: false,
      variants: [
        {
          id: variantId,
          importFields: buildVariantImportFieldsFromJson({
            raw: { text: "Baseline line.", direction: "ascending" },
            lengthTiered: false,
            text: "Baseline line.",
            lengthTier: null,
            requiredConstraints: [],
            excludedConstraints: [],
          }),
        },
      ],
    },
  ]);

  if (second.variantsUnchanged !== 1) {
    throw new Error(
      `FAIL: expected unchanged on re-import, got updated=${second.variantsUpdatedById} unchanged=${second.variantsUnchanged}`,
    );
  }

  console.log("PASS: direction field upsert by id");
}

async function main() {
  if (!process.env.VOICE_ADMIN_TABLE_NAME) {
    console.log("SKIP live test (set VOICE_ADMIN_TABLE_NAME)");
    return;
  }
  await testDirectionUpsertById();
  console.log("All variant import direction tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
