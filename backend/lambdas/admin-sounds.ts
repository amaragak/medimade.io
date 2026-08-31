import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireAdminJson } from "../lib/admin-auth";
import { jsonAuth } from "../lib/medimade-auth-http";
import {
  BG_AUDIO_CATEGORIES,
  BG_AUDIO_PREFIX,
  BG_AUDIO_RAW_PREFIX,
  mergeByStemPreferMp3,
  normalizeBgAudioCategory,
  originalKeyForPublicKey,
  parseAnyBgAudioKey,
  parseBgAudioKey,
  publicKeysForCategoryMove,
  siblingWavKey,
  stemKeysFromRelativePath,
  spliceFilenameId,
  type BgAudioCategory,
} from "../lib/background-audio-keys";
import { coerceSoundSubcategory } from "../lib/sound-taxonomy";
import { listAllS3Objects } from "../lib/s3-list-all";
import { suggestSoundCategories } from "../lib/sound-category-suggest";
import {
  deleteSoundRow,
  listAllSoundRows,
  normalizeTags,
  parseSoundReviewStatus,
  putSoundRow,
  soundEnabledFromStatus,
  updateSoundProcessing,
  type SoundCatalogRow,
  type SoundReviewStatus,
} from "../lib/sound-catalog";

const s3 = new S3Client({
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

const PART_SIZE = 8 * 1024 * 1024;
const MULTIPART_MIN = 8 * 1024 * 1024;
const PRESIGN = {
  // A batch of hour-long WAVs on a slow uplink can outlive a one-hour window.
  expiresIn: 6 * 3600,
  unsignableHeaders: new Set([
    "content-type",
    "x-amz-checksum-crc32",
    "x-amz-checksum-crc32c",
    "x-amz-checksum-sha1",
    "x-amz-checksum-sha256",
    "x-amz-sdk-checksum-algorithm",
    "x-amz-trailer",
    "x-amz-decoded-content-length",
  ]),
};

function json(
  statusCode: number,
  payload: Record<string, unknown>,
): APIGatewayProxyStructuredResultV2 {
  return jsonAuth(statusCode, payload);
}

function s3KeySet(objects: { Key?: string }[]): Set<string> {
  const keys = new Set<string>();
  for (const o of objects) {
    if (o.Key) keys.add(o.Key);
  }
  return keys;
}

function rawKeysForPublicMp3(mp3Key: string, packPath?: string): string[] {
  const out: string[] = [];
  if (packPath?.trim()) out.push(`${BG_AUDIO_RAW_PREFIX}${packPath.trim()}`);
  const rel = mp3Key.startsWith(BG_AUDIO_PREFIX) ? mp3Key.slice(BG_AUDIO_PREFIX.length) : mp3Key;
  const stem = rel.replace(/\.mp3$/i, "");
  out.push(`${BG_AUDIO_RAW_PREFIX}${stem}.wav`, `${BG_AUDIO_RAW_PREFIX}${stem}.mp3`);
  return out;
}

async function objectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function copyIfExists(bucket: string, fromKey: string, toKey: string): Promise<boolean> {
  if (fromKey === toKey) return objectExists(bucket, fromKey);
  if (!(await objectExists(bucket, fromKey))) return false;
  await s3.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${fromKey}`,
      Key: toKey,
      MetadataDirective: "COPY",
    }),
  );
  return true;
}

async function movePublicSoundToCategory(
  bucket: string,
  key: string,
  existing: SoundCatalogRow | undefined,
  toCategory: BgAudioCategory,
): Promise<{ nextKey: string; category: BgAudioCategory } | null> {
  const current =
    normalizeBgAudioCategory(existing?.category ?? "") ??
    parseBgAudioKey(key)?.category ??
    "music";
  if (toCategory === current) return { nextKey: key, category: current };
  const move = publicKeysForCategoryMove(key, toCategory);
  if (!move) return null;
  await copyIfExists(bucket, move.fromMp3, move.toMp3);
  await copyIfExists(bucket, move.fromWav, move.toWav);
  await copyIfExists(bucket, move.fromOpus, move.toOpus);
  const fromOrigMp3 = originalKeyForPublicKey(move.fromMp3);
  const fromOrigWav = originalKeyForPublicKey(move.fromWav);
  await copyIfExists(bucket, fromOrigMp3, originalKeyForPublicKey(move.toMp3));
  await copyIfExists(bucket, fromOrigWav, originalKeyForPublicKey(move.toWav));
  if (move.fromMp3 !== move.toMp3) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: move.fromMp3 })).catch(() => undefined);
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: move.fromWav })).catch(() => undefined);
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: move.fromOpus })).catch(() => undefined);
  }
  if (existing) await deleteSoundRow(existing.sk);
  return { nextKey: move.toMp3, category: toCategory };
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method === "OPTIONS") return json(204, {});

  const admin = await requireAdminJson(event);
  if ("statusCode" in admin) return admin;

  const bucket = process.env.MEDIA_BUCKET_NAME;
  if (!bucket) return json(500, { error: "MEDIA_BUCKET_NAME is not set" });

  const domain = (process.env.MEDIA_CLOUDFRONT_DOMAIN || "").trim();
  const baseUrl = domain ? `https://${domain}` : undefined;

  try {
    if (method === "GET") return await handleGet(bucket, baseUrl);
    if (method === "PATCH") return await handlePatch(event, bucket);
    if (method === "POST") return await handlePost(event, bucket);
    return json(405, { error: "Method not allowed" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Admin sounds failed";
    console.error("admin-sounds", msg);
    return json(500, { error: msg });
  }
}

/** A multipart upload that was started but never completed — the file is not in S3. */
type PendingRawUpload = {
  uploadId: string;
  initiatedAt: string | null;
  uploadedBytes: number;
  partCount: number;
};

/**
 * Distinguishes "the browser upload died halfway" from "nothing was ever sent",
 * which the panel previously reported identically.
 */
async function listPendingRawUploads(bucket: string): Promise<Map<string, PendingRawUpload>> {
  const out = new Map<string, PendingRawUpload>();
  try {
    let keyMarker: string | undefined;
    let uploadIdMarker: string | undefined;
    do {
      const res = await s3.send(
        new ListMultipartUploadsCommand({
          Bucket: bucket,
          Prefix: BG_AUDIO_RAW_PREFIX,
          KeyMarker: keyMarker,
          UploadIdMarker: uploadIdMarker,
        }),
      );
      for (const u of res.Uploads ?? []) {
        if (!u.Key || !u.UploadId) continue;
        out.set(u.Key, {
          uploadId: u.UploadId,
          initiatedAt: u.Initiated ? u.Initiated.toISOString() : null,
          uploadedBytes: 0,
          partCount: 0,
        });
      }
      keyMarker = res.IsTruncated ? res.NextKeyMarker : undefined;
      uploadIdMarker = res.IsTruncated ? res.NextUploadIdMarker : undefined;
    } while (keyMarker);

    // Part sizes tell us how far the upload actually got.
    await Promise.all(
      [...out.entries()].map(async ([key, info]) => {
        try {
          const parts = await s3.send(
            new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: info.uploadId }),
          );
          info.partCount = parts.Parts?.length ?? 0;
          info.uploadedBytes = (parts.Parts ?? []).reduce((sum, p) => sum + (p.Size ?? 0), 0);
        } catch {
          /* part listing is best-effort */
        }
      }),
    );
  } catch (e) {
    console.warn("listPendingRawUploads failed", e instanceof Error ? e.message : e);
  }
  return out;
}

async function handleGet(bucket: string, baseUrl: string | undefined) {
  const [objects, rawObjects, rows, pendingUploads] = await Promise.all([
    listAllS3Objects(s3, bucket, BG_AUDIO_PREFIX),
    listAllS3Objects(s3, bucket, BG_AUDIO_RAW_PREFIX),
    listAllSoundRows(),
    listPendingRawUploads(bucket),
  ]);
  const rawKeySet = s3KeySet(rawObjects);
  const metaBySk = new Map(rows.map((r) => [r.sk, r]));

  const parsedItems: {
    key: string;
    name: string;
    size: number | null;
    folderCategory: BgAudioCategory | null;
  }[] = [];
  for (const o of objects) {
    if (!o.Key) continue;
    const parsed = parseAnyBgAudioKey(o.Key);
    if (!parsed) continue;
    parsedItems.push({
      key: parsed.key,
      name: parsed.name,
      size: o.Size ?? null,
      folderCategory: parsed.folderCategory,
    });
  }
  const merged = mergeByStemPreferMp3(parsedItems);
  const folderCatByKey = new Map<string, BgAudioCategory | null>();
  for (const p of parsedItems) {
    const k = p.key.toLowerCase().endsWith(".wav") ? `${p.key.slice(0, -4)}.mp3` : p.key;
    folderCatByKey.set(k, p.folderCategory);
    folderCatByKey.set(p.key, p.folderCategory);
  }

  function rowPayload(item: {
    key: string;
    wavKey?: string;
    name: string;
    size: number | null;
    ready: boolean;
    hasRaw?: boolean;
  }) {
    const meta = metaBySk.get(item.key);
    const candidateRawKeys = rawKeysForPublicMp3(item.key, meta?.packPath);
    const hasRaw = item.hasRaw ?? candidateRawKeys.some((k) => rawKeySet.has(k));
    const pendingUpload =
      candidateRawKeys
        .map((k) => pendingUploads.get(k))
        .find((u): u is PendingRawUpload => Boolean(u)) ?? null;
    const folderCategory = folderCatByKey.get(item.key) ?? parseAnyBgAudioKey(item.key)?.folderCategory ?? null;
    const category: BgAudioCategory =
      (meta?.category && normalizeBgAudioCategory(meta.category)) ||
      folderCategory ||
      "music";
    return {
      key: item.key,
      wavKey: item.wavKey,
      name: meta?.name ?? item.name,
      size: item.size,
      packPath: meta?.packPath ?? null,
      folderCategory,
      category,
      subcategory: meta?.subcategory ?? "",
      suggestedCategory: meta?.suggestedCategory ?? null,
      suggestedSubcategory: meta?.suggestedSubcategory ?? null,
      suggestedName: meta?.suggestedName ?? null,
      tags: meta?.tags ?? [],
      status: meta?.status ?? "in_use",
      enabled: soundEnabledFromStatus(meta?.status ?? "in_use"),
      notes: meta?.notes ?? "",
      originalKey: meta?.originalKey,
      trimStartSec: meta?.trimStartSec ?? 0,
      trimEndSec: meta?.trimEndSec ?? null,
      fadeInSec: meta?.fadeInSec ?? 0,
      fadeOutSec: meta?.fadeOutSec ?? 0,
      inCatalog: Boolean(meta),
      ready: item.ready,
      hasRaw,
      rawKey: candidateRawKeys.find((k) => rawKeySet.has(k)) ?? null,
      processing: meta?.processing ?? null,
      pendingUpload,
      importedAt: meta?.importedAt ?? meta?.updatedAt ?? null,
      updatedAt: meta?.updatedAt ?? null,
    };
  }

  const seen = new Set<string>();
  const items: Record<string, unknown>[] = [];

  for (const item of merged) {
    seen.add(item.key);
    items.push(rowPayload({ ...item, ready: true }));
  }

  for (const row of rows) {
    if (seen.has(row.sk)) continue;
    items.push(
      rowPayload({
        key: row.sk,
        wavKey: siblingWavKey(row.sk) ?? undefined,
        name: row.name,
        size: null,
        ready: false,
        hasRaw: rawKeysForPublicMp3(row.sk, row.packPath).some((k) => rawKeySet.has(k)),
      }),
    );
  }

  items.sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const inUse = items.filter((i) => i.status === "in_use").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const unused = items.filter((i) => i.status === "unused").length;
  const categorised = items.filter((i) => i.status === "categorised").length;
  const loopVerified = items.filter((i) => i.status === "loop_verified").length;

  return json(200, {
    ...(baseUrl ? { baseUrl } : {}),
    categories: BG_AUDIO_CATEGORIES,
    counts: {
      total: items.length,
      inUse,
      pending,
      unused,
      categorised,
      loopVerified,
      inCatalog: rows.length,
    },
    items,
  });
}

async function handlePatch(event: APIGatewayProxyEventV2, bucket: string) {
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

  const rows = await listAllSoundRows();
  const existing = rows.find((r) => r.sk === key);
  const parsed = parseBgAudioKey(key);
  const requestedCategory =
    typeof body.category === "string" ? normalizeBgAudioCategory(body.category) : null;
  let category: BgAudioCategory =
    normalizeBgAudioCategory(existing?.category ?? "") ??
    parsed?.category ??
    "music";

  const relocated = requestedCategory
    ? await movePublicSoundToCategory(bucket, key, existing, requestedCategory)
    : { nextKey: key, category };
  if (!relocated) return json(400, { error: "Cannot recategorize this key" });
  const nextKey = relocated.nextKey;
  category = relocated.category;

  let status: SoundReviewStatus = existing?.status ?? "in_use";
  if (typeof body.status === "string") {
    status = parseSoundReviewStatus(body.status);
  } else if (typeof body.enabled === "boolean") {
    status = body.enabled ? "in_use" : "unused";
  }

  const row: SoundCatalogRow = {
    pk: "SOUND",
    sk: nextKey,
    name:
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim().slice(0, 120)
        : existing?.name ?? parsed?.name ?? nextKey,
    category,
    tags: Array.isArray(body.tags) ? normalizeTags(body.tags) : existing?.tags ?? [],
    status,
    enabled: soundEnabledFromStatus(status),
    notes:
      typeof body.notes === "string"
        ? body.notes.slice(0, 500)
        : existing?.notes,
    subcategory: coerceSoundSubcategory(
      category,
      typeof body.subcategory === "string" ? body.subcategory : existing?.subcategory,
    ),
    categoryPinned: requestedCategory ? true : existing?.categoryPinned,
    suggestedCategory: existing?.suggestedCategory,
    suggestedSubcategory: existing?.suggestedSubcategory,
    suggestedName: existing?.suggestedName,
    packPath: existing?.packPath,
    importedAt: existing?.importedAt ?? existing?.updatedAt,
    processing: existing?.processing,
    originalKey: existing?.originalKey
      ? originalKeyForPublicKey(nextKey)
      : existing?.originalKey,
    trimStartSec: existing?.trimStartSec,
    trimEndSec: existing?.trimEndSec,
    fadeInSec: existing?.fadeInSec,
    fadeOutSec: existing?.fadeOutSec,
    updatedAt: new Date().toISOString(),
  };
  await putSoundRow(row);
  return json(200, { item: row, key: nextKey });
}

async function handlePost(event: APIGatewayProxyEventV2, bucket: string) {
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(event.body || "{}") as Record<string, unknown>;
  } catch {
    return json(400, { error: "Invalid JSON" });
  }
  if (body.completeMultipart && typeof body.completeMultipart === "object") {
    return handleCompleteMultipart(bucket, body.completeMultipart as Record<string, unknown>);
  }
  if (body.abortMultipart && typeof body.abortMultipart === "object") {
    return handleAbortMultipart(bucket, body.abortMultipart as Record<string, unknown>);
  }
  if (body.analyseTitles && typeof body.analyseTitles === "object") {
    return handleAnalyseTitles(bucket, body.analyseTitles as Record<string, unknown>);
  }
  if (body.reprocess && typeof body.reprocess === "object") {
    return handleReprocess(bucket, body.reprocess as Record<string, unknown>);
  }
  if (body.suggest && typeof body.suggest === "object") {
    return handleSuggest(body.suggest as Record<string, unknown>);
  }
  return handleUploads(bucket, body);
}

async function handleCompleteMultipart(bucket: string, rec: Record<string, unknown>) {
  const rawKey = typeof rec.rawKey === "string" ? rec.rawKey.trim() : "";
  const uploadId = typeof rec.uploadId === "string" ? rec.uploadId.trim() : "";
  const parts = Array.isArray(rec.parts) ? rec.parts : [];
  if (!rawKey.startsWith(BG_AUDIO_RAW_PREFIX) || !uploadId || parts.length === 0) {
    return json(400, { error: "completeMultipart requires rawKey, uploadId, parts" });
  }
  const completed = parts
    .map((p) => {
      if (!p || typeof p !== "object") return null;
      const row = p as Record<string, unknown>;
      const partNumber = Number(row.partNumber);
      const etag = typeof row.etag === "string" ? row.etag.trim() : "";
      if (!Number.isInteger(partNumber) || partNumber < 1 || !etag) return null;
      return { PartNumber: partNumber, ETag: etag };
    })
    .filter((p): p is { PartNumber: number; ETag: string } => Boolean(p))
    .sort((a, b) => a.PartNumber - b.PartNumber);
  if (completed.length === 0) return json(400, { error: "No valid multipart parts" });
  await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: rawKey,
      UploadId: uploadId,
      MultipartUpload: { Parts: completed },
    }),
  );
  return json(200, { ok: true, rawKey });
}

