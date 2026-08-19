import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const FACTORY_MIX_PK = "FACTORY_MIX";

export type FactoryChannel = {
  source: string | null;
  volume: number;
};

export type FactoryMixPublic = {
  id: string;
  name: string;
  description: string;
  icon: string;
  icon_bg: string;
  icon_color: string;
  sort: number;
  channels: {
    music: FactoryChannel;
    ambience: FactoryChannel;
    drums: FactoryChannel;
    noise: FactoryChannel;
  };
  createdAt: string;
  updatedAt: string;
};

type FactoryMixRow = FactoryMixPublic & {
  pk: typeof FACTORY_MIX_PK;
  sk: string;
};

function tableName(): string {
  const n = process.env.SOUND_CATALOG_TABLE_NAME?.trim();
  if (!n) throw new Error("SOUND_CATALOG_TABLE_NAME is not set");
  return n;
}

function clampGain(n: unknown): number {
  const x = typeof n === "number" && Number.isFinite(n) ? n : 25;
  return Math.min(100, Math.max(0, x));
}

function coerceChannel(raw: unknown): FactoryChannel {
  if (!raw || typeof raw !== "object") return { source: null, volume: 25 };
  const o = raw as Record<string, unknown>;
  const src = typeof o.source === "string" ? o.source.trim() : "";
  return { source: src || null, volume: clampGain(o.volume) };
}

function coerceHex(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const v = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
  return fallback;
}

function coerceIcon(raw: unknown): string {
  if (typeof raw !== "string") return "cloud-rain";
  const v = raw.trim().slice(0, 40);
  return v || "cloud-rain";
}

export function normalizeFactoryMix(raw: unknown): FactoryMixPublic | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id =
    (typeof o.id === "string" && o.id.trim()) ||
    (typeof o.sk === "string" && o.sk.trim()) ||
    "";
  if (!id) return null;
  const ch =
    o.channels && typeof o.channels === "object"
      ? (o.channels as Record<string, unknown>)
      : {};
  const createdAt =
    typeof o.createdAt === "string" ? o.createdAt : new Date().toISOString();
  const updatedAt =
    typeof o.updatedAt === "string" ? o.updatedAt : createdAt;
  const sort = typeof o.sort === "number" && Number.isFinite(o.sort) ? o.sort : 0;
  return {
    id,
    name:
      typeof o.name === "string" && o.name.trim()
        ? o.name.trim().slice(0, 80)
        : "Untitled mix",
    description:
      typeof o.description === "string" ? o.description.trim().slice(0, 160) : "",
    icon: coerceIcon(o.icon),
    icon_bg: coerceHex(o.icon_bg, "#E4EEF4"),
    icon_color: coerceHex(o.icon_color, "#3D5A73"),
    sort,
    channels: {
      music: coerceChannel(ch.music),
      ambience: coerceChannel(ch.ambience),
      drums: coerceChannel(ch.drums),
      noise: coerceChannel(ch.noise),
    },
    createdAt,
    updatedAt,
  };
}

export async function listFactoryMixes(): Promise<FactoryMixPublic[]> {
  const items: FactoryMixPublic[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const out = await ddb.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": FACTORY_MIX_PK },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const it of out.Items ?? []) {
      const row = normalizeFactoryMix(it);
      if (row) items.push(row);
    }
    startKey = out.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  items.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  return items;
}

async function getFactoryMix(id: string): Promise<FactoryMixPublic | null> {
  const sk = id.trim();
  if (!sk) return null;
  const out = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { pk: FACTORY_MIX_PK, sk },
    }),
  );
  return normalizeFactoryMix(out.Item);
}

export async function putFactoryMix(
  input: Partial<FactoryMixPublic> & { id?: string },
): Promise<FactoryMixPublic> {
  const now = new Date().toISOString();
  const existing = input.id ? await getFactoryMix(input.id) : null;
  const id =
    (typeof input.id === "string" && input.id.trim()) ||
    crypto.randomUUID();
  const next = normalizeFactoryMix({
    ...existing,
    ...input,
    id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    sort:
      typeof input.sort === "number"
        ? input.sort
        : (existing?.sort ?? Date.now() % 1_000_000),
  });
  if (!next) throw new Error("Invalid factory mix");
  const row: FactoryMixRow = {
    ...next,
    pk: FACTORY_MIX_PK,
    sk: next.id,
  };
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: row,
    }),
  );
  return next;
}

export async function deleteFactoryMix(id: string): Promise<void> {
  const sk = id.trim();
  if (!sk) return;
  await ddb.send(
    new DeleteCommand({
      TableName: tableName(),
      Key: { pk: FACTORY_MIX_PK, sk },
    }),
  );
}
