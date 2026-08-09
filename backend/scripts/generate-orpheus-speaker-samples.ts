/**
 * Generate Orpheus TTS preview clips for each canonical voice and upload to the media bucket.
 *
 * Never calls RunPod for keys that already exist in S3. Uses HeadObject before each synthesize.
 * Also uploads `*-loud.mp3` and `*-loud-fx.wav` (Pedalboard preset `mixer`) when missing.
 *
 * Usage:
 *   backend/scripts/generate-orpheus-speaker-samples --profile mm
 *   npm run generate-orpheus-speaker-samples -- --profile mm
 *   backend/scripts/generate-orpheus-speaker-samples --force-update --profile mm
 *
 * Single-sample local test (one RunPod job; purges queue, uses `/run`, cancels on exit):
 *   npm run generate-orpheus-speaker-samples -- --local-test --voice tara --speed 0.9 --profile mm
 *
 * Custom local output base path (no extension):
 *   npm run generate-orpheus-speaker-samples -- --local-out .local/orpheus-speaker-samples/tara-0.9 --voice tara --profile mm
 *
 * Auth:
 *   - RUNPODS_API_KEY + RUNPODS_URL env vars, or
 *   - AWS creds + Secrets Manager (`medimade/RUNPODS_API_KEY`, `medimade/RUNPODS_URL`)
 */

import { execFileSync } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
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
import { ORPHEUS_VOICES, normalizeOrpheusVoiceId } from "../lib/orpheus-voices";
import { orpheusTtsWav } from "../lib/orpheus-tts-client";
import { loudnormMp3Buffer } from "../lib/ffmpeg-loudnorm";
import {
  FIXED_SPEECH_PREVIEW_SPEED,
  SPEAKER_PREVIEW_SPEEDS,
  snapSpeakerSampleSpeed,
  orpheusSpeakerPreviewLoudFxSampleKey,
  orpheusSpeakerPreviewLoudSampleKey,
  orpheusSpeakerPreviewSampleKey,
  speechSpeedToSampleStem,
} from "../lib/speaker-sample-speed";

const SAMPLE_TEXT = "Welcome to your personalised meditation";
const DEFAULT_LOCAL_SAMPLES_DIR = path.join(
  process.cwd(),
  ".local/orpheus-speaker-samples",
);
const LOCAL_TEST_LOCK_FILE = path.join(
  DEFAULT_LOCAL_SAMPLES_DIR,
  ".runpod-local-test.lock",
);
const DEFAULT_RUNPOD_SECRET_NAME = "medimade/RUNPODS_API_KEY";
const DEFAULT_RUNPOD_URL_SECRET_NAME = "medimade/RUNPODS_URL";
const execFileAsync = promisify(execFile);
const LOUD_PREVIEW_SECONDS = 6;
const MIXER_VOICE_FX_PRESET = "mixer";

function scriptLog(message: string, data?: Record<string, unknown>): void {
  if (process.env.ORPHEUS_SAMPLES_QUIET === "1") return;
  if (data && Object.keys(data).length > 0) {
    console.log(`[orpheus-samples] ${message}`, data);
  } else {
    console.log(`[orpheus-samples] ${message}`);
  }
}

function elapsedMs(start: number): number {
  return Date.now() - start;
}

