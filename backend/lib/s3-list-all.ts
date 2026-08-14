import { S3Client, ListObjectsV2Command, type _Object } from "@aws-sdk/client-s3";

export async function listAllS3Objects(
  s3: S3Client,
  bucket: string,
  prefix: string,
): Promise<_Object[]> {
  const out: _Object[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    out.push(...(page.Contents ?? []));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return out;
}
