import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { randomUUID } from "crypto";
import { FIXED_SPEECH_PREVIEW_SPEED } from "../lib/speaker-sample-speed";
import { optionalUserJson } from "../lib/medimade-auth-http";
import { GLOBAL_MEDITATION_USER_ID } from "../lib/meditation-user-pk";
import {
  normalizeOrpheusVoiceId,
  normalizeTtsProvider,
  type TtsProvider,
} from "../lib/orpheus-voices";
import { coerceClaudeModel } from "../lib/anthropic-pricing";
import { coerceMeditationTargetMinutes } from "../lib/meditation-target-minutes";

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

  let body: {
    transcript?: string;
    meditationStyle?: string;
    scriptText?: string;
    reference_id?: string;
    ttsProvider?: string;
    /** Fish Audio model: `s2.1-pro` / `s2.1-pro-free` or `s1` (quality A/B). */
    fishTtsModel?: string;
    speed?: number;
    voiceFxPreset?: string;
    sessionToken?: string;
    /** True when the user used journal / “How I feel” flow (no real style label). */
    journalMode?: boolean;
    /** Guided meditation length target in minutes, for coach + script. */
    meditationTargetMinutes?: number;
    /** Dev-only Claude A/B; unsupported ids fall back to Haiku in the worker. */
    claudeModel?: string;
    /** `native` = Fish `[break]` / `[long-break]` …; `segmented` = ffmpeg silence (default). */
    fishPauseMode?: string;
    /** When true, do not index the result in the personal library (program shelf audio). */
    excludeFromLibrary?: boolean;
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

  const auth = await optionalUserJson(
    event,
    typeof body.sessionToken === "string" ? body.sessionToken : null,
  );
  const userId = auth?.sub?.trim() || GLOBAL_MEDITATION_USER_ID;

  const tableName = process.env.MEDITATION_JOBS_TABLE_NAME;
  const workerFn = process.env.WORKER_FUNCTION_NAME;
  if (!tableName || !workerFn) {
    return json(500, { error: "Job table or worker function not configured" });
  }

  const ttsProvider: TtsProvider = normalizeTtsProvider(body.ttsProvider);

  let referenceId =
    typeof body.reference_id === "string" && body.reference_id.trim()
      ? body.reference_id.trim()
      : "";
  if (ttsProvider === "orpheus") {
    const voice = normalizeOrpheusVoiceId(referenceId);
    if (!voice) {
      return json(400, {
        error: "`reference_id` must be a valid Orpheus voice id (e.g. tara, leah)",
      });
    }
    referenceId = voice;
  } else if (!referenceId) {
    return json(400, {
      error: "`reference_id` (Fish voice model id) is required",
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
  const excludeFromLibrary = body.excludeFromLibrary === true;

  const meditationTargetMinutes = coerceMeditationTargetMinutes(
    body.meditationTargetMinutes,
  );

  const claudeModel = coerceClaudeModel(body.claudeModel);

  const rawFishModel =
    typeof body.fishTtsModel === "string" ? body.fishTtsModel.trim() : "";
  const fishTtsModel =
    rawFishModel === "s1"
      ? "s1"
      : rawFishModel === "s2.1-pro" ||
          rawFishModel === "s2.1-pro-free" ||
          rawFishModel === ""
        ? "s2.1-pro-free"
        : "s2.1-pro-free";

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
        ttsProvider,
        fishTtsModel,
        speed,
        ...(journalMode ? { journalMode: true } : {}),
        ...(excludeFromLibrary ? { excludeFromLibrary: true } : {}),
        meditationTargetMinutes,
        claudeModel,
        fishPauseMode:
          body.fishPauseMode === "native" ? "native" : "segmented",
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

