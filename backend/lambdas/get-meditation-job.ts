import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

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

  const tableName = process.env.MEDITATION_JOBS_TABLE_NAME;
  if (!tableName) {
    return json(500, { error: "MEDITATION_JOBS_TABLE_NAME is not set" });
  }

  const jobId = event.pathParameters?.jobId;
  if (!jobId) {
    return json(400, { error: "`jobId` path parameter is required" });
  }

  const out = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { jobId },
    }),
  );

  if (!out.Item) {
    return json(404, { error: "Job not found" });
  }

  const {
    status,
    audioUrl,
    scriptTextUsed,
    audioKey,
    title,
    description,
    errorMessage,
    createdAt,
    updatedAt,
  } =
    out.Item as {
      status?: string;
      audioUrl?: string;
      scriptTextUsed?: string;
      audioKey?: string;
      title?: string;
      description?: string;
      errorMessage?: string;
      createdAt?: string;
      updatedAt?: string;
    };

  return json(200, {
    jobId,
    status,
    audioUrl,
    scriptTextUsed,
    audioKey,
    title,
    description,
    error: errorMessage ?? undefined,
    createdAt,
    updatedAt,
  });
}

