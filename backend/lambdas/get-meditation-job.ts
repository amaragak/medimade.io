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
import { optionalUserJson } from "../lib/medimade-auth-http";

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

  const auth = await optionalUserJson(
    event,
    event.queryStringParameters?.sessionToken ?? null,
  );
  const callerId = auth?.sub?.trim() || "";

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
  // Unauthenticated poll is allowed for now (guest generate). Signed-in
  // callers still cannot read another user's non-global job.
  if (!isGlobalJob && callerId && jobUserId !== callerId) {
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
    durationSeconds,
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
      durationSeconds?: number | null;
    };

  const playbackKey =
    typeof audioKey === "string" ? meditationPlaybackS3Key(audioKey) : audioKey;
  const playbackUrl =
    typeof audioUrl === "string"
      ? meditationPlaybackAudioUrl(audioUrl)
      : audioUrl;

  const duration =
    typeof durationSeconds === "number" &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0
      ? durationSeconds
      : null;

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
    durationSeconds: duration,
  });
}