async function handleAbortMultipart(bucket: string, rec: Record<string, unknown>) {
  const rawKey = typeof rec.rawKey === "string" ? rec.rawKey.trim() : "";
  const uploadId = typeof rec.uploadId === "string" ? rec.uploadId.trim() : "";
  if (!rawKey.startsWith(BG_AUDIO_RAW_PREFIX) || !uploadId) {
    return json(400, { error: "abortMultipart requires rawKey and uploadId" });
  }
  await s3.send(
    new AbortMultipartUploadCommand({ Bucket: bucket, Key: rawKey, UploadId: uploadId }),
  ).catch(() => undefined);
  return json(200, { ok: true });
}

/**
 * Re-runs normalization for an upload whose raw file is in S3 but never produced
 * playable output. Copying the raw object onto itself re-fires the S3 trigger,
 * so nothing has to be re-uploaded from the browser.
 */
async function handleReprocess(bucket: string, rec: Record<string, unknown>) {
  const key = typeof rec.key === "string" ? rec.key.trim() : "";
  if (!key.startsWith(BG_AUDIO_PREFIX)) {
    return json(400, { error: "reprocess requires a background-audio key" });
  }
  const rows = await listAllSoundRows();
  const existing = rows.find((r) => r.sk === key);
  const candidates = rawKeysForPublicMp3(key, existing?.packPath);

  let rawKey: string | null = null;
  for (const candidate of candidates) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: candidate }));
      rawKey = candidate;
      break;
    } catch {
      /* try next candidate */
    }
  }
  if (!rawKey) {
    return json(409, {
      error: "No raw upload found in S3 for this sound. Re-import the file.",
    });
  }

  await updateSoundProcessing(key, { stage: "downloading", detail: "reprocess requested" });
  await s3.send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: rawKey,
      CopySource: `${bucket}/${encodeURIComponent(rawKey).replace(/%2F/g, "/")}`,
      MetadataDirective: "REPLACE",
      Metadata: { reprocessedAt: new Date().toISOString() },
    }),
  );
  return json(200, { ok: true, rawKey });
}

