import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

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

  const tableName = process.env.MEDITATION_ANALYTICS_TABLE_NAME;
  if (!tableName) {
    return json(500, { error: "MEDITATION_ANALYTICS_TABLE_NAME is not set" });
  }

  const limitRaw = event.queryStringParameters?.limit;
  const limitN = limitRaw ? Number(limitRaw) : 200;
  const limit =
    Number.isFinite(limitN) && limitN > 0 ? Math.min(1000, Math.floor(limitN)) : 200;

  try {
    const out = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": "meditation" },
        ScanIndexForward: false, // newest first (sk is ISO timestamp prefix)
        Limit: limit,
      }),
    );

    return json(200, {
      items: out.Items ?? [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Analytics query failed";
    return json(500, { error: msg });
  }
}

