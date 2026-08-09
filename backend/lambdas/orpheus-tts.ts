import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { orpheusTtsWav } from "../lib/orpheus-tts-client";
import { DEFAULT_ORPHEUS_VOICE_ID } from "../lib/orpheus-voices";

const secrets = new SecretsManagerClient({});
let cachedApiKey: string | undefined;
let cachedUpstreamUrl: string | undefined;

const DEFAULT_MODEL = "orpheus";

async function getSecretString(
  envKey: string,
  cache: "apiKey" | "url",
): Promise<string> {
  if (cache === "apiKey" && cachedApiKey) return cachedApiKey;
  if (cache === "url" && cachedUpstreamUrl) return cachedUpstreamUrl;

  const arn = process.env[envKey];
  if (!arn) {
    throw new Error(`${envKey} is not set`);
  }
  const out = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
  const s = out.SecretString?.trim();
  if (!s) {
    throw new Error(`Secret for ${envKey} is empty`);
  }
  if (cache === "apiKey") cachedApiKey = s;
  else cachedUpstreamUrl = s;
  return s;
}

async function getRunpodApiKey(): Promise<string> {
  return getSecretString("RUNPODS_SECRET_ARN", "apiKey");
}

async function getUpstreamUrl(): Promise<string> {
  /** Full upstream URL from Secrets Manager `medimade/RUNPODS_URL` (no env fallback). */
  return getSecretString("RUNPODS_URL_SECRET_ARN", "url");
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

type SpeechRequest = {
  text: string;
  voice: string;
  model: string;
  responseFormat: string;
  speed: number;
};

function parseSpeechRequest(raw: unknown): SpeechRequest | { error: string } {
  if (!raw || typeof raw !== "object") {
    return { error: "JSON body must be an object" };
  }
  const body = raw as Record<string, unknown>;

  const textRaw =
    (typeof body.input === "string" ? body.input : null) ??
    (typeof body.text === "string" ? body.text : null);
  const text = textRaw?.trim() ?? "";
  if (!text) {
    return { error: "Field `input` (string) is required" };
  }

  const voice =
    typeof body.voice === "string" && body.voice.trim()
      ? body.voice.trim()
      : DEFAULT_ORPHEUS_VOICE_ID;

  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : DEFAULT_MODEL;

  const responseFormat =
    typeof body.response_format === "string" && body.response_format.trim()
      ? body.response_format.trim().toLowerCase()
      : "wav";

  if (responseFormat !== "wav") {
    return { error: "Only `response_format: \"wav\"` is supported" };
  }

  const speed =
    typeof body.speed === "number" && Number.isFinite(body.speed) && body.speed > 0
      ? body.speed
      : 1.0;

  return { text, voice, model, responseFormat, speed };
}

function wavAudioResponse(audioB64: string): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "audio/wav",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
    body: audioB64,
    isBase64Encoded: true,
  };
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let apiKey: string;
  let upstreamUrl: string;
  try {
    apiKey = await getRunpodApiKey();
    upstreamUrl = await getUpstreamUrl();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Configuration error";
    return json(500, { error: msg });
  }

  let rawBody: unknown;
  try {
    rawBody = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const parsed = parseSpeechRequest(rawBody);
  if ("error" in parsed) {
    return json(400, { error: parsed.error });
  }

  try {
    const wav = await orpheusTtsWav({
      apiKey,
      upstreamUrl,
      text: parsed.text,
      voice: parsed.voice,
      model: parsed.model,
      speed: parsed.speed,
    });
    return wavAudioResponse(wav.toString("base64"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upstream TTS failed";
    return json(502, { error: msg });
  }
}
