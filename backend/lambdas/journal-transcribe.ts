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

/** Strip codecs / params so OpenAI sees a plain audio/* type. */
function baseMime(mime: string): string {
  return mime.split(";")[0]!.trim().toLowerCase();
}

/**
 * Whisper accepts: flac, m4a, mp3, mp4, mpeg, mpga, oga, ogg, wav, webm.
 * Prefer bytes over client-reported MIME (Safari often mislabels mp4 as webm).
 */
function resolveWhisperFile(
  buf: Buffer,
  claimedMime: string,
): { ext: string; mime: string } | { error: string } {
  const sniffed = sniffAudioFormat(buf);
  if (sniffed) return sniffed;

  const m = baseMime(claimedMime);
  if (m.includes("webm")) return { ext: "webm", mime: "audio/webm" };
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) {
    return { ext: "m4a", mime: "audio/mp4" };
  }
  if (m.includes("mpeg") || m.includes("mp3") || m.includes("mpga")) {
    return { ext: "mp3", mime: "audio/mpeg" };
  }
  if (m.includes("wav") || m.includes("wave")) return { ext: "wav", mime: "audio/wav" };
  if (m.includes("ogg") || m.includes("oga") || m.includes("opus")) {
    return { ext: "ogg", mime: "audio/ogg" };
  }
  if (m.includes("flac")) return { ext: "flac", mime: "audio/flac" };
  if (m.includes("caf")) {
    return {
      error:
        "This browser recorded CAF audio, which Whisper cannot transcribe. Try Chrome or Firefox, or another browser that records WebM/MP4.",
    };
  }
  return {
    error: `Unrecognized audio format (${claimedMime || "unknown"}). Supported: webm, m4a/mp4, mp3, wav, ogg, flac.`,
  };
}

function sniffAudioFormat(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length < 4) return null;
  // EBML / WebM
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { ext: "webm", mime: "audio/webm" };
  }
  // Ogg
  if (buf.toString("ascii", 0, 4) === "OggS") {
    return { ext: "ogg", mime: "audio/ogg" };
  }
  // WAV
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WAVE"
  ) {
    return { ext: "wav", mime: "audio/wav" };
  }
  // FLAC
  if (buf.toString("ascii", 0, 4) === "fLaC") {
    return { ext: "flac", mime: "audio/flac" };
  }
  // MP4 / M4A / AAC in MP4 (`....ftyp`)
  if (buf.length >= 8 && buf.toString("ascii", 4, 8) === "ftyp") {
    return { ext: "m4a", mime: "audio/mp4" };
  }
  // MP3 with ID3 tag
  if (buf.length >= 3 && buf.toString("ascii", 0, 3) === "ID3") {
    return { ext: "mp3", mime: "audio/mpeg" };
  }
  // MP3 frame sync
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0) {
    return { ext: "mp3", mime: "audio/mpeg" };
  }
  return null;
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
        "Access-Control-Allow-Headers":
          "Content-Type,Authorization,X-Medimade-Authorization",
        "Access-Control-Max-Age": "86400",
      },
      body: "",
    };
  }

  if (method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body: { audioBase64?: string; mimeType?: string; sessionToken?: string };
  try {
    body = JSON.parse(event.body || "{}") as {
      audioBase64?: string;
      mimeType?: string;
      sessionToken?: string;
    };
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const auth = await optionalUserJson(
    event,
    typeof body.sessionToken === "string" ? body.sessionToken : null,
  );
  const userId = auth?.sub?.trim() || "guest";

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

  const claimedMime =
    typeof body.mimeType === "string" && body.mimeType.trim()
      ? body.mimeType.trim()
      : "audio/webm";

  const resolved = resolveWhisperFile(buf, claimedMime);
  if ("error" in resolved) {
    return json(400, { error: resolved.error });
  }
  const { ext, mime } = resolved;
  const filename = `journal-${randomUUID().slice(0, 8)}.${ext}`;

  const form = new FormData();
  // Prefer File so multipart includes a real filename + clean Content-Type.
  const fileBytes = new Uint8Array(buf);
  const filePart =
    typeof File !== "undefined"
      ? new File([fileBytes], filename, { type: mime })
      : new Blob([fileBytes], { type: mime });
  form.append("file", filePart, filename);
  form.append("model", "whisper-1");

  const upstream = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!upstream.ok) {
    const detailRaw = await upstream.text();
    let detail = detailRaw.slice(0, 2000);
    try {
      const parsed = JSON.parse(detailRaw) as {
        error?: { message?: string };
      };
      if (typeof parsed.error?.message === "string" && parsed.error.message.trim()) {
        detail = parsed.error.message.trim();
      }
    } catch {
      /* keep raw */
    }
    return json(upstream.status >= 400 ? upstream.status : 502, {
      error: "OpenAI Whisper request failed",
      detail,
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
