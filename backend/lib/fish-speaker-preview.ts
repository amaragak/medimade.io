import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { loudnormMp3Buffer } from "./ffmpeg-loudnorm";
import {
  FIXED_SPEECH_PREVIEW_SPEED,
  speakerPreviewLoudFxSampleKey,
  speakerPreviewLoudSampleKey,
  speakerPreviewSampleKey,
} from "./speaker-sample-speed";

const execFileAsync = promisify(execFile);
const FISH_TTS_URL = "https://api.fish.audio/v1/tts";
const SAMPLE_TEXT = "Welcome to your personalised meditation";
const LOUD_PREVIEW_SECONDS = 6;
const MIXER_VOICE_FX_PRESET = "mixer";

function fishTtsModel(): string {
  return (process.env.FISH_TTS_MODEL || "s2.1-pro-free").trim() || "s2.1-pro-free";
}

function isS3ObjectMissing(e: unknown): boolean {
  const err = e as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  if (err.$metadata?.httpStatusCode === 404) return true;
  const code = err.name ?? err.Code;
  return code === "NotFound" || code === "NoSuchKey";
}

export async function speakerPreviewExists(
  s3: S3Client,
  bucket: string,
  modelId: string,
): Promise<boolean> {
  const key = speakerPreviewLoudSampleKey(modelId, FIXED_SPEECH_PREVIEW_SPEED);
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (e: unknown) {
    if (isS3ObjectMissing(e)) return false;
    throw e;
  }
}

async function trimMp3ForPreview(buf: Buffer): Promise<Buffer> {
  const id = randomUUID();
  const inPath = `/tmp/spk-in-${id}.mp3`;
  const outPath = `/tmp/spk-trim-${id}.mp3`;
  try {
    fs.writeFileSync(inPath, buf);
    await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-y",
      "-i",
      inPath,
      "-t",
      String(LOUD_PREVIEW_SECONDS),
      "-c:a",
      "libmp3lame",
      "-q:a",
      "2",
      outPath,
    ]);
    return fs.readFileSync(outPath);
  } finally {
    for (const p of [inPath, outPath]) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* */
      }
    }
  }
}

async function fishTtsMp3(
  apiKey: string,
  referenceId: string,
  speed: number,
): Promise<Buffer> {
  const upstream = await fetch(FISH_TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      model: fishTtsModel(),
    },
    body: JSON.stringify({
      text: SAMPLE_TEXT,
      reference_id: referenceId,
      format: "mp3",
      latency: "normal",
      normalize: true,
      prosody: { speed, normalize_loudness: true },
    }),
  });
  if (!upstream.ok) {
    const detail = await upstream.text();
    throw new Error(`Fish TTS failed (${upstream.status}): ${detail.slice(0, 500)}`);
  }
  return Buffer.from(await upstream.arrayBuffer());
}

async function voiceFxMixerWav(apiBase: string, mp3: Buffer): Promise<Buffer> {
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/audio/voice-fx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      audioBase64: mp3.toString("base64"),
      preset: MIXER_VOICE_FX_PRESET,
      inputFormat: "mp3",
    }),
  });
  const raw = await res.text();
  let data: { audioBase64?: string; error?: string } | null = null;
  try {
    data = JSON.parse(raw) as { audioBase64?: string; error?: string };
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(
      `voice-fx HTTP ${res.status}${data?.error ? `: ${data.error}` : ""}`,
    );
  }
  if (!data?.audioBase64) throw new Error("voice-fx response missing audioBase64");
  return Buffer.from(data.audioBase64, "base64");
}

/** Mixer preview at the fixed Create speech speed (loud MP3 + FX WAV). */
export async function generateFishSpeakerPreview(params: {
  s3: S3Client;
  bucket: string;
  apiKey: string;
  modelId: string;
  apiBase?: string | null;
}): Promise<{
  mp3Key: string;
  loudKey: string;
  loudFxKey: string | null;
  skipped?: boolean;
}> {
  const speed = FIXED_SPEECH_PREVIEW_SPEED;
  const mp3Key = speakerPreviewSampleKey(params.modelId, speed);
  const loudKey = speakerPreviewLoudSampleKey(params.modelId, speed);
  const loudFxKey = speakerPreviewLoudFxSampleKey(params.modelId, speed);

  if (await speakerPreviewExists(params.s3, params.bucket, params.modelId)) {
    return { mp3Key, loudKey, loudFxKey: null, skipped: true };
  }

  const buf = await fishTtsMp3(params.apiKey, params.modelId, speed);
  await params.s3.send(
    new PutObjectCommand({
      Bucket: params.bucket,
      Key: mp3Key,
      Body: buf,
      ContentType: "audio/mpeg",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  const previewMp3 = await trimMp3ForPreview(buf);
  const loudMp3 = await loudnormMp3Buffer(previewMp3);
  await params.s3.send(
    new PutObjectCommand({
      Bucket: params.bucket,
      Key: loudKey,
      Body: loudMp3,
      ContentType: "audio/mpeg",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  let uploadedFx: string | null = null;
  if (params.apiBase) {
    const wavBuf = await voiceFxMixerWav(params.apiBase, loudMp3);
    await params.s3.send(
      new PutObjectCommand({
        Bucket: params.bucket,
        Key: loudFxKey,
        Body: wavBuf,
        ContentType: "audio/wav",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    uploadedFx = loudFxKey;
  }

  return { mp3Key, loudKey, loudFxKey: uploadedFx };
}
