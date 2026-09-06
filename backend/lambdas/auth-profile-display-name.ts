import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { jsonAuth, optionsAuth, requireUserJson } from "../lib/medimade-auth-http";
import { signMedimadeJwt } from "../lib/medimade-jwt";
import {
  buildSetCookie,
  ACCESS_COOKIE,
  ACCESS_TOKEN_TTL_SEC,
  corsHeadersForEvent,
  parseCookieHeader,
  REFRESH_COOKIE,
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

function normalizeDisplayName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(/\s+/g, " ");
  if (t.length < 1 || t.length > 80) return null;
  return t;
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method === "OPTIONS") return optionsAuth(event);
  if (method !== "POST") return json(event, 405, { error: "Method not allowed" });

  const usersTable = process.env.USERS_TABLE_NAME?.trim();
  if (!usersTable) {
    return json(event, 500, { error: "USERS_TABLE_NAME is not configured" });
  }

  const u = await requireUserJson(event);
  if (!("sub" in u)) return u;
  const auth = u;
  const email = auth.email?.trim().toLowerCase();
  if (!email) {
    return jsonAuth(401, { error: "Session is missing email" }, event);
  }

  let body: { displayName?: unknown };
  try {
    body = JSON.parse(event.body || "{}") as { displayName?: unknown };
  } catch {
    return json(event, 400, { error: "Invalid JSON body" });
  }
  const displayName = normalizeDisplayName(body.displayName);
  if (!displayName) {
    return json(event, 400, {
      error: "displayName must be a non-empty string up to 80 characters",
    });
  }

  const now = new Date().toISOString();
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: usersTable,
        Key: { email },
        UpdateExpression: "SET #dn = :dn, #ua = :ua",
        ExpressionAttributeNames: {
          "#dn": "displayName",
          "#ua": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":dn": displayName,
          ":ua": now,
        },
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not save name";
    return json(event, 500, { error: msg });
  }

  const refreshTable = process.env.REFRESH_TABLE_NAME?.trim();
  const refreshRaw = parseCookieHeader(event, REFRESH_COOKIE);
  if (refreshTable && refreshRaw) {
    try {
      const tokenHash = sha256Hex(refreshRaw);
      const got = await ddb.send(
        new GetCommand({ TableName: refreshTable, Key: { tokenHash } }),
      );
      if (got.Item) {
        await ddb.send(
          new PutCommand({
            TableName: refreshTable,
            Item: {
              ...got.Item,
              displayName,
            },
          }),
        );
      }
    } catch {
      /* non-fatal */
    }
  }

  let jwt: string;
  try {
    jwt = await signMedimadeJwt({
      sub: auth.sub,
      email,
      name: displayName,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not mint session";
    return json(event, 500, { error: msg });
  }

  return json(event, 200, { token: jwt, displayName }, [
    buildSetCookie(ACCESS_COOKIE, jwt, ACCESS_TOKEN_TTL_SEC),
  ]);
}
