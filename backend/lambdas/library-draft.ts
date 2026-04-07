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

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const MAX_DRAFT_STATE_BYTES = 350_000;

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

  if (method === "GET") {
    const skRaw = event.queryStringParameters?.sk?.trim();
    if (!skRaw) {
      return json(400, { error: "Query parameter `sk` is required" });
    }
    try {
      const out = await ddb.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: "meditation", sk: skRaw },
        }),
      );
      const item = out.Item;
      if (!item || item.isDraft !== true) {
        return json(404, { error: "Draft not found" });
      }
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
      const got = await ddb.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: "meditation", sk: existingSk },
        }),
      );
      const prev = got.Item;
      if (!prev || prev.isDraft !== true) {
        return json(404, { error: "Draft not found or not a draft" });
      }
      sk = existingSk;
      id = typeof prev.id === "string" ? prev.id : randomUUID();
      createdAt =
        typeof prev.createdAt === "string"
          ? prev.createdAt
          : new Date().toISOString();
      s3Key =
        typeof prev.s3Key === "string" && prev.s3Key.startsWith("drafts/")
          ? prev.s3Key
          : `drafts/${id}`;
    } else {
      createdAt = new Date().toISOString();
      id = randomUUID();
      sk = `${createdAt}#${id}`;
      s3Key = `drafts/${id}`;
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
          pk: "meditation",
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
