import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { requireUserJson } from "../lib/medimade-auth-http";

const OPENAI_TRANSCRIPTIONS_URL =
  "https://api.openai.com/v1/audio/transcriptions";

/** API Gateway HTTP payload limit is tight; keep uploads small. */
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

const secrets = new SecretsManagerClient({});
const s3 = new S3Client({});
let cachedOpenAiKey: string | undefined;

async function getOpenAiApiKey(): Promise<string> {
  if (cachedOpenAiKey) return cachedOpenAiKey;
  const arn = process.env.OPENAI_SECRET_ARN;
  if (!arn) throw new Error("OPENAI_SECRET_ARN is not set");
  const out = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
  const s = out.SecretString?.trim();
  if (!s) throw new Error("OpenAI API key secret is empty");
  cachedOpenAiKey = s;
  return cachedOpenAiKey;
}

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4") || m.includes("m4a")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("caf")) return "caf";
  return "bin";
}

function json(
  statusCode: number,
  payload: Record<string, unknown>,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(payload),
  };
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;

  if (method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Max-Age": "86400",
      },
      body: "",
    };
  }

  if (method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = await requireUserJson(event);
  if ("statusCode" in auth) return auth;
  const userId = (auth as { sub: string }).sub;

  const bucket = process.env.MEDIA_BUCKET_NAME?.trim();
  if (!bucket) {
    return json(500, { error: "MEDIA_BUCKET_NAME is not set" });
  }

  let apiKey: string;
  try {
    apiKey = await getOpenAiApiKey();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Secret lookup failed";
    return json(500, { error: msg });
  }

  let body: { audioBase64?: string; mimeType?: string };
  try {
    body = JSON.parse(event.body || "{}") as { audioBase64?: string; mimeType?: string };
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const b64 =
    typeof body.audioBase64 === "string" ? body.audioBase64.trim() : "";
  if (!b64) {
    return json(400, { error: "Field `audioBase64` (base64-encoded audio) is required" });
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return json(400, { error: "Invalid base64 in audioBase64" });
  }

  if (buf.length === 0 || buf.length > MAX_AUDIO_BYTES) {
    return json(400, {
      error: `Audio size must be between 1 and ${MAX_AUDIO_BYTES} bytes after base64 decode`,
    });
  }

  const mime =
    typeof body.mimeType === "string" && body.mimeType.trim()
      ? body.mimeType.trim()
      : "audio/webm";

  const ext = extFromMime(mime);
  const filename = `journal-${randomUUID().slice(0, 8)}.${ext}`;

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: mime }), filename);
  form.append("model", "whisper-1");

  const upstream = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!upstream.ok) {
    const detail = await upstream.text();
    return json(upstream.status >= 400 ? upstream.status : 502, {
      error: "OpenAI Whisper request failed",
      detail: detail.slice(0, 2000),
    });
  }

  let text = "";
  try {
    const data = (await upstream.json()) as { text?: string };
    text = typeof data.text === "string" ? data.text : "";
  } catch {
    return json(502, { error: "Invalid JSON from OpenAI" });
  }

  const id = randomUUID();
  const d = new Date();
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const prefix = `journal-transcriptions/${userId}/${y}/${mo}`;
  const audioKey = `${prefix}/${id}.${ext}`;
  const metaKey = `${prefix}/${id}.json`;

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: audioKey,
        Body: buf,
        ContentType: mime,
      }),
    );
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: metaKey,
        Body: JSON.stringify({
          text,
          audioKey,
          mimeType: mime,
          model: "whisper-1",
          transcribedAt: d.toISOString(),
        }),
        ContentType: "application/json; charset=utf-8",
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "S3 upload failed";
    console.error("journal-transcribe S3", msg);
    return json(500, { error: "Could not store transcription in media bucket", detail: msg });
  }

  return json(200, {
    text,
    storage: { audioKey, metaKey },
  });
}
