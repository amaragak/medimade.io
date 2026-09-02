/**
 * Pending async embedding jobs + aggregate stats for Script Lab admin UI.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { normalizeScriptSegmentTag } from "./script-segment-tags";
import { listScriptSegmentDocuments } from "./script-segment-library";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const SCRIPT_LAB_EMBED_QUEUE_PK = "SCRIPT_LAB_EMBED_QUEUE";
export const SCRIPT_LAB_EMBED_QUEUE_SK = "pending";

export type ScriptLabEmbeddingStats = {
  total: number;
  embedded: number;
  queued: number;
  missing: number;
  /** ISO timestamp when stats were computed. */
  updatedAt: string;
};

function requireTable(): string {
  const n = process.env.VOICE_ADMIN_TABLE_NAME?.trim();
  if (!n) throw new Error("VOICE_ADMIN_TABLE_NAME is not set");
  return n;
}

export function embedPendingKey(tagName: string, variantId: string): string {
  return `${normalizeScriptSegmentTag(tagName)}#${variantId.trim()}`;
}

function parsePendingKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const key = item.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function coerceQueuedAt(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === "string" && typeof v === "string" && v.trim()) {
      out[k.trim()] = v.trim();
    }
  }
  return out;
}

async function loadPendingRecord(): Promise<{
  keys: string[];
  queuedAt: Record<string, string>;
}> {
  const TableName = requireTable();
  const out = await ddb.send(
    new GetCommand({
      TableName,
      Key: { pk: SCRIPT_LAB_EMBED_QUEUE_PK, sk: SCRIPT_LAB_EMBED_QUEUE_SK },
    }),
  );
  return {
    keys: parsePendingKeys(out.Item?.pendingKeys),
    queuedAt: coerceQueuedAt(out.Item?.queuedAt),
  };
}

async function writePendingRecord(params: {
  keys: string[];
  queuedAt: Record<string, string>;
}): Promise<void> {
  const TableName = requireTable();
  await ddb.send(
    new PutCommand({
      TableName,
      Item: {
        pk: SCRIPT_LAB_EMBED_QUEUE_PK,
        sk: SCRIPT_LAB_EMBED_QUEUE_SK,
        pendingKeys: params.keys,
        queuedAt: params.queuedAt,
        updatedAt: new Date().toISOString(),
      },
    }),
  );
}

/** Mark variants as queued for async embedding (deduped). */
export async function markVariantsEmbedPending(
  items: Array<{ tagName: string; variantId: string }>,
): Promise<number> {
  if (items.length === 0) return 0;
  const { keys: existing, queuedAt } = await loadPendingRecord();
  const keySet = new Set(existing);
  const now = new Date().toISOString();
  let added = 0;
  for (const item of items) {
    const key = embedPendingKey(item.tagName, item.variantId);
    if (keySet.has(key)) continue;
    keySet.add(key);
    queuedAt[key] = now;
    added += 1;
  }
  if (added === 0) return 0;
  await writePendingRecord({ keys: [...keySet], queuedAt });
  return added;
}

/** Remove variants from the pending queue (after embed_store writes). */
export async function clearVariantsEmbedPending(
  items: Array<{ tagName: string; variantId: string }>,
): Promise<void> {
  if (items.length === 0) return;
  const { keys: existing, queuedAt } = await loadPendingRecord();
  if (existing.length === 0) return;
  const remove = new Set(
    items.map((item) => embedPendingKey(item.tagName, item.variantId)),
  );
  const nextKeys = existing.filter((k) => !remove.has(k));
  if (nextKeys.length === existing.length) return;
  for (const k of remove) delete queuedAt[k];
  await writePendingRecord({ keys: nextKeys, queuedAt });
}

type EmbeddingIndex = {
  total: number;
  embedded: number;
  embeddedKeys: Set<string>;
  knownKeys: Set<string>;
};

/** Count embeddings from segment documents (no full library flatten). */
export async function summarizeScriptSegmentEmbeddings(): Promise<EmbeddingIndex> {
  const docs = await listScriptSegmentDocuments();
  let total = 0;
  let embedded = 0;
  const embeddedKeys = new Set<string>();
  const knownKeys = new Set<string>();
  for (const doc of docs) {
    for (const v of doc.variants) {
      total += 1;
      const key = embedPendingKey(doc.tag, v.id);
      knownKeys.add(key);
      if (Array.isArray(v.embedding) && v.embedding.length > 0) {
        embedded += 1;
        embeddedKeys.add(key);
      }
    }
  }
  return { total, embedded, embeddedKeys, knownKeys };
}

/**
 * Aggregate embedding progress: embedded / queued / missing.
 * Reconciles stale pending keys (already embedded or deleted variants).
 */
export async function getScriptLabEmbeddingStats(): Promise<ScriptLabEmbeddingStats> {
  const [index, pending] = await Promise.all([
    summarizeScriptSegmentEmbeddings(),
    loadPendingRecord(),
  ]);

  const activePending = pending.keys.filter(
    (key) => index.knownKeys.has(key) && !index.embeddedKeys.has(key),
  );
  const stalePending = pending.keys.filter((key) => !activePending.includes(key));
  if (stalePending.length > 0) {
    const nextQueuedAt = { ...pending.queuedAt };
    for (const k of stalePending) delete nextQueuedAt[k];
    await writePendingRecord({ keys: activePending, queuedAt: nextQueuedAt });
  }

  const queued = activePending.length;
  const missing = Math.max(0, index.total - index.embedded - queued);

  return {
    total: index.total,
    embedded: index.embedded,
    queued,
    missing,
    updatedAt: new Date().toISOString(),
  };
}
