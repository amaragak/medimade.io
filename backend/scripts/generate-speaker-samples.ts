/**
 * Generate Fish TTS preview clips for each canonical speaker and upload to the media bucket.
 *
 * Never calls Fish TTS for keys that already exist in S3 (saves credits). Uses HeadObject before each synthesize.
 * Also uploads `*-fx.wav` per speed (Pedalboard preset `mixer` via POST /audio/voice-fx) when missing.
 * API base: `MEDIIMADE_API_URL` / `NEXT_PUBLIC_MEDIMADE_API_URL`, or AWS CLI discovers `ApiUrl` from stack `MedimadeBackend` (override with `MEDIIMADE_STACK_NAME`).
 *
 * Usage (from repo root or anywhere):
 *   backend/scripts/generate-speaker-samples
 *   backend/scripts/generate-speaker-samples --profile other
 *   MEDIA_BUCKET_NAME=my-bucket backend/scripts/generate-speaker-samples
 *   backend/scripts/generate-speaker-samples --force-update --profile mm
 *   backend/scripts/generate-speaker-samples --force-fx-update --profile mm
 *
 * Or from backend/: npm run generate-speaker-samples -- --profile mm
 *
 * Auth:
 *   - FISH_AUDIO_API_KEY: plain API key, or
 *   - AWS creds + Secrets Manager secret (default name medimade/FISH_AUDIO_API_KEY)
 *
 * Bucket:
 *   - MEDIA_BUCKET_NAME, or AWS CLI resolves CloudFormation export MediaBucketName (see scripts/sync-bg-audio, source audio/bg-audio).
 */

import { execFileSync } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { FISH_SPEAKERS } from "../lib/fish-speakers";
import { loudnormMp3Buffer } from "../lib/ffmpeg-loudnorm";
import {
  SPEAKER_PREVIEW_SPEEDS,
  speakerPreviewFxSampleKey,
  speakerPreviewLoudFxSampleKey,
  speakerPreviewLoudSampleKey,
  speakerPreviewSampleKey,
} from "../lib/speaker-sample-speed";

const SAMPLE_TEXT = "Welcome to your personalised meditation";
const FISH_TTS_URL = "https://api.fish.audio/v1/tts";
const FISH_TTS_MODEL = (process.env.FISH_TTS_MODEL || "s2-pro").trim() || "s2-pro";
const DEFAULT_SECRET_NAME = "medimade/FISH_AUDIO_API_KEY";
const execFileAsync = promisify(execFile);

const LOUD_PREVIEW_SECONDS = 6;

async function trimMp3ForPreview(buf: Buffer): Promise<Buffer> {
  // Keep preview artifacts small so /audio/voice-fx can safely return base64 WAV via API Gateway.
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

function parseFlagsFromArgv(argv: string[]): {
  awsArgs: string[];
  forceUpdate: boolean;
  forceFxUpdate: boolean;
} {
  let forceUpdate = false;
  let forceFxUpdate = false;
  const awsArgs: string[] = [];
  for (const a of argv) {
    if (a === "--force-update") {
      forceUpdate = true;
      continue;
    }
    if (a === "--force-fx-update") {
      forceFxUpdate = true;
      continue;
    }
    awsArgs.push(a);
  }
  return { awsArgs, forceUpdate, forceFxUpdate };
}

/** Extra args for `aws cloudformation list-exports` (e.g. `--profile`, `--region`). */
function awsCliPassthroughFromArgv(): string[] {
  return process.argv.slice(2);
}

/**
 * So S3 / Secrets Manager SDK calls use the same account as the CLI when the user passes
 * `--profile` (SDK does not read CLI flags by default). If unset and no `--profile` flag, uses mm.
 */
function applyAwsProfileFromCliArgs(args: string[]): void {
  if (process.env.AWS_PROFILE?.trim()) return;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--profile" && args[i + 1]) {
      process.env.AWS_PROFILE = args[i + 1];
      return;
    }
    if (a.startsWith("--profile=")) {
      process.env.AWS_PROFILE = a.slice("--profile=".length);
      return;
    }
  }
  process.env.AWS_PROFILE = "mm";
}

