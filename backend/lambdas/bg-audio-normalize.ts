import type { S3Event } from "aws-lambda";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";

const s3 = new S3Client({});
const execFileAsync = promisify(execFile);

const RAW_PREFIX = "background-audio-raw/";
const OUT_PREFIX = "background-audio/";

function isAudioKey(key: string): boolean {
  const k = key.toLowerCase();
  return k.endsWith(".mp3") || k.endsWith(".wav");
}

/** Normalized outputs: PCM WAV (pro / archival) + MP3 (streaming). Same stem for both. */
function outKeysFromRawKey(key: string): { wavKey: string; mp3Key: string } {
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
  };
}

async function downloadToFile(bucket: string, key: string, path: string): Promise<void> {
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!obj.Body) throw new Error("S3 body is empty");
  const buf = Buffer.from(await obj.Body.transformToByteArray());
  fs.writeFileSync(path, buf);
}

function ffmpegExecutable(): string {
  if (fs.existsSync("/opt/bin/ffmpeg")) return "/opt/bin/ffmpeg";
  return "ffmpeg";
}

async function execFfmpeg(args: string[]): Promise<void> {
  const bin = ffmpegExecutable();
  const env = { ...process.env, PATH: `/opt/bin:${process.env.PATH || ""}` };
  try {
    await execFileAsync(bin, args, { env, maxBuffer: 10 * 1024 * 1024 });
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer; message?: string };
    const stderr = e.stderr?.toString?.().trim() ?? "";
    throw new Error(
      `ffmpeg failed (${bin}): ${e.message ?? String(err)}${stderr ? `\n${stderr}` : ""}`,
    );
  }
}

/** Loud-normalized 24-bit PCM WAV (same loudness as streamed MP3). */
async function loudnormToWav(inputPath: string, outputWavPath: string): Promise<void> {
  const filter = "loudnorm=I=-16:TP=-1.5:LRA=11:linear=true";
  await execFfmpeg([
    "-hide_banner",
    "-y",
    "-i",
    inputPath,
    "-af",
    filter,
    "-c:a",
    "pcm_s24le",
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

export async function handler(event: S3Event): Promise<void> {
  for (const rec of event.Records ?? []) {
    const bucket = rec.s3.bucket.name;
    const key = decodeURIComponent(rec.s3.object.key.replace(/\+/g, " "));

    // Only process raw prefix audio.
    if (!key.startsWith(RAW_PREFIX)) continue;
    if (!isAudioKey(key)) continue;

    const { wavKey, mp3Key } = outKeysFromRawKey(key);

    const id = randomUUID();
    const inExt = key.toLowerCase().endsWith(".mp3") ? "mp3" : "wav";
    const inPath = `/tmp/bg-in-${id}.${inExt}`;
    const tmpWav = `/tmp/bg-norm-${id}.wav`;
    const tmpMp3 = `/tmp/bg-out-${id}.mp3`;

    try {
      await downloadToFile(bucket, key, inPath);
      await loudnormToWav(inPath, tmpWav);
      await wavToMp3(tmpWav, tmpMp3);
      const wavBuf = fs.readFileSync(tmpWav);
      const mp3Buf = fs.readFileSync(tmpMp3);

      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: wavKey,
          Body: wavBuf,
          ContentType: "audio/wav",
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: mp3Key,
          Body: mp3Buf,
          ContentType: "audio/mpeg",
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );

      console.log("normalized bg audio", {
        bucket,
        key,
        wavKey,
        mp3Key,
        wavBytes: wavBuf.byteLength,
        mp3Bytes: mp3Buf.byteLength,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("bg audio normalize failed", { bucket, key, wavKey, mp3Key, msg });
      throw e;
    } finally {
      for (const p of [inPath, tmpWav, tmpMp3]) {
        try {
          fs.unlinkSync(p);
        } catch {
          /* */
        }
      }
    }
  }
}

