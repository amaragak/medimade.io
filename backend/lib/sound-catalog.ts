import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { isBgAudioCategory, type BgAudioCategory } from "./background-audio-keys";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const SOUND_PK = "SOUND";

export type SoundReviewStatus = "in_use" | "pending" | "unused" | "categorised";

export function storedSoundReviewStatus(raw: unknown): SoundReviewStatus | null {
  if (raw === "pending" || raw === "unused" || raw === "in_use" || raw === "categorised") {
    return raw;
  }
  return null;
}

/** Legacy beds live under nature/music/drums/noise. Splice packs and admin imports do not. */
export function defaultSoundReviewStatus(row: {
  sk: string;
  importedAt?: string;
}): SoundReviewStatus {
  if (row.importedAt) return "pending";
  const rel = row.sk.replace(/^background-audio\//, "");
  const folder = rel.split("/")[0] ?? "";
  if (isBgAudioCategory(folder)) return "in_use";
  return "pending";
}

export function resolveSoundReviewStatus(
  stored: unknown,
  row: { sk: string; importedAt?: string },
): SoundReviewStatus {
  return storedSoundReviewStatus(stored) ?? defaultSoundReviewStatus(row);
}

export function parseSoundReviewStatus(raw: unknown): SoundReviewStatus {
  return storedSoundReviewStatus(raw) ?? "in_use";
}

export function soundIsInCustomerPicker(row: { status: SoundReviewStatus }): boolean {
  return row.status === "in_use" || row.status === "categorised";
}

export function soundEnabledFromStatus(status: SoundReviewStatus): boolean {
  return soundIsInCustomerPicker({ status });
}

export type SoundCatalogRow = {
  pk: typeof SOUND_PK;
  sk: string;
  name: string;
  category: BgAudioCategory;
  subcategory?: string;
  suggestedCategory?: BgAudioCategory;
  suggestedSubcategory?: string;
  suggestedName?: string;
  packPath?: string;
  tags: string[];
  /** in_use = approved for mixer; categorised = approved + tagged; pending = fresh import; unused = skip */
  status: SoundReviewStatus;
  enabled: boolean;
  notes?: string;
  originalKey?: string;
  trimStartSec?: number;
  trimEndSec?: number | null;
  importedAt?: string;
  updatedAt: string;
};

function tableName(): string {
  const n = process.env.SOUND_CATALOG_TABLE_NAME?.trim();
  if (!n) throw new Error("SOUND_CATALOG_TABLE_NAME is not set");
  return n;
}

export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const v = t.trim().toLowerCase().slice(0, 32);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= 24) break;
  }
  return out;
}

export async function listAllSoundRows(): Promise<SoundCatalogRow[]> {
  const items: SoundCatalogRow[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const out = await ddb.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": SOUND_PK },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const it of out.Items ?? []) {
      if (typeof it.sk !== "string" || !it.sk) continue;
      const importedAt = typeof it.importedAt === "string" ? it.importedAt : undefined;
      const status = resolveSoundReviewStatus(it.status, { sk: it.sk, importedAt });
      items.push({
        pk: SOUND_PK,
        sk: it.sk,
        name: typeof it.name === "string" ? it.name : it.sk,
        category: (it.category as BgAudioCategory) || "music",
        subcategory: typeof it.subcategory === "string" ? it.subcategory : undefined,
        suggestedCategory: isBgAudioCategory(String(it.suggestedCategory ?? ""))
          ? (it.suggestedCategory as BgAudioCategory)
          : undefined,
        suggestedSubcategory:
          typeof it.suggestedSubcategory === "string" ? it.suggestedSubcategory : undefined,
        suggestedName: typeof it.suggestedName === "string" ? it.suggestedName : undefined,
        packPath: typeof it.packPath === "string" ? it.packPath : undefined,
        tags: normalizeTags(it.tags),
        status,
        enabled: soundEnabledFromStatus(status),
        notes: typeof it.notes === "string" ? it.notes : undefined,
        originalKey: typeof it.originalKey === "string" ? it.originalKey : undefined,
        trimStartSec: typeof it.trimStartSec === "number" ? it.trimStartSec : undefined,
        trimEndSec: typeof it.trimEndSec === "number" ? it.trimEndSec : null,
        importedAt,
        updatedAt: typeof it.updatedAt === "string" ? it.updatedAt : "",
      });
    }
    startKey = out.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return items;
}

export async function putSoundRow(row: SoundCatalogRow): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        ...row,
        pk: SOUND_PK,
        tags: normalizeTags(row.tags),
        updatedAt: row.updatedAt || new Date().toISOString(),
      },
    }),
  );
}

export async function deleteSoundRow(sk: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName(),
      Key: { pk: SOUND_PK, sk },
    }),
  );
}
