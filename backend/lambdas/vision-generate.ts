/**
 * Vision board scene generation via Gemini "Nano Banana" image models.
 * Uses a self-reference photo + text prompt so the user can appear in the scene.
 */

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
import { optionalUserJson } from "../lib/medimade-auth-http";

const secrets = new SecretsManagerClient({});
const s3 = new S3Client({});
let cachedGoogleKey: string | undefined;

/** Default = Nano Banana (Gemini 2.5 Flash Image). Override with VISION_IMAGE_MODEL. */
const DEFAULT_MODEL = "gemini-2.5-flash-image";
const MAX_REF_BYTES = 6 * 1024 * 1024;
const MAX_PROMPT_CHARS = 2000;

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

async function getGoogleAiApiKey(): Promise<string> {
  if (cachedGoogleKey) return cachedGoogleKey;
  const arn = process.env.GOOGLE_AI_SECRET_ARN?.trim();
  if (!arn) throw new Error("GOOGLE_AI_SECRET_ARN is not set");
  const out = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
  const s = out.SecretString?.trim();
  if (!s) throw new Error("Google AI API key secret is empty");
  cachedGoogleKey = s;
  return cachedGoogleKey;
}

function modelId(): string {
  return process.env.VISION_IMAGE_MODEL?.trim() || DEFAULT_MODEL;
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method === "OPTIONS") return options();
  if (method !== "POST") return json(405, { error: "Method not allowed" });

  let body: {
    prompt?: unknown;
    referenceBase64?: unknown;
    mimeType?: unknown;
    sessionToken?: unknown;
  };
  try {
    body = JSON.parse(event.body || "{}") as typeof body;
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const auth = await optionalUserJson(
    event,
    typeof body.sessionToken === "string" ? body.sessionToken : null,
  );
  const userId = auth?.sub?.trim() || "guest";

  const prompt =
    typeof body.prompt === "string" ? body.prompt.trim().slice(0, MAX_PROMPT_CHARS) : "";
  if (prompt.length < 3) {
    return json(400, { error: "Write a short scene description first." });
  }

  const b64 =
    typeof body.referenceBase64 === "string" ? body.referenceBase64.trim() : "";
  if (!b64) {
    return json(400, {
      error: "Upload a reference photo of yourself before generating a scene.",
    });
  }

  let refBuf: Buffer;
  try {
    refBuf = Buffer.from(b64, "base64");
  } catch {
    return json(400, { error: "Invalid base64 reference image" });
  }
  if (refBuf.length < 64 || refBuf.length > MAX_REF_BYTES) {
    return json(400, {
      error: `Reference image must be between 64 bytes and ${MAX_REF_BYTES} bytes`,
    });
  }

  const mime =
    typeof body.mimeType === "string" && body.mimeType.trim()
      ? body.mimeType.trim().split(";")[0]!.toLowerCase()
      : "image/jpeg";
  if (!mime.startsWith("image/")) {
    return json(400, { error: "Reference must be an image" });
  }

  let apiKey: string;
  try {
    apiKey = await getGoogleAiApiKey();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Secret lookup failed";
    return json(500, {
      error:
        "Vision image generation is not configured (set medimade/GOOGLE_AI_API_KEY).",
      detail: msg,
    });
  }

  const model = modelId();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const instruction = [
    "Create a single cohesive vision-board image.",
    "The person in the reference photo must appear as themselves in the scene — keep face, hair, and body identity consistent.",
    "Photorealistic, warm, hopeful mood. No text overlays, watermarks, or logos.",
    `Scene: ${prompt}`,
  ].join("\n");

  const upstream = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: instruction },
            {
              inline_data: {
                mime_type: mime,
                data: b64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    }),
  });

  const rawText = await upstream.text();
  if (!upstream.ok) {
    let detail = rawText.slice(0, 1500);
    try {
      const parsed = JSON.parse(rawText) as {
        error?: { message?: string };
      };
      if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      /* keep */
    }
    return json(upstream.status >= 400 ? upstream.status : 502, {
      error: "Image generation failed",
      detail,
    });
  }

  let outB64 = "";
  let outMime = "image/png";
  try {
    const data = JSON.parse(rawText) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
            inlineData?: { mimeType?: string; data?: string };
            inline_data?: { mime_type?: string; data?: string };
          }>;
        };
      }>;
    };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      const inline = p.inlineData ?? p.inline_data;
      if (inline?.data) {
        outB64 = inline.data;
        outMime =
          inline.mimeType ||
          (inline as { mime_type?: string }).mime_type ||
          "image/png";
        break;
      }
    }
  } catch {
    return json(502, { error: "Invalid JSON from image model" });
  }

  if (!outB64) {
    return json(502, {
      error: "Model returned no image — try a clearer scene description.",
    });
  }

  const outBuf = Buffer.from(outB64, "base64");
  const bucket = process.env.MEDIA_BUCKET_NAME?.trim();
  const cfDomain = process.env.MEDIA_CLOUDFRONT_DOMAIN?.trim();
  let urlOut: string | undefined;
  let key: string | undefined;

  if (bucket && cfDomain) {
    const ext = outMime.includes("jpeg") || outMime.includes("jpg") ? "jpg" : "png";
    key = `ideate/vision/${userId}/${randomUUID()}.${ext}`;
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: outBuf,
          ContentType: outMime,
        }),
      );
      urlOut = `https://${cfDomain}/${key}`;
    } catch (e) {
      console.error("vision-generate S3", e);
      /* still return base64 */
    }
  }

  return json(200, {
    imageBase64: outB64,
    mimeType: outMime,
    ...(urlOut && key ? { url: urlOut, key } : {}),
    model,
  });
}
