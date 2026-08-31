import type { S3Event, Context } from "aws-lambda";
import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import fs from "fs";
import { pipeline } from "stream/promises";
import type { Readable } from "stream";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { OPUS_CONTENT_TYPE, opusEncodeArgs } from "../lib/bg-audio-opus";
import { updateSoundProcessing } from "../lib/sound-catalog";

const s3 = new S3Client({});
const execFileAsync = promisify(execFile);

const RAW_PREFIX = "background-audio-raw/";
const OUT_PREFIX = "background-audio/";

/**
 * loudnorm's linear mode emits 192 kHz internally; without an explicit rate the
 * intermediate WAV balloons ~4x and fills /tmp on long compositions.
 */
const MAX_SAMPLE_RATE = 48000;

function isAudioKey(key: string): boolean {
  const k = key.toLowerCase();
  return k.endsWith(".mp3") || k.endsWith(".wav");
}

/**
 * Normalized outputs sharing one stem: PCM WAV (pro / archival), MP3 (streaming
 * fallback), and Ogg Opus (streaming default — gapless, so looped beds have no
 * encoder padding at the seam).
 */
function outKeysFromRawKey(key: string): {
  wavKey: string;
  mp3Key: string;
  opusKey: string;
} {
  if (!key.startsWith(RAW_PREFIX)) {
    throw new Error(`key does not start with ${RAW_PREFIX}`);
  }
  const rel = key.slice(RAW_PREFIX.length);
  const lower = rel.toLowerCase();
  let stem: string;
  if (lower.endsWith(".wav")) stem = rel.slice(0, -4);
  else if (lower.endsWith(".mp3")) stem = rel.slice(0, -4);
  else throw new Error(`unsupported audio key: ${key}`);
  return {
    wavKey: OUT_PREFIX + stem + ".wav",
    mp3Key: OUT_PREFIX + stem + ".mp3",
    opusKey: OUT_PREFIX + stem + ".opus",
  };
}

async function downloadToFile(bucket: string, key: string, path: string): Promise<number> {
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!obj.Body) throw new Error("S3 body is empty");
  await pipeline(obj.Body as Readable, fs.createWriteStream(path));
  return fs.statSync(path).size;
}

async function uploadFile(
  bucket: string,
  key: string,
  path: string,
  contentType: string,
): Promise<number> {
  const bytes = fs.statSync(path).size;
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: fs.createReadStream(path),
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    },
    queueSize: 2,
    partSize: 16 * 1024 * 1024,
  });
  await upload.done();
  return bytes;
}

function ffmpegExecutable(): string {
  if (fs.existsSync("/opt/bin/ffmpeg")) return "/opt/bin/ffmpeg";
  return "ffmpeg";
}

function ffprobeExecutable(): string {
  if (fs.existsSync("/opt/bin/ffprobe")) return "/opt/bin/ffprobe";
  return "ffprobe";
}

/** Last lines of ffmpeg stderr — the part that actually names the failure. */
function stderrTail(stderr: string, lines = 12): string {
  return stderr.split("\n").filter(Boolean).slice(-lines).join("\n");
}

async function execFfmpeg(args: string[]): Promise<void> {
  const bin = ffmpegExecutable();
  const env = { ...process.env, PATH: `/opt/bin:${process.env.PATH || ""}` };
  try {
    await execFileAsync(bin, args, { env, maxBuffer: 10 * 1024 * 1024 });
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer; message?: string };
    const stderr = stderrTail(e.stderr?.toString?.() ?? "");
    throw new Error(
      `ffmpeg failed (${bin}): ${e.message?.split("\n")[0] ?? String(err)}${
        stderr ? `\n${stderr}` : ""
      }`,
    );
  }
}

type SourceInfo = { sampleRate: number; durationSec: number | null };

async function probeSource(inputPath: string): Promise<SourceInfo> {
  const env = { ...process.env, PATH: `/opt/bin:${process.env.PATH || ""}` };
  try {
    const { stdout } = await execFileAsync(
      ffprobeExecutable(),
      [
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=sample_rate:format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        inputPath,
      ],
      { env, maxBuffer: 1024 * 1024 },
    );
    const [rateRaw, durRaw] = stdout.trim().split("\n");
    const rate = Number(rateRaw);
    const dur = Number(durRaw);
    return {
      sampleRate: Number.isFinite(rate) && rate > 0 ? rate : 44100,
      durationSec: Number.isFinite(dur) && dur > 0 ? dur : null,
    };
  } catch {
    return { sampleRate: 44100, durationSec: null };
  }
}

/** Loud-normalized 24-bit PCM WAV at the source rate (capped), same loudness as the MP3. */
async function loudnormToWav(
  inputPath: string,
  outputWavPath: string,
  sampleRate: number,
): Promise<void> {
  const filter = "loudnorm=I=-16:TP=-1.5:LRA=11:linear=true";
  await execFfmpeg([
    "-hide_banner",
    "-y",
    "-i",
    inputPath,
    "-af",
    filter,
    "-ar",
    String(sampleRate),
    "-c:a",
    "pcm_s24le",
    "-rf64",
    "auto",
    outputWavPath,
  ]);
}

