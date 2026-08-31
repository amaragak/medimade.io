import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { requireAdminJson } from "../lib/admin-auth";
import { jsonAuth } from "../lib/medimade-auth-http";
import {
  BG_AUDIO_PREFIX,
  originalKeyForPublicKey,
  parseBgAudioKey,
  siblingOpusKey,
  siblingWavKey,
} from "../lib/background-audio-keys";
import { OPUS_CONTENT_TYPE, opusEncodeArgs } from "../lib/bg-audio-opus";
import { listAllSoundRows, putSoundRow, soundEnabledFromStatus, type SoundCatalogRow } from "../lib/sound-catalog";

const s3 = new S3Client({});
const execFileAsync = promisify(execFile);
const EDGE_FADE_SEC = 0.01;

function json(
  statusCode: number,
  payload: Record<string, unknown>,
): APIGatewayProxyStructuredResultV2 {
  return jsonAuth(statusCode, payload);
}

function ffmpegExecutable(): string {
  if (fs.existsSync("/opt/bin/ffmpeg")) return "/opt/bin/ffmpeg";
  return "ffmpeg";
}

function ffprobeExecutable(): string {
  if (fs.existsSync("/opt/bin/ffprobe")) return "/opt/bin/ffprobe";
  return "ffprobe";
}

function binEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `/opt/bin:${process.env.PATH || ""}` };
}

async function execFfmpeg(args: string[]): Promise<void> {
  const bin = ffmpegExecutable();
  try {
    await execFileAsync(bin, args, { env: binEnv(), maxBuffer: 10 * 1024 * 1024 });
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer; message?: string };
    const stderr = e.stderr?.toString?.().trim() ?? "";
    throw new Error(
      `ffmpeg failed (${bin}): ${e.message ?? String(err)}${stderr ? `\n${stderr}` : ""}`,
    );
  }
}

async function probeDurationSec(path: string): Promise<number> {
  const bin = ffprobeExecutable();
  const { stdout } = await execFileAsync(
    bin,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      path,
    ],
    { env: binEnv(), maxBuffer: 1024 * 1024 },
  );
  const n = Number(String(stdout).trim());
  if (!Number.isFinite(n) || n <= 0) throw new Error("Could not read audio duration");
  return n;
}

/**
 * Fades at the clip edges. The tiny default is a de-click, not a musical fade —
 * an explicit fade time replaces it. Neither may exceed a quarter of the clip,
 * so a short sample cannot fade over its whole length.
 */
