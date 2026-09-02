/**
 * Cross-session variant repeat-avoidance for Script Lab admin test generation.
 * Stored in VoiceAdminTable; not used by the public create flow.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import type { ScriptLabBeat } from "./script-lab-beats";
import { normalizeScriptSegmentTag } from "./script-segment-tags";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const SCRIPT_LAB_ADMIN_PK = "SCRIPT_LAB_ADMIN";
export const SCRIPT_LAB_ADMIN_USER_ID = "script-lab-admin";
export const SCRIPT_LAB_RECENT_VARIANTS_CAP = 200;

function requireTable(): string {
  const n = process.env.VOICE_ADMIN_TABLE_NAME?.trim();
  if (!n) throw new Error("VOICE_ADMIN_TABLE_NAME is not set");
  return n;
}

function coerceRecentVariantIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= SCRIPT_LAB_RECENT_VARIANTS_CAP) break;
  }
  return out;
}

/** Most recent first; deduped; capped. */
export function mergeRecentVariantIds(
  existing: readonly string[],
  appendedInScriptOrder: readonly string[],
  cap = SCRIPT_LAB_RECENT_VARIANTS_CAP,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...appendedInScriptOrder, ...existing]) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= cap) break;
  }
  return out;
}

export async function loadScriptLabRecentVariantIds(): Promise<string[]> {
  const TableName = requireTable();
  const out = await ddb.send(
    new GetCommand({
      TableName,
      Key: { pk: SCRIPT_LAB_ADMIN_PK, sk: SCRIPT_LAB_ADMIN_USER_ID },
    }),
  );
  return coerceRecentVariantIds(out.Item?.recentVariantIds);
}

export async function appendScriptLabRecentVariantIds(
  usedInScriptOrder: readonly string[],
): Promise<string[]> {
  if (usedInScriptOrder.length === 0) return loadScriptLabRecentVariantIds();
  const existing = await loadScriptLabRecentVariantIds();
  const next = mergeRecentVariantIds(existing, usedInScriptOrder);
  const TableName = requireTable();
  await ddb.send(
    new PutCommand({
      TableName,
      Item: {
        pk: SCRIPT_LAB_ADMIN_PK,
        sk: SCRIPT_LAB_ADMIN_USER_ID,
        userId: SCRIPT_LAB_ADMIN_USER_ID,
        recentVariantIds: next,
        updatedAt: new Date().toISOString(),
      },
    }),
  );
  return next;
}

/** Resolve library variantIds from filled beats (script order). */
export function collectVariantIdsFromScriptBeats(
  beats: readonly ScriptLabBeat[],
  variantsByTag: Record<string, Array<{ variantId: string; text: string }>>,
): string[] {
  const ids: string[] = [];
  for (const beat of beats) {
    if (beat.custom || beat.beatType === "pause" || !beat.tag?.trim()) continue;
    const tag = normalizeScriptSegmentTag(beat.tag);
    const text = beat.text?.trim();
    if (!text) continue;
    const variants = variantsByTag[tag] ?? variantsByTag[beat.tag] ?? [];
    const match = variants.find((v) => v.text.trim() === text);
    if (match) ids.push(match.variantId);
  }
  return ids;
}

export function collectVariantIdsFromBeatPicks(
  beats: readonly ScriptLabBeat[],
  picksByBeatIndex: Record<number, string>,
): string[] {
  const ids: string[] = [];
  for (let i = 0; i < beats.length; i++) {
    const id = picksByBeatIndex[i]?.trim();
    if (id) ids.push(id);
  }
  return ids;
}
