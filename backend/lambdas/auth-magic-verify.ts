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

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function json(
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

function options(): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Max-Age": "86400",
    },
    body: "",
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
      e && typeof e === "object" && "name" in e ? String((e as { name: string }).name) : "";
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

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method === "OPTIONS") return options();
  if (method !== "POST") return json(405, { error: "Method not allowed" });

  const magicTable = process.env.MAGIC_LINK_TABLE_NAME?.trim();
  const usersTable = process.env.USERS_TABLE_NAME?.trim();
  if (!magicTable || !usersTable) {
    return json(500, { error: "Auth tables are not configured" });
  }

  let body: { token?: unknown };
  try {
    body = JSON.parse(event.body || "{}") as { token?: unknown };
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const token =
    typeof body.token === "string" && body.token.trim() ? body.token.trim() : null;
  if (!token) {
    return json(400, { error: "`token` is required" });
  }

  let email: string | null = null;
  try {
    const got = await ddb.send(
      new GetCommand({ TableName: magicTable, Key: { token } }),
    );
    const item = got.Item as { email?: string; ttl?: number } | undefined;
    if (!item?.email || typeof item.email !== "string") {
      return json(400, { error: "Invalid or expired sign-in link" });
    }
    const ttl =
      typeof item.ttl === "number" && Number.isFinite(item.ttl) ? item.ttl : 0;
    if (ttl < Math.floor(Date.now() / 1000)) {
      await ddb.send(new DeleteCommand({ TableName: magicTable, Key: { token } }));
      return json(400, { error: "Sign-in link expired" });
    }
    email = item.email.trim().toLowerCase();
    await ddb.send(new DeleteCommand({ TableName: magicTable, Key: { token } }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Token lookup failed";
    return json(500, { error: msg });
  }

  if (!email) {
    return json(400, { error: "Invalid or expired sign-in link" });
  }

  let userId: string;
  try {
    userId = await getOrCreateUserId(usersTable, email);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "User lookup failed";
    return json(500, { error: msg });
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
    return json(500, { error: msg });
  }

  const needsProfileName = !displayName;

  let jwt: string;
  try {
    jwt = await signMedimadeJwt({
      sub: userId,
      email,
      name: displayName ?? undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not mint session";
    return json(500, { error: msg });
  }

  return json(200, {
    token: jwt,
    userId,
    email,
    needsProfileName,
    ...(displayName ? { displayName } : {}),
  });
}
