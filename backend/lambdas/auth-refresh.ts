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

  const cookieRaw = parseCookieHeader(event, REFRESH_COOKIE);
  // Try cookie and body independently. Preferring cookie-only broke localhost /
  // ITP when a stale HttpOnly cookie shadowed a valid localStorage refreshToken
  // (body was ignored → perpetual "Invalid refresh session").
  type RefreshRow = {
    userId?: string;
    email?: string;
    displayName?: string;
    ttl?: number;
  };

  async function lookupRefresh(raw: string | null): Promise<{
    row: RefreshRow;
    raw: string;
    tokenHash: string;
  } | null> {
    if (!raw) return null;
    const tokenHash = sha256Hex(raw);
    try {
      const got = await ddb.send(
        new GetCommand({ TableName: refreshTable, Key: { tokenHash } }),
      );
      const row = (got.Item as RefreshRow | undefined) ?? null;
      if (!row?.userId || !row.email) return null;
      const ttl = typeof row.ttl === "number" ? row.ttl : 0;
      if (ttl < Math.floor(Date.now() / 1000)) {
        try {
          await ddb.send(
            new DeleteCommand({ TableName: refreshTable, Key: { tokenHash } }),
          );
        } catch {
          /* */
        }
        return null;
      }
      return { row, raw, tokenHash };
    } catch {
      return null;
    }
  }

  if (!cookieRaw && !bodyRefresh) {
    return json(event, 401, { error: "No refresh session", code: "missing" });
  }

  // Prefer body (localStorage) when present — SPA source of truth. Cookie-first
  // let stale HttpOnly cookies win over a live body token and break sessions.
  let matched = await lookupRefresh(bodyRefresh);
  if (!matched && cookieRaw && cookieRaw !== bodyRefresh) {
    matched = await lookupRefresh(cookieRaw);
  }
  if (!matched) {
    // Neither cookie nor body maps to a live row — do not clear cookies here
    // (parallel rotation may have set a newer cookie we didn't receive yet).
    return json(event, 401, {
      error: "Invalid refresh session",
      code: "invalid",
    });
  }

  const { row, tokenHash } = matched;
  const displayName =
    typeof row.displayName === "string" && row.displayName.trim()
      ? row.displayName.trim()
      : null;

  try {
    const accessToken = await signMedimadeJwt({
      sub: row.userId!,
      email: row.email!,
      name: displayName ?? undefined,
    });
    const refreshToken = newOpaqueToken(32);
    const newHash = sha256Hex(refreshToken);
    const nowSec = Math.floor(Date.now() / 1000);

    // Write the new refresh token BEFORE deleting the old one so a failed Put
    // cannot leave the user with no valid refresh row.
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
    try {
      await ddb.send(
        new DeleteCommand({ TableName: refreshTable, Key: { tokenHash } }),
      );
    } catch {
      /* old row may already be gone from a parallel rotate */
    }

    return json(
      event,
      200,
      {
        token: accessToken,
        refreshToken,
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
