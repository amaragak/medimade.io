/**
 * Clear refresh session + cookies.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { optionsAuth } from "../lib/medimade-auth-http";
import {
  corsHeadersForEvent,
  parseCookieHeader,
  REFRESH_COOKIE,
  sessionClearCookieHeaders,
  sha256Hex,
} from "../lib/medimade-auth-tokens";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

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
    cookies: sessionClearCookieHeaders(),
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
  const candidates = [cookieRaw, bodyRefresh].filter(
    (v, i, a): v is string => Boolean(v) && a.indexOf(v) === i,
  );
  if (refreshTable) {
    for (const raw of candidates) {
      try {
        await ddb.send(
          new DeleteCommand({
            TableName: refreshTable,
            Key: { tokenHash: sha256Hex(raw) },
          }),
        );
      } catch {
        /* still clear cookies */
      }
    }
  }

  return json(event, 200, { ok: true });
}