async function handleSuggest(rec: Record<string, unknown>) {
  const rawPaths = Array.isArray(rec.paths) ? rec.paths : [];
  const rels: string[] = [];
  const keysByRel = new Map<string, NonNullable<ReturnType<typeof stemKeysFromRelativePath>>>();
  for (const p of rawPaths) {
    if (typeof p !== "string") continue;
    const keys = stemKeysFromRelativePath(p);
    if (!keys) continue;
    if (keysByRel.has(keys.rel)) continue;
    keysByRel.set(keys.rel, keys);
    rels.push(keys.rel);
  }
  if (rels.length === 0) return json(200, { updated: 0 });
  if (rels.length > 40) return json(400, { error: "At most 40 paths per suggest request" });

  let suggestions = new Map<
    string,
    { category: BgAudioCategory; subcategory: string; name: string }
  >();
  try {
    suggestions = await suggestSoundCategories(rels.map((rel) => ({ id: rel, filename: rel })));
  } catch (e) {
    console.warn("sound category suggest failed", e);
    return json(200, { updated: 0, error: "suggest failed" });
  }

  const catalog = await listAllSoundRows();
  const bySk = new Map(catalog.map((r) => [r.sk, r]));
  const byPack = new Map(catalog.filter((r) => r.packPath).map((r) => [r.packPath as string, r]));
  let updated = 0;
  for (const rel of rels) {
    const hint = suggestions.get(rel);
    if (!hint) continue;
    const keys = keysByRel.get(rel);
    const row = (keys ? bySk.get(keys.mp3Key) : undefined) ?? byPack.get(rel);
    if (!row) continue;
    await putSoundRow({
      ...row,
      suggestedCategory: hint.category,
      suggestedSubcategory: hint.subcategory,
      suggestedName: hint.name,
      updatedAt: new Date().toISOString(),
    });
    updated += 1;
  }
  return json(200, { updated });
}

