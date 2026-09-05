import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { DeleteObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { optionalUserJson, requireUserJson } from "../lib/medimade-auth-http";

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({});

const SK_META = "META";
const entrySk = (id: string) => `ENTRY#${id}`;

/** Full HTTP body cap (API Gateway limit is higher; keep headroom). */
const MAX_REQUEST_BODY_BYTES = 6 * 1024 * 1024;
/** DynamoDB item limit is 400 KB; leave margin for attribute names. */
const MAX_ENTRY_CONTENT_BYTES = 350 * 1024;
const MAX_TITLE_BYTES = 4096;
const MAX_ENTRIES = 2000;

function json(
  statusCode: number,
  payload: Record<string, unknown>,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(payload),
  };
}

function options(): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Max-Age": "86400",
    },
    body: "",
  };
}

function legacyStoreKey(ownerId: string): string {
  return `journal/stores/${ownerId}.json`;
}

type JournalEntry = {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  contentHtml: string;
  kind?: "freeform" | "gratitude";
  gratitude?: [string, string, string];
  mood?: string;
  tags?: string[];
  importSource?: string;
  importBatchId?: string;
  sourceMetadata?: Record<string, unknown>;
  mediaRefs?: string[];
  folderId?: string;
};

type JournalFolder = { id: string; name: string };

type JournalStoreV2 = {
  version: 2;
  activeEntryId: string | null;
  entries: JournalEntry[];
  folders?: JournalFolder[];
};

function isStoreV2(x: unknown): x is JournalStoreV2 {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.version !== 2) return false;
  if (!Array.isArray(o.entries)) return false;
  if (o.activeEntryId != null && typeof o.activeEntryId !== "string") return false;
  return o.entries.every((e) => {
    if (!e || typeof e !== "object") return false;
    const r = e as Record<string, unknown>;
    return (
      typeof r.id === "string" &&
      typeof r.createdAt === "string" &&
      typeof r.updatedAt === "string" &&
      typeof r.title === "string" &&
      typeof r.contentHtml === "string"
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function queryAllKeys(
  table: string,
  ownerId: string,
): Promise<Array<{ pk: string; sk: string }>> {
  const keys: Array<{ pk: string; sk: string }> = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :p",
        ExpressionAttributeValues: { ":p": ownerId },
        ProjectionExpression: "pk, sk",
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    for (const it of r.Items ?? []) {
      const pk = typeof it.pk === "string" ? it.pk : "";
      const sk = typeof it.sk === "string" ? it.sk : "";
      if (pk && sk) keys.push({ pk, sk });
    }
    startKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return keys;
}

async function scanAllItems(table: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: table,
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    for (const it of r.Items ?? []) items.push(it as Record<string, unknown>);
    startKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return items;
}

function gratitudeFromUnknown(raw: unknown): [string, string, string] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return [
    typeof raw[0] === "string" ? raw[0] : "",
    typeof raw[1] === "string" ? raw[1] : "",
    typeof raw[2] === "string" ? raw[2] : "",
  ];
}

function tagsFromUnknown(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const tags = raw
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().slice(0, 32))
    .filter(Boolean)
    .slice(0, 16);
  return tags.length ? tags : undefined;
}

function journalEntryFromItem(
  item: Record<string, unknown>,
  id: string,
): JournalEntry | null {
  if (
    typeof item.createdAt !== "string" ||
    typeof item.updatedAt !== "string" ||
    typeof item.title !== "string" ||
    typeof item.contentHtml !== "string"
  ) {
    return null;
  }
  const kind = item.kind === "gratitude" ? ("gratitude" as const) : undefined;
  const gratitude = gratitudeFromUnknown(item.gratitude);
  const mood = typeof item.mood === "string" ? item.mood : undefined;
  const tags = tagsFromUnknown(item.tags);
  const importSource =
    typeof item.importSource === "string" ? item.importSource : undefined;
  const importBatchId =
    typeof item.importBatchId === "string" ? item.importBatchId : undefined;
  const sourceMetadata =
    item.sourceMetadata &&
    typeof item.sourceMetadata === "object" &&
    !Array.isArray(item.sourceMetadata)
      ? (item.sourceMetadata as Record<string, unknown>)
      : undefined;
  const mediaRefs = Array.isArray(item.mediaRefs)
    ? item.mediaRefs.filter((x): x is string => typeof x === "string").slice(0, 64)
    : undefined;
  const folderId =
    typeof item.folderId === "string" && item.folderId.trim()
      ? item.folderId.trim().slice(0, 80)
      : undefined;
  return {
    id,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    title: item.title,
    contentHtml: item.contentHtml,
    ...(kind ? { kind, gratitude: gratitude ?? ["", "", ""] } : {}),
    ...(mood ? { mood } : {}),
    ...(tags ? { tags } : {}),
    ...(importSource ? { importSource } : {}),
    ...(importBatchId ? { importBatchId } : {}),
    ...(sourceMetadata ? { sourceMetadata } : {}),
    ...(mediaRefs?.length ? { mediaRefs } : {}),
    ...(folderId ? { folderId } : {}),
  };
}

function mergeAllJournalItems(items: Record<string, unknown>[]): JournalStoreV2 {
  type Row = { entry: JournalEntry; updated: number };
  const rows: Row[] = [];
  for (const item of items) {
    const sk = item.sk;
    if (typeof sk !== "string" || !sk.startsWith("ENTRY#")) continue;
    const id = typeof item.id === "string" ? item.id : sk.slice("ENTRY#".length);
    const entry = journalEntryFromItem(item, id);
    if (!entry) continue;
    rows.push({
      updated: new Date(entry.updatedAt).getTime() || 0,
      entry,
    });
  }
  rows.sort((a, b) => b.updated - a.updated);
  const entries = rows.map((r) => r.entry);
  return {
    version: 2,
    activeEntryId: entries[0]?.id ?? null,
    entries,
  };
}

async function queryAllItems(
  table: string,
  ownerId: string,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :p",
        ExpressionAttributeValues: { ":p": ownerId },
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    for (const it of r.Items ?? []) items.push(it as Record<string, unknown>);
    startKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return items;
}

function foldersFromUnknown(raw: unknown): JournalFolder[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: JournalFolder[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id.trim()) continue;
    const name = typeof o.name === "string" ? o.name.trim().slice(0, 40) : "";
    if (!name || seen.has(o.id)) continue;
    seen.add(o.id);
    out.push({ id: o.id.trim().slice(0, 80), name });
    if (out.length >= 40) break;
  }
  return out.length ? out : undefined;
}

