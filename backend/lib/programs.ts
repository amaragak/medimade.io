import { randomUUID } from "crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { coerceMeditationTargetMinutes } from "./meditation-target-minutes";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const PROGRAM_PK = "PROGRAM";

export type ProgramDayStatus = "draft" | "generating" | "ready" | "failed";

export type ProgramDay = {
  id: string;
  /** 1-based order within the program. */
  dayNumber: number;
  title: string;
  /** One-shot prompt used to generate the script. */
  prompt: string;
  /** Optional listener-facing blurb; LLM-filled when short/empty at generate time. */
  description: string;
  speakerModelId: string;
  /** Composition / soundscape streaming key (music slot alone). */
  compositionKey: string;
  targetMinutes: number;
  status: ProgramDayStatus;
  jobId: string | null;
  audioUrl: string | null;
  audioKey: string | null;
  errorMessage: string | null;
  generatedAt: string | null;
};

export type ProgramPublic = {
  id: string;
  title: string;
  description: string;
  /** When true, eligible for the Library Programs shelf. */
  published: boolean;
  sort: number;
  days: ProgramDay[];
  createdAt: string;
  updatedAt: string;
};

type ProgramRow = ProgramPublic & {
  pk: typeof PROGRAM_PK;
  sk: string;
};

function tableName(): string {
  const n = process.env.VOICE_ADMIN_TABLE_NAME?.trim();
  if (!n) throw new Error("VOICE_ADMIN_TABLE_NAME is not set");
  return n;
}

function coerceStatus(raw: unknown): ProgramDayStatus {
  if (raw === "generating" || raw === "ready" || raw === "failed") return raw;
  return "draft";
}

function coerceDay(raw: unknown, fallbackIndex: number): ProgramDay | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id =
    (typeof o.id === "string" && o.id.trim()) ||
    `day-${randomUUID().slice(0, 8)}`;
  const dayNumber =
    typeof o.dayNumber === "number" && Number.isFinite(o.dayNumber)
      ? Math.max(1, Math.floor(o.dayNumber))
      : fallbackIndex + 1;
  return {
    id,
    dayNumber,
    title:
      typeof o.title === "string" && o.title.trim()
        ? o.title.trim().slice(0, 120)
        : `Day ${dayNumber}`,
    prompt: typeof o.prompt === "string" ? o.prompt.trim().slice(0, 4000) : "",
    description:
      typeof o.description === "string"
        ? o.description.trim().slice(0, 600)
        : "",
    speakerModelId:
      typeof o.speakerModelId === "string" ? o.speakerModelId.trim() : "",
    compositionKey:
      typeof o.compositionKey === "string" ? o.compositionKey.trim() : "",
    targetMinutes: coerceMeditationTargetMinutes(o.targetMinutes),
    status: coerceStatus(o.status),
    jobId: typeof o.jobId === "string" && o.jobId.trim() ? o.jobId.trim() : null,
    audioUrl:
      typeof o.audioUrl === "string" && o.audioUrl.trim()
        ? o.audioUrl.trim()
        : null,
    audioKey:
      typeof o.audioKey === "string" && o.audioKey.trim()
        ? o.audioKey.trim()
        : null,
    errorMessage:
      typeof o.errorMessage === "string" && o.errorMessage.trim()
        ? o.errorMessage.trim().slice(0, 500)
        : null,
    generatedAt:
      typeof o.generatedAt === "string" && o.generatedAt.trim()
        ? o.generatedAt.trim()
        : null,
  };
}

export function normalizeProgram(raw: unknown): ProgramPublic | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id =
    (typeof o.id === "string" && o.id.trim()) ||
    (typeof o.sk === "string" && o.sk.trim()) ||
    "";
  if (!id) return null;
  const daysRaw = Array.isArray(o.days) ? o.days : [];
  const days = daysRaw
    .map((d, i) => coerceDay(d, i))
    .filter((d): d is ProgramDay => Boolean(d))
    .sort((a, b) => a.dayNumber - b.dayNumber)
    .map((d, i) => ({ ...d, dayNumber: i + 1 }));
  const createdAt =
    typeof o.createdAt === "string" ? o.createdAt : new Date().toISOString();
  const updatedAt =
    typeof o.updatedAt === "string" ? o.updatedAt : createdAt;
  const sort =
    typeof o.sort === "number" && Number.isFinite(o.sort) ? o.sort : 0;
  return {
    id,
    title:
      typeof o.title === "string" && o.title.trim()
        ? o.title.trim().slice(0, 120)
        : "Untitled program",
    description:
      typeof o.description === "string"
        ? o.description.trim().slice(0, 500)
        : "",
    published: o.published === true,
    sort,
    days,
    createdAt,
    updatedAt,
  };
}