async function trimMp3ForPreview(buf: Buffer): Promise<Buffer> {
  const id = randomUUID();
  const inPath = `/tmp/orph-in-${id}.mp3`;
  const outPath = `/tmp/orph-trim-${id}.mp3`;
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

async function wavToMp3Buffer(wavBuf: Buffer): Promise<Buffer> {
  const id = randomUUID();
  const inPath = `/tmp/orph-wav-${id}.wav`;
  const outPath = `/tmp/orph-mp3-${id}.mp3`;
  try {
    fs.writeFileSync(inPath, wavBuf);
    await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-y",
      "-i",
      inPath,
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

function acquireLocalTestLock(): void {
  fs.mkdirSync(DEFAULT_LOCAL_SAMPLES_DIR, { recursive: true });
  if (fs.existsSync(LOCAL_TEST_LOCK_FILE)) {
    const existing = fs.readFileSync(LOCAL_TEST_LOCK_FILE, "utf8").trim();
    throw new Error(
      `Another local Orpheus test appears to be running (lock: ${LOCAL_TEST_LOCK_FILE}, pid ${existing}). Remove the lock only if that process is dead.`,
    );
  }
  fs.writeFileSync(LOCAL_TEST_LOCK_FILE, String(process.pid), "utf8");
  scriptLog("Acquired local test lock", {
    lockFile: LOCAL_TEST_LOCK_FILE,
    pid: process.pid,
  });
}

function releaseLocalTestLock(): void {
  try {
    if (fs.existsSync(LOCAL_TEST_LOCK_FILE)) {
      fs.unlinkSync(LOCAL_TEST_LOCK_FILE);
    }
  } catch {
    /* */
  }
}

function defaultLocalOutBase(voiceId: string, speed: number): string {
  return path.join(
    DEFAULT_LOCAL_SAMPLES_DIR,
    `${voiceId}-${speechSpeedToSampleStem(speed)}`,
  );
}

function parseFlagsFromArgv(argv: string[]): {
  awsArgs: string[];
  forceUpdate: boolean;
  forceFxUpdate: boolean;
  localOutBase: string | null;
  localTest: boolean;
  voiceId: string | null;
  speed: number | null;
  quiet: boolean;
} {
  let forceUpdate = false;
  let forceFxUpdate = false;
  let quiet = false;
  let localTest = false;
  let localOutBase: string | null = null;
  let voiceId: string | null = null;
  let speed: number | null = null;
  const awsArgs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force-update") {
      forceUpdate = true;
      continue;
    }
    if (a === "--force-fx-update") {
      forceFxUpdate = true;
      continue;
    }
    if (a === "--quiet") {
      quiet = true;
      continue;
    }
    if (a === "--local-test") {
      localTest = true;
      continue;
    }
    if (a === "--local-out") {
      localOutBase = argv[i + 1]?.trim() || null;
      if (!localOutBase) {
        throw new Error("--local-out requires a base path (no extension)");
      }
      i += 1;
      continue;
    }
    if (a.startsWith("--local-out=")) {
      localOutBase = a.slice("--local-out=".length).trim() || null;
      if (!localOutBase) {
        throw new Error("--local-out requires a base path (no extension)");
      }
      continue;
    }
    if (a === "--voice") {
      voiceId = argv[i + 1]?.trim().toLowerCase() || null;
      if (!voiceId) throw new Error("--voice requires a voice id (e.g. tara)");
      i += 1;
      continue;
    }
    if (a.startsWith("--voice=")) {
      voiceId = a.slice("--voice=".length).trim().toLowerCase() || null;
      if (!voiceId) throw new Error("--voice requires a voice id (e.g. tara)");
      continue;
    }
    if (a === "--speed") {
      const raw = argv[i + 1];
      const n = raw ? Number(raw) : NaN;
      if (!Number.isFinite(n)) throw new Error("--speed requires a number (e.g. 0.9)");
      speed = snapSpeakerSampleSpeed(n);
      i += 1;
      continue;
    }
    if (a.startsWith("--speed=")) {
      const n = Number(a.slice("--speed=".length));
      if (!Number.isFinite(n)) throw new Error("--speed requires a number (e.g. 0.9)");
      speed = snapSpeakerSampleSpeed(n);
      continue;
    }
    awsArgs.push(a);
  }
  return {
    awsArgs,
    forceUpdate,
    forceFxUpdate,
    localOutBase,
    localTest,
    voiceId,
    speed,
    quiet,
  };
}

function awsCliPassthroughFromArgv(): string[] {
  return process.argv.slice(2);
}

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

async function getRunpodCredentials(
  secrets: SecretsManagerClient,
): Promise<{ apiKey: string; upstreamUrl: string }> {
  const directKey = process.env.RUNPODS_API_KEY?.trim();
  const directUrl = process.env.RUNPODS_URL?.trim();
  if (directKey && directUrl) {
    scriptLog("RunPod credentials loaded from environment", {
      urlHost: (() => {
        try {
          return new URL(directUrl).host;
        } catch {
          return directUrl.slice(0, 80);
        }
      })(),
    });
    return { apiKey: directKey, upstreamUrl: directUrl };
  }

  const keySecretId =
    process.env.RUNPODS_SECRET_ARN?.trim() ||
    process.env.RUNPODS_SECRET_NAME?.trim() ||
    DEFAULT_RUNPOD_SECRET_NAME;
  const urlSecretId =
    process.env.RUNPODS_URL_SECRET_ARN?.trim() ||
    process.env.RUNPODS_URL_SECRET_NAME?.trim() ||
    DEFAULT_RUNPOD_URL_SECRET_NAME;

  const [keyOut, urlOut] = await Promise.all([
    secrets.send(new GetSecretValueCommand({ SecretId: keySecretId })),
    secrets.send(new GetSecretValueCommand({ SecretId: urlSecretId })),
  ]);
  const apiKey = keyOut.SecretString?.trim();
  const upstreamUrl = urlOut.SecretString?.trim();
  if (!apiKey) throw new Error(`Secret ${keySecretId} is empty`);
  if (!upstreamUrl) throw new Error(`Secret ${urlSecretId} is empty`);
  scriptLog("RunPod credentials loaded from Secrets Manager", {
    keySecretId,
    urlSecretId,
    upstreamUrl,
  });
  return { apiKey, upstreamUrl };
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
  scriptLog("POST /audio/voice-fx", {
    apiBase,
    preset: MIXER_VOICE_FX_PRESET,
    inputBytes: mp3.byteLength,
  });
  const started = Date.now();
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
  const wav = Buffer.from(data.audioBase64, "base64");
  scriptLog("voice-fx complete", {
    wavBytes: wav.byteLength,
    elapsedMs: elapsedMs(started),
  });
  return wav;
}

async function orpheusTtsMp3(params: {
  runpod: { apiKey: string; upstreamUrl: string };
  voiceId: string;
  speed: number;
  pollMaxAttempts?: number;
  pollIntervalMs?: number;
  jobPolicy?: "default" | "single";
}): Promise<Buffer> {
  const ttsStarted = Date.now();
  const wav = await orpheusTtsWav({
    apiKey: params.runpod.apiKey,
    upstreamUrl: params.runpod.upstreamUrl,
    text: SAMPLE_TEXT,
    voice: params.voiceId,
    speed: params.speed,
    pollMaxAttempts: params.pollMaxAttempts,
    pollIntervalMs: params.pollIntervalMs,
    jobPolicy: params.jobPolicy,
    log: scriptLog,
  });
  scriptLog("WAV → MP3 (ffmpeg)", { wavBytes: wav.byteLength });
  const mp3Started = Date.now();
  const mp3 = await wavToMp3Buffer(wav);
  scriptLog("MP3 encode complete", {
    mp3Bytes: mp3.byteLength,
    encodeMs: elapsedMs(mp3Started),
    totalTtsMs: elapsedMs(ttsStarted),
  });
  return mp3;
}

async function generateLocalSample(params: {
  runpod: { apiKey: string; upstreamUrl: string };
  voiceId: string;
  speed: number;
  localOutBase: string;
  apiBase: string | null;
}): Promise<void> {
  acquireLocalTestLock();
  try {
    const base = params.localOutBase.replace(/\.(mp3|wav)$/i, "");
    fs.mkdirSync(path.dirname(base), { recursive: true });
    const mp3Path = `${base}.mp3`;
    const loudPath = `${base}-loud.mp3`;
    const loudFxPath = `${base}-loud-fx.wav`;

    console.log(`Local test: ${params.voiceId} @ ${params.speed}× → ${base}.*`);
    scriptLog("Local test configuration", {
      voiceId: params.voiceId,
      speed: params.speed,
      sampleText: SAMPLE_TEXT,
      mp3Path,
      loudPath,
      loudFxPath,
      apiBase: params.apiBase ?? "(none)",
      runpodPolicy: "single (/run + purge-queue + cancel on exit)",
    });

    console.log("1/3 Orpheus TTS (RunPod)…");
    const step1Started = Date.now();
    const mp3Buf = await orpheusTtsMp3({
      runpod: params.runpod,
      voiceId: params.voiceId,
      speed: params.speed,
      pollMaxAttempts: 300,
      pollIntervalMs: 2000,
      jobPolicy: "single",
    });
    fs.writeFileSync(mp3Path, mp3Buf);
    console.log(`wrote ${mp3Path} (${mp3Buf.byteLength} bytes)`);
    scriptLog("Step 1/3 complete", { elapsedMs: elapsedMs(step1Started) });

    console.log("2/3 loudnorm + trim…");
    const step2Started = Date.now();
    const previewMp3 = await trimMp3ForPreview(mp3Buf);
    scriptLog("Trimmed preview MP3", {
      inputBytes: mp3Buf.byteLength,
      trimmedBytes: previewMp3.byteLength,
      seconds: LOUD_PREVIEW_SECONDS,
    });
    const loudMp3 = await loudnormMp3Buffer(previewMp3);
    fs.writeFileSync(loudPath, loudMp3);
    console.log(`wrote ${loudPath} (${loudMp3.byteLength} bytes)`);
    scriptLog("Step 2/3 complete", { elapsedMs: elapsedMs(step2Started) });

    if (!params.apiBase) {
      console.warn(
        "No API base — skipping voice-fx (3/3). Set MEDIIMADE_API_URL to test FX.",
      );
      return;
    }

    console.log("3/3 voice-fx mixer…");
    const step3Started = Date.now();
    const wavBuf = await voiceFxMixerWav(params.apiBase, loudMp3);
    fs.writeFileSync(loudFxPath, wavBuf);
    console.log(`wrote ${loudFxPath} (${wavBuf.byteLength} bytes)`);
    scriptLog("Step 3/3 complete", { elapsedMs: elapsedMs(step3Started) });
  } finally {
    releaseLocalTestLock();
  }
}

async function main(): Promise<void> {
  const {
    awsArgs,
    forceUpdate,
    forceFxUpdate,
    localOutBase,
    localTest,
    voiceId,
    speed,
    quiet,
  } = parseFlagsFromArgv(awsCliPassthroughFromArgv());
  applyAwsProfileFromCliArgs(awsArgs);

  const secrets = new SecretsManagerClient({});
  const testVoiceId =
    normalizeOrpheusVoiceId(voiceId ?? "tara") ?? "tara";
  const testSpeed = speed ?? FIXED_SPEECH_PREVIEW_SPEED;
  const resolvedLocalOutBase =
    localOutBase ?? (localTest ? defaultLocalOutBase(testVoiceId, testSpeed) : null);

  if (quiet) {
    process.env.ORPHEUS_SAMPLES_QUIET = "1";
    process.env.ORPHEUS_TTS_LOG = "0";
  } else {
    process.env.ORPHEUS_TTS_LOG = process.env.ORPHEUS_TTS_LOG ?? "1";
  }

  scriptLog("Starting Orpheus speaker sample generator", {
    mode: resolvedLocalOutBase ? "local-test" : "s3-upload",
    localOutBase: resolvedLocalOutBase ?? undefined,
    awsProfile: process.env.AWS_PROFILE ?? "(default)",
    voiceFilter: voiceId ?? "(all)",
    speedFilter: speed ?? "(all preview speeds)",
    forceUpdate,
    forceFxUpdate,
  });

  if (resolvedLocalOutBase) {
    const runpod = await getRunpodCredentials(secrets);
    const apiBase = resolveMedimadeApiBase(awsArgs);
    const runStarted = Date.now();
    await generateLocalSample({
      runpod,
      voiceId: testVoiceId,
      speed: testSpeed,
      localOutBase: resolvedLocalOutBase,
      apiBase,
    });
    scriptLog("Local test finished", { totalMs: elapsedMs(runStarted) });
    console.log("Done (local test).");
    return;
  }

  const s3 = new S3Client({});
  const bucket = resolveMediaBucket(awsArgs);
  const apiBase = resolveMedimadeApiBase(awsArgs);

  const voices = voiceId
    ? ORPHEUS_VOICES.filter((v) => v.id === testVoiceId)
    : ORPHEUS_VOICES;
  if (voices.length === 0) {
    throw new Error(`Unknown Orpheus voice: ${voiceId}`);
  }
  const speeds = speed !== null ? [testSpeed] : [...SPEAKER_PREVIEW_SPEEDS];

  console.log(`Bucket: ${bucket}`);
  console.log(
    `Orpheus voices: ${voices.length} × speeds: ${speeds.join(", ")}`,
  );
  if (forceUpdate) {
    console.log(
      "--force-update: overwrite base MP3 + loud MP3 + loud FX WAV (even if S3 objects exist).",
    );
  } else if (forceFxUpdate) {
    console.log("--force-fx-update: overwrite loud FX WAV only.");
  } else {
    console.log(
      "Existing S3 objects are skipped (no RunPod calls); credentials loaded only if something is missing.",
    );
  }
  if (!apiBase) {
    console.warn(
      "No HTTP API base for voice-fx (set MEDIIMADE_API_URL or deploy stack with ApiUrl). Skipping *-loud-fx.wav uploads.",
    );
  }

  let runpod: { apiKey: string; upstreamUrl: string } | undefined;
  const totalJobs = voices.length * speeds.length;
  let jobIndex = 0;
  const batchStarted = Date.now();

  for (const voice of voices) {
    for (const spd of speeds) {
      jobIndex += 1;
      scriptLog("Processing sample", {
        progress: `${jobIndex}/${totalJobs}`,
        voice: voice.id,
        speed: spd,
      });

      const mp3Key = orpheusSpeakerPreviewSampleKey(voice.id, spd);
      if (forceUpdate || !(await objectExists(s3, bucket, mp3Key))) {
        if (runpod === undefined) {
          runpod = await getRunpodCredentials(secrets);
        }

        console.log(`synthesize ${voice.name} (${voice.id}) @ ${spd}×…`);
        const synthStarted = Date.now();
        const buf = await orpheusTtsMp3({
          runpod,
          voiceId: voice.id,
          speed: spd,
        });
        scriptLog("Synthesis complete", {
          voice: voice.id,
          speed: spd,
          mp3Bytes: buf.byteLength,
          elapsedMs: elapsedMs(synthStarted),
        });
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
        await new Promise((r) => setTimeout(r, 500));
      } else {
        console.log(`skip (exists) ${voice.name} ${spd}× → ${mp3Key}`);
      }

      const loudKey = orpheusSpeakerPreviewLoudSampleKey(voice.id, spd);
      if (forceUpdate || !(await objectExists(s3, bucket, loudKey))) {
        console.log(`loudnorm ${voice.name} ${spd}× → ${loudKey}`);
        const loudStarted = Date.now();
        const srcMp3 = await getObjectBuffer(s3, bucket, mp3Key);
        const previewMp3 = await trimMp3ForPreview(srcMp3);
        let loudMp3: Buffer;
        try {
          loudMp3 = await loudnormMp3Buffer(previewMp3);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(
            `loudnorm failed (${msg}). Install ffmpeg and ensure it is on PATH.`,
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
        scriptLog("Loudnorm upload complete", { elapsedMs: elapsedMs(loudStarted) });
        await new Promise((r) => setTimeout(r, 250));
      } else {
        console.log(`skip (exists) ${voice.name} ${spd}× LOUD → ${loudKey}`);
      }

      const loudFxKey = orpheusSpeakerPreviewLoudFxSampleKey(voice.id, spd);
      if (!apiBase) continue;
      if (
        !forceUpdate &&
        !forceFxUpdate &&
        (await objectExists(s3, bucket, loudFxKey))
      ) {
        console.log(`skip (exists) ${voice.name} ${spd}× LOUD FX → ${loudFxKey}`);
        continue;
      }

      console.log(`voice-fx mixer (from loud) ${voice.name} (${voice.id}) @ ${spd}×…`);
      const fxStarted = Date.now();
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
      scriptLog("Voice FX upload complete", { elapsedMs: elapsedMs(fxStarted) });
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  scriptLog("Batch finished", {
    totalJobs,
    totalMs: elapsedMs(batchStarted),
  });
  console.log("Done.");
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[orpheus-samples] FAILED: ${msg}`);
  if (e instanceof Error && e.stack) {
    console.error(e.stack);
  }
  process.exit(1);
});
