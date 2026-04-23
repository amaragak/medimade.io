import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { requireUserJson } from "../lib/medimade-auth-http";
import {
  LEGACY_MEDITATION_PARTITION_PK,
  meditationGlobalUserPk,
  meditationUserPk,
} from "../lib/meditation-user-pk";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MAX_DRAFT_STATE_BYTES = 350_000;

async function getDraftRowWithPartition(
  tableName: string,
  partitionKeys: string[],
  sk: string,
): Promise<{ item: Record<string, unknown>; pk: string } | null> {
  for (const pk of partitionKeys) {
    const out = await ddb.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk, sk },
      }),
    );
    const item = out.Item;
    if (item && item.isDraft === true) {
      return { item: item as Record<string, unknown>, pk };
    }
  }
  return null;
}

function json(
  statusCode: number,
  payload: Record<string, unknown>,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  const tableName = process.env.MEDITATION_ANALYTICS_TABLE_NAME;
  if (!tableName) {
    return json(500, { error: "Draft API is not configured" });
  }

  const auth = await requireUserJson(event);
  if ("statusCode" in auth) return auth;
  const user = auth as { sub: string };
  const userPk = meditationUserPk(user.sub);
  const globalPk = meditationGlobalUserPk();
  const legacyPk = LEGACY_MEDITATION_PARTITION_PK;
  const readPartitions = [userPk, globalPk, legacyPk];

  if (method === "GET") {
    const skRaw = event.queryStringParameters?.sk?.trim();
    if (!skRaw) {
      return json(400, { error: "Query parameter `sk` is required" });
    }
    try {
      const found = await getDraftRowWithPartition(tableName, readPartitions, skRaw);
      if (!found) {
        return json(404, { error: "Draft not found" });
      }
      const item = found.item;
      let draftState: unknown;
      const raw = item.draftState;
      if (typeof raw === "string") {
        try {
          draftState = JSON.parse(raw) as unknown;
        } catch {
          return json(500, { error: "Stored draft state is invalid JSON" });
        }
      } else {
        draftState = raw ?? null;
      }
      return json(200, {
        sk: item.sk,
        id: item.id,
        createdAt: item.createdAt,
        title: typeof item.title === "string" ? item.title : null,
        meditationStyle:
          typeof item.meditationStyle === "string" ? item.meditationStyle : null,
        draftState,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Get draft failed";
      return json(500, { error: msg });
    }
  }

  if (method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body: {
    sk?: string;
    title?: string;
    meditationStyle?: string | null;
    draftState?: unknown;
  };
  try {
    body = JSON.parse(event.body || "{}") as typeof body;
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  if (body.draftState === undefined || body.draftState === null) {
    return json(400, { error: "Field `draftState` is required" });
  }
  if (typeof body.draftState !== "object") {
    return json(400, { error: "Field `draftState` must be an object" });
  }

  const draftStateStr = JSON.stringify(body.draftState);
  const stateBytes = Buffer.byteLength(draftStateStr, "utf8");
  if (stateBytes > MAX_DRAFT_STATE_BYTES) {
    return json(413, {
      error: `Draft too large (${stateBytes} bytes); max ${MAX_DRAFT_STATE_BYTES}`,
    });
  }

  const titleIn =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim().slice(0, 200)
      : null;
  const meditationStyle =
    typeof body.meditationStyle === "string" && body.meditationStyle.trim()
      ? body.meditationStyle.trim().slice(0, 120)
      : null;

  try {
    let sk: string;
    let id: string;
    let createdAt: string;
    let s3Key: string;

    const existingSk =
      typeof body.sk === "string" && body.sk.trim() ? body.sk.trim() : null;

    if (existingSk) {
      const found = await getDraftRowWithPartition(tableName, readPartitions, existingSk);
      if (!found) {
        return json(404, { error: "Draft not found or not a draft" });
      }
      const prev = found.item;
      const targetPk = found.pk;
      sk = existingSk;
      id = typeof prev.id === "string" ? prev.id : randomUUID();
      createdAt =
        typeof prev.createdAt === "string"
          ? prev.createdAt
          : new Date().toISOString();
      const prevS3 = typeof prev.s3Key === "string" ? prev.s3Key : "";
      if (prevS3.startsWith("drafts/")) {
        s3Key = prevS3;
      } else if (targetPk === globalPk) {
        s3Key = `drafts/_/${id}`;
      } else {
        s3Key = `drafts/${user.sub}/${id}`;
      }
      await ddb.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: targetPk,
            sk,
            id,
            createdAt,
            isDraft: true,
            s3Key,
            title:
              titleIn ??
              (meditationStyle
                ? `Draft · ${meditationStyle}`.slice(0, 200)
                : "Draft"),
            meditationStyle: meditationStyle ?? null,
            draftState: draftStateStr,
            rating: null,
            favourite: false,
          },
        }),
      );
      return json(200, {
        sk,
        id,
        createdAt,
        title:
          titleIn ??
          (meditationStyle
            ? `Draft · ${meditationStyle}`.slice(0, 200)
            : "Draft"),
      });
    }

    const targetPk = userPk;
    {
      createdAt = new Date().toISOString();
      id = randomUUID();
      sk = `${createdAt}#${id}`;
      s3Key = `drafts/${user.sub}/${id}`;
    }

    const title =
      titleIn ??
      (meditationStyle
        ? `Draft · ${meditationStyle}`.slice(0, 200)
        : "Draft");

    await ddb.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk: targetPk,
          sk,
          id,
          createdAt,
          isDraft: true,
          s3Key,
          title,
          meditationStyle: meditationStyle ?? null,
          draftState: draftStateStr,
          rating: null,
          favourite: false,
        },
      }),
    );

    return json(200, { sk, id, createdAt, title });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Save draft failed";
    return json(500, { error: msg });
  }
}
