import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  isValidConstraintTag,
  normalizeConstraintTag,
} from "./script-constraint-tags";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const SCRIPT_CONSTRAINT_VOCAB_PK = "SCRIPT_CONSTRAINT_VOCAB";

export const SEED_CONSTRAINT_TAGS = ["standing", "seated_or_lying"] as const;

export type ConstraintVocabRow = {
  tag: string;
  createdAt: string;
  updatedAt: string;
};

function tableName(): string | null {
  const n = process.env.VOICE_ADMIN_TABLE_NAME?.trim();
  return n || null;
}

function requireTable(): string {
  const n = tableName();
  if (!n) throw new Error("VOICE_ADMIN_TABLE_NAME is not set");
  return n;
}

export async function listConstraintVocabulary(): Promise<ConstraintVocabRow[]> {
  await seedConstraintVocabularyIfEmpty();
  const TableName = requireTable();
  const out: ConstraintVocabRow[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": SCRIPT_CONSTRAINT_VOCAB_PK },
        ExclusiveStartKey,
      }),
    );
    for (const item of res.Items ?? []) {
      const tag =
        typeof item.tag === "string"
          ? normalizeConstraintTag(item.tag)
          : typeof item.sk === "string"
            ? normalizeConstraintTag(item.sk)
            : "";
      if (!tag) continue;
      out.push({
        tag,
        createdAt: String(item.createdAt ?? ""),
        updatedAt: String(item.updatedAt ?? ""),
      });
    }
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  out.sort((a, b) => a.tag.localeCompare(b.tag));
  return out;
}

export async function seedConstraintVocabularyIfEmpty(): Promise<void> {
  const TableName = requireTable();
  const existing = await ddb.send(
    new QueryCommand({
      TableName,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": SCRIPT_CONSTRAINT_VOCAB_PK },
      Limit: 1,
    }),
  );
  if ((existing.Items ?? []).length > 0) return;
  const now = new Date().toISOString();
  for (const seed of SEED_CONSTRAINT_TAGS) {
    await ddb.send(
      new PutCommand({
        TableName,
        Item: {
          pk: SCRIPT_CONSTRAINT_VOCAB_PK,
          sk: seed,
          tag: seed,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );
  }
}

export async function putConstraintVocabularyTag(raw: string): Promise<ConstraintVocabRow> {
  const TableName = requireTable();
  const tag = normalizeConstraintTag(raw);
  if (!isValidConstraintTag(tag)) {
    throw new Error("Constraint tag must be lowercase letters, numbers, underscore (min 2 chars).");
  }
  const existing = await ddb.send(
    new GetCommand({ TableName, Key: { pk: SCRIPT_CONSTRAINT_VOCAB_PK, sk: tag } }),
  );
  const now = new Date().toISOString();
  const row: ConstraintVocabRow = {
    tag,
    createdAt: String(existing.Item?.createdAt ?? now),
    updatedAt: now,
  };
  await ddb.send(
    new PutCommand({
      TableName,
      Item: { pk: SCRIPT_CONSTRAINT_VOCAB_PK, sk: tag, ...row },
    }),
  );
  return row;
}

/** Add any missing tags; returns tags that were newly created. */
export async function ensureConstraintVocabularyTags(rawTags: string[]): Promise<string[]> {
  await seedConstraintVocabularyIfEmpty();
  const existing = new Set((await listConstraintVocabulary()).map((r) => r.tag));
  const added: string[] = [];
  for (const raw of rawTags) {
    const tag = normalizeConstraintTag(raw);
    if (!tag || !isValidConstraintTag(tag) || existing.has(tag)) continue;
    await putConstraintVocabularyTag(tag);
    existing.add(tag);
    added.push(tag);
  }
  added.sort();
  return added;
}

export async function deleteConstraintVocabularyTag(raw: string): Promise<void> {
  const TableName = requireTable();
  const tag = normalizeConstraintTag(raw);
  if (!tag) return;
  await ddb.send(
    new DeleteCommand({
      TableName,
      Key: { pk: SCRIPT_CONSTRAINT_VOCAB_PK, sk: tag },
    }),
  );
}
