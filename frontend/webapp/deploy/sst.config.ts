/// <reference path="./.sst/platform/config.d.ts" />
// Ion-style config (SST v3+ / v4). Not compatible with legacy SST v2.
// Deploy from repo root: `./frontend/webapp/deploy/deploy-web [--stage …] [--profile name]`
// Stage ids are only `dev` or `prod` (deploy-web accepts production/development as aliases).
// prod uses removal "retain".

function nextPublicEnvFromProcess(): Record<string, string> {
  const keys = [
    "NEXT_PUBLIC_MEDIMADE_API_URL",
    "NEXT_PUBLIC_MEDIMADE_CHAT_URL",
    "NEXT_PUBLIC_MEDIMADE_MEDIA_BASE_URL",
  ] as const;
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = process.env[k]?.trim();
    if (v) out[k] = v;
  }
  return out;
}

export default $config({
  app(input) {
    return {
      name: "medimade-webapp",
      removal: input?.stage === "prod" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const web = new sst.aws.Nextjs("Web", {
      path: "..",
      environment: nextPublicEnvFromProcess(),
      domain: {
        name: "consciously.live",
        aliases: ["www.consciously.live"],
        // DNS in Cloudflare (not Route 53); point records at CloudFront / ACM as needed.
        dns: false,
        cert: "arn:aws:acm:us-east-1:382309212161:certificate/de288d1f-a1f7-436b-ae16-3f79de3d5d98",
      },
    });
    return { url: web.url };
  },
});
