import type { S3Event } from "aws-lambda";
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
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

function outKeyFromRawKey(key: string): string {
  if (!key.startsWith(RAW_PREFIX)) {
    throw new Error(`key does not start with ${RAW_PREFIX}`);
  }
  return OUT_PREFIX + key.slice(RAW_PREFIX.length);
}

async function objectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function downloadToFile(bucket: string, key: string, path: string): Promise<void> {
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!obj.Body) throw new Error("S3 body is empty");
  const buf = Buffer.from(await obj.Body.transformToByteArray());
  fs.writeFileSync(path, buf);
}

async function normalizeWithFfmpeg(inputPath: string, outputPath: string, ext: "mp3" | "wav"): Promise<void> {
  const filter = "loudnorm=I=-16:TP=-1.5:LRA=11:linear=true";
  const args =
    ext === "mp3"
      ? ["-hide_banner", "-y", "-i", inputPath, "-af", filter, "-c:a", "libmp3lame", "-q:a", "2", outputPath]
      : ["-hide_banner", "-y", "-i", inputPath, "-af", filter, "-c:a", "pcm_s16le", outputPath];
  await execFileAsync("ffmpeg", args);
}

export async function handler(event: S3Event): Promise<void> {
  for (const rec of event.Records ?? []) {
    const bucket = rec.s3.bucket.name;
    const key = decodeURIComponent(rec.s3.object.key.replace(/\+/g, " "));

    // Only process raw prefix audio.
    if (!key.startsWith(RAW_PREFIX)) continue;
    if (!isAudioKey(key)) continue;

    const outKey = outKeyFromRawKey(key);

    // If raw is re-uploaded, we re-normalize; but we also avoid redundant work
    // if an output exists and the raw upload is likely a duplicate.
    // The --force-update sync script will re-upload raw objects and this lambda will overwrite output.

    const id = randomUUID();
    const ext = key.toLowerCase().endsWith(".mp3") ? "mp3" : "wav";
    const inPath = `/tmp/bg-in-${id}.${ext}`;
    const outPath = `/tmp/bg-out-${id}.${ext}`;

    try {
      await downloadToFile(bucket, key, inPath);
      await normalizeWithFfmpeg(inPath, outPath, ext);
      const outBuf = fs.readFileSync(outPath);

      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: outKey,
          Body: outBuf,
          ContentType: ext === "mp3" ? "audio/mpeg" : "audio/wav",
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
      console.log("normalized bg audio", { bucket, key, outKey, bytes: outBuf.byteLength, existed: await objectExists(bucket, outKey) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("bg audio normalize failed", { bucket, key, outKey, msg });
      throw e;
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
}