async function wavToMp3(wavPath: string, outputMp3Path: string): Promise<void> {
  await execFfmpeg([
    "-hide_banner",
    "-y",
    "-i",
    wavPath,
    "-c:a",
    "libmp3lame",
    "-q:a",
    "2",
    outputMp3Path,
  ]);
}

async function wavToOpus(wavPath: string, outputOpusPath: string): Promise<void> {
  await execFfmpeg(opusEncodeArgs(wavPath, outputOpusPath));
}

async function alreadyNormalized(bucket: string, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

function freeTmpMb(): number | null {
  try {
    const st = fs.statfsSync("/tmp");
    return Math.round((Number(st.bavail) * Number(st.bsize)) / (1024 * 1024));
  } catch {
    return null;
  }
}

export async function handler(event: S3Event, context?: Context): Promise<void> {
  for (const rec of event.Records ?? []) {
    const bucket = rec.s3.bucket.name;
    const key = decodeURIComponent(rec.s3.object.key.replace(/\+/g, " "));

    // Only process raw prefix audio.
    if (!key.startsWith(RAW_PREFIX)) continue;
    if (!isAudioKey(key)) continue;

    const { wavKey, mp3Key, opusKey } = outKeysFromRawKey(key);

    const id = randomUUID();
    const inExt = key.toLowerCase().endsWith(".mp3") ? "mp3" : "wav";
    const inPath = `/tmp/bg-in-${id}.${inExt}`;
    const tmpWav = `/tmp/bg-norm-${id}.wav`;
    const tmpMp3 = `/tmp/bg-out-${id}.mp3`;
    const tmpOpus = `/tmp/bg-out-${id}.opus`;
    const startedAt = Date.now();
    let stage: "downloading" | "normalizing" | "encoding" | "storing" = "downloading";
    let source: SourceInfo | null = null;
    let rawBytes = 0;

    const describeSource = () =>
      source
        ? `${Math.round(rawBytes / 1048576)}MB source, ${
            source.durationSec ? `${Math.round(source.durationSec / 60)}min, ` : ""
          }${source.sampleRate}Hz`
        : `${Math.round(rawBytes / 1048576)}MB source`;

    try {
      if (await alreadyNormalized(bucket, mp3Key)) {
        console.log("bg audio already normalized, skipping", { key, mp3Key });
        await updateSoundProcessing(mp3Key, { stage: "done", detail: "already normalized" });
        continue;
      }

      await updateSoundProcessing(mp3Key, { stage: "downloading" });
      rawBytes = await downloadToFile(bucket, key, inPath);
      source = await probeSource(inPath);
      const sampleRate = Math.min(source.sampleRate, MAX_SAMPLE_RATE);

      stage = "normalizing";
      await updateSoundProcessing(mp3Key, { stage: "normalizing", detail: describeSource() });
      await loudnormToWav(inPath, tmpWav, sampleRate);
      fs.unlinkSync(inPath);

      stage = "encoding";
      await updateSoundProcessing(mp3Key, { stage: "encoding", detail: describeSource() });
      await wavToMp3(tmpWav, tmpMp3);
      // Opus is an optimisation (gapless loops). If the ffmpeg build has no
      // libopus, keep the WAV + MP3 outputs — playback falls back to MP3.
      let hasOpus = false;
      try {
        await wavToOpus(tmpWav, tmpOpus);
        hasOpus = true;
      } catch (e) {
        console.warn("opus encode skipped", {
          key,
          msg: e instanceof Error ? e.message : String(e),
        });
      }

      stage = "storing";
      await updateSoundProcessing(mp3Key, { stage: "storing", detail: describeSource() });
      const wavBytes = await uploadFile(bucket, wavKey, tmpWav, "audio/wav");
      const mp3Bytes = await uploadFile(bucket, mp3Key, tmpMp3, "audio/mpeg");
      const opusBytes = hasOpus
        ? await uploadFile(bucket, opusKey, tmpOpus, OPUS_CONTENT_TYPE)
        : null;

      await updateSoundProcessing(mp3Key, { stage: "done", detail: describeSource() });
      console.log("normalized bg audio", {
        bucket,
        key,
        wavKey,
        mp3Key,
        opusKey: hasOpus ? opusKey : null,
        rawBytes,
        wavBytes,
        mp3Bytes,
        opusBytes,
        sampleRate,
        durationSec: source.durationSec,
        elapsedMs: Date.now() - startedAt,
        freeTmpMb: freeTmpMb(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const remainingMs = context?.getRemainingTimeInMillis?.() ?? null;
      const detail = [
        `stage=${stage}`,
        describeSource(),
        `elapsed=${Math.round((Date.now() - startedAt) / 1000)}s`,
        `freeTmp=${freeTmpMb() ?? "?"}MB`,
        remainingMs != null ? `remaining=${Math.round(remainingMs / 1000)}s` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      await updateSoundProcessing(mp3Key, { stage: "failed", error: msg, detail });
      console.error("bg audio normalize failed", { bucket, key, mp3Key, stage, detail, msg });
      throw e;
    } finally {
      for (const p of [inPath, tmpWav, tmpMp3, tmpOpus]) {
        try {
          fs.unlinkSync(p);
        } catch {
          /* */
        }
      }
    }
  }
}
