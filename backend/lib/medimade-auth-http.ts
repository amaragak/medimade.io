import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { verifyMedimadeJwt } from "./medimade-jwt";

export function jsonAuth(
  statusCode: number,
  payload: Record<string, unknown>,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(payload),
  };
}

function stripBearerPrefix(raw: string): string {
  return raw.trim().replace(/^Bearer\s+/i, "").trim();
}

function headerValueCaseInsensitive(
  headers: Record<string, string | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === want && typeof v === "string" && v.trim()) {
      return v;
    }
  }
  return undefined;
}

export function parseBearer(
  event: APIGatewayProxyEventV2,
  extraToken?: string | null,
): string | null {
  const fromHeader =
    headerValueCaseInsensitive(event.headers, "authorization") ??
    headerValueCaseInsensitive(event.headers, "x-medimade-authorization");
  if (fromHeader) {
    const t = stripBearerPrefix(fromHeader);
    if (t) return t;
  }

  const fromQuery = event.queryStringParameters?.sessionToken?.trim();
  if (fromQuery) {
    const t = stripBearerPrefix(fromQuery);
    if (t) return t;
  }

  if (typeof extraToken === "string" && extraToken.trim()) {
    const t = stripBearerPrefix(extraToken);
    if (t) return t;
  }

  return null;
}

export type MedimadeAuthUser = { sub: string; email?: string; name?: string };

export async function optionalUserJson(
  event: APIGatewayProxyEventV2,
  extraToken?: string | null,
): Promise<MedimadeAuthUser | null> {
  const token = parseBearer(event, extraToken);
  if (!token) return null;
  try {
    const claims = await verifyMedimadeJwt(token);
    if (!claims?.sub) return null;
    return {
      sub: claims.sub,
      email: claims.email,
      ...(claims.name ? { name: claims.name } : {}),
    };
  } catch {
    return null;
  }
}

export async function requireUserJson(
  event: APIGatewayProxyEventV2,
  extraToken?: string | null,
): Promise<MedimadeAuthUser | APIGatewayProxyStructuredResultV2> {
  const token = parseBearer(event, extraToken);
  if (!token) {
    return jsonAuth(401, { error: "Authorization Bearer token required" });
  }
  try {
    const claims = await verifyMedimadeJwt(token);
    if (!claims?.sub) {
      return jsonAuth(401, { error: "Invalid or expired session" });
    }
    return {
      sub: claims.sub,
      email: claims.email,
      ...(claims.name ? { name: claims.name } : {}),
    };
  } catch {
    return jsonAuth(401, { error: "Invalid or expired session" });
  }
}
