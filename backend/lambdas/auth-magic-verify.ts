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

async function getOrCreateUserId(usersTable: string, email: string): Promise<string> {
  const got = await ddb.send(
    new GetCommand({
      TableName: usersTable,
      Key: { email },
    }),
  );
  const existing = got.Item?.userId;
  if (typeof existing === "string" && existing.trim()) {
    return existing.trim();
  }
  const userId = randomUUID();
  const now = new Date().toISOString();
  try {
    await ddb.send(
      new PutCommand({
        TableName: usersTable,
        Item: { email, userId, createdAt: now },
        ConditionExpression: "attribute_not_exists(#e)",
        ExpressionAttributeNames: { "#e": "email" },
      }),
    );
    return userId;
  } catch (e: unknown) {
    const name =
      e && typeof e === "object" && "name" in e
        ? String((e as { name: string }).name)
        : "";
    if (name !== "ConditionalCheckFailedException") {
      throw e;
    }
    const again = await ddb.send(
      new GetCommand({ TableName: usersTable, Key: { email } }),
    );
    const u = again.Item?.userId;
    if (typeof u !== "string" || !u.trim()) {
      throw new Error("User record race without userId");
    }
    return u.trim();
  }
}

async function issueSession(params: {
  event: APIGatewayProxyEventV2;
  userId: string;
  email: string;
  displayName: string | null;
  needsProfileName: boolean;
}): Promise<APIGatewayProxyStructuredResultV2> {
  const refreshTable = process.env.REFRESH_TABLE_NAME?.trim();
  if (!refreshTable) {
    return json(params.event, 500, { error: "REFRESH_TABLE_NAME is not set" });
  }

  const accessToken = await signMedimadeJwt({
    sub: params.userId,
    email: params.email,
    name: params.displayName ?? undefined,
  });
  const refreshToken = newOpaqueToken(32);
  const refreshHash = sha256Hex(refreshToken);
  const nowSec = Math.floor(Date.now() / 1000);

  await ddb.send(
    new PutCommand({
      TableName: refreshTable,
      Item: {
        tokenHash: refreshHash,
        userId: params.userId,
        email: params.email,
        ...(params.displayName ? { displayName: params.displayName } : {}),
        createdAt: new Date().toISOString(),
        ttl: nowSec + REFRESH_TOKEN_TTL_SEC,
      },
    }),
  );

  return json(
    params.event,
    200,
    {
      token: accessToken,
      userId: params.userId,
      email: params.email,
      needsProfileName: params.needsProfileName,
      displayName: params.displayName,
    },
    sessionSetCookieHeaders({ accessToken, refreshToken }),
  );
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method === "OPTIONS") return optionsAuth(event);
  if (method !== "POST") return json(event, 405, { error: "Method not allowed" });

  const magicTable = process.env.MAGIC_LINK_TABLE_NAME?.trim();
  const usersTable = process.env.USERS_TABLE_NAME?.trim();
  if (!magicTable || !usersTable) {
    return json(event, 500, { error: "Auth tables are not configured" });
  }

  let body: { token?: unknown };
  try {
    body = JSON.parse(event.body || "{}") as { token?: unknown };
  } catch {
    return json(event, 400, { error: "Invalid JSON body" });
  }
  const rawToken =
    typeof body.token === "string" && body.token.trim() ? body.token.trim() : null;
  if (!rawToken) {
    return json(event, 400, { error: "`token` is required" });
  }

  const tokenHash = sha256Hex(rawToken);
  let email: string | null = null;
  try {
    const got = await ddb.send(
      new GetCommand({ TableName: magicTable, Key: { token: tokenHash } }),
    );
    const item = got.Item as { email?: string; ttl?: number; kind?: string } | undefined;
    if (!item?.email || typeof item.email !== "string" || item.kind === "rate") {
      return json(event, 400, { error: "Invalid or expired sign-in link" });
    }
    const ttl =
      typeof item.ttl === "number" && Number.isFinite(item.ttl) ? item.ttl : 0;
    if (ttl < Math.floor(Date.now() / 1000)) {
      await ddb.send(
        new DeleteCommand({ TableName: magicTable, Key: { token: tokenHash } }),
      );
      return json(event, 400, { error: "Sign-in link expired" });
    }
    email = item.email.trim().toLowerCase();
    await ddb.send(
      new DeleteCommand({ TableName: magicTable, Key: { token: tokenHash } }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Token lookup failed";
    return json(event, 500, { error: msg });
  }

  if (!email) {
    return json(event, 400, { error: "Invalid or expired sign-in link" });
  }

  let userId: string;
  try {
    userId = await getOrCreateUserId(usersTable, email);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "User lookup failed";
    return json(event, 500, { error: msg });
  }

  let displayName: string | null = null;
  try {
    const userRow = await ddb.send(
      new GetCommand({ TableName: usersTable, Key: { email } }),
    );
    const dn = userRow.Item?.displayName;
    if (typeof dn === "string" && dn.trim()) {
      displayName = dn.trim();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "User profile read failed";
    return json(event, 500, { error: msg });
  }

  try {
    return await issueSession({
      event,
      userId,
      email,
      displayName,
      needsProfileName: !displayName,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not mint session";
    return json(event, 500, { error: msg });
  }
}
