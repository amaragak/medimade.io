import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import {
  BG_AUDIO_CATEGORIES,
  BG_AUDIO_PREFIX,
  mergeByStemPreferMp3,
  parseAnyBgAudioKey,
  type BgAudioCategory,
  type ListedBgItem,
} from "../lib/background-audio-keys";
import { listAllSoundRows, soundIsInCustomerPicker } from "../lib/sound-catalog";

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
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    },
    body: JSON.stringify(payload),
  };
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const bucket = process.env.MEDIA_BUCKET_NAME;
  if (!bucket) {
    return json(500, { error: "MEDIA_BUCKET_NAME is not set" });
  }

  const domain = (process.env.MEDIA_CLOUDFRONT_DOMAIN || "").trim();
  const baseUrl = domain ? `https://${domain}` : undefined;

  try {
    const objects: { Key?: string; Size?: number }[] = [];
    let token: string | undefined;
    do {
      const page = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: BG_AUDIO_PREFIX,
          ContinuationToken: token,
        }),
      );
      objects.push(...(page.Contents ?? []));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);

    const buckets: Record<BgAudioCategory, ListedBgItem[]> = {
      nature: [],
      music: [],
      drums: [],
      noise: [],
    };

    const skip = new Set<string>();
    const categoryOverride = new Map<string, BgAudioCategory>();
    if (process.env.SOUND_CATALOG_TABLE_NAME) {
      try {
        const rows = await listAllSoundRows();
        for (const row of rows) {
          if (!soundIsInCustomerPicker(row)) skip.add(row.sk);
          if (row.category && BG_AUDIO_CATEGORIES.includes(row.category)) {
            categoryOverride.set(row.sk, row.category);
          }
        }
      } catch (e) {
        console.warn("sound catalog overlay skipped", e);
      }
    }

    for (const o of objects) {
      if (!o.Key) continue;
      const parsed = parseAnyBgAudioKey(o.Key);
      if (!parsed) continue;
      const item = {
        key: parsed.key,
        name: parsed.name,
        size: o.Size ?? null,
      };
      const lower = parsed.key.toLowerCase();
      const catalogKey = lower.endsWith(".wav")
        ? `${parsed.key.slice(0, -4)}.mp3`
        : parsed.key;
      if (skip.has(catalogKey) || skip.has(parsed.key)) continue;
      const cat =
        categoryOverride.get(catalogKey) ??
        categoryOverride.get(parsed.key) ??
        parsed.folderCategory;
      if (!cat) continue;
      buckets[cat].push(item);
    }

    for (const c of BG_AUDIO_CATEGORIES) {
      buckets[c] = mergeByStemPreferMp3(buckets[c]);
      buckets[c].sort((a, b) => a.name.localeCompare(b.name));
    }

    return json(200, {
      ...(baseUrl ? { baseUrl } : {}),
      nature: buckets.nature,
      music: buckets.music,
      drums: buckets.drums,
      noise: buckets.noise,
      /** @deprecated flat list; prefer nature/music/drums/noise */
      items: [...buckets.nature, ...buckets.music, ...buckets.drums, ...buckets.noise],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ListObjects failed";
    return json(500, { error: msg });
  }
}
