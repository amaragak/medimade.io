/**
 * Generate Fish TTS preview clips for each canonical speaker and upload to the media bucket.
 *
 * Never calls Fish TTS for keys that already exist in S3 (saves credits). Uses HeadObject before each synthesize.
 *
 * Usage (from repo root or anywhere):
 *   backend/scripts/generate-speaker-samples
 *   backend/scripts/generate-speaker-samples --profile mm
 *   MEDIA_BUCKET_NAME=my-bucket backend/scripts/generate-speaker-samples
 *
 * Or from backend/: npm run generate-speaker-samples -- --profile mm
 *
 * Auth:
 *   - FISH_AUDIO_API_KEY: plain API key, or
 *   - AWS creds + Secrets Manager secret (default name medimade/FISH_AUDIO_API_KEY)
 *
 * Bucket:
 *   - MEDIA_BUCKET_NAME, or AWS CLI resolves CloudFormation export MediaBucketName (same as sync-bg-audio).
 */

import { execFileSync } from "node:child_process";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { FISH_SPEAKERS } from "../lib/fish-speakers";
import {
  SPEAKER_PREVIEW_SPEEDS,
  speakerPreviewSampleKey,
} from "../lib/speaker-sample-speed";

const SAMPLE_TEXT = "Welcome to your personalised meditation";
const FISH_TTS_URL = "https://api.fish.audio/v1/tts";
const FISH_TTS_MODEL = (process.env.FISH_TTS_MODEL || "s2-pro").trim() || "s2-pro";
const DEFAULT_SECRET_NAME = "medimade/FISH_AUDIO_API_KEY";

/** Extra args for `aws cloudformation list-exports` (e.g. `--profile`, `--region`). */
function awsCliPassthroughFromArgv(): string[] {
  return process.argv.slice(2);
}

/**
 * So S3 / Secrets Manager SDK calls use the same account as the CLI when the user passes
 * `--profile` (SDK does not read CLI flags by default).
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
      latency: "balanced",
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

async function main(): Promise<void> {
  const awsArgs = awsCliPassthroughFromArgv();
  applyAwsProfileFromCliArgs(awsArgs);

  const s3 = new S3Client({});
  const secrets = new SecretsManagerClient({});

  const bucket = resolveMediaBucket(awsArgs);

  console.log(`Bucket: ${bucket}`);
  console.log(
    `Speakers: ${FISH_SPEAKERS.length} × speeds: ${SPEAKER_PREVIEW_SPEEDS.join(", ")}`,
  );
  console.log(
    "Existing S3 objects are skipped (no Fish TTS); API key loaded only if something is missing.",
  );

  let apiKey: string | undefined;

  for (const sp of FISH_SPEAKERS) {
    for (const speed of SPEAKER_PREVIEW_SPEEDS) {
      const key = speakerPreviewSampleKey(sp.modelId, speed);
      if (await objectExists(s3, bucket, key)) {
        console.log(`skip (exists) ${sp.name} ${speed}× → ${key}`);
        continue;
      }

      if (apiKey === undefined) {
        apiKey = await getFishApiKey(secrets);
      }

      console.log(`synthesize ${sp.name} (${sp.modelId}) @ ${speed}×…`);
      const buf = await fishTtsMp3(apiKey, sp.modelId, speed);
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buf,
          ContentType: "audio/mpeg",
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
      console.log(`uploaded ${key} (${buf.byteLength} bytes)`);

      await new Promise((r) => setTimeout(r, 400));
    }
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
