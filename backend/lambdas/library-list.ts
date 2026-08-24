import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { listVoiceSpeakers } from "../lib/voice-admin";
import { meditationPlaybackS3Key } from "../lib/playback-keys";
import { optionalUserJson } from "../lib/medimade-auth-http";
import { mixListenerPk } from "../lib/meditation-listener-mix";
import {
  GLOBAL_MEDITATION_USER_ID,
  LEGACY_MEDITATION_PARTITION_PK,
  meditationGlobalUserPk,
  meditationUserPk,
} from "../lib/meditation-user-pk";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

function json(
  statusCode: number,
  payload: Record<string, unknown>,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(payload),
  };
}

type DdbMeditation = Record<string, unknown> & {
  pk?: string;
  sk?: string;
  s3Key?: string;
  id?: string;
};

type OutItem = {
  id: string | null;
  sk: string | null;
  s3Key: string;
  audioUrl: string;
  title: string;
  meditationType: string | null;
  meditationStyle: string | null;
  createdAt: string | null;
  durationSeconds: number | null;
  scriptText: string | null;
  scriptTruncated: boolean;
  scriptUtf8Bytes: number | null;
  rating: number | null;
  favourite: boolean;
  archived: boolean;
  isPublic: boolean;
  description: string | null;
  speakerModelId: string | null;
  speakerName: string | null;
  catalogued: boolean;
  mp3Bytes: number | null;
  isDraft: boolean;
  liveMix: boolean;
  backgroundNatureKey: string | null;
  backgroundMusicKey: string | null;
  backgroundDrumsKey: string | null;
  backgroundNoiseKey: string | null;
  backgroundNatureGain: number | null;
  backgroundMusicGain: number | null;
  backgroundDrumsGain: number | null;
  backgroundNoiseGain: number | null;
  createdBackgroundNatureKey: string | null;
  createdBackgroundMusicKey: string | null;
  createdBackgroundDrumsKey: string | null;
  createdBackgroundNoiseKey: string | null;
  createdBackgroundNatureGain: number | null;
  createdBackgroundMusicGain: number | null;
  createdBackgroundDrumsGain: number | null;
  createdBackgroundNoiseGain: number | null;
  publisherBackgroundNatureKey: string | null;
  publisherBackgroundMusicKey: string | null;
  publisherBackgroundDrumsKey: string | null;
  publisherBackgroundNoiseKey: string | null;
  publisherBackgroundNatureGain: number | null;
  publisherBackgroundMusicGain: number | null;
  publisherBackgroundDrumsGain: number | null;
  publisherBackgroundNoiseGain: number | null;
  /** ms from job create (Generate click) until library row write. */
  generationElapsedMs: number | null;
  jobCreatedAt: string | null;
};

function optTrimKey(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function optGain(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(100, Math.max(0, v));
}

async function queryAllMeditationItems(
  tableName: string,
  pk: string,
): Promise<DdbMeditation[]> {
  const items: DdbMeditation[] = [];
  let lek: Record<string, unknown> | undefined;
  do {
    const out = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": pk },
        ScanIndexForward: false,
        ExclusiveStartKey: lek,
      }),
    );
    items.push(...((out.Items ?? []) as DdbMeditation[]));
    lek = out.LastEvaluatedKey;
  } while (lek);
  return items;
}

async function scanPublicMeditationItems(
  tableName: string,
): Promise<DdbMeditation[]> {
  const items: DdbMeditation[] = [];
  let lek: Record<string, unknown> | undefined;
  do {
    const out = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression:
          "#p = :t AND (attribute_not_exists(archived) OR archived = :f) AND (attribute_not_exists(isDraft) OR isDraft = :f)",
        ExpressionAttributeNames: { "#p": "isPublic" },
        ExpressionAttributeValues: { ":t": true, ":f": false },
        ExclusiveStartKey: lek,
      }),
    );
    items.push(...((out.Items ?? []) as DdbMeditation[]));
    lek = out.LastEvaluatedKey;
  } while (lek);
  return items;
}