function fadeFilter(clipDurSec: number, fadeInSec: number, fadeOutSec: number): string | null {
  const cap = clipDurSec / 4;
  const fadeIn = Math.min(fadeInSec > 0 ? fadeInSec : EDGE_FADE_SEC, cap);
  const fadeOut = Math.min(fadeOutSec > 0 ? fadeOutSec : EDGE_FADE_SEC, cap);
  const parts: string[] = [];
  if (fadeIn > 0) parts.push(`afade=t=in:st=0:d=${fadeIn}:curve=qsin`);
  if (fadeOut > 0) {
    parts.push(`afade=t=out:st=${Math.max(0, clipDurSec - fadeOut)}:d=${fadeOut}:curve=qsin`);
  }
  return parts.length > 0 ? parts.join(",") : null;
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

async function copyObject(bucket: string, fromKey: string, toKey: string): Promise<void> {
  await s3.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${fromKey}`,
      Key: toKey,
      MetadataDirective: "COPY",
    }),
  );
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method === "OPTIONS") return json(204, {});
  if (event.requestContext.http.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const admin = await requireAdminJson(event);
  if ("statusCode" in admin) return admin;

  const bucket = process.env.MEDIA_BUCKET_NAME;
  if (!bucket) return json(500, { error: "MEDIA_BUCKET_NAME is not set" });

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(event.body || "{}") as Record<string, unknown>;
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key.startsWith(BG_AUDIO_PREFIX)) {
    return json(400, { error: "key must be a background-audio object" });
  }

  const startSec = Number(body.startSec);
  const endSecRaw = body.endSec;
  const endSec =
    endSecRaw === null || endSecRaw === undefined || endSecRaw === ""
      ? null
      : Number(endSecRaw);
  if (!Number.isFinite(startSec) || startSec < 0) {
    return json(400, { error: "startSec must be a non-negative number" });
  }
  if (endSec != null && (!Number.isFinite(endSec) || endSec <= startSec)) {
    return json(400, { error: "endSec must be greater than startSec" });
  }

  function fadeArg(raw: unknown): number {
    const n = Number(raw ?? 0);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(n, 30);
  }
  const fadeInSec = fadeArg(body.fadeInSec);
  const fadeOutSec = fadeArg(body.fadeOutSec);

  const mp3Key = key.toLowerCase().endsWith(".wav") ? `${key.slice(0, -4)}.mp3` : key;
  const wavKey = siblingWavKey(mp3Key) ?? `${mp3Key.slice(0, -4)}.wav`;
  const opusKey = siblingOpusKey(mp3Key) ?? `${mp3Key.slice(0, -4)}.opus`;
  const origMp3 = originalKeyForPublicKey(mp3Key);
  const origWav = originalKeyForPublicKey(wavKey);

  const id = randomUUID();
  const inPath = `/tmp/trim-in-${id}`;
  const outWav = `/tmp/trim-out-${id}.wav`;
  const outMp3 = `/tmp/trim-out-${id}.mp3`;
  const outOpus = `/tmp/trim-out-${id}.opus`;
  const origMp3Path = `/tmp/trim-orig-${id}.mp3`;

  try {
    if (!(await objectExists(bucket, origWav)) && !(await objectExists(bucket, origMp3))) {
      if (await objectExists(bucket, wavKey)) await copyObject(bucket, wavKey, origWav);
      if (await objectExists(bucket, mp3Key)) await copyObject(bucket, mp3Key, origMp3);
    }

    let sourceKey: string | null = null;
    let ext = "wav";
    if (await objectExists(bucket, origWav)) {
      sourceKey = origWav;
      ext = "wav";
    } else if (await objectExists(bucket, origMp3)) {
      sourceKey = origMp3;
      ext = "mp3";
    } else if (await objectExists(bucket, wavKey)) {
      sourceKey = wavKey;
      ext = "wav";
    } else if (await objectExists(bucket, mp3Key)) {
      sourceKey = mp3Key;
      ext = "mp3";
    }
    if (!sourceKey) return json(404, { error: "Audio object not found (still processing?)" });

    const srcPath = `${inPath}.${ext}`;
    await downloadToFile(bucket, sourceKey, srcPath);

    // The admin panel always auditions the archived original and streams it as
    // MP3, so a WAV-only original would leave the card silent once the public
    // file has been replaced by the trimmed render.
    if (!(await objectExists(bucket, origMp3))) {
      await execFfmpeg([
        "-hide_banner",
        "-y",
        "-i",
        srcPath,
        "-c:a",
        "libmp3lame",
        "-q:a",
        "2",
        origMp3Path,
      ]);
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: origMp3,
          Body: fs.readFileSync(origMp3Path),
          ContentType: "audio/mpeg",
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
    }

    const clipDur =
      endSec != null
        ? Math.max(0, endSec - startSec)
        : Math.max(0, (await probeDurationSec(srcPath)) - startSec);
    const fade = fadeFilter(clipDur, fadeInSec, fadeOutSec);

    const args = ["-hide_banner", "-y", "-i", srcPath, "-ss", String(startSec)];
    if (endSec != null) args.push("-to", String(endSec));
    if (fade) args.push("-af", fade);
    args.push("-c:a", "pcm_s24le", outWav);
    await execFfmpeg(args);
    await execFfmpeg([
      "-hide_banner",
      "-y",
      "-i",
      outWav,
      "-c:a",
      "libmp3lame",
      "-q:a",
      "2",
      outMp3,
    ]);
    // Opus is an optimisation (gapless loops); a build without libopus must not
    // fail the trim, since playback falls back to MP3.
    let opusBuf: Buffer | null = null;
    try {
      await execFfmpeg(opusEncodeArgs(outWav, outOpus));
      opusBuf = fs.readFileSync(outOpus);
    } catch (e) {
      console.warn("opus encode skipped", e instanceof Error ? e.message : e);
    }

    const wavBuf = fs.readFileSync(outWav);
    const mp3Buf = fs.readFileSync(outMp3);
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
    if (opusBuf) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: opusKey,
          Body: opusBuf,
          ContentType: OPUS_CONTENT_TYPE,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
    }

    const rows = await listAllSoundRows();
    const existing = rows.find((r) => r.sk === mp3Key);
    const parsed = parseBgAudioKey(mp3Key);
    const row: SoundCatalogRow = {
      pk: "SOUND",
      sk: mp3Key,
      name: existing?.name ?? parsed?.name ?? mp3Key,
      category: existing?.category ?? parsed?.category ?? "music",
      subcategory: existing?.subcategory,
      categoryPinned: existing?.categoryPinned,
      suggestedCategory: existing?.suggestedCategory,
      suggestedSubcategory: existing?.suggestedSubcategory,
      suggestedName: existing?.suggestedName,
      packPath: existing?.packPath,
      tags: existing?.tags ?? [],
      status: existing?.status ?? "in_use",
      enabled: soundEnabledFromStatus(existing?.status ?? "in_use"),
      notes: existing?.notes,
      originalKey: origMp3,
      trimStartSec: startSec,
      trimEndSec: endSec,
      fadeInSec,
      fadeOutSec,
      importedAt: existing?.importedAt ?? existing?.updatedAt,
      updatedAt: new Date().toISOString(),
    };
    await putSoundRow(row);

    return json(200, {
      ok: true,
      key: mp3Key,
      wavKey,
      originalKey: origMp3,
      startSec,
      endSec,
      fadeInSec,
      fadeOutSec,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("admin-sounds-trim", msg);
    return json(500, { error: msg });
  } finally {
    for (const p of [
      inPath,
      `${inPath}.wav`,
      `${inPath}.mp3`,
      outWav,
      outMp3,
      outOpus,
      origMp3Path,
    ]) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* */
      }
    }
  }
}
