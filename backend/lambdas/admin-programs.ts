import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { requireAdminJson } from "../lib/admin-auth";
import { jsonAuth } from "../lib/medimade-auth-http";
import {
  generateProgramDayDescription,
} from "../lib/program-day-description";
import {
  deleteProgram,
  listPrograms,
  putProgram,
} from "../lib/programs";

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
      const programs = await listPrograms();
      return json(200, { programs });
    }
    if (method === "PATCH") {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(event.body || "{}") as Record<string, unknown>;
      } catch {
        return json(400, { error: "Invalid JSON" });
      }
      const program = await putProgram(body);
      return json(200, { program });
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
        await deleteProgram(id);
        return json(200, { ok: true });
      }
      if (action === "describe-day") {
        const prompt = String(body.prompt ?? "").trim();
        if (!prompt) return json(400, { error: "prompt is required" });
        const description = await generateProgramDayDescription({
          prompt,
          title: typeof body.title === "string" ? body.title : "",
          programTitle:
            typeof body.programTitle === "string" ? body.programTitle : "",
        });
        return json(200, { description });
      }
      return json(400, { error: "Unknown action" });
    }
    return json(405, { error: "Method not allowed" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Admin programs failed";
    console.error("admin-programs", msg);
    return json(500, { error: msg });
  }
}