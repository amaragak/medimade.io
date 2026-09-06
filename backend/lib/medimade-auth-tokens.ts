/**
 * Auth token helpers: hashing, cookies, refresh rows.
 */

import { createHash, randomBytes } from "crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

export const ACCESS_COOKIE = "mm_access";
export const REFRESH_COOKIE = "mm_refresh";

/** Access JWT lifetime (seconds). */
export const ACCESS_TOKEN_TTL_SEC = 60 * 60; // 1 hour

/** Refresh cookie / Dynamo TTL (seconds). */
export const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60; // 30 days

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function newOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function allowedWebOrigins(): string[] {
  const raw = process.env.AUTH_ALLOWED_ORIGINS?.trim();
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim().replace(/\/$/, ""))
      .filter(Boolean);
  }
  const primary =
    process.env.AUTH_WEBAPP_ORIGIN?.trim().replace(/\/$/, "") ||
    "https://consciously.live";
  return [
    primary,
    "https://consciously.live",
    "https://www.consciously.live",
    "https://d2nu9q5wynnhfv.cloudfront.net",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
  ].filter((v, i, a) => a.indexOf(v) === i);
}

export function requestOrigin(event: APIGatewayProxyEventV2): string | null {
  const headers = event.headers ?? {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "origin" && typeof v === "string" && v.trim()) {
      return v.trim().replace(/\/$/, "");
    }
  }
  return null;
}

/** Reflect Origin when allowlisted; otherwise omit credentials-friendly CORS. */
export function corsHeadersForEvent(
  event: APIGatewayProxyEventV2,
): Record<string, string> {
  const origin = requestOrigin(event);
  const allowed = allowedWebOrigins();
  if (origin && allowed.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin",
    };
  }
  // Non-browser / unknown origin: no credentials.
  return {
    "Access-Control-Allow-Origin": allowed[0] || "https://consciously.live",
    Vary: "Origin",
  };
}

export function parseCookieHeader(
  event: APIGatewayProxyEventV2,
  name: string,
): string | null {
  const fromList = event.cookies;
  if (Array.isArray(fromList)) {
    for (const part of fromList) {
      const idx = part.indexOf("=");
      if (idx <= 0) continue;
      const k = part.slice(0, idx).trim();
      if (k !== name) continue;
      const val = part.slice(idx + 1).trim();
      try {
        return decodeURIComponent(val);
      } catch {
        return val || null;
      }
    }
  }

  const headers = event.headers ?? {};
  let raw: string | undefined;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "cookie" && typeof v === "string") {
      raw = v;
      break;
    }
  }
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    if (k !== name) continue;
    const val = part.slice(idx + 1).trim();
    try {
      return decodeURIComponent(val);
    } catch {
      return val || null;
    }
  }
  return null;
}

function cookieSecureFlag(): boolean {
  // Localhost over http cannot use Secure cookies.
  return process.env.AUTH_COOKIE_SECURE !== "0";
}

export function buildSetCookie(
  name: string,
  value: string,
  maxAgeSec: number,
): string {
  const secure = cookieSecureFlag();
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`,
    "HttpOnly",
    // Cross-site API (consciously.live / localhost → execute-api) needs None+Secure.
    secure ? "SameSite=None" : "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(name: string): string {
  const secure = cookieSecureFlag();
  const parts = [
    `${name}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    secure ? "SameSite=None" : "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function sessionSetCookieHeaders(params: {
  accessToken: string;
  refreshToken: string;
}): string[] {
  return [
    buildSetCookie(ACCESS_COOKIE, params.accessToken, ACCESS_TOKEN_TTL_SEC),
    buildSetCookie(REFRESH_COOKIE, params.refreshToken, REFRESH_TOKEN_TTL_SEC),
  ];
}

export function sessionClearCookieHeaders(): string[] {
  return [clearCookie(ACCESS_COOKIE), clearCookie(REFRESH_COOKIE)];
}
