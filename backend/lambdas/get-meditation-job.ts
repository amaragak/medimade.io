import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  meditationPlaybackAudioUrl,
  meditationPlaybackS3Key,
} from "../lib/playback-keys";
import { GLOBAL_MEDITATION_USER_ID } from "../lib/meditation-user-pk";
import { requireUserJson } from "../lib/medimade-auth-http";

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
  const callerId = (auth as { sub: string }).sub;

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

  const jobUserId =
    typeof out.Item.userId === "string" && out.Item.userId.trim()
      ? out.Item.userId.trim()
      : "";
  const isGlobalJob =
    !jobUserId ||
    jobUserId === GLOBAL_MEDITATION_USER_ID;
  if (!isGlobalJob && jobUserId !== callerId) {
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

  const playbackKey =
    typeof audioKey === "string" ? meditationPlaybackS3Key(audioKey) : audioKey;
  const playbackUrl =
    typeof audioUrl === "string"
      ? meditationPlaybackAudioUrl(audioUrl)
      : audioUrl;

  return json(200, {
    jobId,
    status,
    audioUrl: playbackUrl,
    scriptTextUsed,
    audioKey: playbackKey,
    title,
    description,
    error: errorMessage ?? undefined,
    createdAt,
    updatedAt,
  });
}

