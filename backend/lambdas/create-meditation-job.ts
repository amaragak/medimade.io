import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { randomUUID } from "crypto";
import { FIXED_SPEECH_PREVIEW_SPEED } from "../lib/speaker-sample-speed";
import { requireUserJson } from "../lib/medimade-auth-http";

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

  const auth = await requireUserJson(event);
  if ("statusCode" in auth) return auth;
  const userId = (auth as { sub: string }).sub;

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
    voiceFxPreset?: string;
    /** True when the user used journal / “How I feel” flow (no real style label). */
    journalMode?: boolean;
    /** 2, 5, or 10 — guided meditation length target for coach + script. */
    meditationTargetMinutes?: number;
    backgroundSoundKey?: string;
    backgroundNatureKey?: string;
    backgroundMusicKey?: string;
    backgroundDrumsKey?: string;
    backgroundNoiseKey?: string;
    backgroundNatureGain?: number;
    backgroundMusicGain?: number;
    backgroundDrumsGain?: number;
    backgroundNoiseGain?: number;
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
  const speed = FIXED_SPEECH_PREVIEW_SPEED;
  const voiceFxPreset =
    typeof body.voiceFxPreset === "string" && body.voiceFxPreset.trim().length > 0
      ? body.voiceFxPreset.trim()
      : undefined;
  const backgroundSoundKey =
    typeof body.backgroundSoundKey === "string" &&
    body.backgroundSoundKey.trim().length > 0
      ? body.backgroundSoundKey.trim()
      : undefined;

  const optTrim = (v: unknown) =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
  const optGain = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;

  const backgroundNatureKey = optTrim(body.backgroundNatureKey);
  const backgroundMusicKey = optTrim(body.backgroundMusicKey);
  const backgroundDrumsKey = optTrim(body.backgroundDrumsKey);
  const backgroundNoiseKey = optTrim(body.backgroundNoiseKey);
  const backgroundNatureGain = optGain(body.backgroundNatureGain);
  const backgroundMusicGain = optGain(body.backgroundMusicGain);
  const backgroundDrumsGain = optGain(body.backgroundDrumsGain);
  const backgroundNoiseGain = optGain(body.backgroundNoiseGain);

  const journalMode = body.journalMode === true;

  const rawLen = body.meditationTargetMinutes;
  const meditationTargetMinutes =
    rawLen === 2 || rawLen === 5 || rawLen === 10 ? rawLen : 5;

  const jobId = randomUUID();
  const now = new Date().toISOString();

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        jobId,
        userId,
        status: "pending",
        createdAt: now,
        updatedAt: now,
        transcript,
        meditationStyle,
        scriptText,
        referenceId,
        speed,
        ...(journalMode ? { journalMode: true } : {}),
        meditationTargetMinutes,
        ...(voiceFxPreset ? { voiceFxPreset } : {}),
        backgroundSoundKey,
        ...(backgroundNatureKey ? { backgroundNatureKey } : {}),
        ...(backgroundMusicKey ? { backgroundMusicKey } : {}),
        ...(backgroundDrumsKey ? { backgroundDrumsKey } : {}),
        ...(backgroundNoiseKey ? { backgroundNoiseKey } : {}),
        ...(backgroundNatureGain !== undefined
          ? { backgroundNatureGain }
          : {}),
        ...(backgroundMusicGain !== undefined
          ? { backgroundMusicGain }
          : {}),
        ...(backgroundDrumsGain !== undefined
          ? { backgroundDrumsGain }
          : {}),
        ...(backgroundNoiseGain !== undefined
          ? { backgroundNoiseGain }
          : {}),
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

