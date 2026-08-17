import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  FISH_SPEAKERS,
  HIDDEN_FISH_SPEAKER_MODEL_IDS,
  type FishSpeaker,
} from "./fish-speakers";
import {
  SCRIPT_PAUSE_BANDS,
  SCRIPT_PAUSE_BAND_SECONDS,
  type ScriptPauseBand,
} from "./script-pause-bands";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const VOICE_SPEAKER_PK = "VOICE_SPEAKER";
export const VOICE_SETTINGS_PK = "VOICE_SETTINGS";
export const VOICE_PAUSES_SK = "pauses";

export type VoiceSpeakerRow = FishSpeaker & {
  hidden: boolean;
  sort: number;
  updatedAt: string;
};

export type PauseBandSeconds = Record<ScriptPauseBand, number>;

function tableName(): string | null {
  const n = process.env.VOICE_ADMIN_TABLE_NAME?.trim();
  return n || null;
}

function requireTable(): string {
  const n = tableName();
  if (!n) throw new Error("VOICE_ADMIN_TABLE_NAME is not set");
  return n;
}

export function defaultPauseBandSeconds(): PauseBandSeconds {
  return { ...SCRIPT_PAUSE_BAND_SECONDS };
}

export function defaultVoiceSpeakers(): VoiceSpeakerRow[] {
  const now = new Date().toISOString();
  return FISH_SPEAKERS.map((s, i) => ({
    name: s.name,
    modelId: s.modelId,
    hidden: HIDDEN_FISH_SPEAKER_MODEL_IDS.has(s.modelId),
    sort: i,
    updatedAt: now,
  }));
}

function coercePauseSeconds(raw: unknown): PauseBandSeconds {
  const base = defaultPauseBandSeconds();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  for (const band of SCRIPT_PAUSE_BANDS) {
    const n = Number(o[band]);
    if (Number.isFinite(n) && n > 0 && n <= 120) base[band] = n;
  }
  return base;
}

export async function listVoiceSpeakers(): Promise<VoiceSpeakerRow[]> {
  const table = tableName();
  if (!table) return defaultVoiceSpeakers();
  const items: VoiceSpeakerRow[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const out = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": VOICE_SPEAKER_PK },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const it of out.Items ?? []) {
      if (typeof it.sk !== "string" || !it.sk) continue;
      items.push({
        modelId: it.sk,
        name: typeof it.name === "string" && it.name.trim() ? it.name.trim() : it.sk,
        hidden: it.hidden === true,
        sort: typeof it.sort === "number" && Number.isFinite(it.sort) ? it.sort : 0,
        updatedAt: typeof it.updatedAt === "string" ? it.updatedAt : "",
      });
    }
    startKey = out.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  if (items.length === 0) return defaultVoiceSpeakers();
  items.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  return items;
}

export async function seedVoiceSpeakersIfEmpty(): Promise<VoiceSpeakerRow[]> {
  const existing = await listVoiceSpeakers();
  const table = tableName();
  if (!table) return existing;
  const out = await ddb.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": VOICE_SPEAKER_PK },
      Limit: 1,
    }),
  );
  if ((out.Items ?? []).length > 0) return existing;
  const seeded = defaultVoiceSpeakers();
  for (const row of seeded) {
    await putVoiceSpeaker(row);
  }
  return seeded;
}

export async function putVoiceSpeaker(row: {
  modelId: string;
  name: string;
  hidden?: boolean;
  sort?: number;
}): Promise<VoiceSpeakerRow> {
  const table = requireTable();
  const modelId = row.modelId.trim();
  if (!modelId) throw new Error("modelId is required");
  const next: VoiceSpeakerRow = {
    modelId,
    name: row.name.trim() || modelId,
    hidden: row.hidden === true,
    sort: typeof row.sort === "number" && Number.isFinite(row.sort) ? row.sort : 0,
    updatedAt: new Date().toISOString(),
  };
  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        pk: VOICE_SPEAKER_PK,
        sk: next.modelId,
        name: next.name,
        hidden: next.hidden,
        sort: next.sort,
        updatedAt: next.updatedAt,
      },
    }),
  );
  return next;
}

export async function deleteVoiceSpeaker(modelId: string): Promise<void> {
  const table = requireTable();
  await ddb.send(
    new DeleteCommand({
      TableName: table,
      Key: { pk: VOICE_SPEAKER_PK, sk: modelId.trim() },
    }),
  );
}

export async function loadPauseBandSeconds(): Promise<PauseBandSeconds> {
  const table = tableName();
  if (!table) return defaultPauseBandSeconds();
  const out = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { pk: VOICE_SETTINGS_PK, sk: VOICE_PAUSES_SK },
    }),
  );
  return coercePauseSeconds(out.Item?.bands);
}

export async function savePauseBandSeconds(
  bands: Partial<Record<ScriptPauseBand, number>>,
): Promise<PauseBandSeconds> {
  const table = requireTable();
  const next = coercePauseSeconds({ ...SCRIPT_PAUSE_BAND_SECONDS, ...bands });
  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        pk: VOICE_SETTINGS_PK,
        sk: VOICE_PAUSES_SK,
        bands: next,
        updatedAt: new Date().toISOString(),
      },
    }),
  );
  return next;
}

export async function listPickerFishSpeakers(): Promise<FishSpeaker[]> {
  const rows = await listVoiceSpeakers();
  return rows.filter((s) => !s.hidden).map((s) => ({ name: s.name, modelId: s.modelId }));
}

export async function resolveSpeakerName(
  modelId: string | null | undefined,
): Promise<string | null> {
  if (!modelId) return null;
  const rows = await listVoiceSpeakers();
  return rows.find((s) => s.modelId === modelId)?.name ?? null;
}
