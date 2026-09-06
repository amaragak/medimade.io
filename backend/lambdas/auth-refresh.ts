/**
 * Rotate refresh cookie → new access JWT + refresh token.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { signMedimadeJwt } from "../lib/medimade-jwt";
import { optionsAuth } from "../lib/medimade-auth-http";
import {
  corsHeadersForEvent,
  newOpaqueToken,
  parseCookieHeader,
  REFRESH_COOKIE,
  REFRESH_TOKEN_TTL_SEC,
  sessionClearCookieHeaders,
  sessionSetCookieHeaders,
  sha256Hex,
} from "../lib/medimade-auth-tokens";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function json(
  event: APIGatewayProxyEventV2,
  statusCode: number,
  payload: Record<string, unknown>,
  setCookies?: string[],
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      ...corsHeadersForEvent(event),
    },
    ...(setCookies?.length ? { cookies: setCookies } : {}),
    body: JSON.stringify(payload),
  };
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method === "OPTIONS") return optionsAuth(event);
  if (method !== "POST") return json(event, 405, { error: "Method not allowed" });

  const refreshTable = process.env.REFRESH_TABLE_NAME?.trim();
  if (!refreshTable) {
    return json(event, 500, { error: "REFRESH_TABLE_NAME is not set" });
  }

  let bodyRefresh: string | null = null;
  try {
    const body = JSON.parse(event.body || "{}") as { refreshToken?: unknown };
    if (typeof body.refreshToken === "string" && body.refreshToken.trim()) {
      bodyRefresh = body.refreshToken.trim();
    }
  } catch {
    /* ignore */
  }

  const raw = bodyRefresh || parseCookieHeader(event, REFRESH_COOKIE);
  if (!raw) {
    return json(event, 401, { error: "No refresh session" }, sessionClearCookieHeaders());
  }

  const tokenHash = sha256Hex(raw);
  type RefreshRow = {
    userId?: string;
    email?: string;
    displayName?: string;
    ttl?: number;
  };
  let row: RefreshRow | null = null;
  try {
    const got = await ddb.send(
      new GetCommand({ TableName: refreshTable, Key: { tokenHash } }),
    );
    row = (got.Item as RefreshRow | undefined) ?? null;
    await ddb.send(
      new DeleteCommand({ TableName: refreshTable, Key: { tokenHash } }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Refresh lookup failed";
    return json(event, 500, { error: msg });
  }

  if (!row?.userId || !row.email) {
    return json(event, 401, { error: "Invalid refresh session" }, sessionClearCookieHeaders());
  }
  const ttl = typeof row.ttl === "number" ? row.ttl : 0;
  if (ttl < Math.floor(Date.now() / 1000)) {
    return json(event, 401, { error: "Refresh session expired" }, sessionClearCookieHeaders());
  }

  const displayName =
    typeof row.displayName === "string" && row.displayName.trim()
      ? row.displayName.trim()
      : null;

  try {
    const accessToken = await signMedimadeJwt({
      sub: row.userId,
      email: row.email,
      name: displayName ?? undefined,
    });
    const refreshToken = newOpaqueToken(32);
    const newHash = sha256Hex(refreshToken);
    const nowSec = Math.floor(Date.now() / 1000);
    await ddb.send(
      new PutCommand({
        TableName: refreshTable,
        Item: {
          tokenHash: newHash,
          userId: row.userId,
          email: row.email,
          ...(displayName ? { displayName } : {}),
          createdAt: new Date().toISOString(),
          ttl: nowSec + REFRESH_TOKEN_TTL_SEC,
        },
      }),
    );
    return json(
      event,
      200,
      {
        token: accessToken,
        userId: row.userId,
        email: row.email,
        displayName,
      },
      sessionSetCookieHeaders({ accessToken, refreshToken }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not refresh session";
    return json(event, 500, { error: msg });
  }
}