export async function listPrograms(): Promise<ProgramPublic[]> {
  const items: ProgramPublic[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const out = await ddb.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": PROGRAM_PK },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const row of out.Items ?? []) {
      const p = normalizeProgram(row);
      if (p) items.push(p);
    }
    startKey = out.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  items.sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
  return items;
}

/** Shelf-facing day: ready audio only, no prompt / generation internals. */
export type LibraryProgramDay = {
  id: string;
  dayNumber: number;
  title: string;
  description: string;
  targetMinutes: number;
  audioUrl: string;
  audioKey: string;
  /** Music / composition bed mixed live under the voice stem. */
  backgroundMusicKey: string;
};

export type LibraryProgram = {
  id: string;
  title: string;
  description: string;
  sort: number;
  days: LibraryProgramDay[];
};

export function toLibraryProgram(p: ProgramPublic): LibraryProgram | null {
  if (!p.published) return null;
  const days: LibraryProgramDay[] = p.days
    .filter(
      (d) =>
        d.status === "ready" &&
        typeof d.audioUrl === "string" &&
        d.audioUrl.trim() &&
        typeof d.audioKey === "string" &&
        d.audioKey.trim(),
    )
    .map((d) => ({
      id: d.id,
      dayNumber: d.dayNumber,
      title: d.title,
      description: d.description,
      targetMinutes: d.targetMinutes,
      audioUrl: d.audioUrl!.trim(),
      audioKey: d.audioKey!.trim(),
      backgroundMusicKey: d.compositionKey.trim(),
    }));
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    sort: p.sort,
    days,
  };
}

export async function listPublishedLibraryPrograms(): Promise<LibraryProgram[]> {
  const all = await listPrograms();
  return all
    .map(toLibraryProgram)
    .filter((p): p is LibraryProgram => Boolean(p));
}

/** S3 keys owned by any program day — keep these off My Creations. */
export async function listProgramOwnedAudioKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  const programs = await listPrograms();
  for (const p of programs) {
    for (const d of p.days) {
      const k = d.audioKey?.trim();
      if (k) keys.add(k);
    }
  }
  return keys;
}

export async function getProgram(id: string): Promise<ProgramPublic | null> {
  const sk = id.trim();
  if (!sk) return null;
  const out = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { pk: PROGRAM_PK, sk },
    }),
  );
  return normalizeProgram(out.Item);
}

export async function putProgram(input: unknown): Promise<ProgramPublic> {
  const existingId =
    input && typeof input === "object" && typeof (input as { id?: unknown }).id === "string"
      ? (input as { id: string }).id.trim()
      : "";
  const existing = existingId ? await getProgram(existingId) : null;
  const now = new Date().toISOString();
  const next = normalizeProgram({
    ...(existing ?? {}),
    ...(typeof input === "object" && input ? input : {}),
    id: existingId || randomUUID(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    sort:
      typeof input === "object" &&
      input &&
      typeof (input as { sort?: unknown }).sort === "number" &&
      Number.isFinite((input as { sort: number }).sort)
        ? (input as { sort: number }).sort
        : (existing?.sort ?? Date.now() % 1_000_000),
  });
  if (!next) throw new Error("Invalid program");
  const row: ProgramRow = {
    ...next,
    pk: PROGRAM_PK,
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

export async function deleteProgram(id: string): Promise<void> {
  const sk = id.trim();
  if (!sk) return;
  await ddb.send(
    new DeleteCommand({
      TableName: tableName(),
      Key: { pk: PROGRAM_PK, sk },
    }),
  );
}
