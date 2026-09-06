import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomBytes } from "crypto";
import { sendEmailBrevo } from "../lib/medimade-email";
import {
  corsHeadersForEvent,
  sha256Hex,
} from "../lib/medimade-auth-tokens";
import { optionsAuth } from "../lib/medimade-auth-http";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const EMAIL_COOLDOWN_SEC = 60;
const IP_WINDOW_SEC = 60 * 60;
const IP_MAX_PER_WINDOW = 10;

function json(
  event: APIGatewayProxyEventV2,
  statusCode: number,
  payload: Record<string, unknown>,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      ...corsHeadersForEvent(event),
    },
    body: JSON.stringify(payload),
  };
}

function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  if (!e || e.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

/**
 * Prefer the browser origin when the request is from local dev
 * (localhost / 127.0.0.1, any port). Otherwise use the deployed AUTH_WEBAPP_ORIGIN.
 */
function resolveWebappOrigin(
  configured: string,
  requested: unknown,
): string {
  const fallback = configured.replace(/\/$/, "");
  if (typeof requested !== "string" || !requested.trim()) return fallback;

  let url: URL;
  try {
    url = new URL(requested.trim());
  } catch {
    return fallback;
  }

  if (url.username || url.password || url.search || url.hash) return fallback;
  if (url.pathname && url.pathname !== "/") return fallback;

  const host = url.hostname.toLowerCase();
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1";
  if (isLocal && (url.protocol === "http:" || url.protocol === "https:")) {
    return url.origin;
  }

  if (url.origin === fallback) return fallback;
  return fallback;
}

function clientIp(event: APIGatewayProxyEventV2): string {
  return event.requestContext.http.sourceIp?.trim() || "unknown";
}

async function rateLimited(
  table: string,
  key: string,
  windowSec: number,
  maxCount: number,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const got = await ddb.send(
    new GetCommand({ TableName: table, Key: { token: key } }),
  );
  const item = got.Item as
    | { count?: number; windowStart?: number; ttl?: number }
    | undefined;
  if (
    item &&
    typeof item.windowStart === "number" &&
    now - item.windowStart < windowSec
  ) {
    const count = typeof item.count === "number" ? item.count : 0;
    if (count >= maxCount) return true;
    await ddb.send(
      new PutCommand({
        TableName: table,
        Item: {
          token: key,
          kind: "rate",
          count: count + 1,
          windowStart: item.windowStart,
          ttl: item.windowStart + windowSec + 60,
        },
      }),
    );
    return false;
  }
  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        token: key,
        kind: "rate",
        count: 1,
        windowStart: now,
        ttl: now + windowSec + 60,
      },
    }),
  );
  return false;
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method === "OPTIONS") return optionsAuth(event);
  if (method !== "POST") return json(event, 405, { error: "Method not allowed" });

  const table = process.env.MAGIC_LINK_TABLE_NAME?.trim();
  const from = process.env.AUTH_EMAIL_FROM?.trim();
  const configuredOrigin = process.env.AUTH_WEBAPP_ORIGIN?.trim().replace(
    /\/$/,
    "",
  );
  const brevoSecret = process.env.BREVO_SECRET_NAME?.trim();
  if (!table || !from || !configuredOrigin || !brevoSecret) {
    return json(event, 500, {
      error:
        "Auth email is not configured (set MAGIC_LINK_TABLE_NAME, AUTH_EMAIL_FROM, AUTH_WEBAPP_ORIGIN, BREVO_SECRET_NAME on the Lambda)",
    });
  }

  let body: { email?: unknown; origin?: unknown };
  try {
    body = JSON.parse(event.body || "{}") as {
      email?: unknown;
      origin?: unknown;
    };
  } catch {
    return json(event, 400, { error: "Invalid JSON body" });
  }
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : null;
  if (!email) {
    return json(event, 400, { error: "Valid `email` is required" });
  }

  // Always-ok responses after validation so callers cannot probe rate state easily.
  const ok = () => json(event, 200, { ok: true });

  try {
    const emailLimited = await rateLimited(
      table,
      `rl:email:${email}`,
      EMAIL_COOLDOWN_SEC,
      1,
    );
    const ipLimited = await rateLimited(
      table,
      `rl:ip:${clientIp(event)}`,
      IP_WINDOW_SEC,
      IP_MAX_PER_WINDOW,
    );
    if (emailLimited || ipLimited) {
      return ok();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Rate limit check failed";
    return json(event, 500, { error: msg });
  }

  const webOrigin = resolveWebappOrigin(configuredOrigin, body.origin);
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = sha256Hex(rawToken);
  const nowSec = Math.floor(Date.now() / 1000);
  const ttl = nowSec + 15 * 60;

  try {
    await ddb.send(
      new PutCommand({
        TableName: table,
        Item: {
          token: tokenHash,
          kind: "magic",
          email,
          ttl,
          createdAt: new Date().toISOString(),
        },
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not store magic link";
    return json(event, 500, { error: msg });
  }

  const link = `${webOrigin}/auth/verify?token=${encodeURIComponent(rawToken)}`;
  const subject = "Sign in to Consciously";
  const text = `Open this link to sign in (expires in 15 minutes):\n\n${link}\n\nIf you did not request this, you can ignore this email.`;

  try {
    await sendEmailBrevo({
      fromEmail: from,
      fromName: "Consciously",
      toEmail: email,
      subject,
      text,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Brevo send failed";
    return json(event, 502, {
      error:
        "Could not send sign-in email (Brevo). Check BREVO API key secret and that the sender email is allowed in Brevo.",
      detail: String(msg).slice(0, 800),
    });
  }

  return ok();
}
