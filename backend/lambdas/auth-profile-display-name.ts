import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { jsonAuth, requireUserJson } from "../lib/medimade-auth-http";
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
  if (method === "OPTIONS") return options();
  if (method !== "POST") return json(405, { error: "Method not allowed" });

  const usersTable = process.env.USERS_TABLE_NAME?.trim();
  if (!usersTable) {
    return json(500, { error: "USERS_TABLE_NAME is not configured" });
  }

  const u = await requireUserJson(event);
  if (!("sub" in u)) return u;
  const auth = u;
  const email = auth.email?.trim().toLowerCase();
  if (!email) {
    return jsonAuth(401, { error: "Session is missing email" });
  }

  let body: { displayName?: unknown };
  try {
    body = JSON.parse(event.body || "{}") as { displayName?: unknown };
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const displayName = normalizeDisplayName(body.displayName);
  if (!displayName) {
    return json(400, {
      error: "displayName must be a non-empty string up to 80 characters",
    });
  }

  const now = new Date().toISOString();
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: usersTable,
        Key: { email },
        UpdateExpression:
          "SET #dn = :dn, #ua = :ua",
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
    return json(500, { error: msg });
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
    return json(500, { error: msg });
  }

  return json(200, { token: jwt, displayName });
}
