import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { requireUserJson } from "../lib/medimade-auth-http";

const s3 = new S3Client({});

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

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

function options(): APIGatewayProxyStructuredResultV2 {
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

function sanitizeOwnerId(raw: string): string | null {
  const t = raw.trim();
  if (!t || t.length > 128) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(t)) return null;
  return t;
}

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4") || m.includes("m4a")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("ogg")) return "ogg";
  return "webm";
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method === "OPTIONS") return options();

  if (method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = await requireUserJson(event);
  if ("statusCode" in auth) return auth;
  const userId = (auth as { sub: string }).sub;

  const bucket = process.env.MEDIA_BUCKET_NAME?.trim();
  const cfDomain = process.env.MEDIA_CLOUDFRONT_DOMAIN?.trim();
  if (!bucket || !cfDomain) {
    return json(500, { error: "MEDIA_BUCKET_NAME or MEDIA_CLOUDFRONT_DOMAIN is not set" });
  }

  let bodyRaw = event.body ?? "";
  if (event.isBase64Encoded && bodyRaw) {
    bodyRaw = Buffer.from(bodyRaw, "base64").toString("utf-8");
  }

  let body: { ownerId?: unknown; audioBase64?: unknown; mimeType?: unknown };
  try {
    body = JSON.parse(bodyRaw || "{}") as {
      ownerId?: unknown;
      audioBase64?: unknown;
      mimeType?: unknown;
    };
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const ownerId = typeof body.ownerId === "string" ? sanitizeOwnerId(body.ownerId) : null;
  if (!ownerId) {
    return json(400, { error: "`ownerId` is required (alphanumeric, _ -, max 128)" });
  }

  const b64 = typeof body.audioBase64 === "string" ? body.audioBase64.trim() : "";
  if (!b64) {
    return json(400, { error: "`audioBase64` is required" });
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return json(400, { error: "Invalid base64 audio" });
  }
  if (buf.length < 64) {
    return json(400, { error: "Audio payload too small" });
  }
  if (buf.length > MAX_AUDIO_BYTES) {
    return json(413, { error: `Audio exceeds max size (${MAX_AUDIO_BYTES} bytes)` });
  }

  const mimeType =
    typeof body.mimeType === "string" && body.mimeType.trim()
      ? body.mimeType.trim()
      : "audio/webm";
  const ext = extFromMime(mimeType);
  const key = `journal/voice/${userId}/${randomUUID()}.${ext}`;

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buf,
        ContentType: mimeType,
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload failed";
    return json(500, { error: msg });
  }

  const url = `https://${cfDomain}/${key}`;
  return json(200, { key, url });
}
