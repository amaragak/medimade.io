import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { requireUserJson } from "../lib/medimade-auth-http";
import {
  LEGACY_MEDITATION_PARTITION_PK,
  meditationGlobalUserPk,
  meditationUserPk,
} from "../lib/meditation-user-pk";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

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
  if (event.requestContext.http.method !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = await requireUserJson(event);
  if ("statusCode" in auth) return auth;
  const sub = (auth as { sub: string }).sub;
  const userPk = meditationUserPk(sub);
  const globalPk = meditationGlobalUserPk();
  const legacyPk = LEGACY_MEDITATION_PARTITION_PK;

  const tableName = process.env.MEDITATION_ANALYTICS_TABLE_NAME;
  if (!tableName) {
    return json(500, { error: "MEDITATION_ANALYTICS_TABLE_NAME is not set" });
  }

  const limitRaw = event.queryStringParameters?.limit;
  const limitN = limitRaw ? Number(limitRaw) : 200;
  const limit =
    Number.isFinite(limitN) && limitN > 0 ? Math.min(1000, Math.floor(limitN)) : 200;

  try {
    const [userOut, globalOut, legacyOut] = await Promise.all([
      ddb.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: { ":pk": userPk },
          ScanIndexForward: false,
          Limit: limit,
        }),
      ),
      ddb.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: { ":pk": globalPk },
          ScanIndexForward: false,
          Limit: limit,
        }),
      ),
      ddb.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: { ":pk": legacyPk },
          ScanIndexForward: false,
          Limit: limit,
        }),
      ),
    ]);

    const merged = [
      ...(userOut.Items ?? []),
      ...(globalOut.Items ?? []),
      ...(legacyOut.Items ?? []),
    ] as Array<{ sk?: string }>;
    merged.sort((a, b) => {
      const sa = typeof a.sk === "string" ? a.sk : "";
      const sb = typeof b.sk === "string" ? b.sk : "";
      return sb.localeCompare(sa);
    });

    return json(200, {
      items: merged.slice(0, limit),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Analytics query failed";
    return json(500, { error: msg });
  }
}