function ddbItemsToStore(items: Record<string, unknown>[]): JournalStoreV2 | null {
  if (!items.length) return null;
  let activeEntryId: string | null = null;
  let folders: JournalFolder[] | undefined;
  type Row = { entry: JournalEntry; pos: number };
  const rows: Row[] = [];
  for (const item of items) {
    const sk = item.sk;
    if (sk === "META") {
      const ae = item.activeEntryId;
      activeEntryId =
        ae === null || typeof ae === "string" ? (ae as string | null) : null;
      folders = foldersFromUnknown(item.folders);
      continue;
    }
    if (typeof sk !== "string" || !sk.startsWith("ENTRY#")) continue;
    const id = typeof item.id === "string" ? item.id : sk.slice("ENTRY#".length);
    const entry = journalEntryFromItem(item, id);
    if (!entry) continue;
    const listPosition =
      typeof item.listPosition === "number" && Number.isFinite(item.listPosition)
        ? item.listPosition
        : 1e9;
    rows.push({
      pos: listPosition,
      entry,
    });
  }
  rows.sort((a, b) => a.pos - b.pos);
  return {
    version: 2,
    activeEntryId,
    entries: rows.map((r) => r.entry),
    ...(folders ? { folders } : {}),
  };
}

type BatchOp =
  | { op: "put"; item: Record<string, unknown> }
  | { op: "del"; pk: string; sk: string };

