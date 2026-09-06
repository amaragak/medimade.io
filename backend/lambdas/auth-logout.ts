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
  const raw = parseCookieHeader(event, REFRESH_COOKIE);
  if (refreshTable && raw) {
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

  return json(event, 200, { ok: true });
}
