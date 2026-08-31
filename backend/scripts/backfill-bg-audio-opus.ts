/**
 * Backfills the gapless Ogg Opus sibling for background-audio beds that were
 * normalized before Opus encoding existed.
 *
 * Encodes from the WAV master when present (no generation loss), else from the
 * MP3. Safe to re-run: stems that already have `.opus` are skipped unless
 * `--force` is passed.
 *
 *   export MEDIA_BUCKET_NAME=…          # or pass --bucket
 *   npm run backfill-bg-audio-opus -- --dry-run
 *   npm run backfill-bg-audio-opus
 *   npm run backfill-bg-audio-opus -- --force --concurrency 4
 *
 * Requires ffmpeg with libopus on PATH.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { BG_AUDIO_PREFIX } from "../lib/background-audio-keys";
import { OPUS_CONTENT_TYPE, opusEncodeArgs } from "../lib/bg-audio-opus";

const execFileAsync = promisify(execFile);
const s3 = new S3Client({});

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");

function argValue(flag: string): string | null {
  const i = args.indexOf(flag);
  if (i === -1) return null;
  return args[i + 1]?.trim() || null;
}

const bucket = argValue("--bucket") ?? process.env.MEDIA_BUCKET_NAME ?? "";
const concurrency = Math.max(1, Number(argValue("--concurrency") ?? "3") || 3);
const limit = Number(argValue("--limit") ?? "0") || 0;

type Stem = { wavKey?: string; mp3Key?: string; hasOpus: boolean };

async function listStems(): Promise<Map<string, Stem>> {
  const stems = new Map<string, Stem>();
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: BG_AUDIO_PREFIX,
        ContinuationToken: token,
      }),
    );
    for (const obj of page.Contents ?? []) {
      const key = obj.Key;
      if (!key || key.endsWith("/")) continue;
      const lower = key.toLowerCase();
      const isWav = lower.endsWith(".wav");
      const isMp3 = lower.endsWith(".mp3");
      const isOpus = lower.endsWith(".opus");
      if (!isWav && !isMp3 && !isOpus) continue;
      const stemKey = key.slice(0, key.lastIndexOf("."));
      const rec = stems.get(stemKey) ?? { hasOpus: false };
      if (isWav) rec.wavKey = key;
      else if (isMp3) rec.mp3Key = key;
      else rec.hasOpus = true;
      stems.set(stemKey, rec);
    }
    token = page.NextContinuationToken;
  } while (token);
  return stems;
}

async function downloadToFile(key: string, filePath: string): Promise<void> {
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!obj.Body) throw new Error(`empty body for ${key}`);
  fs.writeFileSync(filePath, Buffer.from(await obj.Body.transformToByteArray()));
}

async function encodeOne(stemKey: string, source: string): Promise<number> {
  const id = randomUUID();
  const ext = source.toLowerCase().endsWith(".wav") ? "wav" : "mp3";
  const inPath = path.join(os.tmpdir(), `bg-opus-in-${id}.${ext}`);
  const outPath = path.join(os.tmpdir(), `bg-opus-out-${id}.opus`);
  try {
    await downloadToFile(source, inPath);
    await execFileAsync("ffmpeg", opusEncodeArgs(inPath, outPath), {
      maxBuffer: 10 * 1024 * 1024,
    });
    const body = fs.readFileSync(outPath);
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${stemKey}.opus`,
        Body: body,
        ContentType: OPUS_CONTENT_TYPE,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    return body.byteLength;
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

async function main(): Promise<void> {
  if (!bucket) {
    throw new Error("MEDIA_BUCKET_NAME is not set (or pass --bucket <name>)");
  }

  const stems = await listStems();
  const pending: { stemKey: string; source: string }[] = [];
  for (const [stemKey, rec] of stems) {
    if (rec.hasOpus && !force) continue;
    const source = rec.wavKey ?? rec.mp3Key;
    if (!source) continue;
    pending.push({ stemKey, source });
  }
  pending.sort((a, b) => a.stemKey.localeCompare(b.stemKey));

  const work = limit > 0 ? pending.slice(0, limit) : pending;
  console.log(
    `[bg-opus] ${stems.size} stems, ${work.length} to encode${dryRun ? " (dry run)" : ""}`,
  );

  if (dryRun) {
    for (const item of work) console.log(`[dry-run] ${item.stemKey}.opus ← ${item.source}`);
    return;
  }

  let done = 0;
  let failed = 0;
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= work.length) return;
      const item = work[index]!;
      try {
        const bytes = await encodeOne(item.stemKey, item.source);
        done++;
        console.log(`[bg-opus] ${done}/${work.length} ${item.stemKey}.opus (${bytes} bytes)`);
      } catch (e) {
        failed++;
        console.error(`[bg-opus] failed ${item.stemKey}`, e instanceof Error ? e.message : e);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, work.length) }, worker));
  console.log(`[bg-opus] complete — encoded ${done}, failed ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
