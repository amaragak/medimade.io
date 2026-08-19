import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { requireAdminJson } from "../lib/admin-auth";
import { jsonAuth } from "../lib/medimade-auth-http";
import {
  deleteFactoryMix,
  listFactoryMixes,
  putFactoryMix,
} from "../lib/factory-mixes";

function json(
  statusCode: number,
  payload: Record<string, unknown>,
): APIGatewayProxyStructuredResultV2 {
  return jsonAuth(statusCode, payload);
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method === "OPTIONS") return json(204, {});

  const admin = await requireAdminJson(event);
  if ("statusCode" in admin) return admin;

  try {
    if (method === "GET") {
      const mixes = await listFactoryMixes();
      return json(200, { mixes });
    }
    if (method === "PATCH") {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(event.body || "{}") as Record<string, unknown>;
      } catch {
        return json(400, { error: "Invalid JSON" });
      }
      const mix = await putFactoryMix(body);
      return json(200, { mix });
    }
    if (method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(event.body || "{}") as Record<string, unknown>;
      } catch {
        return json(400, { error: "Invalid JSON" });
      }
      const action = String(body.action ?? "").trim();
      if (action === "delete") {
        const id = String(body.id ?? "").trim();
        if (!id) return json(400, { error: "id is required" });
        await deleteFactoryMix(id);
        return json(200, { ok: true });
      }
      return json(400, { error: "Unknown action" });
    }
    return json(405, { error: "Method not allowed" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Admin factory mixes failed";
    console.error("admin-factory-mixes", msg);
    return json(500, { error: msg });
  }
}
