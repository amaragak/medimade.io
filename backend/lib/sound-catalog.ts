import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { normalizeBgAudioCategory, type BgAudioCategory } from "./background-audio-keys";
import { coerceSoundSubcategory } from "./sound-taxonomy";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const SOUND_PK = "SOUND";

export type SoundReviewStatus =
  | "in_use"
  | "pending"
  | "unused"
  | "categorised"
  | "loop_verified";

export function storedSoundReviewStatus(raw: unknown): SoundReviewStatus | null {
  if (
    raw === "pending" ||
    raw === "unused" ||
    raw === "in_use" ||
    raw === "categorised" ||
    raw === "loop_verified"
  ) {
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
  if (normalizeBgAudioCategory(folder)) return "in_use";
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
  // loop_verified is categorised plus an admin-only note that the loop was
  // checked, so both belong in the customer picker.
  return row.status === "categorised" || row.status === "loop_verified";
}

export function soundEnabledFromStatus(status: SoundReviewStatus): boolean {
  return soundIsInCustomerPicker({ status });
}

/** Where an upload is in the raw -> normalized pipeline, so stalls are legible. */
export type SoundProcessingStage =
  | "uploading"
  | "downloading"
  | "normalizing"
  | "encoding"
  | "storing"
  | "done"
  | "failed";

export type SoundProcessing = {
  stage: SoundProcessingStage;
  /** Failure detail (ffmpeg stderr tail, S3 error, out-of-memory hint). */
  error?: string;
  /** Source characteristics, useful when a specific file keeps failing. */
  detail?: string;
  attempt?: number;
  updatedAt: string;
};

export function parseSoundProcessing(raw: unknown): SoundProcessing | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const stage = r.stage;
  if (
    stage !== "uploading" &&
    stage !== "downloading" &&
    stage !== "normalizing" &&
    stage !== "encoding" &&
    stage !== "storing" &&
    stage !== "done" &&
    stage !== "failed"
  ) {
    return undefined;
  }
  return {
    stage,
    error: typeof r.error === "string" ? r.error : undefined,
    detail: typeof r.detail === "string" ? r.detail : undefined,
    attempt: typeof r.attempt === "number" ? r.attempt : undefined,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
  };
}

export type SoundCatalogRow = {
  pk: typeof SOUND_PK;
  sk: string;
  name: string;
  category: BgAudioCategory;
  subcategory?: string;
  /** Category was chosen by an admin, so the classifier must not move it. */
  categoryPinned?: boolean;
  suggestedCategory?: BgAudioCategory;
  suggestedSubcategory?: string;
  suggestedName?: string;
  packPath?: string;
  tags: string[];
  /** in_use = approved but uncategorised (not in mixer); categorised = in mixer; loop_verified = in mixer, loop seam checked; pending = fresh import; unused = skip */
  status: SoundReviewStatus;
  enabled: boolean;
  notes?: string;
  originalKey?: string;
  trimStartSec?: number;
  trimEndSec?: number | null;
  /** Fades baked in at the trim edges when the trim is applied. */
  fadeInSec?: number;
  fadeOutSec?: number;
  importedAt?: string;
  processing?: SoundProcessing;
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
        // Admin reviews re-list immediately after a status write; an eventually
        // consistent read here resurrects the old status in the UI.
        ConsistentRead: true,
      }),
    );
    for (const it of out.Items ?? []) {
      if (typeof it.sk !== "string" || !it.sk) continue;
      const importedAt = typeof it.importedAt === "string" ? it.importedAt : undefined;
      const status = resolveSoundReviewStatus(it.status, { sk: it.sk, importedAt });
      const category =
        normalizeBgAudioCategory(String(it.category ?? "")) ?? "music";
      const suggestedCategory = normalizeBgAudioCategory(String(it.suggestedCategory ?? ""));
      items.push({
        pk: SOUND_PK,
        sk: it.sk,
        name: typeof it.name === "string" ? it.name : it.sk,
        category,
        subcategory:
          typeof it.subcategory === "string" && it.subcategory.trim()
            ? coerceSoundSubcategory(category, it.subcategory)
            : undefined,
        categoryPinned: it.categoryPinned === true ? true : undefined,
        suggestedCategory: suggestedCategory ?? undefined,
        suggestedSubcategory:
          typeof it.suggestedSubcategory === "string"
            ? coerceSoundSubcategory(suggestedCategory ?? category, it.suggestedSubcategory)
            : undefined,
        suggestedName: typeof it.suggestedName === "string" ? it.suggestedName : undefined,
        packPath: typeof it.packPath === "string" ? it.packPath : undefined,
        tags: normalizeTags(it.tags),
        status,
        enabled: soundEnabledFromStatus(status),
        notes: typeof it.notes === "string" ? it.notes : undefined,
        originalKey: typeof it.originalKey === "string" ? it.originalKey : undefined,
        trimStartSec: typeof it.trimStartSec === "number" ? it.trimStartSec : undefined,
        trimEndSec: typeof it.trimEndSec === "number" ? it.trimEndSec : null,
        fadeInSec: typeof it.fadeInSec === "number" ? it.fadeInSec : undefined,
        fadeOutSec: typeof it.fadeOutSec === "number" ? it.fadeOutSec : undefined,
        importedAt,
        processing: parseSoundProcessing(it.processing),
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

/**
 * Records pipeline progress without touching the rest of the row, so a crash
 * mid-normalize still leaves a readable trail. No-ops when the row is gone.
 */
export async function updateSoundProcessing(
  sk: string,
  processing: Omit<SoundProcessing, "updatedAt">,
): Promise<void> {
  const value: SoundProcessing = {
    ...processing,
    error: processing.error ? processing.error.slice(0, 3000) : undefined,
    detail: processing.detail ? processing.detail.slice(0, 500) : undefined,
    updatedAt: new Date().toISOString(),
  };
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { pk: SOUND_PK, sk },
        UpdateExpression: "SET #p = :p",
        ExpressionAttributeNames: { "#p": "processing" },
        ExpressionAttributeValues: { ":p": value },
        ConditionExpression: "attribute_exists(sk)",
      }),
    );
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === "ConditionalCheckFailedException") return;
    console.warn("updateSoundProcessing failed", { sk, stage: value.stage, name });
  }
}

export async function deleteSoundRow(sk: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName(),
      Key: { pk: SOUND_PK, sk },
    }),
  );
}
