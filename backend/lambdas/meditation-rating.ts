import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

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
  if (event.requestContext.http.method !== "PATCH") {
    return json(405, { error: "Method not allowed" });
  }

  const tableName = process.env.MEDITATION_ANALYTICS_TABLE_NAME;
  if (!tableName) {
    return json(500, { error: "MEDITATION_ANALYTICS_TABLE_NAME is not set" });
  }

  let body: { sk?: unknown; rating?: unknown };
  try {
    body = JSON.parse(event.body ?? "{}") as { sk?: unknown; rating?: unknown };
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const sk = typeof body.sk === "string" ? body.sk.trim() : "";
  if (!sk) {
    return json(400, { error: "`sk` (sort key from library item) is required" });
  }

  const rawRating = body.rating;
  let ratingValue: number | null;
  if (rawRating === null || rawRating === undefined) {
    ratingValue = null;
  } else if (typeof rawRating === "number" && Number.isFinite(rawRating)) {
    const r = Math.round(rawRating);
    if (r < 1 || r > 5) {
      return json(400, { error: "rating must be between 1 and 5, or null to clear" });
    }
    ratingValue = r;
  } else {
    return json(400, { error: "rating must be a number 1–5 or null" });
  }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: "meditation", sk },
        UpdateExpression: "SET #r = :r",
        ExpressionAttributeNames: { "#r": "rating" },
        ExpressionAttributeValues: { ":r": ratingValue },
        // Avoid creating a spurious row if sk is wrong.
        ConditionExpression: "attribute_exists(s3Key)",
      }),
    );
  } catch (e) {
    const name =
      e && typeof e === "object" && "name" in e
        ? String((e as { name: string }).name)
        : "";
    if (name === "ConditionalCheckFailedException") {
      return json(404, { error: "Meditation not found" });
    }
    const msg = e instanceof Error ? e.message : "Update failed";
    return json(500, { error: msg });
  }

  return json(200, { ok: true, rating: ratingValue });
}
