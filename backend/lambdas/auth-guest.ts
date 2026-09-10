/**
 * Guest login — issues a normal session for the shared guest account.
 * POST /auth/guest (no body). No email / magic link.
 */

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
import { randomUUID } from "crypto";
import { signMedimadeJwt } from "../lib/medimade-jwt";
import { optionsAuth } from "../lib/medimade-auth-http";
import {
  corsHeadersForEvent,
  newOpaqueToken,
  REFRESH_TOKEN_TTL_SEC,
  sessionSetCookieHeaders,
  sha256Hex,
} from "../lib/medimade-auth-tokens";

/** Shared guest account — Continue-as-guest logs into this user. */
export const GUEST_ACCOUNT_EMAIL = "guest@consciously.live";
export const GUEST_ACCOUNT_DISPLAY_NAME = "Guest";

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

async function getOrCreateGuestUser(usersTable: string): Promise<{
  userId: string;
  email: string;
  displayName: string;
}> {
  const email = GUEST_ACCOUNT_EMAIL;
  const displayName = GUEST_ACCOUNT_DISPLAY_NAME;
  const got = await ddb.send(
    new GetCommand({
      TableName: usersTable,
      Key: { email },
    }),
  );
  const existingId = got.Item?.userId;
  if (typeof existingId === "string" && existingId.trim()) {
    // Keep displayName fresh on the row.
    if (got.Item?.displayName !== displayName) {
      await ddb.send(
        new PutCommand({
          TableName: usersTable,
          Item: {
            ...got.Item,
            email,
            userId: existingId.trim(),
            displayName,
            updatedAt: new Date().toISOString(),
          },
        }),
      );
    }
    return { userId: existingId.trim(), email, displayName };
  }

  const userId = randomUUID();
  const now = new Date().toISOString();
  try {
    await ddb.send(
      new PutCommand({
        TableName: usersTable,
        Item: {
          email,
          userId,
          displayName,
          createdAt: now,
          updatedAt: now,
          isGuestAccount: true,
        },
        ConditionExpression: "attribute_not_exists(#e)",
        ExpressionAttributeNames: { "#e": "email" },
      }),
    );
    return { userId, email, displayName };
  } catch (e: unknown) {
    const name =
      e && typeof e === "object" && "name" in e
        ? String((e as { name: string }).name)
        : "";
    if (name !== "ConditionalCheckFailedException") throw e;
    const again = await ddb.send(
      new GetCommand({ TableName: usersTable, Key: { email } }),
    );
    const u = again.Item?.userId;
    if (typeof u !== "string" || !u.trim()) {
      throw new Error("Guest user race without userId");
    }
    return { userId: u.trim(), email, displayName };
  }
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method === "OPTIONS") return optionsAuth(event);
  if (method !== "POST") {
    return json(event, 405, { error: "Method not allowed" });
  }

  const usersTable = process.env.USERS_TABLE_NAME?.trim();
  const refreshTable = process.env.REFRESH_TABLE_NAME?.trim();
  if (!usersTable || !refreshTable) {
    return json(event, 500, { error: "Auth tables are not configured" });
  }

  try {
    const guest = await getOrCreateGuestUser(usersTable);
    const accessToken = await signMedimadeJwt({
      sub: guest.userId,
      email: guest.email,
      name: guest.displayName,
    });
    const refreshToken = newOpaqueToken(32);
    const refreshHash = sha256Hex(refreshToken);
    const nowSec = Math.floor(Date.now() / 1000);

    await ddb.send(
      new PutCommand({
        TableName: refreshTable,
        Item: {
          tokenHash: refreshHash,
          userId: guest.userId,
          email: guest.email,
          displayName: guest.displayName,
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
        refreshToken,
        userId: guest.userId,
        email: guest.email,
        needsProfileName: false,
        displayName: guest.displayName,
      },
      sessionSetCookieHeaders({ accessToken, refreshToken }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Guest login failed";
    return json(event, 500, { error: msg });
  }
}