async function batchWriteAll(table: string, ops: BatchOp[]): Promise<void> {
  const chunkSize = 25;
  for (let i = 0; i < ops.length; i += chunkSize) {
    const slice = ops.slice(i, i + chunkSize);
    let requests = slice.map((op) =>
      op.op === "del"
        ? { DeleteRequest: { Key: { pk: op.pk, sk: op.sk } } }
        : { PutRequest: { Item: op.item } },
    );
    let attempt = 0;
    while (requests.length) {
      const res = await ddb.send(
        new BatchWriteCommand({
          RequestItems: { [table]: requests },
        }),
      );
      const un = res.UnprocessedItems?.[table];
      if (!un?.length) break;
      requests = un as typeof requests;
      attempt += 1;
      if (attempt > 12) {
        throw new Error("DynamoDB BatchWrite still has unprocessed items");
      }
      await sleep(Math.min(800, 40 * 2 ** attempt));
    }
  }
}

function validateStoreForWrite(store: JournalStoreV2): string | null {
  if (store.entries.length > MAX_ENTRIES) {
    return `Too many entries (max ${MAX_ENTRIES})`;
  }
  const ids = new Set<string>();
  for (const e of store.entries) {
    if (ids.has(e.id)) return `Duplicate entry id: ${e.id}`;
    ids.add(e.id);
    if (Buffer.byteLength(e.contentHtml, "utf-8") > MAX_ENTRY_CONTENT_BYTES) {
      return `Entry ${e.id} contentHtml exceeds ${MAX_ENTRY_CONTENT_BYTES} bytes; use POST /journal/voice for audio`;
    }
    if (Buffer.byteLength(e.title, "utf-8") > MAX_TITLE_BYTES) {
      return `Entry ${e.id} title too long`;
    }
  }
  if (
    store.activeEntryId != null &&
    !store.entries.some((x) => x.id === store.activeEntryId)
  ) {
    return "`activeEntryId` must refer to an entry in `entries` or be null";
  }
  return null;
}

async function persistStoreToDdb(
  table: string,
  ownerId: string,
  store: JournalStoreV2,
): Promise<void> {
  const err = validateStoreForWrite(store);
  if (err) throw new Error(err);

  const existing = await queryAllKeys(table, ownerId);
  const incomingIds = new Set(store.entries.map((e) => e.id));
  const ops: BatchOp[] = [];

  for (const { pk, sk } of existing) {
    if (sk === SK_META) continue;
    if (sk.startsWith("ENTRY#")) {
      const id = sk.slice("ENTRY#".length);
      if (!incomingIds.has(id)) {
        ops.push({ op: "del", pk, sk });
      }
    }
  }

  store.entries.forEach((e, listPosition) => {
    const item: Record<string, unknown> = {
      pk: ownerId,
      sk: entrySk(e.id),
      id: e.id,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      title: e.title,
      contentHtml: e.contentHtml,
      listPosition,
    };
    if (e.kind === "gratitude") {
      item.kind = "gratitude";
      item.gratitude = Array.isArray(e.gratitude)
        ? [
            typeof e.gratitude[0] === "string" ? e.gratitude[0] : "",
            typeof e.gratitude[1] === "string" ? e.gratitude[1] : "",
            typeof e.gratitude[2] === "string" ? e.gratitude[2] : "",
          ]
        : ["", "", ""];
    }
    if (typeof e.mood === "string" && e.mood.trim()) {
      item.mood = e.mood.trim().slice(0, 32);
    }
    if (Array.isArray(e.tags)) {
      const tags = e.tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().slice(0, 32))
        .filter(Boolean)
        .slice(0, 16);
      if (tags.length) item.tags = tags;
    }
    if (typeof e.importSource === "string" && e.importSource.trim()) {
      item.importSource = e.importSource.trim().slice(0, 32);
    }
    if (typeof e.importBatchId === "string" && e.importBatchId.trim()) {
      item.importBatchId = e.importBatchId.trim().slice(0, 80);
    }
  if (
      e.sourceMetadata &&
      typeof e.sourceMetadata === "object" &&
      !Array.isArray(e.sourceMetadata)
    ) {
      const raw = JSON.stringify(e.sourceMetadata);
      if (Buffer.byteLength(raw, "utf-8") <= 16 * 1024) {
        item.sourceMetadata = e.sourceMetadata;
      }
    }
    if (Array.isArray(e.mediaRefs)) {
      const refs = e.mediaRefs
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.slice(0, 512))
        .filter(Boolean)
        .slice(0, 64);
      if (refs.length) item.mediaRefs = refs;
    }
    if (typeof e.folderId === "string" && e.folderId.trim()) {
      item.folderId = e.folderId.trim().slice(0, 80);
    }
    ops.push({
      op: "put",
      item,
    });
  });

  ops.push({
    op: "put",
    item: {
      pk: ownerId,
      sk: SK_META,
      activeEntryId: store.activeEntryId,
      ...(foldersFromUnknown(store.folders)
        ? { folders: foldersFromUnknown(store.folders) }
        : {}),
    },
  });

  await batchWriteAll(table, ops);
}

