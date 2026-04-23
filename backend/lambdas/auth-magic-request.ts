import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomBytes } from "crypto";
import { sendEmailBrevo } from "../lib/medimade-email";

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

function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  if (!e || e.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method === "OPTIONS") return options();
  if (method !== "POST") return json(405, { error: "Method not allowed" });

  const table = process.env.MAGIC_LINK_TABLE_NAME?.trim();
  const from = process.env.AUTH_EMAIL_FROM?.trim();
  const webOrigin = process.env.AUTH_WEBAPP_ORIGIN?.trim().replace(/\/$/, "");
  const brevoSecret = process.env.BREVO_SECRET_NAME?.trim();
  if (!table || !from || !webOrigin || !brevoSecret) {
    return json(500, {
      error:
        "Auth email is not configured (set MAGIC_LINK_TABLE_NAME, AUTH_EMAIL_FROM, AUTH_WEBAPP_ORIGIN, BREVO_SECRET_NAME on the Lambda)",
    });
  }

  let body: { email?: unknown };
  try {
    body = JSON.parse(event.body || "{}") as { email?: unknown };
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : null;
  if (!email) {
    return json(400, { error: "Valid `email` is required" });
  }

  const token = randomBytes(24).toString("hex");
  const nowSec = Math.floor(Date.now() / 1000);
  const ttl = nowSec + 15 * 60;

  try {
    await ddb.send(
      new PutCommand({
        TableName: table,
        Item: {
          token,
          email,
          ttl,
          createdAt: new Date().toISOString(),
        },
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not store magic link";
    return json(500, { error: msg });
  }

  const link = `${webOrigin}/auth/verify?token=${encodeURIComponent(token)}`;
  const subject = "Sign in to medimade.io";
  const text = `Open this link to sign in (expires in 15 minutes):\n\n${link}\n\nIf you did not request this, you can ignore this email.`;

  try {
    await sendEmailBrevo({
      fromEmail: from,
      fromName: "medimade.io",
      toEmail: email,
      subject,
      text,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Brevo send failed";
    return json(502, {
      error:
        "Could not send sign-in email (Brevo). Check BREVO API key secret and that the sender email is allowed in Brevo.",
      detail: String(msg).slice(0, 800),
    });
  }

  return json(200, { ok: true });
}
