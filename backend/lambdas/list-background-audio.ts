import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const s3 = new S3Client({});
const PREFIX = "background-audio/";

const CATEGORIES = ["nature", "music", "drums"] as const;
type Category = (typeof CATEGORIES)[number];

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

function itemFromKey(key: string): { key: string; name: string; size: number | null } | null {
  if (!key || key.endsWith("/")) return null;
  const withoutPrefix = key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key;
  const firstSlash = withoutPrefix.indexOf("/");
  if (firstSlash <= 0) return null;
  const category = withoutPrefix.slice(0, firstSlash) as Category;
  if (!CATEGORIES.includes(category)) return null;
  const rest = withoutPrefix.slice(firstSlash + 1);
  if (!rest || rest.endsWith("/")) return null;
  const lastSlash = rest.lastIndexOf("/");
  const leaf = lastSlash >= 0 ? rest.slice(lastSlash + 1) : rest;
  if (!leaf) return null;
  const dot = leaf.lastIndexOf(".");
  const base = dot > 0 ? leaf.slice(0, dot) : leaf;
  return {
    key,
    name: base || leaf,
    size: null,
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
    const out = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: PREFIX,
      }),
    );

    const buckets: Record<Category, { key: string; name: string; size: number | null }[]> = {
      nature: [],
      music: [],
      drums: [],
    };

    for (const o of out.Contents ?? []) {
      if (!o.Key) continue;
      const parsed = itemFromKey(o.Key);
      if (!parsed) continue;
      parsed.size = o.Size ?? null;
      const withoutPrefix = o.Key.startsWith(PREFIX) ? o.Key.slice(PREFIX.length) : o.Key;
      const cat = withoutPrefix.slice(0, withoutPrefix.indexOf("/")) as Category;
      if (CATEGORIES.includes(cat)) {
        buckets[cat].push(parsed);
      }
    }

    for (const c of CATEGORIES) {
      buckets[c].sort((a, b) => a.name.localeCompare(b.name));
    }

    return json(200, {
      ...(baseUrl ? { baseUrl } : {}),
      nature: buckets.nature,
      music: buckets.music,
      drums: buckets.drums,
      /** @deprecated flat list; prefer nature/music/drums */
      items: [...buckets.nature, ...buckets.music, ...buckets.drums],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ListObjects failed";
    return json(500, { error: msg });
  }
}