async function handleAnalyseTitles(bucket: string, rec: Record<string, unknown>) {
  const rawKeys = Array.isArray(rec.keys) ? rec.keys : [];
  const keys = rawKeys.filter((k): k is string => typeof k === "string" && k.startsWith(BG_AUDIO_PREFIX));
  const unique = [...new Set(keys)];
  if (unique.length === 0) return json(200, { updated: 0 });
  if (unique.length > 40) return json(400, { error: "At most 40 keys per analyse request" });

  const catalog = await listAllSoundRows();
  const bySk = new Map(catalog.map((r) => [r.sk, r]));
  const payload: Array<{ id: string; filename: string }> = [];
  for (const key of unique) {
    const row = bySk.get(key);
    if (!row) continue;
    const filename = row.packPath || row.name || key.split("/").pop() || key;
    payload.push({ id: key, filename });
  }
  if (payload.length === 0) return json(200, { updated: 0 });

  let suggestions = new Map<
    string,
    { category: BgAudioCategory; subcategory: string; name: string }
  >();
  try {
    suggestions = await suggestSoundCategories(payload);
  } catch (e) {
    console.warn("sound title analyse failed", e);
    return json(500, { error: "analyse failed", detail: e instanceof Error ? e.message : String(e) });
  }

  let updated = 0;
  for (const item of payload) {
    const hint = suggestions.get(item.id);
    const row = bySk.get(item.id);
    if (!hint || !row) continue;
    // A pinned row keeps the category the admin chose at import; the classifier
    // is only there for the name.
    const target = row.categoryPinned ? row.category : hint.category;
    const relocated = await movePublicSoundToCategory(bucket, item.id, row, target);
    if (!relocated) continue;
    await putSoundRow({
      ...row,
      sk: relocated.nextKey,
      name: hint.name || row.name,
      category: relocated.category,
      subcategory: row.categoryPinned ? row.subcategory : hint.subcategory,
      suggestedCategory: hint.category,
      suggestedSubcategory: hint.subcategory,
      suggestedName: hint.name,
      originalKey: row.originalKey ? originalKeyForPublicKey(relocated.nextKey) : row.originalKey,
      updatedAt: new Date().toISOString(),
    });
    updated += 1;
  }
  return json(200, { updated });
}

