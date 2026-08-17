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
import {
  coerceSoundSubcategory,
  inferSoundSubcategory,
} from "../lib/sound-taxonomy";

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
      ambience: [],
      music: [],
      drums: [],
      noise: [],
    };

    const mixerKeys = new Set<string>();
    const nameOverride = new Map<string, string>();
    const categoryOverride = new Map<string, BgAudioCategory>();
    const subcategoryOverride = new Map<string, string>();
    const catalogConfigured = Boolean(process.env.SOUND_CATALOG_TABLE_NAME);
    const catalogRows = catalogConfigured
      ? await listAllSoundRows().catch((e) => {
          console.warn("sound catalog overlay skipped", e);
          return [];
        })
      : [];
    for (const row of catalogRows) {
      if (soundIsInCustomerPicker(row)) mixerKeys.add(row.sk);
      const displayName = row.name.trim();
      if (displayName) nameOverride.set(row.sk, displayName);
      if (row.category && BG_AUDIO_CATEGORIES.includes(row.category)) {
        categoryOverride.set(row.sk, row.category);
        subcategoryOverride.set(
          row.sk,
          coerceSoundSubcategory(
            row.category,
            row.subcategory || inferSoundSubcategory(row.category, row.packPath || row.sk),
          ),
        );
      }
    }

    const rawItems: { key: string; name: string; size: number | null; category: BgAudioCategory; subcategory: string }[] =
      [];
    for (const o of objects) {
      if (!o.Key) continue;
      const parsed = parseAnyBgAudioKey(o.Key);
      if (!parsed) continue;
      const lower = parsed.key.toLowerCase();
      const catalogKey = lower.endsWith(".wav")
        ? `${parsed.key.slice(0, -4)}.mp3`
        : parsed.key;
      if (
        catalogConfigured &&
        !mixerKeys.has(catalogKey) &&
        !mixerKeys.has(parsed.key)
      ) {
        continue;
      }
      const cat =
        categoryOverride.get(catalogKey) ??
        categoryOverride.get(parsed.key) ??
        parsed.folderCategory;
      if (!cat) continue;
      const subcategory =
        subcategoryOverride.get(catalogKey) ??
        subcategoryOverride.get(parsed.key) ??
        coerceSoundSubcategory(cat, inferSoundSubcategory(cat, parsed.rel || parsed.key));
      rawItems.push({
        key: parsed.key,
        name:
          nameOverride.get(catalogKey) ??
          nameOverride.get(parsed.key) ??
          parsed.name,
        size: o.Size ?? null,
        category: cat,
        subcategory,
      });
    }

    const seen = new Set<string>();
    for (const item of rawItems) {
      const k = item.key.toLowerCase().endsWith(".wav")
        ? `${item.key.slice(0, -4)}.mp3`
        : item.key;
      seen.add(k);
      seen.add(item.key);
      buckets[item.category].push(item);
    }
    for (const row of catalogRows) {
      if (!soundIsInCustomerPicker(row)) continue;
      if (seen.has(row.sk)) continue;
      const cat = row.category;
      if (!BG_AUDIO_CATEGORIES.includes(cat)) continue;
      buckets[cat].push({
        key: row.sk,
        name: row.name,
        size: null,
        subcategory:
          subcategoryOverride.get(row.sk) ??
          coerceSoundSubcategory(cat, inferSoundSubcategory(cat, row.packPath || row.sk)),
      });
    }

    for (const c of BG_AUDIO_CATEGORIES) {
      const merged = mergeByStemPreferMp3(buckets[c]);
      const subByStem = new Map<string, string>();
      for (const it of buckets[c]) {
        const stem = it.key.replace(/\.(mp3|wav)$/i, "");
        if (it.subcategory && !subByStem.has(stem)) subByStem.set(stem, it.subcategory);
      }
      buckets[c] = merged.map((it) => {
        const stem = it.key.replace(/\.(mp3|wav)$/i, "");
        return {
          ...it,
          name:
            nameOverride.get(it.key) ??
            nameOverride.get(`${stem}.mp3`) ??
            nameOverride.get(`${stem}.wav`) ??
            it.name,
          subcategory:
            subByStem.get(stem) ??
            coerceSoundSubcategory(c, inferSoundSubcategory(c, it.key)),
        };
      });
      buckets[c].sort((a, b) => a.name.localeCompare(b.name));
    }

    return json(200, {
      ...(baseUrl ? { baseUrl } : {}),
      nature: buckets.ambience,
      ambience: buckets.ambience,
      music: buckets.music,
      drums: buckets.drums,
      noise: buckets.noise,
      /** @deprecated flat list; prefer nature/music/drums/noise */
      items: [...buckets.ambience, ...buckets.music, ...buckets.drums, ...buckets.noise],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ListObjects failed";
    return json(500, { error: msg });
  }
}
