import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

const FISH_TTS_URL = "https://api.fish.audio/v1/tts";
const FISH_TTS_MODEL = (process.env.FISH_TTS_MODEL || "s2-pro").trim() || "s2-pro";

const secrets = new SecretsManagerClient({});
let cachedApiKey: string | undefined;

async function getFishApiKey(): Promise<string> {
  if (cachedApiKey) return cachedApiKey;
  const arn = process.env.FISH_AUDIO_SECRET_ARN;
  if (!arn) {
    throw new Error("FISH_AUDIO_SECRET_ARN is not set");
  }
  const out = await secrets.send(
    new GetSecretValueCommand({ SecretId: arn }),
  );
  const s = out.SecretString?.trim();
  if (!s) {
    throw new Error("Fish Audio API key secret is empty");
  }
  cachedApiKey = s;
  return cachedApiKey;
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let apiKey: string;
  try {
    apiKey = await getFishApiKey();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Secret lookup failed";
    return json(500, { error: msg });
  }

  let body: { text?: string; reference_id?: string };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return json(400, { error: "Field `text` (string) is required" });
  }

  const reference_id =
    typeof body.reference_id === "string" && body.reference_id.length > 0
      ? body.reference_id
      : undefined;

  if (!reference_id) {
    return json(400, {
      error:
        "Field `reference_id` (string) is required — use a Fish Audio voice model id",
    });
  }

  const upstream = await fetch(FISH_TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      model: FISH_TTS_MODEL,
    },
    body: JSON.stringify({
      text,
      reference_id,
      format: "mp3",
      latency: "balanced",
      normalize: true,
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text();
    return json(upstream.status, {
      error: "Fish Audio request failed",
      detail: detail.slice(0, 2000),
    });
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
    body: buf.toString("base64"),
    isBase64Encoded: true,
  };
}

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
