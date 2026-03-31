import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { randomUUID } from "crypto";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambdaClient = new LambdaClient({});

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
  if (event.requestContext.http.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const tableName = process.env.MEDITATION_JOBS_TABLE_NAME;
  const workerFn = process.env.WORKER_FUNCTION_NAME;
  if (!tableName || !workerFn) {
    return json(500, { error: "Job table or worker function not configured" });
  }

  let body: {
    transcript?: string;
    meditationStyle?: string;
    scriptText?: string;
    reference_id?: string;
    speed?: number;
    backgroundSoundKey?: string;
  };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const referenceId =
    typeof body.reference_id === "string" && body.reference_id.trim()
      ? body.reference_id.trim()
      : "";
  if (!referenceId) {
    return json(400, {
      error: "`reference_id` (voice model id) is required",
    });
  }

  const transcript = typeof body.transcript === "string" ? body.transcript : "";
  const meditationStyle =
    typeof body.meditationStyle === "string" ? body.meditationStyle : "";
  const scriptText =
    typeof body.scriptText === "string" ? body.scriptText.trim() : "";
  const speed =
    typeof body.speed === "number" && Number.isFinite(body.speed)
      ? body.speed
      : undefined;
  const backgroundSoundKey =
    typeof body.backgroundSoundKey === "string" &&
    body.backgroundSoundKey.trim().length > 0
      ? body.backgroundSoundKey.trim()
      : undefined;

  const jobId = randomUUID();
  const now = new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        jobId,
        status: "pending",
        createdAt: now,
        updatedAt: now,
        transcript,
        meditationStyle,
        scriptText,
        referenceId,
        speed,
        backgroundSoundKey,
      },
    }),
  );

  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: workerFn,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify({ jobId }), "utf8"),
    }),
  );

  return json(202, { jobId });
}

