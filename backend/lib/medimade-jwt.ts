import { createHmac, timingSafeEqual } from "crypto";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

const secrets = new SecretsManagerClient({});
let cachedJwtSecret: string | undefined;

async function getJwtSecret(): Promise<string> {
  if (cachedJwtSecret) return cachedJwtSecret;
  const arn = process.env.AUTH_JWT_SECRET_ARN?.trim();
  if (!arn) throw new Error("AUTH_JWT_SECRET_ARN is not set");
  const out = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
  const s = out.SecretString?.trim();
  if (!s) throw new Error("JWT secret is empty");
  cachedJwtSecret = s;
  return cachedJwtSecret;
}

function base64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function decodeBase64urlJson<T>(raw: string): T | null {
  try {
    const pad = raw.length % 4 === 0 ? "" : "=".repeat(4 - (raw.length % 4));
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const json = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

const EXP_SECONDS = 30 * 24 * 60 * 60;

export async function signMedimadeJwt(params: {
  sub: string;
  email: string;
  /** Optional display name (only included when non-empty). */
  name?: string | null;
}): Promise<string> {
  const secret = await getJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: "HS256", typ: "JWT" });
  const name =
    typeof params.name === "string" && params.name.trim()
      ? params.name.trim()
      : undefined;
  const payload = base64urlJson({
    sub: params.sub,
    email: params.email,
    ...(name ? { name } : {}),
    iat: now,
    exp: now + EXP_SECONDS,
  });
  const data = `${header}.${payload}`;
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export async function verifyMedimadeJwt(
  token: string,
): Promise<{ sub: string; email?: string; name?: string } | null> {
  const parts = token.trim().split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  if (!h || !p || !sig) return null;
  const secret = await getJwtSecret();
  const expected = createHmac("sha256", secret)
    .update(`${h}.${p}`)
    .digest("base64url");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const payload = decodeBase64urlJson<{
    sub?: unknown;
    email?: unknown;
    name?: unknown;
    exp?: unknown;
  }>(p);
  if (!payload || typeof payload.sub !== "string" || !payload.sub.trim()) {
    return null;
  }
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    return null;
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  const email =
    typeof payload.email === "string" && payload.email.trim()
      ? payload.email.trim()
      : undefined;
  const name =
    typeof payload.name === "string" && payload.name.trim()
      ? payload.name.trim()
      : undefined;
  return { sub: payload.sub.trim(), email, ...(name ? { name } : {}) };
}
