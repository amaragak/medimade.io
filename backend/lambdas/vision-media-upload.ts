/**
 * Upload Ideate vision media (self-reference / board tiles) to S3 for cloud sync.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { requireUserJson } from "../lib/medimade-auth-http";

const s3 = new S3Client({});
const MAX_BYTES = 8 * 1024 * 1024;

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
      "Access-Control-Allow-Headers":
        "Content-Type,Authorization,X-Medimade-Authorization",
      "Access-Control-Max-Age": "86400",
    },
    body: "",
  };
}

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  return "jpg";
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method === "OPTIONS") return options();
  if (method !== "POST") return json(405, { error: "Method not allowed" });

  const auth = await requireUserJson(event);
  if ("statusCode" in auth) return auth;
  const userId = (auth as { sub: string }).sub;

  const bucket = process.env.MEDIA_BUCKET_NAME?.trim();
  const cfDomain = process.env.MEDIA_CLOUDFRONT_DOMAIN?.trim();
  if (!bucket || !cfDomain) {
    return json(500, {
      error: "MEDIA_BUCKET_NAME or MEDIA_CLOUDFRONT_DOMAIN is not set",
    });
  }

  let bodyRaw = event.body ?? "";
  if (event.isBase64Encoded && bodyRaw) {
    bodyRaw = Buffer.from(bodyRaw, "base64").toString("utf-8");
  }

  let body: {
    imageBase64?: unknown;
    mimeType?: unknown;
    kind?: unknown;
  };
  try {
    body = JSON.parse(bodyRaw || "{}") as typeof body;
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const b64 =
    typeof body.imageBase64 === "string" ? body.imageBase64.trim() : "";
  if (!b64) return json(400, { error: "`imageBase64` is required" });

  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return json(400, { error: "Invalid base64 image" });
  }
  if (buf.length < 64) return json(400, { error: "Image payload too small" });
  if (buf.length > MAX_BYTES) {
    return json(413, { error: `Image exceeds max size (${MAX_BYTES} bytes)` });
  }

  const mimeType =
    typeof body.mimeType === "string" && body.mimeType.trim()
      ? body.mimeType.trim().split(";")[0]!
      : "image/jpeg";
  if (!mimeType.startsWith("image/")) {
    return json(400, { error: "mimeType must be an image/* type" });
  }

  const kind =
    body.kind === "tile" || body.kind === "self" || body.kind === "extra"
      ? body.kind
      : "self";
  const ext = extFromMime(mimeType);
  const key = `ideate/vision/${userId}/${kind}/${randomUUID()}.${ext}`;

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
  return json(200, { key, url, mimeType, byteLength: buf.length });
}