function resolveMedimadeApiBase(awsArgs: string[]): string | null {
  const fromEnv =
    process.env.MEDIIMADE_API_URL?.trim() ||
    process.env.NEXT_PUBLIC_MEDIMADE_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const stack = process.env.MEDIIMADE_STACK_NAME?.trim() || "MedimadeBackend";
  try {
    const out = execFileSync(
      "aws",
      [
        "cloudformation",
        "describe-stacks",
        "--stack-name",
        stack,
        ...awsArgs,
        "--query",
        "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue | [0]",
        "--output",
        "text",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    if (out && out !== "None") return out.replace(/\/$/, "");
  } catch {
    return null;
  }
  return null;
}

function resolveMediaBucket(awsArgs: string[]): string {
  const fromEnv = process.env.MEDIA_BUCKET_NAME?.trim();
  if (fromEnv) return fromEnv;
  try {
    const out = execFileSync(
      "aws",
      [
        "cloudformation",
        "list-exports",
        ...awsArgs,
        "--query",
        "Exports[?Name=='MediaBucketName'].Value | [0]",
        "--output",
        "text",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    if (out && out !== "None") return out;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Could not resolve CloudFormation export MediaBucketName via AWS CLI (${detail}). Set MEDIA_BUCKET_NAME or pass CLI options (e.g. --profile mm).`,
    );
  }
  throw new Error(
    "Set MEDIA_BUCKET_NAME or deploy the stack so export MediaBucketName exists.",
  );
}

async function getFishApiKey(secrets: SecretsManagerClient): Promise<string> {
  const direct = process.env.FISH_AUDIO_API_KEY?.trim();
  if (direct) return direct;

  const secretId =
    process.env.FISH_AUDIO_SECRET_ARN?.trim() ||
    process.env.FISH_AUDIO_SECRET_NAME?.trim() ||
    DEFAULT_SECRET_NAME;

  const out = await secrets.send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  const s = out.SecretString?.trim();
  if (!s) throw new Error(`Secret ${secretId} is empty`);
  return s;
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

async function objectExists(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (e: unknown) {
    if (isS3ObjectMissing(e)) return false;
    throw e;
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
      model: FISH_TTS_MODEL,
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
    throw new Error(
      `Fish TTS failed (${upstream.status}): ${detail.slice(0, 500)}`,
    );
  }

  return Buffer.from(await upstream.arrayBuffer());
}

const MIXER_VOICE_FX_PRESET = "mixer";

async function getObjectBuffer(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<Buffer> {
  const out = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const body = out.Body;
  if (!body) throw new Error(`S3 empty body: ${key}`);
  return Buffer.from(await body.transformToByteArray());
}

async function voiceFxMixerWav(apiBase: string, mp3: Buffer): Promise<Buffer> {
  const res = await fetch(`${apiBase}/audio/voice-fx`, {
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
    const detail =
      (data?.error && String(data.error)) || raw.slice(0, 2000) || "";
    throw new Error(`voice-fx HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  if (!data?.audioBase64) {
    throw new Error(`voice-fx response missing audioBase64: ${raw.slice(0, 2000)}`);
  }
  return Buffer.from(data.audioBase64, "base64");
}

async function main(): Promise<void> {
  const { awsArgs, forceUpdate, forceFxUpdate } = parseFlagsFromArgv(
    awsCliPassthroughFromArgv(),
  );
  applyAwsProfileFromCliArgs(awsArgs);

  const s3 = new S3Client({});
  const secrets = new SecretsManagerClient({});

  const bucket = resolveMediaBucket(awsArgs);

  console.log(`Bucket: ${bucket}`);
  console.log(
    `Speakers: ${FISH_SPEAKERS.length} × speeds: ${SPEAKER_PREVIEW_SPEEDS.join(", ")}`,
  );
  if (forceUpdate) {
    console.log("--force-update: overwrite base MP3 + loud MP3 + loud FX WAV (even if S3 objects exist).");
  } else if (forceFxUpdate) {
    console.log("--force-fx-update: overwrite loud FX WAV only (even if S3 object exists).");
  } else {
    console.log(
      "Existing S3 objects are skipped (no Fish TTS); API key loaded only if something is missing.",
    );
  }

  const apiBase = resolveMedimadeApiBase(awsArgs);
  if (!apiBase) {
    console.warn(
      "No HTTP API base for voice-fx (set MEDIIMADE_API_URL or deploy stack with ApiUrl). Skipping *-fx.wav uploads.",
    );
  }

  let apiKey: string | undefined;

  for (const sp of FISH_SPEAKERS) {
    for (const speed of SPEAKER_PREVIEW_SPEEDS) {
      const mp3Key = speakerPreviewSampleKey(sp.modelId, speed);
      if (forceUpdate || !(await objectExists(s3, bucket, mp3Key))) {
        if (apiKey === undefined) {
          apiKey = await getFishApiKey(secrets);
        }

        console.log(`synthesize ${sp.name} (${sp.modelId}) @ ${speed}×…`);
        const buf = await fishTtsMp3(apiKey, sp.modelId, speed);
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: mp3Key,
            Body: buf,
            ContentType: "audio/mpeg",
            CacheControl: "public, max-age=31536000, immutable",
          }),
        );
        console.log(`uploaded ${mp3Key} (${buf.byteLength} bytes)`);

        await new Promise((r) => setTimeout(r, 400));
      } else {
        console.log(`skip (exists) ${sp.name} ${speed}× → ${mp3Key}`);
      }

      // Always create a loudness-normalized variant. This is the input to the FX WAV,
      // so the chain is: Fish MP3 → loudnorm → upload *-loud.mp3 → voice-fx → upload *-loud-fx.wav
      const loudKey = speakerPreviewLoudSampleKey(sp.modelId, speed);
      if (forceUpdate || !(await objectExists(s3, bucket, loudKey))) {
        console.log(`loudnorm ${sp.name} ${speed}× → ${loudKey}`);
        const srcMp3 = await getObjectBuffer(s3, bucket, mp3Key);
        const previewMp3 = await trimMp3ForPreview(srcMp3);
        let loudMp3: Buffer;
        try {
          loudMp3 = await loudnormMp3Buffer(previewMp3);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(
            `loudnorm failed (${msg}). Install ffmpeg and ensure it is on PATH, or run this script in an environment with ffmpeg.`,
          );
        }
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: loudKey,
            Body: loudMp3,
            ContentType: "audio/mpeg",
            CacheControl: "public, max-age=31536000, immutable",
          }),
        );
        console.log(`uploaded ${loudKey} (${loudMp3.byteLength} bytes)`);
        await new Promise((r) => setTimeout(r, 250));
      } else {
        console.log(`skip (exists) ${sp.name} ${speed}× LOUD → ${loudKey}`);
      }

      // Keep legacy FX keys untouched; generate new loud-derived FX for mixer previews.
      const fxKey = speakerPreviewFxSampleKey(sp.modelId, speed);
      if (!apiBase) {
        continue;
      }
      if (await objectExists(s3, bucket, fxKey)) {
        console.log(`skip (exists) ${sp.name} ${speed}× FX → ${fxKey}`);
      }

      const loudFxKey = speakerPreviewLoudFxSampleKey(sp.modelId, speed);
      if (!forceUpdate && !forceFxUpdate && (await objectExists(s3, bucket, loudFxKey))) {
        console.log(`skip (exists) ${sp.name} ${speed}× LOUD FX → ${loudFxKey}`);
        continue;
      }

      console.log(`voice-fx mixer (from loud) ${sp.name} (${sp.modelId}) @ ${speed}×…`);
      const loudMp3Buf = await getObjectBuffer(s3, bucket, loudKey);
      const wavBuf = await voiceFxMixerWav(apiBase, loudMp3Buf);
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: loudFxKey,
          Body: wavBuf,
          ContentType: "audio/wav",
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
      console.log(`uploaded ${loudFxKey} (${wavBuf.byteLength} bytes)`);
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
