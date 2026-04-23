import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { speakerNameForModelId } from "../lib/fish-speakers";
import { meditationPlaybackS3Key } from "../lib/playback-keys";
import { requireUserJson } from "../lib/medimade-auth-http";
import {
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

type DdbMeditation = Record<string, unknown> & {
  sk?: string;
  s3Key?: string;
  id?: string;
};

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

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = await requireUserJson(event);
  if ("statusCode" in auth) return auth;
  const user = auth as { sub: string };

  const tableName = process.env.MEDITATION_ANALYTICS_TABLE_NAME;
  const bucket = process.env.MEDIA_BUCKET_NAME;
  const cfDomain = process.env.MEDIA_CLOUDFRONT_DOMAIN;
  if (!tableName || !bucket || !cfDomain) {
    return json(500, { error: "Library list is not configured" });
  }

  const userPk = meditationUserPk(user.sub);
  const globalPk = meditationGlobalUserPk();
  const legacyPk = LEGACY_MEDITATION_PARTITION_PK;
  const userMp3Prefix = `meditations/${user.sub}/`;
  const globalMp3Prefix = `meditations/_/`;

  try {
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
      s3ByKey.set(o.key, o);
    }
    const s3Objects = [...s3ByKey.values()];

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
      rating: number | null;
      favourite: boolean;
      archived: boolean;
      description: string | null;
      speakerModelId: string | null;
      speakerName: string | null;
      catalogued: boolean;
      mp3Bytes: number | null;
      isDraft: boolean;
    };

    const merged = new Map<string, OutItem>();

    for (const row of ddbItems) {
      const isDraft = row.isDraft === true;
      let s3Key = typeof row.s3Key === "string" ? row.s3Key : "";
      const id = typeof row.id === "string" ? row.id : null;
      if (isDraft) {
        if (!id) continue;
        // New per-user drafts store `drafts/<userId>/<id>`. Keep legacy fallback for old rows.
        if (!s3Key) s3Key = `drafts/${user.sub}/${id}`;
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
      const rating =
        typeof row.rating === "number" &&
        Number.isFinite(row.rating) &&
        row.rating >= 1 &&
        row.rating <= 5
          ? row.rating
          : null;
      const favourite = row.favourite === true;
      const archived = row.archived === true;
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
        rating,
        favourite,
        archived,
        description,
        speakerModelId: referenceId,
        speakerName: speakerNameForModelId(referenceId),
        catalogued: !isDraft,
        mp3Bytes,
        isDraft,
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
        rating: null,
        favourite: false,
        archived: false,
        description: null,
        speakerModelId: null,
        speakerName: null,
        catalogued: false,
        mp3Bytes: obj.size,
        isDraft: false,
      });
    }

    const items = [...merged.values()].sort((a, b) => {
      const ta = a.createdAt ?? "";
      const tb = b.createdAt ?? "";
      return tb.localeCompare(ta);
    });

    return json(200, { items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Library list failed";
    return json(500, { error: msg });
  }
}