async function queryListenerMixOverrides(
  tableName: string,
  pk: string,
): Promise<Map<string, DdbMeditation>> {
  const byS3 = new Map<string, DdbMeditation>();
  let lek: Record<string, unknown> | undefined;
  do {
    const out = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :pfx)",
        ExpressionAttributeValues: { ":pk": pk, ":pfx": "MIX#" },
        ExclusiveStartKey: lek,
      }),
    );
    for (const row of (out.Items ?? []) as DdbMeditation[]) {
      const s3Key =
        typeof row.s3Key === "string" && row.s3Key.trim()
          ? row.s3Key.trim()
          : typeof row.sk === "string" && row.sk.startsWith("MIX#")
            ? row.sk.slice(4)
            : "";
      if (s3Key) byS3.set(s3Key, row);
    }
    lek = out.LastEvaluatedKey;
  } while (lek);
  return byS3;
}

function applyListenerMixOverlay(
  items: OutItem[],
  overrides: Map<string, DdbMeditation>,
): OutItem[] {
  if (overrides.size === 0) return items;
  return items.map((item) => {
    const o = overrides.get(item.s3Key);
    if (!o) return item;
    return {
      ...item,
      liveMix: o.liveMix === true || item.liveMix,
      backgroundNatureKey:
        optTrimKey(o.backgroundNatureKey) ?? item.backgroundNatureKey,
      backgroundMusicKey:
        optTrimKey(o.backgroundMusicKey) ?? item.backgroundMusicKey,
      backgroundDrumsKey:
        optTrimKey(o.backgroundDrumsKey) ?? item.backgroundDrumsKey,
      backgroundNoiseKey:
        optTrimKey(o.backgroundNoiseKey) ?? item.backgroundNoiseKey,
      backgroundNatureGain:
        optGain(o.backgroundNatureGain) ?? item.backgroundNatureGain,
      backgroundMusicGain:
        optGain(o.backgroundMusicGain) ?? item.backgroundMusicGain,
      backgroundDrumsGain:
        optGain(o.backgroundDrumsGain) ?? item.backgroundDrumsGain,
      backgroundNoiseGain:
        optGain(o.backgroundNoiseGain) ?? item.backgroundNoiseGain,
    };
  });
}

async function scanAllMeditationItems(tableName: string): Promise<DdbMeditation[]> {
  const items: DdbMeditation[] = [];
  let lek: Record<string, unknown> | undefined;
  do {
    const out = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lek,
      }),
    );
    items.push(...((out.Items ?? []) as DdbMeditation[]));
    lek = out.LastEvaluatedKey;
  } while (lek);
  return items;
}

async function listMeditationMp3Keys(
  bucket: string,
  prefix: string,
): Promise<
  Array<{ key: string; lastModified: string | null; size: number | null }>
