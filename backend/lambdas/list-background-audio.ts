import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const s3 = new S3Client({});
const PREFIX = "background-audio/";

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

  try {
    const out = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: PREFIX,
      }),
    );

    const items =
      out.Contents?.filter((o) => o.Key && !o.Key.endsWith("/")).map((o) => {
        const key = o.Key as string;
        const withoutPrefix = key.startsWith(PREFIX)
          ? key.slice(PREFIX.length)
          : key;
        const lastSlash = withoutPrefix.lastIndexOf("/");
        const leaf =
          lastSlash >= 0 ? withoutPrefix.slice(lastSlash + 1) : withoutPrefix;
        const dot = leaf.lastIndexOf(".");
        const base = dot > 0 ? leaf.slice(0, dot) : leaf;
        return {
          key,
          name: base || leaf,
          size: o.Size ?? null,
        };
      }) ?? [];

    return json(200, { items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ListObjects failed";
    return json(500, { error: msg });
  }
}