async function tryMigrateLegacyS3Json(
  bucket: string,
  table: string,
  ownerId: string,
): Promise<JournalStoreV2 | null> {
  try {
    const out = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: legacyStoreKey(ownerId),
      }),
    );
    const raw = await out.Body?.transformToString("utf-8");
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
    if (!isStoreV2(parsed)) return null;
    await persistStoreToDdb(table, ownerId, parsed);
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: legacyStoreKey(ownerId),
        }),
      );
    } catch {
      /* migrated data is in DDB; S3 delete is best-effort */
    }
    return parsed;
  } catch (e: unknown) {
    const name =
      e && typeof e === "object" && "name" in e ? String((e as { name: string }).name) : "";
    const status =
      e && typeof e === "object" && "$metadata" in e
        ? (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
        : undefined;
    if (name === "NoSuchKey" || status === 404) return null;
    throw e;
  }
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method === "OPTIONS") return options();

  const table = process.env.JOURNAL_TABLE_NAME?.trim();
  if (!table) {
    return json(500, { error: "JOURNAL_TABLE_NAME is not set" });
  }

  if (method === "GET") {
    const user = await optionalUserJson(event);
    // Guests use local demo / device journal only — never scan every owner's store.
    if (!user) {
      return json(200, { store: null });
    }
    const ownerId = user.sub;
    try {
      const items = await queryAllItems(table, ownerId);
      if (items.length) {
        const store = ddbItemsToStore(items);
        return json(200, {
          store: store ?? { version: 2, activeEntryId: null, entries: [] },
        });
      }
      const bucket = process.env.MEDIA_BUCKET_NAME?.trim();
      if (bucket) {
        const migrated = await tryMigrateLegacyS3Json(bucket, table, ownerId);
        if (migrated) return json(200, { store: migrated });
      }
      return json(200, { store: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Read failed";
      return json(500, { error: msg });
    }
  }

  if (method !== "PUT") {
    return json(405, { error: "Method not allowed" });
  }

  let bodyRaw = event.body ?? "";
  if (event.isBase64Encoded && bodyRaw) {
    bodyRaw = Buffer.from(bodyRaw, "base64").toString("utf-8");
  }
  const byteLen = Buffer.byteLength(bodyRaw, "utf-8");
  if (byteLen > MAX_REQUEST_BODY_BYTES) {
    return json(413, {
      error: `Journal request too large (${byteLen} bytes). Max ${MAX_REQUEST_BODY_BYTES}. Upload voice via POST /journal/voice and use URLs in HTML.`,
    });
  }

  const auth = await requireUserJson(event);
  if ("statusCode" in auth) return auth;
  const ownerId = (auth as { sub: string }).sub;

  let body: { store?: unknown };
  try {
    body = JSON.parse(bodyRaw || "{}") as { store?: unknown };
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  if (!isStoreV2(body.store)) {
    return json(400, { error: "`store` must be a v2 journal object with entries[]" });
  }

  try {
    const err = validateStoreForWrite(body.store);
    if (err) return json(400, { error: err });
    await persistStoreToDdb(table, ownerId, body.store);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Write failed";
    if (msg.startsWith("Too many") || msg.includes("contentHtml") || msg.includes("title")) {
      return json(400, { error: msg });
    }
    if (msg.includes("activeEntryId")) return json(400, { error: msg });
    return json(500, { error: msg });
  }

  return json(200, { ok: true });
}