> {
  const out: Array<{ key: string; lastModified: string | null; size: number | null }> = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const o of res.Contents ?? []) {
      if (!o.Key || !o.Key.endsWith(".mp3")) continue;
      out.push({
        key: o.Key,
        lastModified: o.LastModified?.toISOString() ?? null,
        size: typeof o.Size === "number" ? o.Size : null,
      });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function listAllMeditationMp3Keys(
  bucket: string,
): Promise<
  Array<{ key: string; lastModified: string | null; size: number | null }>
> {
  return listMeditationMp3Keys(bucket, "meditations/");
}

/** `meditations/<file>.mp3` (no extra path segment) — pre–per-user S3 layout. */
async function listLegacyRootMeditationMp3Keys(
  bucket: string,
): Promise<
  Array<{ key: string; lastModified: string | null; size: number | null }>
> {
  const out: Array<{ key: string; lastModified: string | null; size: number | null }> = [];
  const legacyMp3 = /^meditations\/[^/]+\.mp3$/i;
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: "meditations/",
        ContinuationToken: token,
      }),
    );
    for (const o of res.Contents ?? []) {
      if (!o.Key || !legacyMp3.test(o.Key)) continue;
      out.push({
        key: o.Key,
        lastModified: o.LastModified?.toISOString() ?? null,
        size: typeof o.Size === "number" ? o.Size : null,
      });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

function userIdFromMeditationPk(pk: unknown): string {
  if (typeof pk !== "string") return GLOBAL_MEDITATION_USER_ID;
  if (pk === LEGACY_MEDITATION_PARTITION_PK) return GLOBAL_MEDITATION_USER_ID;
  if (pk.startsWith("USER#")) return pk.slice("USER#".length) || GLOBAL_MEDITATION_USER_ID;
  return GLOBAL_MEDITATION_USER_ID;
}

function buildLibraryItems(params: {
  ddbItems: DdbMeditation[];
  s3Objects: Array<{ key: string; lastModified: string | null; size: number | null }>;
  cfDomain: string;
  draftUserFallback?: string;
  speakerNames: Map<string, string>;
}): OutItem[] {
  const { ddbItems, s3Objects, cfDomain, draftUserFallback, speakerNames } = params;
  const merged = new Map<string, OutItem>();

  for (const row of ddbItems) {
    const isDraft = row.isDraft === true;
    let s3Key = typeof row.s3Key === "string" ? row.s3Key : "";
    const id = typeof row.id === "string" ? row.id : null;
    const rowUserId = userIdFromMeditationPk(row.pk);
    const draftUser = draftUserFallback ?? rowUserId;
    if (isDraft) {
      if (!id) continue;
      if (!s3Key) s3Key = `drafts/${draftUser}/${id}`;
    } else if (!s3Key) {
      continue;
    }
    const catalogS3Key = isDraft ? s3Key : meditationPlaybackS3Key(s3Key);
    const sk = typeof row.sk === "string" ? row.sk : null;
    const title =
      typeof row.title === "string" && row.title.trim()
        ? row.title.trim()
        : isDraft
          ? "Draft"
          : "Meditation";
    const meditationType =
      typeof row.meditationType === "string" ? row.meditationType : null;
    const meditationStyle =
      typeof row.meditationStyle === "string" ? row.meditationStyle : null;
    const referenceId =
      typeof row.referenceId === "string" ? row.referenceId : null;
    const createdAt =
      typeof row.createdAt === "string" ? row.createdAt : null;
    const durationSeconds =
      typeof row.durationSeconds === "number" && Number.isFinite(row.durationSeconds)
        ? row.durationSeconds
        : null;
    const scriptText =
      typeof row.scriptText === "string" ? row.scriptText : null;
    const scriptTruncated = row.scriptTruncated === true;
    const scriptUtf8Bytes =
      typeof row.scriptUtf8Bytes === "number" &&
      Number.isFinite(row.scriptUtf8Bytes) &&
      row.scriptUtf8Bytes > 0
        ? row.scriptUtf8Bytes
        : null;
    const rating =
      typeof row.rating === "number" &&
      Number.isFinite(row.rating) &&
      row.rating >= 1 &&
      row.rating <= 5
        ? row.rating
        : null;
    const favourite = row.favourite === true;
    const archived = row.archived === true;
    const isPublic = row.isPublic === true;
    const description =
      typeof row.description === "string" && row.description.trim().length > 0
        ? row.description.trim()
        : null;
    const mp3Bytes =
      typeof row.mp3Bytes === "number" && Number.isFinite(row.mp3Bytes)
        ? row.mp3Bytes
        : null;

    merged.set(catalogS3Key, {
      id,
      sk,
      s3Key: catalogS3Key,
      audioUrl: isDraft
        ? ""
        : `https://${cfDomain}/${catalogS3Key}`,
      title,
      meditationType,
      meditationStyle,
      createdAt,
      durationSeconds,
      scriptText,
      scriptTruncated,
      scriptUtf8Bytes,
      rating,
      favourite,
      archived,
      isPublic,
      description,
      speakerModelId: referenceId,
      speakerName: referenceId ? speakerNames.get(referenceId) ?? null : null,
      catalogued: !isDraft,
      mp3Bytes,
      isDraft,
      liveMix: row.liveMix === true,
      backgroundNatureKey: optTrimKey(row.backgroundNatureKey),
      backgroundMusicKey: optTrimKey(row.backgroundMusicKey),
      backgroundDrumsKey: optTrimKey(row.backgroundDrumsKey),
      backgroundNoiseKey: optTrimKey(row.backgroundNoiseKey),
      backgroundNatureGain: optGain(row.backgroundNatureGain),
      backgroundMusicGain: optGain(row.backgroundMusicGain),
      backgroundDrumsGain: optGain(row.backgroundDrumsGain),
      backgroundNoiseGain: optGain(row.backgroundNoiseGain),
      createdBackgroundNatureKey:
        optTrimKey(row.createdBackgroundNatureKey) ??
        optTrimKey(row.backgroundNatureKey),
      createdBackgroundMusicKey:
        optTrimKey(row.createdBackgroundMusicKey) ??
        optTrimKey(row.backgroundMusicKey),
      createdBackgroundDrumsKey:
        optTrimKey(row.createdBackgroundDrumsKey) ??
        optTrimKey(row.backgroundDrumsKey),
      createdBackgroundNoiseKey:
        optTrimKey(row.createdBackgroundNoiseKey) ??
        optTrimKey(row.backgroundNoiseKey),
      createdBackgroundNatureGain:
        optGain(row.createdBackgroundNatureGain) ??
        optGain(row.backgroundNatureGain),
      createdBackgroundMusicGain:
        optGain(row.createdBackgroundMusicGain) ??
        optGain(row.backgroundMusicGain),
      createdBackgroundDrumsGain:
        optGain(row.createdBackgroundDrumsGain) ??
        optGain(row.backgroundDrumsGain),
      createdBackgroundNoiseGain:
        optGain(row.createdBackgroundNoiseGain) ??
        optGain(row.backgroundNoiseGain),
      publisherBackgroundNatureKey: optTrimKey(row.backgroundNatureKey),
      publisherBackgroundMusicKey: optTrimKey(row.backgroundMusicKey),
      publisherBackgroundDrumsKey: optTrimKey(row.backgroundDrumsKey),
      publisherBackgroundNoiseKey: optTrimKey(row.backgroundNoiseKey),
      publisherBackgroundNatureGain: optGain(row.backgroundNatureGain),
      publisherBackgroundMusicGain: optGain(row.backgroundMusicGain),
      publisherBackgroundDrumsGain: optGain(row.backgroundDrumsGain),
      publisherBackgroundNoiseGain: optGain(row.backgroundNoiseGain),
      generationElapsedMs:
        typeof row.generationElapsedMs === "number" &&
        Number.isFinite(row.generationElapsedMs) &&
        row.generationElapsedMs >= 0
          ? Math.round(row.generationElapsedMs)
          : null,
      jobCreatedAt:
        typeof row.jobCreatedAt === "string" && row.jobCreatedAt.trim()
          ? row.jobCreatedAt.trim()
          : null,
    });
  }

  for (const obj of s3Objects) {
    if (merged.has(obj.key)) continue;
    merged.set(obj.key, {
      id: null,
      sk: null,
      s3Key: obj.key,
      audioUrl: `https://${cfDomain}/${obj.key}`,
      title: "Uncatalogued audio",
      meditationType: null,
      meditationStyle: null,
      createdAt: obj.lastModified,
      durationSeconds: null,
      scriptText: null,
      scriptTruncated: false,
      scriptUtf8Bytes: null,
      rating: null,
      favourite: false,
      archived: false,
      isPublic: false,
      description: null,
      speakerModelId: null,
      speakerName: null,
      catalogued: false,
      mp3Bytes: obj.size,
      isDraft: false,
      liveMix: false,
      backgroundNatureKey: null,
      backgroundMusicKey: null,
      backgroundDrumsKey: null,
      backgroundNoiseKey: null,
      backgroundNatureGain: null,
      backgroundMusicGain: null,
      backgroundDrumsGain: null,
      backgroundNoiseGain: null,
      createdBackgroundNatureKey: null,
      createdBackgroundMusicKey: null,
      createdBackgroundDrumsKey: null,
      createdBackgroundNoiseKey: null,
      createdBackgroundNatureGain: null,
      createdBackgroundMusicGain: null,
      createdBackgroundDrumsGain: null,
      createdBackgroundNoiseGain: null,
      publisherBackgroundNatureKey: null,
      publisherBackgroundMusicKey: null,
      publisherBackgroundDrumsKey: null,
      publisherBackgroundNoiseKey: null,
      publisherBackgroundNatureGain: null,
      publisherBackgroundMusicGain: null,
      publisherBackgroundDrumsGain: null,
      publisherBackgroundNoiseGain: null,
      generationElapsedMs: null,
      jobCreatedAt: null,
    });
  }

  return [...merged.values()].sort((a, b) => {
    const ta = a.createdAt ?? "";
    const tb = b.createdAt ?? "";
    return tb.localeCompare(ta);
  });
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const user = await optionalUserJson(event);
  const community =
    event.queryStringParameters?.community === "1" ||
    event.queryStringParameters?.community === "true";

  const tableName = process.env.MEDITATION_ANALYTICS_TABLE_NAME;
  const bucket = process.env.MEDIA_BUCKET_NAME;
  const cfDomain = process.env.MEDIA_CLOUDFRONT_DOMAIN;
  if (!tableName || !bucket || !cfDomain) {
    return json(500, { error: "Library list is not configured" });
  }

  try {
    const speakerRows = await listVoiceSpeakers().catch(() => []);
    const speakerNames = new Map(speakerRows.map((s) => [s.modelId, s.name]));

    if (community) {
      const ddbItems = await scanPublicMeditationItems(tableName);
      const items = buildLibraryItems({ ddbItems, s3Objects: [], cfDomain, speakerNames });
      const mixTable = process.env.MEDITATION_LISTENER_MIX_TABLE_NAME;
      const listenerPk = mixTable
        ? mixListenerPk({
            userSub: user?.sub,
            guestListenerId: event.queryStringParameters?.listenerId,
          })
        : null;
      if (mixTable && listenerPk) {
        const overrides = await queryListenerMixOverrides(mixTable, listenerPk);
        return json(200, {
          items: applyListenerMixOverlay(items, overrides),
        });
      }
      return json(200, { items });
    }

    if (!user) {
      const [ddbItems, s3Objects] = await Promise.all([
        scanAllMeditationItems(tableName),
        listAllMeditationMp3Keys(bucket),
      ]);
      return json(200, {
        items: buildLibraryItems({ ddbItems, s3Objects, cfDomain, speakerNames }),
      });
    }

    const userPk = meditationUserPk(user.sub);
    const globalPk = meditationGlobalUserPk();
    const legacyPk = LEGACY_MEDITATION_PARTITION_PK;
    const userMp3Prefix = `meditations/${user.sub}/`;
    const globalMp3Prefix = `meditations/_/`;

    const [userRows, globalRows, legacyRows, userS3, globalS3, legacyS3] =
      await Promise.all([
        queryAllMeditationItems(tableName, userPk),
        queryAllMeditationItems(tableName, globalPk),
        queryAllMeditationItems(tableName, legacyPk),
        listMeditationMp3Keys(bucket, userMp3Prefix),
        listMeditationMp3Keys(bucket, globalMp3Prefix),
        listLegacyRootMeditationMp3Keys(bucket),
      ]);
    const ddbItems = [...userRows, ...globalRows, ...legacyRows];
    const s3ByKey = new Map<
      string,
      { key: string; lastModified: string | null; size: number | null }
    >();
    for (const o of [...userS3, ...globalS3, ...legacyS3]) {
      if (!o.key.endsWith(".mp3")) continue;
      s3ByKey.set(o.key, o);
    }

    return json(200, {
      items: buildLibraryItems({
        ddbItems,
        s3Objects: [...s3ByKey.values()],
        cfDomain,
        draftUserFallback: user.sub,
        speakerNames,
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Library list failed";
    return json(500, { error: msg });
  }
}