async function handleUploads(bucket: string, body: Record<string, unknown>) {
  const files = Array.isArray(body.files) ? body.files : [];
  // Set from the import panel when the admin already knows where the folder
  // belongs; it survives the classifier pass that follows the upload.
  const pinnedCategory =
    typeof body.category === "string" ? normalizeBgAudioCategory(body.category) : null;
  const rawSubcategory = typeof body.subcategory === "string" ? body.subcategory.trim() : "";
  const pinnedSubcategory =
    pinnedCategory && rawSubcategory ? coerceSoundSubcategory(pinnedCategory, rawSubcategory) : "";
  if (files.length === 0) return json(400, { error: "files is required" });
  if (files.length > 24) return json(400, { error: "At most 24 files per request" });

  const [catalog, publicObjects, rawObjects] = await Promise.all([
    listAllSoundRows(),
    listAllS3Objects(s3, bucket, BG_AUDIO_PREFIX),
    listAllS3Objects(s3, bucket, BG_AUDIO_RAW_PREFIX),
  ]);
  const publicKeys = s3KeySet(publicObjects);
  const rawKeys = s3KeySet(rawObjects);
  /**
   * Leaf-name de-dup, split by how far the file got: a normalized copy means
   * there is nothing to do, whereas a raw-only copy just needs reprocessing.
   */
  const processedSpliceIds = new Set<string>();
  const rawKeyBySpliceId = new Map<string, string>();
  for (const key of publicKeys) {
    const id = spliceFilenameId(key);
    if (id) processedSpliceIds.add(id);
  }
  for (const key of rawKeys) {
    const id = spliceFilenameId(key);
    if (id && !rawKeyBySpliceId.has(id)) rawKeyBySpliceId.set(id, key);
  }
  const catalogById = new Map<string, SoundCatalogRow>();
  for (const row of catalog) {
    const ids = [row.name, row.packPath ?? "", row.sk]
      .map((src) => spliceFilenameId(src))
      .filter(Boolean);
    for (const id of ids) {
      if (!catalogById.has(id)) catalogById.set(id, row);
    }
  }

  const prepared: Array<{
    relativePath: string;
    keys: NonNullable<ReturnType<typeof stemKeysFromRelativePath>>;
    contentType: string;
    size: number;
    existing?: SoundCatalogRow;
  }> = [];
  const skipped: string[] = [];
  const reprocessed: string[] = [];
  const seenRawKeys = new Set<string>();
  /** Raw files already in S3 that never produced audio: re-run, do not re-upload. */
  const toReprocess: Array<{ relativePath: string; rawKey: string; mp3Key: string }> = [];

  for (const raw of files) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const relativePath =
      (typeof rec.relativePath === "string" && rec.relativePath.trim()) ||
      (typeof rec.filename === "string" ? rec.filename : "");
    const keys = stemKeysFromRelativePath(relativePath);
    if (!keys) continue;
    const id = spliceFilenameId(keys.name) || spliceFilenameId(relativePath);
    if (!id) continue;
    if (seenRawKeys.has(keys.rawKey)) {
      skipped.push(relativePath);
      continue;
    }
    seenRawKeys.add(keys.rawKey);

    // Already normalized: nothing to do.
    const siblingWav = siblingWavKey(keys.mp3Key);
    if (
      processedSpliceIds.has(id) ||
      publicKeys.has(keys.mp3Key) ||
      (siblingWav && publicKeys.has(siblingWav))
    ) {
      skipped.push(relativePath);
      continue;
    }

    // Raw is in S3 but produced nothing: reprocess that copy instead of re-uploading.
    const existingRawKey =
      rawKeysForPublicMp3(keys.mp3Key, keys.rel).find((k) => rawKeys.has(k)) ??
      rawKeyBySpliceId.get(id) ??
      null;
    if (existingRawKey) {
      toReprocess.push({ relativePath, rawKey: existingRawKey, mp3Key: keys.mp3Key });
      continue;
    }
    const contentType =
      typeof rec.contentType === "string" && rec.contentType.trim()
        ? rec.contentType.trim()
        : keys.rawKey.toLowerCase().endsWith(".wav")
          ? "audio/wav"
          : "audio/mpeg";
    const size = typeof rec.size === "number" && Number.isFinite(rec.size) ? rec.size : 0;
    prepared.push({
      relativePath,
      keys,
      contentType,
      size,
      existing: catalogById.get(id) ?? catalog.find((r) => r.sk === keys.mp3Key),
    });
  }

  for (const r of toReprocess) {
    try {
      await updateSoundProcessing(r.mp3Key, {
        stage: "downloading",
        detail: "re-import found the raw file in S3",
      });
      await s3.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: r.rawKey,
          CopySource: `${bucket}/${encodeURIComponent(r.rawKey).replace(/%2F/g, "/")}`,
          MetadataDirective: "REPLACE",
          Metadata: { reprocessedAt: new Date().toISOString() },
        }),
      );
      reprocessed.push(r.relativePath);
    } catch (e) {
      console.warn("re-import reprocess failed", {
        rawKey: r.rawKey,
        msg: e instanceof Error ? e.message : String(e),
      });
      skipped.push(r.relativePath);
    }
  }

  if (prepared.length === 0) {
    return json(200, {
      uploads: [],
      skipped,
      skippedCount: skipped.length,
      reprocessed,
      reprocessedCount: reprocessed.length,
    });
  }

  const now = new Date().toISOString();
  const uploads: Record<string, unknown>[] = [];
  for (const p of prepared) {
    const prev = p.existing;
    await putSoundRow({
      pk: "SOUND",
      sk: p.keys.mp3Key,
      name: prev?.name ?? p.keys.name,
      category: pinnedCategory ?? prev?.category ?? "music",
      subcategory: pinnedCategory ? pinnedSubcategory || undefined : prev?.subcategory,
      categoryPinned: pinnedCategory ? true : prev?.categoryPinned,
      suggestedCategory: prev?.suggestedCategory,
      suggestedSubcategory: prev?.suggestedSubcategory,
      packPath: p.keys.rel,
      tags: prev?.tags ?? [],
      status: "pending",
      enabled: false,
      notes: prev?.notes,
      originalKey: prev?.originalKey,
      processing: {
        stage: "uploading",
        detail: p.size ? `${Math.round(p.size / 1048576)}MB queued` : undefined,
        updatedAt: now,
      },
      trimStartSec: prev?.trimStartSec,
      trimEndSec: prev?.trimEndSec,
      fadeInSec: prev?.fadeInSec,
      fadeOutSec: prev?.fadeOutSec,
      importedAt: prev?.importedAt ?? now,
      updatedAt: now,
    });

    const entry: Record<string, unknown> = {
      filename: p.relativePath,
      relativePath: p.relativePath,
      rawKey: p.keys.rawKey,
      key: p.keys.mp3Key,
      wavKey: p.keys.wavKey,
      contentType: p.contentType,
    };

    if (p.size >= MULTIPART_MIN) {
      const created = await s3.send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: p.keys.rawKey,
        }),
      );
      const uploadId = created.UploadId;
      if (!uploadId) throw new Error(`Failed to start multipart upload for ${p.keys.rawKey}`);
      const partCount = Math.max(1, Math.ceil(p.size / PART_SIZE));
      const urls: string[] = [];
      for (let n = 1; n <= partCount; n++) {
        urls.push(
          await getSignedUrl(
            s3 as never,
            new UploadPartCommand({
              Bucket: bucket,
              Key: p.keys.rawKey,
              UploadId: uploadId,
              PartNumber: n,
            }),
            PRESIGN,
          ),
        );
      }
      entry.multipart = { uploadId, partSize: PART_SIZE, urls };
    } else {
      entry.url = await getSignedUrl(
        s3 as never,
        new PutObjectCommand({
          Bucket: bucket,
          Key: p.keys.rawKey,
        }),
        PRESIGN,
      );
    }
    uploads.push(entry);
  }

  return json(200, {
    uploads,
    skipped,
    skippedCount: skipped.length,
    reprocessed,
    reprocessedCount: reprocessed.length,
  });
}
