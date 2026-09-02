/**
 * Persist V3 no-match signals for Script Lab CSV download.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const SCRIPT_LAB_V3_NOMATCH_PK = "SCRIPT_LAB_V3_NOMATCH";

export type ScriptLabV3NoMatchRow = {
  id: string;
  text: string;
  meditationType: string;
  targetDuration: number;
  topMatchTag: string | null;
  topMatchScore: number | null;
  createdAt: string;
};

function requireTable(): string {
  const n = process.env.VOICE_ADMIN_TABLE_NAME?.trim();
  if (!n) throw new Error("VOICE_ADMIN_TABLE_NAME is not set");
  return n;
}

export async function appendScriptLabV3NoMatchLogs(
  rows: Array<{
    text: string;
    meditationType: string;
    targetDuration: number;
    topMatchTag?: string | null;
    topMatchScore?: number | null;
  }>,
): Promise<void> {
  const TableName = requireTable();
  const now = new Date().toISOString();
  for (const row of rows) {
    const id = randomUUID();
    await ddb.send(
      new PutCommand({
        TableName,
        Item: {
          pk: SCRIPT_LAB_V3_NOMATCH_PK,
          sk: `${now}#${id}`,
          id,
          text: row.text.slice(0, 2000),
          meditationType: row.meditationType.slice(0, 80),
          targetDuration: row.targetDuration,
          topMatchTag: row.topMatchTag ?? null,
          topMatchScore: row.topMatchScore ?? null,
          createdAt: now,
        },
      }),
    );
  }
}

export async function listScriptLabV3NoMatchLogs(limit = 2000): Promise<ScriptLabV3NoMatchRow[]> {
  const TableName = requireTable();
  const out: ScriptLabV3NoMatchRow[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": SCRIPT_LAB_V3_NOMATCH_PK },
        ExclusiveStartKey,
        ScanIndexForward: false,
        Limit: Math.min(200, limit - out.length),
      }),
    );
    for (const item of res.Items ?? []) {
      out.push({
        id: String(item.id ?? ""),
        text: String(item.text ?? ""),
        meditationType: String(item.meditationType ?? ""),
        targetDuration: Number(item.targetDuration) || 0,
        topMatchTag: typeof item.topMatchTag === "string" ? item.topMatchTag : null,
        topMatchScore:
          typeof item.topMatchScore === "number" ? item.topMatchScore : null,
        createdAt: String(item.createdAt ?? ""),
      });
      if (out.length >= limit) break;
    }
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey && out.length < limit);
  return out;
}

export function noMatchLogsToCsv(rows: ScriptLabV3NoMatchRow[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = [
    "text,meditationType,targetDuration,topMatchTag,topMatchScore,createdAt",
  ];
  for (const r of rows) {
    lines.push(
      [
        esc(r.text),
        esc(r.meditationType),
        String(r.targetDuration),
        esc(r.topMatchTag ?? ""),
        r.topMatchScore == null ? "" : String(r.topMatchScore),
        esc(r.createdAt),
      ].join(","),
    );
  }
  return lines.join("\n");
}
