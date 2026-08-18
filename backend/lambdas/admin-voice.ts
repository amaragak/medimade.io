import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { S3Client } from "@aws-sdk/client-s3";
import { requireAdminJson } from "../lib/admin-auth";
import { SCRIPT_PAUSE_BANDS, type ScriptPauseBand } from "../lib/script-pause-bands";
import { FIXED_SPEECH_PREVIEW_SPEED, speakerPreviewLoudSampleKey } from "../lib/speaker-sample-speed";
import {
  generateFishSpeakerPreview,
  speakerPreviewExists,
} from "../lib/fish-speaker-preview";
import {
  deleteVoiceSpeaker,
  loadPauseBandSeconds,
  listVoiceSpeakers,
  putVoiceSpeaker,
  savePauseBandSeconds,
  seedVoiceSpeakersIfEmpty,
  type PauseBandSeconds,
  type VoiceSpeakerRow,
} from "../lib/voice-admin";

const s3 = new S3Client({});
const secrets = new SecretsManagerClient({});

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
  if (method === "OPTIONS") return json(204, {});

  const admin = await requireAdminJson(event);
  if ("statusCode" in admin) return admin;

  try {
    if (method === "GET") return await handleGet();
    if (method === "PATCH") return await handlePatch(event);
    if (method === "POST") return await handlePost(event);
    return json(405, { error: "Method not allowed" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Admin voice failed";
    console.error("admin-voice", msg);
    return json(500, { error: msg });
  }
}

async function handleGet() {
  const domain = (process.env.MEDIA_CLOUDFRONT_DOMAIN || "").trim();
  const baseUrl = domain ? `https://${domain}` : undefined;
  const bucket = process.env.MEDIA_BUCKET_NAME?.trim();
  const [speakers, pauses] = await Promise.all([
    seedVoiceSpeakersIfEmpty(),
    loadPauseBandSeconds(),
  ]);
  const withSamples = await Promise.all(
    speakers.map(async (s) => {
      let hasSample = false;
      if (bucket) {
        try {
          hasSample = await speakerPreviewExists(s3, bucket, s.modelId);
        } catch {
          hasSample = false;
        }
      }
      const sampleKey = speakerPreviewLoudSampleKey(s.modelId, FIXED_SPEECH_PREVIEW_SPEED);
      const bust = encodeURIComponent(s.updatedAt || String(Date.now()));
      return {
        ...s,
        hasSample,
        sampleUrl: hasSample && baseUrl ? `${baseUrl}/${sampleKey}?v=${bust}` : null,
      };
    }),
  );
  return json(200, { baseUrl, speakers: withSamples, pauses, pauseBands: SCRIPT_PAUSE_BANDS });
}

async function handlePatch(event: APIGatewayProxyEventV2) {
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(event.body || "{}") as Record<string, unknown>;
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  let pauses: PauseBandSeconds | undefined;
  if (body.pauses && typeof body.pauses === "object") {
    pauses = await savePauseBandSeconds(body.pauses as Partial<Record<ScriptPauseBand, number>>);
  }

  let speaker: VoiceSpeakerRow | undefined;
  if (body.speaker && typeof body.speaker === "object") {
    const s = body.speaker as Record<string, unknown>;
    speaker = await putVoiceSpeaker({
      modelId: String(s.modelId ?? ""),
      name: String(s.name ?? ""),
      hidden: s.hidden === true,
      sort: typeof s.sort === "number" ? s.sort : undefined,
      description: typeof s.description === "string" ? s.description : undefined,
    });
  }

  return json(200, { ok: true, pauses, speaker });
}

async function handlePost(event: APIGatewayProxyEventV2) {
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(event.body || "{}") as Record<string, unknown>;
  } catch {
    return json(400, { error: "Invalid JSON" });
  }
  const action = String(body.action ?? "").trim();
  if (action === "delete") {
    const modelId = String(body.modelId ?? "").trim();
    if (!modelId) return json(400, { error: "modelId is required" });
    await deleteVoiceSpeaker(modelId);
    return json(200, { ok: true });
  }
  if (action === "sample") {
    const modelId = String(body.modelId ?? "").trim();
    if (!modelId) return json(400, { error: "modelId is required" });
    const bucket = process.env.MEDIA_BUCKET_NAME?.trim();
    if (!bucket) return json(500, { error: "MEDIA_BUCKET_NAME is not set" });
    const arn = process.env.FISH_AUDIO_SECRET_ARN;
    if (!arn) return json(500, { error: "FISH_AUDIO_SECRET_ARN is not set" });
    const secret = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
    const apiKey = secret.SecretString?.trim();
    if (!apiKey) return json(500, { error: "Fish Audio API key is empty" });
    const keys = await generateFishSpeakerPreview({
      s3,
      bucket,
      apiKey,
      modelId,
      apiBase: process.env.MEDIMADE_API_URL?.trim() || null,
    });
    const existing = (await listVoiceSpeakers()).find((s) => s.modelId === modelId);
    if (existing && !keys.skipped) {
      await putVoiceSpeaker({
        modelId,
        name: existing.name,
        hidden: existing.hidden,
        sort: existing.sort,
        description: existing.description,
      });
    }
    const domain = (process.env.MEDIA_CLOUDFRONT_DOMAIN || "").trim();
    const sampleUrl = domain
      ? `https://${domain}/${speakerPreviewLoudSampleKey(modelId, FIXED_SPEECH_PREVIEW_SPEED)}`
      : null;
    return json(200, { ok: true, ...keys, sampleUrl });
  }
  return json(400, { error: "Unknown action" });
}
