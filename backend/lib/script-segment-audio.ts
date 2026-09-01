import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { parseBuffer } from "music-metadata";
import { loudnormMp3Buffer } from "./ffmpeg-loudnorm";
import { FIXED_SPEECH_PREVIEW_SPEED } from "./speaker-sample-speed";
import {
  putScriptSegmentVariantAudio,
  scriptSegmentAudioS3Key,
  setScriptSegmentVariantAudioStatus,
  type ScriptSegmentVariantAudioRow,
} from "./script-segment-library";

const FISH_TTS_URL = "https://api.fish.audio/v1/tts";

function fishTtsModel(): string {
  return (process.env.FISH_TTS_MODEL || "s2.1-pro-free").trim() || "s2.1-pro-free";
}

export async function getMp3DurationSeconds(buf: Buffer): Promise<number | null> {
  try {
    const m = await parseBuffer(buf, { mimeType: "audio/mpeg", size: buf.byteLength });
    const d = m.format.duration;
    if (typeof d === "number" && Number.isFinite(d) && d > 0) return d;
    return null;
  } catch {
    return null;
  }
}

async function fishTtsMp3(params: {
  apiKey: string;
  referenceId: string;
  text: string;
  speed?: number;
}): Promise<Buffer> {
  const text = params.text.trim().slice(0, 4000);
  if (!text) throw new Error("Variant text is empty");
  const speed = params.speed ?? FIXED_SPEECH_PREVIEW_SPEED;
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const upstream = await fetch(FISH_TTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
        model: fishTtsModel(),
      },
      body: JSON.stringify({
        text,
        reference_id: params.referenceId,
        format: "mp3",
        latency: "normal",
        normalize: true,
        prosody: { speed, normalize_loudness: true },
      }),
    });
    if (upstream.ok) {
      return Buffer.from(await upstream.arrayBuffer());
    }
    lastErr = await upstream.text();
    const retryable = [429, 502, 503, 504].includes(upstream.status);
    if (!retryable || attempt >= 3) break;
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  throw new Error(`Fish TTS failed: ${lastErr.slice(0, 500)}`);
}

export async function generateScriptSegmentVariantAudio(params: {
  s3: S3Client;
  bucket: string;
  apiKey: string;
  tagName: string;
  variantId: string;
  modelId: string;
  text: string;
}): Promise<ScriptSegmentVariantAudioRow> {
  await setScriptSegmentVariantAudioStatus({
    tagName: params.tagName,
    variantId: params.variantId,
    modelId: params.modelId,
    status: "generating",
  });

  try {
    const raw = await fishTtsMp3({
      apiKey: params.apiKey,
      referenceId: params.modelId,
      text: params.text,
    });
    const mp3 = await loudnormMp3Buffer(raw);
    const durationSeconds = (await getMp3DurationSeconds(mp3)) ?? 0;
    const s3Key = scriptSegmentAudioS3Key(
      params.tagName,
      params.variantId,
      params.modelId,
    );
    await params.s3.send(
      new PutObjectCommand({
        Bucket: params.bucket,
        Key: s3Key,
        Body: mp3,
        ContentType: "audio/mpeg",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    const row: ScriptSegmentVariantAudioRow = {
      tagName: params.tagName,
      variantId: params.variantId,
      modelId: params.modelId,
      status: "generated",
      s3Key,
      durationSeconds,
      updatedAt: new Date().toISOString(),
    };
    await putScriptSegmentVariantAudio(row);
    return row;
  } catch (e) {
    await setScriptSegmentVariantAudioStatus({
      tagName: params.tagName,
      variantId: params.variantId,
      modelId: params.modelId,
      status: "failed",
    });
    throw e;
  }
}

/** Same throttle pattern as the old per-section FX fan-out — bounded concurrency. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Math.min(Math.max(1, limit), items.length);
  async function worker() {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

export const SCRIPT_LAB_TTS_CONCURRENCY = 4;
