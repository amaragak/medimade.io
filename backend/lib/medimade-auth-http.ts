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

export function parseBearer(event: APIGatewayProxyEventV2): string | null {
  const h =
    event.headers?.authorization ??
    (event.headers as Record<string, string | undefined>)?.Authorization;
  if (!h || typeof h !== "string") return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  const t = m?.[1]?.trim();
  return t || null;
}

export async function requireUserJson(
  event: APIGatewayProxyEventV2,
): Promise<
  { sub: string; email?: string; name?: string } | APIGatewayProxyStructuredResultV2
> {
  const token = parseBearer(event);
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
